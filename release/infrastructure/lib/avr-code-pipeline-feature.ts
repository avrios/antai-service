#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';

import { AvrCodePipeline, AvrCodePipelineProps } from './avr-code-pipeline';
import { Stage } from 'avr-cdk-utils';

/**
 * Pipeline to release feature branches to TEST. Branches are only deployed to TEST if approved. 
 * Feature branches are defined as all branches except the `main` branch and branches starting with `hotfix/`.
 */
export class AvrCodePipelineFeature extends AvrCodePipeline {
    private static readonly ARTIFACT_NAME = 'feature.zip';

    public readonly codeBuildProject: codebuild.Project;
    public readonly codePipeline: codepipeline.Pipeline;

    /**
     * @param scope Parent of this pipeline, usually an `App` or a `Stage`, but could be any construct.
     * @param props Pipeline properties.
     */
    constructor(scope: cdk.Construct, props: AvrCodePipelineProps) {
        super(scope, 'feature', props);

        this.codeBuildProject = this.setupCodeBuildForFeatureBranches();
        this.codePipeline = this.setupCodePipelineForFeatureBranches();
    }

    private setupCodeBuildForFeatureBranches(): codebuild.Project {
        const projectName = `${this.props.serviceShortName}-feature`;
        const codeBuildProject = new codebuild.Project(this, `${projectName}-build`, {
            projectName,
            description: `${this.props.serviceShortName}: feature branches`,
            badge: false,
            environment: {
                buildImage: this.props.codeBuildImage,
                computeType: this.props.codeBuildComputeType,
                privileged: true,
                environmentVariables: {
                    'CODE_ARTIFACT_ACCOUNT': this.getCodeArtifactAccountForCodeBuild(),
                    'REPOSITORY_URI': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: this.props.ecrRepository.repositoryUri },
                    'RELEASE_VERSION_PREFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: 'FEATURE-' },
                    'RELEASE_VERSION_POSTFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: '-SNAPSHOT' }
                }
            },
            buildSpec: codebuild.BuildSpec.fromSourceFilename('.build/buildspec.yml'),
            cache: this.codeBuildCache,
            source: codebuild.Source.gitHub({
                    identifier: 'GitHub',
                    owner: 'avrios',
                    repo: this.props.gitRepositoryName,
                    webhook: true,
                    reportBuildStatus: true,
                    webhookFilters: [
                        codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH)
                            .andBranchIsNot(this.props.mainBranch)
                            .andBranchIsNot(AvrCodePipeline.HOTFIX_BRANCH_PATTERN)
                            .andCommitMessageIsNot(AvrCodePipeline.SKIP_CI_PATTERN)
                    ],
                    cloneDepth: 1
            }),
            artifacts: codebuild.Artifacts.s3({
                bucket: this.s3SourceBucket,
                path: this.props.serviceShortName,
                name: AvrCodePipelineFeature.ARTIFACT_NAME,
                packageZip: true,
                includeBuildId: false
            })
        });

        this.updateCodeBuildProjectPermissions(codeBuildProject);

        return codeBuildProject;
    }

    private setupCodePipelineForFeatureBranches(): codepipeline.Pipeline {
        const s3SourceArtifact = new codepipeline.Artifact();

        const codePipeline = new codepipeline.Pipeline(this, `${this.props.serviceShortName}-feature-pipeline`, {
            pipelineName: `${this.props.serviceShortName}-feature`,
            artifactBucket: this.s3TargetBucket
        });

        this.addS3SourceStage(codePipeline, this.s3SourceBucket, s3SourceArtifact, AvrCodePipelineFeature.ARTIFACT_NAME);
        this.addApprovalStage(codePipeline, Stage.TEST, false);
        this.addDeployStage(codePipeline, Stage.TEST, s3SourceArtifact);

        return codePipeline;
    }
}
