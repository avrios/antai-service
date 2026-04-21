import { aws_ecs as ecs } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { AppStack } from './app-stack';

import {
    AvrCiCdStack,
    AvrCiCdStackProps,
    AvrCodePipeline,
    AvrCodePipelineDeployToTest,
    AvrCodePipelineFeature,
    AvrCodePipelineHotfix,
    AvrCodePipelineMain,
    AvrEcrCodePipelineProps,
    AvrEcrRepository,
    AvrStage,
} from '@avrios/avr-cdk-utils';

export class CicdStack extends AvrCiCdStack {
    private readonly ecrRepository: AvrEcrRepository;
    private readonly serviceImages: { [key: string]: ecs.TagParameterContainerImage } = {};

    constructor(scope: Construct, props: AvrCiCdStackProps) {
        super(scope, props);

        this.ecrRepository = new AvrEcrRepository(this, {
            repositoryName: this.props.serviceShortName,
        });

        this.createApplicationStack(scope, AvrStage.TEST);
        this.createApplicationStack(scope, AvrStage.STAGING);
        this.createApplicationStack(scope, AvrStage.PROD);

        const pipelineProps = this.getPipelineProps();
        new AvrCodePipelineFeature(this, pipelineProps, true);
        new AvrCodePipelineHotfix(this, pipelineProps);
        new AvrCodePipelineMain(this, pipelineProps, false);
        new AvrCodePipelineDeployToTest(this, pipelineProps);
    }

    private createApplicationStack(scope: Construct, stage: AvrStage): void {
        const appStack = new AppStack(scope, {
            stage,
            serviceShortName: this.props.serviceShortName,
            repository: this.ecrRepository.repository,
            taskContainerProps: {
                runtimePlatform: {
                    cpuArchitecture: ecs.CpuArchitecture.ARM64,
                    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                },
            },
        });
        this.serviceImages[stage.identifier] = appStack.fargateService.image;
    }

    private getPipelineProps(): AvrEcrCodePipelineProps {
        return {
            ecrRepository: this.ecrRepository.repository,
            serviceImages: this.serviceImages,
            serviceShortName: this.props.serviceShortName,
            gitRepositoryName: this.props.gitRepositoryName,
            codeBuildImage: AvrCodePipeline.getEcrImage(this, 'code-build-image', '3'),
        };
    }
}
