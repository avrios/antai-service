#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';

import { BlueprintAppStack } from './blueprint-app-stack';

import { 
    AvrStage,
    AvrCiCdStack, 
    AvrCiCdStackProps,
    AvrEcrRepository,
    AvrCodePipelineFeature,
    AvrCodePipelineHotfix,
    AvrEcrCodePipelineProps,
    AvrCodePipelineMain,
    AvrFargateContainerProps
} from 'avr-cdk-utils';

export class BlueprintCiCdStack extends AvrCiCdStack {
    private readonly ecrRepository: AvrEcrRepository;
    private readonly serviceImages: {[key: string]: ecs.TagParameterContainerImage} = {};

    constructor(scope: cdk.Construct, props: AvrCiCdStackProps) {
        super(scope, props);

        this.ecrRepository = new AvrEcrRepository(this, {
            repositoryName: this.props.serviceShortName
        });
        
        this.createApplicationStack(scope, AvrStage.TEST, {
            cpuMultiplier: 0.5 
        });
        this.createApplicationStack(scope, AvrStage.STAGING);
        this.createApplicationStack(scope, AvrStage.PROD);

        const pipelineProps = this.getPipelineProps();
        new AvrCodePipelineFeature(this, pipelineProps);
        new AvrCodePipelineHotfix(this, pipelineProps);
        new AvrCodePipelineMain(this, pipelineProps);
    }

    private createApplicationStack(scope: cdk.Construct, stage: AvrStage, taskContainerProps?: AvrFargateContainerProps): void {
        const appStack = new BlueprintAppStack(scope, {
            stage, 
            serviceShortName: this.props.serviceShortName,
            repository: this.ecrRepository.repository, 
            taskContainerProps
        });
        this.serviceImages[stage.identifier] = appStack.fargateService.image;
    }

    private getPipelineProps(): AvrEcrCodePipelineProps {
        return {
            ecrRepository: this.ecrRepository.repository,
            serviceImages: this.serviceImages,
            serviceShortName: this.props.serviceShortName,
            gitRepositoryName: this.props.gitRepositoryName
        };
    }
}
