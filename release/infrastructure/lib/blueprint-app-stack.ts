#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as ecr from '@aws-cdk/aws-ecr';

import { 
    AvrAppStack,
    AvrAppStackProps,
    AvrFargateService,
    AvrFargateContainerProps,
    AvrTopic,
    AvrQueue
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
        
        // sample resources
        const testTopic = new AvrTopic(this, {
            topicName: 'blueprint-events',
            stage: props.stage
        });
        const testQueue = new AvrQueue(this, {
            queueName: 'blueprint-events',
            stage: props.stage,
            topic: testTopic
        });
    }
}
