#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as ecr from '@aws-cdk/aws-ecr';
import * as iam from '@aws-cdk/aws-iam';

import {
    AvrAppStack,
    AvrAppStackProps,
    AvrFargateService,
    AvrFargateContainerProps,
    AvrTopic,
    AvrQueue,
    AvrStage
} from 'avr-cdk-utils';

interface BlueprintAppStackProps extends AvrAppStackProps {
    readonly repository: ecr.Repository;
    readonly taskContainerProps?: AvrFargateContainerProps;
}

export class BlueprintAppStack extends AvrAppStack {
    protected readonly props: BlueprintAppStackProps;
    public readonly fargateService: AvrFargateService;

    constructor(scope: cdk.Construct, props: BlueprintAppStackProps) {
        super(scope, props);

        this.props = props;

        this.fargateService = new AvrFargateService(this, {
            serviceShortName: this.props.serviceShortName,
            stage: this.props.stage,
            repository: this.props.repository,
            taskContainerProps: this.props.taskContainerProps
        });

        new BlueprintResources(this, this.props.stage, this.fargateService.getTaskRole());
    }
}

export class BlueprintDevStack extends cdk.Stack {
    constructor(scope: cdk.Construct, serviceShortName: string) {
        super(scope, `${AvrStage.DEV.identifier}-${serviceShortName}-resources`, {
            env: AvrStage.DEV.env
        });

        new BlueprintResources(this, AvrStage.DEV);
    }
}

export class BlueprintResources {
    constructor(scope: cdk.Construct, stage: AvrStage, taskRole?: iam.IGrantable) {
        // sample resources
        const testTopic = new AvrTopic(scope, {
            topicName: 'blueprint-events',
            stage,
            publishMessagesGrantee: taskRole
        });
        const testQueue = new AvrQueue(scope, {
            queueName: 'blueprint-events',
            stage,
            topic: testTopic.topic,
            consumeMessagesGrantee: taskRole
        });
    }
}
