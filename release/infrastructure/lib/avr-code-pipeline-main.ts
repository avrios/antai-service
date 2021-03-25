#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as kms from '@aws-cdk/aws-kms';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';

import { Stage } from 'avr-cdk-utils';
import { AvrCodePipeline, AvrCodePipelineProps } from './avr-code-pipeline';

/**
 * Default CI/CD pipeline to release changes pushed to the `main` branch to TEST, STAGING and PROD.
 * The change needs to be approved in order to be deployed to PROD. The `main` branch is configurable, 
 * and defaults to `main`. Possible alternative is `master`.
 */
export class AvrCodePipelineMain extends AvrCodePipeline {
    public readonly codePipeline: codepipeline.Pipeline

    /**
     * @param scope Parent of this pipeline, usually an `App` or a `Stage`, but could be any construct.
     * @param props Pipeline properties.
     */
    constructor(scope: cdk.Construct, props: AvrCodePipelineProps) {
        super(scope, 'main', props);

        this.codePipeline = this.createCodePipeline();
    }  

    private createCodePipeline(): codepipeline.Pipeline {
        const codeBuildProject = this.setupCodeBuildPipelineProject(this.encryptionKey);

        const sourceArtifact = new codepipeline.Artifact('sourceCode');
        const buildOutput = new codepipeline.Artifact();
        const artifactBucket = this.s3TargetBucket;

        const codePipeline = new codepipeline.Pipeline(this, `${this.props.serviceShortName}-main-pipeline`, {
            pipelineName: `${this.props.serviceShortName}-main`,
            artifactBucket
        });

        this.addGithubSourceStage(codePipeline, this.props.mainBranch, sourceArtifact);
        this.addCodeBuildStage(codePipeline, sourceArtifact, buildOutput, codeBuildProject);

        this.addDeployStage(codePipeline, Stage.TEST, buildOutput);
        this.addDeployStage(codePipeline, Stage.STAGING, buildOutput);

        this.addApprovalStage(codePipeline, Stage.PROD, false);
        this.addDeployStage(codePipeline, Stage.PROD, buildOutput);

        return codePipeline;
    }

    private setupCodeBuildPipelineProject(encryptionKey: kms.IKey): codebuild.PipelineProject {
        // only alphanumeric characters, dash and underscore are supported
        const projectName = `${this.props.serviceShortName}-${this.props.mainBranch.replace(/[^\w]/gi, '-')}`;
        const codeBuildProject = new codebuild.PipelineProject(this, `${projectName}-build`, {
            projectName,
            description: `${this.props.serviceShortName}: ${this.props.mainBranch} branch`,
            environment: {
                buildImage: this.props.codeBuildImage,
                computeType: this.props.codeBuildComputeType,
                privileged: true,
                environmentVariables: {
                    'CODE_ARTIFACT_ACCOUNT': this.getCodeArtifactAccountForCodeBuild(),
                    'REPOSITORY_URI': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: this.props.ecrRepository.repositoryUri },
                    'RELEASE_VERSION_PREFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: 'RELEASE-' },
                    'RELEASE_VERSION_POSTFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: '' }
                }
            },
            buildSpec: codebuild.BuildSpec.fromSourceFilename('.build/buildspec.yml'),
            cache: this.codeBuildCache,
            encryptionKey
        });

        this.updateCodeBuildProjectPermissions(codeBuildProject);

        return codeBuildProject;
    }  
}
