#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as logs from '@aws-cdk/aws-logs';
import * as apiGw from '@aws-cdk/aws-apigateway';
import {
    ApplicationLoadBalancedTaskImageOptions,
    ApplicationLoadBalancedFargateService
} from '@aws-cdk/aws-ecs-patterns';
import { Repository } from '@aws-cdk/aws-ecr';
import { StringParameter } from '@aws-cdk/aws-ssm';
import { ManagedPolicy } from '@aws-cdk/aws-iam';

import { Stage } from 'avr-cdk-utils';
import {
    INTERNAL_NAME,
    INTERNAL_NAME_SHORT,
    CONTAINER_PORT,
    TASK_CPU,
    TASK_MEMORY_LIMIT_MIB,
    TRACKING_AGENT_TASK_CPU,
    TRACKING_AGENT_MEMORY_LIMIT_MIB,
    LOGS_ROUTER_TASK_CPU,
    LOGS_ROUTER_MEMORY_LIMIT_MIB,
    TASK_HEALTH_CHECK_GRACE_PERIOD,
    SERVICE_XMS,
    SERVICE_XMX,
    LOGS_AGENT_HOST
} from './project-settings'

export interface StageAwareStackProps extends cdk.StackProps {
    stage: Stage;
}

export class FargateStack extends cdk.Stack {
    private readonly stage: Stage;
    public readonly fargateService: ecs.FargateService;

    constructor(scope: cdk.Construct, id: string, props: StageAwareStackProps) {
        super(scope, id, props);

        this.stage = props.stage;

        const loadBalancedFargateService = this.createFargateService();
        this.fargateService = loadBalancedFargateService.service;

        this.setupSecurityGroupHealthCheck(loadBalancedFargateService.targetGroup);
        this.setupTargetGroupAttributes(loadBalancedFargateService.targetGroup);
        this.setupRoutingRule(loadBalancedFargateService.targetGroup);
        this.setupExecutionRole(loadBalancedFargateService);

        this.setupApiGwRouting();
    }

    private createFargateService(): ApplicationLoadBalancedFargateService {
        const vpc = ec2.Vpc.fromLookup(this, 'VPC', { vpcId: this.stage.vpcId });

        const cluster = this.fetchCluster(vpc);

        // create a load-balanced Fargate service and make it private
        const fargateServiceId = `${INTERNAL_NAME}-${this.stage.identifier}`;
        const fargateService = new ApplicationLoadBalancedFargateService(this, fargateServiceId, {
            serviceName: `${INTERNAL_NAME}`,
            cluster,
            cpu: TASK_CPU,
            memoryLimitMiB: TASK_MEMORY_LIMIT_MIB,
            taskImageOptions: this.getTaskImageOptions(),
            healthCheckGracePeriod: cdk.Duration.seconds(TASK_HEALTH_CHECK_GRACE_PERIOD),
            desiredCount: 1,
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            assignPublicIp: true,
            publicLoadBalancer: true,
            /** By default cdk needs to create a listener (¯\_(ツ)_/¯), we set this port because by default 80 is used
             * which clashes with the application load balancer listener.
             */
            listenerPort: 1235,
            loadBalancer: this.fetchLoadBalancer(vpc)
        });

        this.setupLogging(fargateService.taskDefinition);

        // allow applications in ECS cluster accessing our RDS instance
        const groupId = 'rds-security-group';
        const rdsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, groupId, this.stage.rdsSecurityGroup);
        fargateService.service.connections.securityGroups.forEach(securityGroup => {
            rdsSecurityGroup.connections.allowFrom(securityGroup, ec2.Port.tcp(5432), 'ECS Cluster for BE services')
        });

