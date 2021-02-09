#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as sns from '@aws-cdk/aws-sns';
import * as kms from '@aws-cdk/aws-kms';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as actions from '@aws-cdk/aws-codepipeline-actions';

import { Stage } from 'avr-cdk-utils';
import {
    INTERNAL_NAME,
    REPO_NAME,
    MAIN_BRANCH,
    GITHUB_TOKEN_PATH,
    DEPLOY_TO_TEST,
    ENCRYPTION_KEY,
    APPROVAL_NOTIFY_EMAILS,
    CODE_BUILD_COMPUTE_TYPE
} from './project-settings'

export interface InfrastructureStackProps extends cdk.StackProps {
    fargateService: {
        [key: string]: ecs.FargateService;
    }
}

export class InfrastructureStack extends cdk.Stack {
    private readonly fargateService: {
        [key: string]: ecs.FargateService;
    }
    private readonly ecrRepositoryUrl: string;
    private codeBuildCache: codebuild.Cache;

    constructor(scope: cdk.Construct, id: string, props: InfrastructureStackProps) {
        super(scope, id, props);

        this.fargateService = props.fargateService;
        this.ecrRepositoryUrl = `${props.env?.account}.dkr.ecr.${props.env?.region}.amazonaws.com/${INTERNAL_NAME}`;

        this.setupCodeBuildCache()
        this.setupCodeBuildForFeatureBranches();
        this.setupCodePipelineForMainBranch();
    }

    private setupCodeBuildCache(): void {
        // add a cache for build artifact (maven or npm dependencies, angular artifacts), used by our codebuild projects
        const s3Cache = s3.Bucket.fromBucketArn(this, 'avr-cicd-cache', 'arn:aws:s3:::avr-cicd-cache');
        this.codeBuildCache = codebuild.Cache.bucket(s3Cache, { prefix: INTERNAL_NAME });
    }

