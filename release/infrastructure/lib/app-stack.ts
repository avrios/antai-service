import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_ecr as ecr, aws_logs as logs, aws_rds as rds } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import {
    AvrAppStack,
    AvrAppStackProps,
    AvrFargateService,
    AvrRdsInstance,
    AvrServiceDlqMonitor,
    AvrStage,
    AvrStageConfig,
    FleetFargateContainerProps,
} from '@avrios/avr-cdk-utils';

interface AppStackProps extends AvrAppStackProps {
    readonly repository: ecr.Repository;
    readonly taskContainerProps?: FleetFargateContainerProps;
}

export class AppStack extends AvrAppStack {
    protected readonly props: AppStackProps;
    public readonly fargateService: AvrFargateService;

    constructor(scope: Construct, props: AppStackProps) {
        super(scope, props);

        this.props = props;

        this.fargateService = new AvrFargateService(this, {
            serviceShortName: this.props.serviceShortName,
            stage: this.props.stage,
            repository: this.props.repository,
            taskContainerProps: this.props.taskContainerProps,
            addApiGatewayOptionsCors: false,
        });

        const rdsInstance = new AvrRdsInstance(this, {
            stage: this.props.stage,
            serviceShortName: this.props.serviceShortName,
            allocatedStorage: AvrStageConfig.all(100),
            maxAllocatedStorage: AvrStageConfig.all(200),
            instanceType: AvrStageConfig.all(ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO)),
            storageType: AvrStageConfig.all(rds.StorageType.GP3),
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_17_6,
            }),
            backupRetention: AvrStageConfig.each(cdk.Duration.days(0), cdk.Duration.days(5), cdk.Duration.days(0), cdk.Duration.days(5)),
            cloudwatchLogsRetention: AvrStageConfig.all(logs.RetentionDays.ONE_WEEK),
            enhancedMonitoringInterval: AvrStageConfig.allButProd(undefined, 60),
        });

        // Ensure Fargate is created before RDS deployment starts
        this.fargateService.node.addDependency();

        // Add ingress rule to allow Fargate to connect to RDS
        rdsInstance.dbSecurityGroup.addIngressRule(
            ec2.Peer.securityGroupId(this.fargateService.serviceSecurityGroup.securityGroupId),
            ec2.Port.tcp(5432),
            `Allow ${this.fargateService.serviceSecurityGroup.securityGroupId}`,
        );

        new AvrServiceDlqMonitor(this, {
            stage: this.props.stage,
            serviceShortName: this.props.serviceShortName,
            slackChannelIdentifier: '@slack-Vimcar-avrios-platform-alerts',
        });
    }
}

export class AntaiDevStack extends cdk.Stack {
    constructor(scope: Construct, serviceShortName: string) {
        super(scope, `${AvrStage.DEV.identifier}-${serviceShortName}-resources`, {
            env: AvrStage.DEV.account.env,
        });
    }
}
