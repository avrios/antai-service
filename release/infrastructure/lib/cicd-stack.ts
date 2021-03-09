#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as iam from '@aws-cdk/aws-iam';
import * as sns from '@aws-cdk/aws-sns';
import * as kms from '@aws-cdk/aws-kms';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as actions from '@aws-cdk/aws-codepipeline-actions';

import { FargateStack, FargateStackProps } from './fargate-stack';
import { Stage } from 'avr-cdk-utils';
import {
    MAIN_BRANCH,
    APPROVAL_NOTIFY_EMAILS,
    CODE_BUILD_COMPUTE_TYPE
} from './project-settings'

export class CiCdStack extends cdk.Stack {
    /**
     * Location of the github token in the AWS Secret Manager.
     */
    private static readonly GITHUB_TOKEN_PATH = '/dev/github.token';

    /**
     * Encryption key used to share code build artifacts.
     */
    private static readonly ENCRYPTION_KEY_ARN = 'arn:aws:kms:eu-central-1:821747761766:key/656022f0-aa97-4c56-bb5f-db7d5a8f29b9';

    /**
     * Pattern used to identify hotfix branches that are released to staging/prod.
     */
    private static readonly HOTFIX_BRANCH_PATTERN = 'hotfix/*';

    private readonly serviceImage: {
        [key: string]: ecs.TagParameterContainerImage;
    } = {};

    private readonly internalShortName: string;
    private readonly gitRepositoryName: string;
    private readonly ecrRepository: ecr.Repository;
    private readonly codeBuildCache: codebuild.Cache;

    /**
     * @param scope Parent of this stack, usually an `App` or a `Stage`, but could be any construct
     * @param internalShortName Short-hand name of the service
     * @param gitRepositoryName  Repository name without github and owner prefix
     */
    constructor(scope: cdk.Construct, internalShortName: string, gitRepositoryName: string) {
        super(scope, `${internalShortName}-cicd`, { env: Stage.TEST.env });

        this.internalShortName = internalShortName;
        this.gitRepositoryName = gitRepositoryName;

        this.ecrRepository = this.setupEcrRepository();
        this.codeBuildCache = this.setupCodeBuildCache();

        this.createStack(scope, Stage.TEST, this.ecrRepository, { taskContainerProps: { cpuMultiplier: 0.5 }});
        this.createStack(scope, Stage.STAGING, this.ecrRepository);
        this.createStack(scope, Stage.PROD, this.ecrRepository);

        const encryptionKey = kms.Key.fromKeyArn(this, 'code-pipeline-artifact-key', CiCdStack.ENCRYPTION_KEY_ARN);

        const s3SourceBucket = this.setupCodeBuildArtifactBucket(encryptionKey);
        const s3TargetBucket = this.setupCodePipelineArtifactBucket(encryptionKey);

        const featureArtifactName = 'feature.zip';
        this.setupCodeBuildForFeatureBranches(s3SourceBucket, featureArtifactName);
        this.setupCodePipelineForFeatureBranches(s3SourceBucket, s3TargetBucket, featureArtifactName);

        const hotfixArtifactName = 'hotfix.zip';
        this.setupCodeBuildForHotfixBranches(s3SourceBucket, hotfixArtifactName);
        this.setupCodePipelineForHotfixBranches(s3SourceBucket, s3TargetBucket, hotfixArtifactName);

        this.setupCodePipelineForMainBranch(encryptionKey, s3TargetBucket);

        cdk.Tags.of(this).add('env', Stage.TEST.identifier);
    }

    private setupCodeBuildArtifactBucket(encryptionKey: kms.IKey): s3.IBucket {
        return s3.Bucket.fromBucketAttributes(this, 'avr-cicd-codebuild-artifacts', {
            bucketArn: 'arn:aws:s3:::avr-cicd-codebuild-artifacts',
            encryptionKey
        });
    }

    private setupCodePipelineArtifactBucket(encryptionKey: kms.IKey): s3.IBucket {
        return s3.Bucket.fromBucketAttributes(this, 'avr-cicd-pipeline-artifacts', {
            bucketArn: 'arn:aws:s3:::avr-cicd-pipeline-artifacts',
            encryptionKey
        });
    }

