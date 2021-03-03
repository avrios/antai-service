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
    GITHUB_TOKEN_PATH,
    ENCRYPTION_KEY,
    APPROVAL_NOTIFY_EMAILS,
    CODE_BUILD_COMPUTE_TYPE
} from './project-settings'

export class InfrastructureStack extends cdk.Stack {
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
        super(scope, `${internalShortName}-infrastructure`, { env: Stage.TEST.env });

        this.internalShortName = internalShortName;
        this.gitRepositoryName = gitRepositoryName;

        this.ecrRepository = this.setupEcrRepository();
        this.codeBuildCache = this.setupCodeBuildCache();

        this.createStack(scope, Stage.TEST, this.ecrRepository, { taskContainerProps: { cpuMultiplier: 0.5 }});
        this.createStack(scope, Stage.STAGING, this.ecrRepository);
        this.createStack(scope, Stage.PROD, this.ecrRepository);

        this.setupCodeBuildForFeatureBranches();
        this.setupCodePipelineForMainBranch();

        cdk.Tags.of(this).add('env', Stage.TEST.identifier);
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

    private setupCodeBuildForFeatureBranches(): void {
        // events triggering AWS CodeBuild
        const triggerEvents = [
            codebuild.EventAction.PUSH
        ];

        // .. finally the CodeBuild project to bring everything together
        const codeBuildProject = new codebuild.Project(this, `${this.internalShortName}-build`, {
            projectName: `${this.internalShortName}-snapshot-build`,
            description: `${this.internalShortName}: feature branches`,
            badge: false,
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
                computeType: CODE_BUILD_COMPUTE_TYPE,
                privileged: true,
                environmentVariables: {
                    'REPOSITORY_URI': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: this.ecrRepository.repositoryUri },
                    'RELEASE_VERSION_PREFIX': { type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, value: 'RC-' },
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
        const buildOutput = new codepipeline.Artifact();

        const artifactBucket = s3.Bucket.fromBucketAttributes(this, 'avr-cicd-pipeline-artifacts', {
            bucketArn: 'arn:aws:s3:::avr-cicd-pipeline-artifacts',
            encryptionKey: kms.Key.fromKeyArn(this, 'code-pipeline-artifact-key', ENCRYPTION_KEY)
        });

        const codePipeline = new codepipeline.Pipeline(this, `${this.internalShortName}-pipeline`, {
            pipelineName: this.internalShortName,
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
                this.getCodeBuildAction(sourceArtifact, buildOutput, codeBuildProject)
            ]
        });

        this.addDeployStage(codePipeline, Stage.TEST, buildOutput);
        this.addDeployStage(codePipeline, Stage.STAGING, buildOutput);

        codePipeline.addStage({
            stageName: 'Approval',
            actions: [
                this.getManualApprovalAction(Stage.PROD)
            ]
        });

        this.addDeployStage(codePipeline, Stage.PROD, buildOutput);
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
        // only alphanumeric characters, dash and underscore are supported
        const projectName = `${this.internalShortName}-release-build-${MAIN_BRANCH.replace(/[^\w]/gi, '-')}`;

        const encryptionKey = kms.Key.fromKeyArn(this, 'code-pipeline-project-key', ENCRYPTION_KEY);
        const codeBuildProject = new codebuild.PipelineProject(this, `${this.internalShortName}-${MAIN_BRANCH}-build`, {
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
        const secret = cdk.SecretValue.secretsManager(GITHUB_TOKEN_PATH);

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
            outputs: [ imageDefinitionsArtifact ],
        });
    }

    private getManualApprovalAction(stage: Stage): actions.ManualApprovalAction {
        const info = `Manual approval for deploying ${this.internalShortName} to ${stage.getUpperCaseIdentifier()} needed.`;
        return new actions.ManualApprovalAction({
            actionName: `ManualApprovalFor${stage.getCapitalizedIdentifier()}`,
            notificationTopic: new sns.Topic(this, `manual-approval-for-${this.internalShortName}`, {
                displayName: `manual-approval-for-${this.internalShortName}-${stage.identifier}`,
                topicName: `manual-approval-for-${this.internalShortName}-${stage.identifier}`
            }),
            notifyEmails: APPROVAL_NOTIFY_EMAILS,
            additionalInformation: info,
            externalEntityLink: 'https://staging.avrios.com/public/login',
        });
    }

    private getDeployAction(stage: Stage, buildOutput: codepipeline.Artifact): actions.CloudFormationCreateUpdateStackAction {
        return new actions.CloudFormationCreateUpdateStackAction({
            actionName: `cfn-deploy-${stage.identifier}`,
            stackName: `${stage.identifier}-${this.internalShortName}`,
            templatePath: buildOutput.atPath(`${stage.identifier}-${this.internalShortName}.template.json`),
            adminPermissions: true,
            parameterOverrides: {
                [this.serviceImage[stage.identifier].tagParameterName]: buildOutput.getParam('imagedefinitions.json', 'imageTag'),
            },
            extraInputs: [buildOutput],
            account: stage.env.account
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
