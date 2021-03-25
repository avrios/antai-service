#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';

import { BlueprintAppStack } from './blueprint-app-stack';

import { AvrCiCdStack, AvrCiCdStackProps } from './avr-cicd-stack';
import { AvrEcrRepository } from './avr-ecr-repository';
import { AvrCodePipelineFeature } from './avr-code-pipeline-feature';
import { AvrCodePipelineHotfix } from './avr-code-pipeline-hotfix';
import { AvrCodePipelineProps } from './avr-code-pipeline';
import { AvrCodePipelineMain } from './avr-code-pipeline-main';
import { FargateContainerProps } from './avr-fargate-service';

import { Stage } from 'avr-cdk-utils';

export class BlueprintCiCdStack extends AvrCiCdStack {
    private readonly ecrRepository: AvrEcrRepository;
    private readonly serviceImages: {[key: string]: ecs.TagParameterContainerImage} = {};

    constructor(scope: cdk.Construct, props: AvrCiCdStackProps) {
        super(scope, props);

        this.ecrRepository = new AvrEcrRepository(this, {
            repositoryName: this.props.serviceShortName
        });
        
        this.createApplicationStack(scope, Stage.TEST, {
            cpuMultiplier: 0.5 
        });
        this.createApplicationStack(scope, Stage.STAGING);
        this.createApplicationStack(scope, Stage.PROD);

        const pipelineProps = this.getPipelineProps();
        new AvrCodePipelineFeature(this, pipelineProps);
        new AvrCodePipelineHotfix(this, pipelineProps);
        new AvrCodePipelineMain(this, pipelineProps);
    }

    private createApplicationStack(scope: cdk.Construct, stage: Stage, taskContainerProps?: FargateContainerProps): void {
        const appStack = new BlueprintAppStack(scope, {
            stage, 
            serviceShortName: this.props.serviceShortName,
            repository: this.ecrRepository.repository, 
            taskContainerProps
        });
        this.serviceImages[stage.identifier] = appStack.fargateService.image;
    }

    private getPipelineProps(): AvrCodePipelineProps {
        return {
            ecrRepository: this.ecrRepository.repository,
            serviceImages: this.serviceImages,
            serviceShortName: this.props.serviceShortName,
            gitRepositoryName: this.props.gitRepositoryName
        };
    }
}