    private setupEcrRepository(): ecr.Repository {
        const repositoryName = this.internalShortName;
        const repository = new ecr.Repository(this, `${this.internalShortName}-ecr`, { repositoryName });

        const cfnRepository = repository.node.defaultChild as ecr.CfnRepository;
        // CDK - when left on its own - happens to create a repository policy that is invalid. As a workaround, we
        // therefore have to override the raw CFN template.
        cfnRepository.repositoryPolicyText = {
            "Version": "2008-10-17",
            "Statement": [
                {
                    "Sid": "cross-account-access",
                    "Effect": "ALLOW",
                    "Principal": {
                        "AWS": [
                            "arn:aws:iam::324932872368:root"
                        ]
                    },
                    "Action": [
                        "ecr:GetAuthorizationToken",
                        "ecr:BatchCheckLayerAvailability",
                        "ecr:GetDownloadUrlForLayer",
                        "ecr:GetRepositoryPolicy",
                        "ecr:DescribeRepositories",
                        "ecr:ListImages",
                        "ecr:DescribeImages",
                        "ecr:BatchGetImage",
                        "ecr:GetLifecyclePolicy",
                        "ecr:GetLifecyclePolicyPreview",
                        "ecr:ListTagsForResource",
                        "ecr:DescribeImageScanFindings"
                    ]
                }
            ]
        };

        return repository;
    }

    private createStack(scope: cdk.Construct, stage: Stage, repository: ecr.Repository, stackProps?: FargateStackProps) {
        const fargateStack = new FargateStack(scope, this.internalShortName, stage, repository, stackProps);
        this.serviceImage[stage.identifier] = fargateStack.image;
    }

    private setupCodeBuildCache(): codebuild.Cache {
        // add a cache for build artifact (maven or npm dependencies, angular artifacts), used by our codebuild projects
        const s3Cache = s3.Bucket.fromBucketArn(this, 'avr-cicd-cache', 'arn:aws:s3:::avr-cicd-cache');
        return codebuild.Cache.bucket(s3Cache, { prefix: this.internalShortName });
    }