        return fargateService;
    }

    private setupLogging(taskDefinition: ecs.FargateTaskDefinition): void {
        this.setupApmAgent(taskDefinition);
        this.setupLogAgent(taskDefinition);
    }

    private setupApmAgent(taskDefinition: ecs.FargateTaskDefinition): void {
        taskDefinition.addContainer('datadog-agent', {
            image: ecs.ContainerImage.fromRegistry(`datadog/agent:latest`),
            cpu: TRACKING_AGENT_TASK_CPU,
            memoryReservationMiB: TRACKING_AGENT_MEMORY_LIMIT_MIB,
            environment: {
                'DD_API_KEY': this.getLogsAgentApiKey(),
                'DD_APM_ENABLED': 'true',
                'DD_DOGSTATSD_NON_LOCAL_TRAFFIC': 'true',
                'DD_DOGSTATSD_TAGS': `["env:${this.stage.identifier}"]`,
                'DD_ENV': this.stage.identifier,
                'DD_SERVICE': INTERNAL_NAME,
                'DD_SITE': 'datadoghq.eu',
                'ECS_FARGATE': 'true'
            },
            logging: this.setupCloudWatchLogGroup('datadog-agent'),
            essential: true
        });
    }

    private setupLogAgent(taskDefinition: ecs.FargateTaskDefinition): void {
        taskDefinition.addFirelensLogRouter('log-router', {
            firelensConfig: {
                type: ecs.FirelensLogRouterType.FLUENTBIT
            },
            logging: this.setupCloudWatchLogGroup('log-router'),
            image: ecs.ContainerImage.fromRegistry('906394416424.dkr.ecr.eu-central-1.amazonaws.com/aws-for-fluent-bit:latest'),
            essential: true,
            memoryReservationMiB: LOGS_ROUTER_MEMORY_LIMIT_MIB,
            cpu: LOGS_ROUTER_TASK_CPU
        })
    }

    private setupCloudWatchLogGroup(logGroupName: string): ecs.LogDriver {
        return ecs.LogDriver.awsLogs({
            streamPrefix: `${logGroupName}-${this.stage.identifier}`,
            logGroup: new logs.LogGroup(this, `${logGroupName}-log-group`, {
                logGroupName: `${logGroupName}-${INTERNAL_NAME}-${this.stage.identifier}`,
                retention: logs.RetentionDays.FIVE_DAYS
            })
        });
    }

    private getLogsAgentApiKey(): string {
        return StringParameter.valueForStringParameter(this, `/${this.stage.identifier}/datadog/apikey`);
    }

    private fetchCluster(vpc: ec2.IVpc): ecs.ICluster {
        return ecs.Cluster.fromClusterAttributes(this, `service-cluster-${this.stage.identifier}`, {
            clusterName: this.stage.getServicesClusterName(),
            clusterArn: this.stage.getServicesClusterArn(),
            vpc,
            securityGroups: []
        })
    }

    private getTaskImageOptions(): ApplicationLoadBalancedTaskImageOptions {
        const password = StringParameter.valueForStringParameter(this, `/${this.stage.identifier}/encryptor.password`);
        const ecrRepoArn = `arn:aws:ecr:${Stage.TEST.env.region}:${Stage.TEST.env.account}:repository/${INTERNAL_NAME}`
        return {
            containerName: INTERNAL_NAME,
            image: ecs.ContainerImage.fromEcrRepository(Repository.fromRepositoryArn(this, 'ecr-repo', ecrRepoArn)),
            containerPort: CONTAINER_PORT,
            logDriver: this.setupFirelensLogs(),
            environment: {
                'APP_NAME': INTERNAL_NAME,
                'ENCRYPTOR_PASSWORD': password,
                'STAGE': this.stage.identifier,
                'XMS': `${SERVICE_XMS}m`,
                'XMX': `${SERVICE_XMX}m`,
                'DD_ENV': this.stage.identifier,
                'DD_JMXFETCH_ENABLED': 'true',
                'DD_LOGS_INJECTION': 'true',
                'DD_PROFILING_ENABLED': 'true',
                'DD_SERVICE_MAPPING': `${INTERNAL_NAME_SHORT}:${INTERNAL_NAME}`,
                'DD_TRACE_ANALYTICS_ENABLED': 'true'
            }
        };
    }

    private setupFirelensLogs(): ecs.LogDriver {
        return new ecs.FireLensLogDriver({
            options: {
                'enable-ecs-log-metadata': 'true',
                'apiKey': this.getLogsAgentApiKey(),
                'provider': 'ecs',
                'dd_service': INTERNAL_NAME,
                'Host': LOGS_AGENT_HOST,
                'TLS': 'on',
                'dd_source': 'java',
                'dd_tags': `env:${this.stage.identifier}`,
                'Name': 'datadog'
            }
        });
    }

    private fetchLoadBalancer(vpc: ec2.IVpc): elbv2.IApplicationLoadBalancer {
        const albId = `alb-${this.stage.identifier}`;
        return elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, albId, {
            vpc,
            securityGroupId: this.stage.getLoadBalancerSecurityGroupId(),
            loadBalancerArn: this.stage.getLoadBalancerArn(),
            loadBalancerDnsName: this.stage.getLoadBalancerDnsName()
        });
    }

    private setupSecurityGroupHealthCheck(targetGroup: elbv2.ApplicationTargetGroup): void {
        targetGroup.configureHealthCheck({
            path: `/${INTERNAL_NAME_SHORT}/healthCheck`,
            port: `${CONTAINER_PORT}`,
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 8,
            timeout: cdk.Duration.seconds(2),
            interval: cdk.Duration.seconds(20)
        });
    }

    private setupTargetGroupAttributes(targetGroup: elbv2.ApplicationTargetGroup): void {
        // once a new target is healthy, make the deregistration quicker.
        targetGroup.setAttribute('deregistration_delay.timeout_seconds', '30')
    }

    private setupRoutingRule(targetGroup: elbv2.ApplicationTargetGroup): void {
        const httpListener = this.fetchHttpListener();

        new elbv2.ApplicationListenerRule(this, `${INTERNAL_NAME}-forward-rule-${this.stage.identifier}`, {
            listener: httpListener,
            priority: 2,
            action: elbv2.ListenerAction.forward([targetGroup]),
            conditions: [elbv2.ListenerCondition.pathPatterns([`/${INTERNAL_NAME_SHORT}/*`])]
        });
    }

    private fetchHttpListener(): elbv2.IApplicationListener {
        const httpListenerId = `alb-listener-${this.stage.identifier}`;
        return elbv2.ApplicationListener.fromApplicationListenerAttributes(this, httpListenerId, {
            listenerArn: this.stage.getHttpListenerArn(),
            securityGroupId: this.stage.getLoadBalancerSecurityGroupId()
        })
    }

    private setupExecutionRole(fargateService: ApplicationLoadBalancedFargateService): void {
        fargateService.taskDefinition.executionRole?.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'));
    }


    private setupApiGwRouting(): void {
        const rootResource = this.getApiGwRootResourceId();

        // ANY /models-service/{proxy}
        this.addProxyResource(rootResource, INTERNAL_NAME_SHORT);
    }

    private getApiGwRootResourceId(): apiGw.IResource {
        const apiGateway = apiGw.RestApi.fromRestApiAttributes(this, `Avrios API: ${this.stage.identifier}`, {
            restApiId: this.stage.getRestApiId(),
            rootResourceId: this.stage.getRestApiRootResourceId()
        });

        return apiGateway.root;
    }

    private addProxyResource(rootResource: apiGw.IResource, contextName: string): void {
        // /models/
        const serviceResource = rootResource.addResource(contextName);

        // /models/{proxy+}
        const proxyResource = serviceResource.addResource('{proxy+}', {
            defaultCorsPreflightOptions: {
                allowCredentials: true,
                allowHeaders: [ 'x-auth-token', 'x-auth-id-token', 'x-auth-access-token', 'x-filename',
                    'x-app-path', 'x-app-version', 'x-handle-error-types', 'x-reset-token', 'content-type' ],
                allowMethods: [ 'OPTIONS', 'GET', 'HEAD', 'POST', 'PUT', 'DELETE' ],
                allowOrigins: [this.stage.baseUrl],
                maxAge: cdk.Duration.seconds(7200)
            }
        });

        const integration = new apiGw.Integration({
            type: apiGw.IntegrationType.HTTP_PROXY,
            uri: this.getAlbUrl(contextName),
            integrationHttpMethod: 'ANY',
            options: {
                cacheKeyParameters: [ 'method.request.path.proxy' ],
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
}
