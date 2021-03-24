#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as apiGw from '@aws-cdk/aws-apigateway';
import * as iam from '@aws-cdk/aws-iam';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecsPatterns from '@aws-cdk/aws-ecs-patterns';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as logs from '@aws-cdk/aws-logs';
import * as ssm from '@aws-cdk/aws-ssm';
import * as uuid from 'uuid';

import { Stage } from 'avr-cdk-utils';

class FargateServiceNaming {
    readonly shortName: string;
    readonly serviceName: string;
    readonly stageAwareServiceName: string;

    constructor(shortName: string, stage: Stage) {
        this.shortName = shortName;
        this.serviceName = `${shortName}-service`;
        this.stageAwareServiceName = `${stage.identifier}-${this.shortName}-fargate`;
    }
}

export interface FargateContainerProps {
    /**
     * Number of vCPUs. Can be 0.25, 0.5, 1, 2, or 4.
     * Validity can be checked at https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html.
     * Represents 1024 * cpuMultiplier of cpu.
     */
    readonly cpuMultiplier?: number;

    /**
     * Multiplier from cpu value to memory value. Only certain values are allowed for a given cpuMultiplier
     * Validity can be checked at https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html
     * Represents 1024 * cpuMultiplier * memoryMultiplier MiB of memory
     */
    readonly memoryMultiplier?: number;
}

export interface FargateServiceProps {
    readonly containerPort?: number;
    readonly taskContainerProps?: FargateContainerProps;
    readonly jdkJavaOptions?: string[];
    readonly logsAgentHost?: string;
    readonly taskHealthCheckGracePeriod?: number;
}

interface CompleteFargateContainerProps {
    readonly cpu: number;
    readonly memory: number;
}

interface CompleteFargateStackProps {
    readonly containerPort: number;
    readonly taskContainerProps: CompleteFargateContainerProps;
    readonly jdkJavaOptions: string[];
    readonly logsAgentHost: string;
    readonly taskHealthCheckGracePeriod: number;
}

export class AvrFargateService extends cdk.Construct {
    private static readonly DEFAULT_CONTAINER_PORT = 8080;
    private static readonly DEFAULT_LOGS_AGENT_HOST = 'http-intake.logs.datadoghq.eu';
    private static readonly DEFAULT_HEALTH_CHECK_GRACE_PERIOD = 60;

    private static readonly DEFAULT_CPU_MULTIPLIER = 1;
    private static readonly DEFAULT_MEMORY_MULTIPLIER = 2;
    private static readonly DEFAULT_MAX_RAM_PERCENTAGE = 0.75;

    public readonly image: ecs.TagParameterContainerImage;
    public readonly fargateService: ecs.FargateService;

    private readonly stage: Stage;
    private readonly serviceNaming: FargateServiceNaming;
    private readonly stackProps: CompleteFargateStackProps;