    private setupCodeBuildForFeatureBranches(s3SourceBucket: s3.IBucket, artifactName: string): void {
        const projectName = `${this.internalShortName}-feature`;
        const codeBuildProject = new codebuild.Project(this, `${projectName}-build`, {
            projectName,
            description: `${this.internalShortName}: feature branches`,
            badge: false,
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
                computeType: CODE_BUILD_COMPUTE_TYPE,
                privileged: true,
                environmentVariables: {
                    'REPOSITORY_URI': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: this.ecrRepository.repositoryUri },
                    'RELEASE_VERSION_PREFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: 'FEATURE-' },
                    'RELEASE_VERSION_POSTFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: '-SNAPSHOT' }
                }
            },
            buildSpec: codebuild.BuildSpec.fromSourceFilename('.build/buildspec.yml'),
            cache: this.codeBuildCache,
            source: codebuild.Source.gitHub({
                    identifier: 'GitHub',
                    owner: 'avrios',
                    repo: this.gitRepositoryName,
                    webhook: true,
                    reportBuildStatus: true,
                    webhookFilters: [
                        codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH)
                            .andBranchIsNot(MAIN_BRANCH)
                            .andBranchIsNot(CiCdStack.HOTFIX_BRANCH_PATTERN),
                    ],
                    cloneDepth: 1
            }),
            artifacts: codebuild.Artifacts.s3({
                bucket: s3SourceBucket,
                path: this.internalShortName,
                name: artifactName,
                packageZip: true,
                includeBuildId: false
            })
        });

        this.updateCodeBuildProjectPermissions(codeBuildProject);
    }

    private setupCodeBuildForHotfixBranches(s3SourceBucket: s3.IBucket, artifactName: string): void {
        const projectName = `${this.internalShortName}-hotfix`;
        const codeBuildProject = new codebuild.Project(this, `${projectName}-build`, {
            projectName,
            description: `${this.internalShortName}: hotfix branches`,
            badge: false,
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
                computeType: CODE_BUILD_COMPUTE_TYPE,
                privileged: true,
                environmentVariables: {
                    'REPOSITORY_URI': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: this.ecrRepository.repositoryUri },
                    'RELEASE_VERSION_PREFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: 'HOTFIX-' },
                    'RELEASE_VERSION_POSTFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: '' }
                }
            },
            buildSpec: codebuild.BuildSpec.fromSourceFilename('.build/buildspec.yml'),
            cache: this.codeBuildCache,
            source: codebuild.Source.gitHub({
                identifier: 'GitHub',
                owner: 'avrios',
                repo: this.gitRepositoryName,
                webhook: true,
                reportBuildStatus: true,
                webhookFilters: [
                    codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH)
                        .andBranchIs(CiCdStack.HOTFIX_BRANCH_PATTERN)
                ],
                cloneDepth: 1
            }),
            artifacts: codebuild.Artifacts.s3({
                bucket: s3SourceBucket,
                path: this.internalShortName,
                name: artifactName,
                packageZip: true,
                includeBuildId: false
            })
        });

        this.updateCodeBuildProjectPermissions(codeBuildProject);
    }

    private setupCodePipelineForFeatureBranches(sourceBucket: s3.IBucket, targetBucket: s3.IBucket, artifactName: string): void {
        const s3SourceArtifact = new codepipeline.Artifact();

        const codePipeline = new codepipeline.Pipeline(this, `${this.internalShortName}-feature-pipeline`, {
            pipelineName: `${this.internalShortName}-feature`,
            artifactBucket: targetBucket
        });

        this.addS3SourceStage(codePipeline, sourceBucket, s3SourceArtifact, artifactName);
        this.addApprovalStage(codePipeline, Stage.TEST, false);
        this.addDeployStage(codePipeline, Stage.TEST, s3SourceArtifact);
    }

    private setupCodePipelineForHotfixBranches(sourceBucket: s3.IBucket, targetBucket: s3.IBucket, artifactName: string): void {
        const s3SourceArtifact = new codepipeline.Artifact();

        const codePipeline = new codepipeline.Pipeline(this, `${this.internalShortName}-hotfix-pipeline`, {
            pipelineName: `${this.internalShortName}-hotfix`,
            artifactBucket: targetBucket
        });

        this.addS3SourceStage(codePipeline, sourceBucket, s3SourceArtifact, artifactName);

        this.addApprovalStage(codePipeline, Stage.STAGING, false);
        this.addDeployStage(codePipeline, Stage.STAGING, s3SourceArtifact);

        this.addApprovalStage(codePipeline, Stage.PROD, false);
        this.addDeployStage(codePipeline, Stage.PROD, s3SourceArtifact);
    }

    private setupCodePipelineForMainBranch(encryptionKey: kms.IKey, targetBucket: s3.IBucket): void {
        const codeBuildProject = this.setupCodeBuildPipelineProject(encryptionKey);

        const sourceArtifact = new codepipeline.Artifact('sourceCode');
        const buildOutput = new codepipeline.Artifact();
        const artifactBucket = targetBucket;

        const codePipeline = new codepipeline.Pipeline(this, `${this.internalShortName}-main-pipeline`, {
            pipelineName: `${this.internalShortName}-main`,
            artifactBucket
        });

        this.addGithubSourceStage(codePipeline, sourceArtifact);
        this.addCodeBuildStage(codePipeline, sourceArtifact, buildOutput, codeBuildProject);

        this.addDeployStage(codePipeline, Stage.TEST, buildOutput);
        this.addDeployStage(codePipeline, Stage.STAGING, buildOutput);

        this.addApprovalStage(codePipeline, Stage.PROD, false);
        this.addDeployStage(codePipeline, Stage.PROD, buildOutput);
    }

    private addGithubSourceStage(codePipeline: codepipeline.Pipeline, artifact: codepipeline.Artifact): void {
        codePipeline.addStage({
            stageName: 'Source',
            actions: [
                this.getGitHubAction(artifact)
            ]
        });
    }

    private addCodeBuildStage(codePipeline: codepipeline.Pipeline, sourceArtifact: codepipeline.Artifact,
                              buildOutput: codepipeline.Artifact, codeBuildProject: codebuild.PipelineProject): void {
        codePipeline.addStage({
            stageName: 'Build',
            actions: [
                this.getCodeBuildAction(sourceArtifact, buildOutput, codeBuildProject)
            ]
        });
    }

    private addS3SourceStage(codePipeline: codepipeline.Pipeline, sourceBucket: s3.IBucket, artifact: codepipeline.Artifact, artifactName: string): void {
        codePipeline.addStage({
            stageName: 'Source',
            actions: [
                this.getS3SourceAction(sourceBucket, artifact, artifactName)
            ]
        });
    }

    private addApprovalStage(codePipeline: codepipeline.Pipeline, stage: Stage, notify: boolean): void {
        codePipeline.addStage({
            stageName: `ApprovalFor${stage.getCapitalizedIdentifier()}`,
            actions: [
                this.getManualApprovalAction(stage, notify)
            ]
        });
    }

    private addDeployStage(codePipeline: codepipeline.Pipeline, stage: Stage, artifact: codepipeline.Artifact): void {
        codePipeline.addStage({
            stageName: `DeployTo${stage.getCapitalizedIdentifier()}`,
            actions: [
                this.getDeployAction(stage, artifact)
            ]
        });
    }

    private getS3SourceAction(sourceBucket: s3.IBucket, s3SourceArtifact: codepipeline.Artifact, artifactName: string): actions.S3SourceAction {
        return new actions.S3SourceAction({
            actionName: 'SourceCodeCheckout',
            bucket: sourceBucket,
            bucketKey: `${this.internalShortName}/${artifactName}`,
            output: s3SourceArtifact
        });
    }

    private getDeployAction(stage: Stage, buildOutput: codepipeline.Artifact): actions.CloudFormationCreateUpdateStackAction {
        return new actions.CloudFormationCreateUpdateStackAction({
            actionName: `cfn-deploy-${stage.identifier}`,
            stackName: `${stage.identifier}-${this.internalShortName}`,
            templatePath: buildOutput.atPath(`${stage.identifier}-${this.internalShortName}-app.template.json`),
            adminPermissions: true,
            parameterOverrides: {
                [this.serviceImage[stage.identifier].tagParameterName]: buildOutput.getParam('imagedefinitions.json', 'imageTag'),
            },
            extraInputs: [buildOutput],
            account: stage.env.account
        });
    }

    private setupCodeBuildPipelineProject(encryptionKey: kms.IKey): codebuild.PipelineProject {
        // only alphanumeric characters, dash and underscore are supported
        const projectName = `${this.internalShortName}-${MAIN_BRANCH.replace(/[^\w]/gi, '-')}`;
        const codeBuildProject = new codebuild.PipelineProject(this, `${projectName}-build`, {
            projectName,
            description: `${this.internalShortName}: ${MAIN_BRANCH} branch`,
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
                computeType: CODE_BUILD_COMPUTE_TYPE,
                privileged: true,
                environmentVariables: {
                    'REPOSITORY_URI': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: this.ecrRepository.repositoryUri },
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
        const secret = cdk.SecretValue.secretsManager(CiCdStack.GITHUB_TOKEN_PATH);

        return new actions.GitHubSourceAction({
            actionName: 'SourceCodeCheckout',
            output: sourceArtifact,
            oauthToken: secret,
            owner: 'avrios',
            repo: this.gitRepositoryName,
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
            outputs: [imageDefinitionsArtifact],
        });
    }

    private getManualApprovalAction(stage: Stage, notify: boolean): actions.ManualApprovalAction {
        const info = `Manual approval for deploying ${this.internalShortName} to ${stage.getUpperCaseIdentifier()} needed.`;
        return new actions.ManualApprovalAction({
            actionName: `ManualApprovalFor${stage.getCapitalizedIdentifier()}`,
            notificationTopic: notify ? new sns.Topic(this, `manual-approval-for-${this.internalShortName}-${stage.identifier}`, {
                displayName: `manual-approval-for-${this.internalShortName}-${stage.identifier}`,
                topicName: `manual-approval-for-${this.internalShortName}-${stage.identifier}`
            }) : undefined,
            notifyEmails: notify ? APPROVAL_NOTIFY_EMAILS : undefined,
            additionalInformation: info
        });
    }

    private updateCodeBuildProjectPermissions(project: codebuild.Project): void {
        const ec2PowerUserPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser');
        project.role?.addManagedPolicy(ec2PowerUserPolicy);

        const codeArtifactAdminPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeArtifactAdminAccess');
        project.role?.addManagedPolicy(codeArtifactAdminPolicy);

        project.addToRolePolicy(new iam.PolicyStatement({
            actions: ['sts:GetServiceBearerToken'],
            resources: ['*'],
        }));
    }
}
