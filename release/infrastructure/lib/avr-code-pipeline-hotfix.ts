#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';

import { AvrCodePipeline, AvrCodePipelineProps } from './avr-code-pipeline';
import { Stage } from 'avr-cdk-utils';

/**
 * Pipeline to release hotfixes STAGING and PROD. Branches are only deployed to STAGING and PROD if approved.
 * Hotfix branches are defined as all branches starting with `hotfix/`.
 */
export class AvrCodePipelineHotfix extends AvrCodePipeline {
    private static readonly ARTIFACT_NAME = 'hotfix.zip';

    public readonly codeBuildProject: codebuild.Project;
    public readonly codePipeline: codepipeline.Pipeline;

    /**
     * @param scope Parent of this pipeline, usually an `App` or a `Stage`, but could be any construct.
     * @param props Pipeline properties.
     */
    constructor(scope: cdk.Construct, props: AvrCodePipelineProps) {
        super(scope, 'hotfix', props);

        this.codeBuildProject = this.setupCodeBuildForHotfixBranches();
        this.codePipeline = this.setupCodePipelineForHotfixBranches();
    }

    private setupCodeBuildForHotfixBranches(): codebuild.Project {
        const projectName = `${this.props.serviceShortName}-hotfix`;
        const codeBuildProject = new codebuild.Project(this, `${projectName}-build`, {
            projectName,
            description: `${this.props.serviceShortName}: hotfix branches`,
            badge: false,
            environment: {
                buildImage: this.props.codeBuildImage,
                computeType: this.props.codeBuildComputeType,
                privileged: true,
                environmentVariables: {
                    'CODE_ARTIFACT_ACCOUNT': this.getCodeArtifactAccountForCodeBuild(),
                    'REPOSITORY_URI': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: this.props.ecrRepository.repositoryUri },
                    'RELEASE_VERSION_PREFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: 'HOTFIX-' },
                    'RELEASE_VERSION_POSTFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: '' }
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
                        .andBranchIs(AvrCodePipeline.HOTFIX_BRANCH_PATTERN)
                        .andCommitMessageIsNot(AvrCodePipeline.SKIP_CI_PATTERN)
                ],
                cloneDepth: 1
            }),
            artifacts: codebuild.Artifacts.s3({
                bucket: this.s3TargetBucket,
                path: this.props.serviceShortName,
                name: AvrCodePipelineHotfix.ARTIFACT_NAME,
                packageZip: true,
                includeBuildId: false
            })
        });

        this.updateCodeBuildProjectPermissions(codeBuildProject);

        return codeBuildProject;
    }

    private setupCodePipelineForHotfixBranches(): codepipeline.Pipeline {
        const s3SourceArtifact = new codepipeline.Artifact();

        const codePipeline = new codepipeline.Pipeline(this, `${this.props.serviceShortName}-hotfix-pipeline`, {
            pipelineName: `${this.props.serviceShortName}-hotfix`,
            artifactBucket: this.s3TargetBucket
        });

        this.addS3SourceStage(codePipeline, this.s3SourceBucket, s3SourceArtifact, AvrCodePipelineHotfix.ARTIFACT_NAME);

        this.addApprovalStage(codePipeline, Stage.STAGING, false);
        this.addDeployStage(codePipeline, Stage.STAGING, s3SourceArtifact);

        this.addApprovalStage(codePipeline, Stage.PROD, false);
        this.addDeployStage(codePipeline, Stage.PROD, s3SourceArtifact);

        return codePipeline;
    }
}
