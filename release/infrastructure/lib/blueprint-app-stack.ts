#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';
import { aws_ecr as ecr } from 'aws-cdk-lib';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { aws_rds as rds } from 'aws-cdk-lib';
import { aws_logs as logs } from 'aws-cdk-lib';
import { Construct } from 'constructs'

import {
    AvrAppStack,
    AvrAppStackProps,
    AvrFargateService,
    AvrFargateContainerProps,
    AvrJobConfig,
    AvrJob,
    AvrTopic,
    AvrQueue,
    AvrRdsInstance,
    AvrServiceDlqMonitor,
    AvrStage,
    AvrStageConfig,
    AvrAwsAccount,
} from 'avr-cdk-utils';

interface BlueprintAppStackProps extends AvrAppStackProps {
    readonly repository: ecr.Repository;
    readonly taskContainerProps?: AvrFargateContainerProps;
}

export class BlueprintAppStack extends AvrAppStack {
    protected readonly props: BlueprintAppStackProps;
    public readonly fargateService: AvrFargateService;

    constructor(scope: Construct, props: BlueprintAppStackProps) {
        super(scope, props);

        this.props = props;

        this.fargateService = new AvrFargateService(this, {
            serviceShortName: this.props.serviceShortName,
            stage: this.props.stage,
            repository: this.props.repository,
            taskContainerProps: this.props.taskContainerProps
        });

        new AvrRdsInstance(this, {
            stage: this.props.stage,
            serviceShortName: this.props.serviceShortName,
            allocatedStorage: AvrStageConfig.all(100),
            maxAllocatedStorage: AvrStageConfig.all(200),
            instanceType: AvrStageConfig.all(ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO)),
            storageType: AvrStageConfig.all(rds.StorageType.GP2),
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_14_1,
            }),
            backupRetention: AvrStageConfig.each(
                cdk.Duration.days(0),
                cdk.Duration.days(1),
                cdk.Duration.days(0),
                cdk.Duration.days(0)),
            cloudwatchLogsRetention: AvrStageConfig.all(logs.RetentionDays.ONE_WEEK),

            dbInstanceIdentifier: `${this.props.stage.identifier}-${this.props.serviceShortName}`,
            dbSecurityGroupsIngressSources: [
                this.fargateService.serviceSecurityGroup,
            ],
        });

        new BlueprintResources(this, this.props.stage, this.fargateService.getTaskRole());

        new AvrServiceDlqMonitor(this, {
            stage: this.props.stage,
            serviceShortName: this.props.serviceShortName,
            slackChannelIdentifier: '@slack-blueprint-alerts'
        });
    }
}

export class BlueprintDevStack extends cdk.Stack {
    constructor(scope: Construct, serviceShortName: string) {
        super(scope, `${AvrStage.DEV.identifier}-${serviceShortName}-resources`, {
            env: AvrStage.DEV.env
        });

        new BlueprintResources(this, AvrStage.DEV);
    }
}

export class BlueprintResources {
    constructor(scope: Construct, stage: AvrStage, taskRole?: iam.IGrantable) {
        // sample resources
        const testTopic = new AvrTopic(scope, {
            topicName: 'blueprint-events',
            stage,
            publishMessagesGrantee: taskRole
        });

        new AvrQueue(scope, {
            queueName: 'blueprint-events',
            stage,
            topic: testTopic.topic,
            consumeMessagesGrantee: taskRole
        });

        new AvrJob(scope, {
            serviceShortName: 'blueprint',
            jobName: 'simple',
            config: new Map<AvrStage, AvrJobConfig>([
                [AvrStage.PROD, { expression: 'cron(1 3 * * ? *)', enabled: true }],
                [AvrStage.STAGING, { expression: 'cron(1 3 * * ? *)', enabled: true }],
                [AvrStage.TEST, { expression: 'cron(1 4 * * ? *)', enabled: true }],
                [AvrStage.DEV, { expression: 'rate(1 hour)', enabled: true }],
            ]),
            stage,
            consumeMessagesGrantee: taskRole,
        });

        new AvrJob(scope, {
            serviceShortName: 'blueprint',
            jobName: 'complex',
            config: new Map<AvrStage, AvrJobConfig>([
                [AvrStage.PROD, { expression: 'cron(1 3 * * ? *)', enabled: true }],
                [AvrStage.STAGING, { expression: 'cron(1 3 * * ? *)', enabled: true }],
                [AvrStage.TEST, { expression: 'cron(1 4 * * ? *)', enabled: true }],
                [AvrStage.DEV, { expression: 'rate(1 day)', enabled: true }],
            ]),
            stage,
            consumeMessagesGrantee: taskRole,
        });
    }
}