    private setupCodeBuildForFeatureBranches(): void {
        // events triggering AWS CodeBuild
        const triggerEvents = [
            codebuild.EventAction.PUSH
        ];

        // .. finally the CodeBuild project to bring everything together
        const codeBuildProject = new codebuild.Project(this, `${INTERNAL_NAME}-build`, {
            projectName: `${INTERNAL_NAME}-snapshot-build`,
            description: `${INTERNAL_NAME}: feature branches`,
            badge: false,
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
                computeType: CODE_BUILD_COMPUTE_TYPE,
                privileged: true,
                environmentVariables: {
                    'CONTAINER_NAME': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: INTERNAL_NAME },
                    'REPOSITORY_URI': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: this.ecrRepositoryUrl },
                    'RELEASE_VERSION_PREFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: 'RC-' },
                    'RELEASE_VERSION_POSTFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: '-SNAPSHOT' }
                }
            },
            buildSpec: codebuild.BuildSpec.fromSourceFilename('.build/buildspec.yml'),
            cache: this.codeBuildCache,
            source: codebuild.Source.gitHub({
                identifier: 'GitHub',
                owner: 'avrios',
                repo: REPO_NAME,
                webhook: true,
                reportBuildStatus: true,
                webhookFilters: [
                    codebuild.FilterGroup.inEventOf(...triggerEvents).andBranchIsNot(MAIN_BRANCH),
                ],
                cloneDepth: 1
            })
        });

        this.updateCodeBuildProjectPermissions(codeBuildProject);
    }

    private setupCodePipelineForMainBranch(): void {
        const codeBuildProject = this.setupCodeBuildPipelineProject();

        const sourceArtifact = new codepipeline.Artifact('sourceCode');
        const imageDefinitionsArtifact = new codepipeline.Artifact('imageDefinitions');

        const artifactBucket = s3.Bucket.fromBucketAttributes(this, 'avr-cicd-pipeline-artifacts', {
            bucketArn: 'arn:aws:s3:::avr-cicd-pipeline-artifacts',
            encryptionKey: kms.Key.fromKeyArn(this, 'code-pipeline-artifact-key', ENCRYPTION_KEY)
        });

        const codePipeline = new codepipeline.Pipeline(this, `${INTERNAL_NAME}-pipeline`, {
            pipelineName: INTERNAL_NAME,
            artifactBucket
        });

        codePipeline.addStage({
            stageName: 'Source',
            actions: [
                this.getGitHubAction(sourceArtifact)
            ]
        });

        codePipeline.addStage({
            stageName: 'Build',
            actions: [
                this.getCodeBuildAction(sourceArtifact, imageDefinitionsArtifact, codeBuildProject)
            ]
        });

        if (DEPLOY_TO_TEST) {
            this.addDeployStage(codePipeline, Stage.TEST, imageDefinitionsArtifact);
        }

        this.addDeployStage(codePipeline, Stage.STAGING, imageDefinitionsArtifact);

        codePipeline.addStage({
            stageName: 'Approval',
            actions: [
                this.getManualApprovalAction(Stage.PROD)
            ]
        });

        this.addDeployStage(codePipeline, Stage.PROD, imageDefinitionsArtifact);
    }

    private addDeployStage(codePipeline: codepipeline.Pipeline, stage: Stage, artifact: codepipeline.Artifact): void {
        codePipeline.addStage({
            stageName: `DeployTo${stage.getCapitalizedIdentifier()}`,
            actions: [
                this.getDeployAction(stage, artifact)
            ]
        });
    }

    private setupCodeBuildPipelineProject(): codebuild.PipelineProject {
        const encryptionKey = kms.Key.fromKeyArn(this, 'code-pipeline-project-key', ENCRYPTION_KEY);
        const codeBuildProject = new codebuild.PipelineProject(this, `${INTERNAL_NAME}-${MAIN_BRANCH}-build`, {
            projectName: `${INTERNAL_NAME}-release-build`,
            description: `${INTERNAL_NAME}: ${MAIN_BRANCH} branch`,
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
                computeType: CODE_BUILD_COMPUTE_TYPE,
                privileged: true,
                environmentVariables: {
                    'CONTAINER_NAME': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: INTERNAL_NAME },
                    'REPOSITORY_URI': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: this.ecrRepositoryUrl },
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

    private getGitHubAction(sourceArtifact: codepipeline.Artifact): actions.GitHubSourceAction {
        const secret = cdk.SecretValue.secretsManager(GITHUB_TOKEN_PATH);

        return new actions.GitHubSourceAction({
            actionName: 'SourceCodeCheckout',
            output: sourceArtifact,
            oauthToken: secret,
            owner: 'avrios',
            repo: REPO_NAME,
            branch: MAIN_BRANCH,
            trigger: actions.GitHubTrigger.WEBHOOK
        });
    }

    private getCodeBuildAction(sourceArtifact: codepipeline.Artifact,
                               imageDefinitionsArtifact: codepipeline.Artifact,
                               codeBuildProject: codebuild.PipelineProject): actions.CodeBuildAction {
        return new actions.CodeBuildAction({
            actionName: 'BuildAndTest',
            project: codeBuildProject,
            input: sourceArtifact,
            outputs: [ imageDefinitionsArtifact ],
        });
    }

    private getManualApprovalAction(stage: Stage): actions.ManualApprovalAction {
        const info = `Manual approval for deploying ${INTERNAL_NAME} to ${stage.getUpperCaseIdentifier()} needed.`;
        return new actions.ManualApprovalAction({
            actionName: `ManualApprovalFor${stage.getCapitalizedIdentifier()}`,
            notificationTopic: new sns.Topic(this, `manual-approval-for-${INTERNAL_NAME}`, {
                displayName: `manual-approval-for-${INTERNAL_NAME}`,
                topicName: `manual-approval-for-${INTERNAL_NAME}`
            }),
            notifyEmails: APPROVAL_NOTIFY_EMAILS,
            additionalInformation: info,
            externalEntityLink: 'https://staging.avrios.com/public/login',
        });
    }

    private getDeployAction(stage: Stage, imageDefinitionsArtifact: codepipeline.Artifact): actions.EcsDeployAction {
        return new actions.EcsDeployAction({
            actionName: 'DeployToECS',
            input: imageDefinitionsArtifact,
            service: this.fargateService[stage.getUpperCaseIdentifier()]
        });
    }

    private updateCodeBuildProjectPermissions(project: codebuild.Project): void {
        const ec2PowerUserPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser');
        project.role?.addManagedPolicy(ec2PowerUserPolicy);

        const codeArtifactAdminPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeArtifactAdminAccess');
        project.role?.addManagedPolicy(codeArtifactAdminPolicy);

        project.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'sts:GetServiceBearerToken'
            ],
            resources: ['*'],
        }));
    }
}
