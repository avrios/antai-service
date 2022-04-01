#!/usr/bin/env node

import { aws_ecs as ecs } from 'aws-cdk-lib';
import { aws_chatbot as chatbot } from 'aws-cdk-lib';
import { Construct } from 'constructs'

import { BlueprintAppStack } from './blueprint-app-stack';

import {
    AvrStage,
    AvrCiCdStack,
    AvrCiCdStackProps,
    AvrEcrRepository,
    AvrCodePipeline,
    AvrCodePipelineFeature,
    AvrCodePipelineHotfix,
    AvrEcrCodePipelineProps,
    AvrCodePipelineMain,
    AvrBuildNotifications
} from 'avr-cdk-utils';

export class BlueprintCiCdStack extends AvrCiCdStack {
    private readonly ecrRepository: AvrEcrRepository;
    private readonly serviceImages: {[key: string]: ecs.TagParameterContainerImage} = {};

    constructor(scope: Construct, props: AvrCiCdStackProps) {
        super(scope, props);

        this.ecrRepository = new AvrEcrRepository(this, {
            repositoryName: this.props.serviceShortName
        });

        this.createApplicationStack(scope, AvrStage.TEST);
        this.createApplicationStack(scope, AvrStage.STAGING);
        this.createApplicationStack(scope, AvrStage.PROD);

        const pipelineProps = this.getPipelineProps();
        new AvrCodePipelineFeature(this, pipelineProps);
        new AvrCodePipelineHotfix(this, pipelineProps);
        new AvrCodePipelineMain(this, pipelineProps);
    }

    private createApplicationStack(scope: Construct, stage: AvrStage): void {
        const appStack = new BlueprintAppStack(scope, {
            stage,
            serviceShortName: this.props.serviceShortName,
            repository: this.ecrRepository.repository,
            taskContainerProps: {
                runtimePlatform: {
                    cpuArchitecture: ecs.CpuArchitecture.ARM64,
                    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                }
            },
        });
        this.serviceImages[stage.identifier] = appStack.fargateService.image;
    }

    private getPipelineProps(): AvrEcrCodePipelineProps {
        const chatbotSlackClient = new chatbot.SlackChannelConfiguration(this, 'slack', {
            slackChannelConfigurationName: `blueprint-alerts`,
            slackWorkspaceId: 'T02S31RB0', // avrios.slack.com
            slackChannelId: 'C030GKTF490', // #blueprint-alerts
        });

        const notificationSettings = new AvrBuildNotifications(chatbotSlackClient)
        return {
            ecrRepository: this.ecrRepository.repository,
            serviceImages: this.serviceImages,
            serviceShortName: this.props.serviceShortName,
            gitRepositoryName: this.props.gitRepositoryName,
            codeBuildImage: AvrCodePipeline.getCustomAarch64Image(this),
            buildNotifications: notificationSettings,
        };
    }
}
