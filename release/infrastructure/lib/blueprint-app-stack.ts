#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as ecr from '@aws-cdk/aws-ecr';

import { AvrAppStack, AvrAppStackProps } from './avr-app-stack';
import { AvrFargateService, FargateContainerProps } from './avr-fargate-service';

interface BlueprintAppStackProps extends AvrAppStackProps {
    readonly repository: ecr.Repository;
    readonly taskContainerProps?: FargateContainerProps;
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
        
        // add your own aws resources here
    }
}