    constructor(scope: cdk.Stack, serviceShortName: string, stage: Stage, repository: ecr.Repository, stackProps?: FargateServiceProps) {
        const serviceNaming = new FargateServiceNaming(serviceShortName, stage);
        super(scope, serviceNaming.stageAwareServiceName);

        this.serviceNaming = serviceNaming;
        this.stage = stage;

        this.stackProps = AvrFargateService.defaultMissingValues(stackProps);

        this.image = new ecs.TagParameterContainerImage(repository);

        const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.stage.vpcId });

        this.fargateService = this.createFargateService(vpc);

        const targetGroup = this.setupServiceTargetGroup(vpc);
        this.setupRoutingRule(targetGroup);

        this.setupApiGwRouting();
    }

    private createFargateService(vpc: ec2.IVpc): ecs.FargateService {
        const cluster = this.fetchFargateCluster(vpc);
        const taskDefinition = this.createTaskDefinition();

        const datadogApiKey = ssm.StringParameter.valueForStringParameter(this, `/${this.stage.identifier}/datadog/apikey`);
        const defaultJavaOptions = this.compileDefaultJavaOptions(this.stackProps.jdkJavaOptions);

        const containerDefinition = taskDefinition.addContainer(this.serviceNaming.serviceName, {
            image: this.image,
            logging: this.setupFirelensLogs(datadogApiKey),
            environment: {
                defaultJavaOptions,
                'DD_ENV': this.stage.identifier,
                'DD_JMXFETCH_ENABLED': 'true',
                'DD_LOGS_INJECTION': 'true',
                'DD_PROFILING_ENABLED': 'true',
                'DD_SERVICE_MAPPING': `${this.serviceNaming.shortName}:${this.serviceNaming.serviceName}`,
                'DD_TRACE_ANALYTICS_ENABLED': 'true'
            },
            memoryReservationMiB: this.stackProps.taskContainerProps.memory * AvrFargateService.DEFAULT_MAX_RAM_PERCENTAGE
        });

        containerDefinition.addPortMappings({
            containerPort: this.stackProps.containerPort
        });

        this.setupMonitoring(taskDefinition, datadogApiKey);

        const fargateService = new ecs.FargateService(this, this.serviceNaming.stageAwareServiceName, {
            serviceName: this.serviceNaming.serviceName,
            cluster,
            taskDefinition,
            healthCheckGracePeriod: cdk.Duration.seconds(this.stackProps.taskHealthCheckGracePeriod),
            securityGroup: this.setServiceSecurityGroup(vpc),
            assignPublicIp: true,
            desiredCount: 1,
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
        });

        // allow applications in ECS cluster accessing our RDS instance
        const groupId = 'rds-security-group';
        const rdsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, groupId, this.stage.rdsSecurityGroup);
        fargateService.connections.securityGroups.forEach(securityGroup => {
            rdsSecurityGroup.connections.allowFrom(securityGroup, ec2.Port.tcp(5432), 'ECS Cluster for BE services')
        });

        return fargateService;
    }

    private setServiceSecurityGroup(vpc: ec2.IVpc): ec2.SecurityGroup {
        const serviceSecurityGroup = new ec2.SecurityGroup(this, `security-group-${this.stage.identifier}`, {
            securityGroupName: `${this.serviceNaming.serviceName}-sg`,
            description: `Security group of ECS service: ${this.serviceNaming.serviceName}`,
            vpc,
            allowAllOutbound: true
        });

        const loadBalancerSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, `alb-security-group-${this.stage.identifier}`,
            this.stage.getLoadBalancerSecurityGroupId());

        serviceSecurityGroup.addIngressRule(loadBalancerSecurityGroup, ec2.Port.tcp(this.stackProps.containerPort),
            'Load balancer to target.');

        return serviceSecurityGroup;
    }

    private createTaskDefinition(): ecs.FargateTaskDefinition {
        return new ecs.FargateTaskDefinition(this, `taskdef-${this.stage.identifier}`, {
            cpu: this.stackProps.taskContainerProps.cpu,
            memoryLimitMiB: this.stackProps.taskContainerProps.memory,
            executionRole: new iam.Role(this, `taskexec-${this.stage.identifier}`, {
                roleName: cdk.PhysicalName.GENERATE_IF_NEEDED,
                assumedBy: new iam.CompositePrincipal(
                    new iam.ServicePrincipal('ecs.amazonaws.com'),
                    new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
                ),
            })
        });
    }

    private setupMonitoring(taskDefinition: ecs.FargateTaskDefinition, datadogApiKey: string): void {
        this.setupApmAgent(taskDefinition, datadogApiKey);
        this.setupLogAgent(taskDefinition);
    }

    private setupApmAgent(taskDefinition: ecs.FargateTaskDefinition, datadogApiKey: string): void {
        taskDefinition.addContainer('datadog-agent', {
            image: ecs.ContainerImage.fromRegistry(`datadog/agent:latest`),
            environment: {
                'DD_API_KEY': datadogApiKey,
                'DD_APM_ENABLED': 'true',
                'DD_DOGSTATSD_NON_LOCAL_TRAFFIC': 'true',
                'DD_DOGSTATSD_TAGS': `["env:${this.stage.identifier}"]`,
                'DD_ENV': this.stage.identifier,
                'DD_SERVICE': this.serviceNaming.serviceName,
                'DD_SITE': 'datadoghq.eu',
                'DD_VERSION': `${this.image.tagParameterValue}`,
                'ECS_FARGATE': 'true'
            },
            logging: this.setupCloudWatchLogGroup('datadog-agent')
        });
    }

    private setupLogAgent(taskDefinition: ecs.FargateTaskDefinition): void {
        let image = ecs.obtainDefaultFluentBitECRImage(taskDefinition, {
            logDriver: 'awsfirelens',

        });
        taskDefinition.addFirelensLogRouter('log-router', {
            firelensConfig: {
                type: ecs.FirelensLogRouterType.FLUENTBIT
            },
            logging: this.setupCloudWatchLogGroup('log-router'),
            image
        })
    }

    private setupCloudWatchLogGroup(logGroupName: string): ecs.LogDriver {
        return ecs.LogDriver.awsLogs({
            streamPrefix: `${logGroupName}-${this.stage.identifier}`,
            logGroup: new logs.LogGroup(this, `${logGroupName}-log-group`, {
                logGroupName: `${this.serviceNaming.stageAwareServiceName}-${logGroupName}`,
                retention: logs.RetentionDays.FIVE_DAYS,
                removalPolicy: cdk.RemovalPolicy.DESTROY
            })
        });
    }

    private fetchFargateCluster(vpc: ec2.IVpc): ecs.ICluster {
        return ecs.Cluster.fromClusterAttributes(this, `service-cluster-${this.stage.identifier}`, {
            clusterName: this.stage.getServicesClusterName(),
            clusterArn: this.stage.getServicesClusterArn(),
            vpc,
            securityGroups: []
        })
    }

    private setupFirelensLogs(datadogApiKey: string): ecs.LogDriver {
        return new ecs.FireLensLogDriver({
            options: {
                'enable-ecs-log-metadata': 'true',
                'apiKey': datadogApiKey,
                'provider': 'ecs',
                'dd_service': this.serviceNaming.serviceName,
                'Host': this.stackProps.logsAgentHost,
                'TLS': 'on',
                'dd_source': 'java',
                'dd_tags': `env:${this.stage.identifier}`,
                'Name': 'datadog'
            }
        });
    }

    private setupServiceTargetGroup(vpc: ec2.IVpc): elbv2.ApplicationTargetGroup {
        return new elbv2.ApplicationTargetGroup(this, `${this.serviceNaming.serviceName}-tg`, {
            protocol: elbv2.ApplicationProtocol.HTTP,
            port: 80,
            targets: [this.fargateService],
            targetGroupName: `${this.serviceNaming.serviceName}-tg`,
            vpc,
            healthCheck: {
                path: `/${this.serviceNaming.shortName}/healthCheck`,
                port: `${this.stackProps.containerPort}`,
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 8,
                timeout: cdk.Duration.seconds(2),
                interval: cdk.Duration.seconds(20)
            },
            targetType: elbv2.TargetType.IP,
            deregistrationDelay: cdk.Duration.seconds(30)
        });
    }

    private setupRoutingRule(targetGroup: elbv2.ApplicationTargetGroup): void {
        const httpListener = this.fetchHttpListener();

        new elbv2.ApplicationListenerRule(this, `${this.serviceNaming.serviceName}-forward-rule-${this.stage.identifier}`, {
            listener: httpListener,
            priority: 11,
            action: elbv2.ListenerAction.forward([targetGroup]),
            conditions: [elbv2.ListenerCondition.pathPatterns([`/${this.serviceNaming.shortName}/*`])]
        });
    }

    private fetchHttpListener(): elbv2.IApplicationListener {
        const httpListenerId = `alb-listener-${this.stage.identifier}`;
        return elbv2.ApplicationListener.fromApplicationListenerAttributes(this, httpListenerId, {
            listenerArn: this.stage.getHttpListenerArn(),
            securityGroupId: this.stage.getLoadBalancerSecurityGroupId()
        })
    }

    private setupApiGwRouting(): void {
        const api = this.getApiGwRootResource();

        this.addProxyResource(api.root);

        const description = `Deployment triggered by: ${this.serviceNaming.shortName}`;
        const deployment = new apiGw.Deployment(this, `gateway-deployment-${uuid.v4()}`, { api, description });

        // @ts-ignore Setting this property allows us to release against an existing stage despite cdk not properly supporting it.
        deployment.resource.stageName = this.stage.identifier;
    }

    private getApiGwRootResource(): apiGw.IRestApi {
        return apiGw.RestApi.fromRestApiAttributes(this, `Avrios API: ${this.stage.identifier}`, {
            restApiId: this.stage.getRestApiId(),
            rootResourceId: this.stage.getRestApiRootResourceId()
        });
    }

    private addProxyResource(rootResource: apiGw.IResource): void {
        const serviceResource = rootResource.addResource(this.serviceNaming.shortName);

        const proxyResource = serviceResource.addResource('{proxy+}', {
            defaultCorsPreflightOptions: {
                allowCredentials: true,
                allowHeaders: ['x-auth-token', 'x-auth-id-token', 'x-auth-access-token', 'x-filename',
                    'x-app-path', 'x-app-version', 'x-handle-error-types', 'x-reset-token', 'content-type'],
                allowMethods: ['OPTIONS', 'GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
                allowOrigins: [this.stage.baseUrl],
                maxAge: cdk.Duration.seconds(7200)
            }
        });

        const integration = new apiGw.Integration({
            type: apiGw.IntegrationType.HTTP_PROXY,
            uri: this.getAlbUrl(this.serviceNaming.shortName),
            integrationHttpMethod: 'ANY',
            options: {
                cacheKeyParameters: ['method.request.path.proxy'],
                requestParameters: {
                    'integration.request.path.proxy': 'method.request.path.proxy'
                },
                passthroughBehavior: apiGw.PassthroughBehavior.WHEN_NO_MATCH
            }
        });

        proxyResource.addMethod('ANY', integration, {
            authorizationType: apiGw.AuthorizationType.CUSTOM,
            authorizer: {
                authorizerId: this.stage.getRestApiAuthorizerId(),
            },
            methodResponses: [{
                statusCode: '200',
                responseModels: {
                    'application/json': apiGw.Model.EMPTY_MODEL
                }
            }],
            requestParameters: {
                'method.request.path.proxy': true
            }
        });
    }

    private getAlbUrl(contextName: string): string {
        return `http://${this.stage.getAlbDns()}/${contextName}/{proxy}`;
    }

    private static defaultMissingValues(stackProps: FargateServiceProps | undefined): CompleteFargateStackProps {
        const taskContainerProps = AvrFargateService.completeContainerProps(stackProps?.taskContainerProps);

        const containerPort = stackProps?.containerPort ? stackProps?.containerPort : AvrFargateService.DEFAULT_CONTAINER_PORT;
        const logsAgentHost = stackProps?.logsAgentHost ? stackProps?.logsAgentHost : AvrFargateService.DEFAULT_LOGS_AGENT_HOST;
        const jdkJavaOptions = stackProps?.jdkJavaOptions ? stackProps?.jdkJavaOptions : [];
        const taskHealthCheckGracePeriod = stackProps?.taskHealthCheckGracePeriod ?
            stackProps?.taskHealthCheckGracePeriod :
            AvrFargateService.DEFAULT_HEALTH_CHECK_GRACE_PERIOD;

        return {
            containerPort,
            logsAgentHost,
            taskContainerProps,
            jdkJavaOptions,
            taskHealthCheckGracePeriod,
        };
    }

    private static completeContainerProps(taskContainer: FargateContainerProps | undefined): CompleteFargateContainerProps {
        const cpuMultiplier = taskContainer?.cpuMultiplier ? taskContainer?.cpuMultiplier : AvrFargateService.DEFAULT_CPU_MULTIPLIER;
        const memoryMultiplier = taskContainer?.memoryMultiplier ? taskContainer?.memoryMultiplier : AvrFargateService.DEFAULT_MEMORY_MULTIPLIER;
        const cpu = cpuMultiplier * 1024;
        const memory = memoryMultiplier * cpu;
        return {
            cpu,
            memory,
        };
    }

    private compileDefaultJavaOptions(defaultJavaOptions: string[]): string {
        const password = ssm.StringParameter.valueForStringParameter(this, `/${this.stage.identifier}/encryptor.password`);
        defaultJavaOptions.push(`-Djasypt.encryptor.password=${password}`);

        defaultJavaOptions.push(`-Dspring.profiles.active=${this.stage.identifier}`);
        defaultJavaOptions.push(`-Dcom.avrios.service.name=${this.serviceNaming.serviceName}`);
        defaultJavaOptions.push(`-XX:+UseThreadPriorities`);
        defaultJavaOptions.push(`-XX:MaxRAMPercentage=${AvrFargateService.DEFAULT_MAX_RAM_PERCENTAGE * 100}`);

        return defaultJavaOptions.map(option => `${option.trim()}`).join(' ');
    }
}
