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
    FleetBuildNotifications
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
            slackChannelConfigurationName: `avrios-blueprint-alerts`,
            slackWorkspaceId: 'T02NY065N', // vimcar.slack.com
            slackChannelId: 'C04RSSN74AE', // #avrios-blueprint-alerts
        });

        const notificationSettings = new FleetBuildNotifications(chatbotSlackClient);
        return {
            ecrRepository: this.ecrRepository.repository,
            serviceImages: this.serviceImages,
            serviceShortName: this.props.serviceShortName,
            gitRepositoryName: this.props.gitRepositoryName,
            codeBuildImage: AvrCodePipeline.getEcrImage(this, 'code-build-image', '2'),
            buildNotifications: notificationSettings,
        };
    }
}
