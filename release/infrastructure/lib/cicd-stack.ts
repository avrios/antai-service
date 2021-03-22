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

import { AvrFargateService, FargateServiceProps } from './avr-fargate-service';
import { Stage, AwsAccount } from 'avr-cdk-utils';

export interface CiCdStackProps {
    /**
     * Short-hand name of the service. Omit the '-service' suffix. 
     * Example: 'blueprint' instead of 'blueprint-service'.
     */
    readonly internalShortName: string;
    
    /**
     * Repository name without github and owner prefix.
     * Example: blueprint-service instead of 'https://github.com/avrios/blueprint-service'.
     */
    readonly gitRepositoryName: string;
    
    /**
     * Name of the main branch. Defaults to 'main'.
     */
    readonly mainBranch?: string;

    /**
     * Build image used by the code build projects. See
     * https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-codebuild.LinuxBuildImage.html
     * Defaults to STANDARD_5_0.
     */
    readonly codeBuildImage?: codebuild.IBuildImage;
    
    /**
     * Size of AWS CodeBuild instance to compile and build the docker image. See
     * https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-codebuild.ComputeType.html
     * Defaults to ComputeType.SMALL.
     */
    readonly codeBuildComputeType?: codebuild.ComputeType;

    /**
     * Defines who should get notified by email if an approval is needed before deployment.
     * You can also manually subscribe to the SNS topic later.
     * Defaults to an empty list of approvals.
     */
    readonly approvalNotifyEmails?: string[];
}

interface CompletedCiCdStackProps {
    readonly internalShortName: string;
    readonly gitRepositoryName: string;
    readonly mainBranch: string;
    readonly codeBuildImage: codebuild.IBuildImage;
    readonly codeBuildComputeType: codebuild.ComputeType;
    readonly approvalNotifyEmails: string[];
}

export class CiCdStack extends cdk.Stack {
    /**
     * Location of the github token in the AWS Secret Manager.
     */
    private static readonly GITHUB_TOKEN_PATH = '/dev/github.token';

    /**
     * Encryption key used to share code build artifacts.
     */
    private static readonly ENCRYPTION_KEY_ARN = 'arn:aws:kms:eu-central-1:917835067517:key/8113893a-07f6-46fa-a3b5-eada0d7c5444';

    /**
     * Pattern used to identify hotfix branches that are released to staging/prod.
     */
    private static readonly HOTFIX_BRANCH_PATTERN = 'hotfix/*';

    /**
     * A commit message matching this pattern must not trigger a build.
     */
    private static readonly SKIP_CI_PATTERN = ".*(\\[skip ci\\]).*";

    private readonly serviceImage: {
        [key: string]: ecs.TagParameterContainerImage;
    } = {};

    private readonly ecrRepository: ecr.Repository;
    private readonly codeBuildCache: codebuild.Cache;
    private readonly stackProps: CompletedCiCdStackProps;

    /**
     * @param scope Parent of this stack, usually an `App` or a `Stage`, but could be any construct
     * @param internalShortName Short-hand name of the service
     * @param gitRepositoryName  Repository name without github and owner prefix
     */
    constructor(scope: cdk.Construct, stackProps: CiCdStackProps) {
        super(scope, `${stackProps.internalShortName}-cicd`, { env: AwsAccount.TOOLING.env });

        this.stackProps = CiCdStack.defaultMissingValues(stackProps);

        this.ecrRepository = this.setupEcrRepository();

        this.createApplicationStack(scope, Stage.TEST, this.ecrRepository, { taskContainerProps: { cpuMultiplier: 0.5 }});
        this.createApplicationStack(scope, Stage.STAGING, this.ecrRepository);
        this.createApplicationStack(scope, Stage.PROD, this.ecrRepository);

        const encryptionKey = kms.Key.fromKeyArn(this, 'code-pipeline-artifact-key', CiCdStack.ENCRYPTION_KEY_ARN);

        this.codeBuildCache = this.setupCodeBuildCache(encryptionKey);
        const s3SourceBucket = this.setupCodeBuildArtifactBucket(encryptionKey);
        const s3TargetBucket = this.setupCodePipelineArtifactBucket(encryptionKey);

        const featureArtifactName = 'feature.zip';
        this.setupCodeBuildForFeatureBranches(s3SourceBucket, featureArtifactName);
        this.setupCodePipelineForFeatureBranches(s3SourceBucket, s3TargetBucket, featureArtifactName);

        const hotfixArtifactName = 'hotfix.zip';
        this.setupCodeBuildForHotfixBranches(s3SourceBucket, hotfixArtifactName);
        this.setupCodePipelineForHotfixBranches(s3SourceBucket, s3TargetBucket, hotfixArtifactName);

        this.setupCodePipelineForMainBranch(encryptionKey, s3TargetBucket);

        cdk.Tags.of(this).add('env', AwsAccount.TOOLING.identifier);
    }

    private setupCodeBuildArtifactBucket(encryptionKey: kms.IKey): s3.IBucket {
        return s3.Bucket.fromBucketAttributes(this, 'avr-awscodebuild-artifacts', {
            bucketArn: 'arn:aws:s3:::avr-awscodebuild-artifacts',
            encryptionKey
        });
    }

    private setupCodePipelineArtifactBucket(encryptionKey: kms.IKey): s3.IBucket {
        return s3.Bucket.fromBucketAttributes(this, 'avr-awscodepipeline-artifacts', {
            bucketArn: 'arn:aws:s3:::avr-awscodepipeline-artifacts',
            encryptionKey
        });
    }

    private setupEcrRepository(): ecr.Repository {
        const repositoryName = this.stackProps.internalShortName;
        const repository = new ecr.Repository(this, `${this.stackProps.internalShortName}-ecr`, { repositoryName });
        
        repository.addLifecycleRule({
            rulePriority: 1,
            description: 'Remove RELEASE images',
            tagPrefixList: ['RELEASE-'],
            maxImageCount: 5
        });

        repository.addLifecycleRule({
            rulePriority: 2,
            description: 'Remove HOTFIX images',
            tagPrefixList: ['HOTFIX-'],
            maxImageCount: 5
        });

        repository.addLifecycleRule({
            rulePriority: 3,
            description: 'Remove FEATURE images',
            tagPrefixList: ['FEATURE-'],
            maxImageAge: cdk.Duration.days(5)
        });

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
                            "arn:aws:iam::" + Stage.TEST.env.account + ":root",
                            "arn:aws:iam::" + Stage.STAGING.env.account + ":root",
                            "arn:aws:iam::" + Stage.PROD.env.account + ":root"
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

    private createApplicationStack(scope: cdk.Construct, stage: Stage, repository: ecr.Repository, serviceProps?: FargateServiceProps) {
        const stackName = `${stage.identifier}-${this.stackProps.internalShortName}-app`;
        const stack = new cdk.Stack(scope, stackName, {
            env: stage.env,
            description: `Application stack for ${this.stackProps.internalShortName} on ${stage.identifier}.`,
            stackName
        });

        const fargateService = new AvrFargateService(stack, this.stackProps.internalShortName, stage, repository, serviceProps);
        this.serviceImage[stage.identifier] = fargateService.image;

        cdk.Tags.of(stack).add('env', stage.identifier);
    }

    private setupCodeBuildCache(encryptionKey: kms.IKey): codebuild.Cache {
        // add a cache for build artifact (maven or npm dependencies, angular artifacts), used by our codebuild projects
        const s3Cache = s3.Bucket.fromBucketAttributes(this, 'avr-awscodebuild-cache', {
            bucketArn: 'arn:aws:s3:::avr-awscodebuild-cache',
            encryptionKey
        });
        return codebuild.Cache.bucket(s3Cache, { prefix: this.stackProps.internalShortName });
    }

    private setupCodeBuildForFeatureBranches(s3SourceBucket: s3.IBucket, artifactName: string): void {
        const projectName = `${this.stackProps.internalShortName}-feature`;
        const codeBuildProject = new codebuild.Project(this, `${projectName}-build`, {
            projectName,
            description: `${this.stackProps.internalShortName}: feature branches`,
            badge: false,
            environment: {
                buildImage: this.stackProps.codeBuildImage,
                computeType: this.stackProps.codeBuildComputeType,
                privileged: true,
                environmentVariables: {
                    'CODE_ARTIFACT_ACCOUNT': this.getCodeArtifactAccountForCodeBuild(),
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
                    repo: this.stackProps.gitRepositoryName,
                    webhook: true,
                    reportBuildStatus: true,
                    webhookFilters: [
                        codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH)
                            .andBranchIsNot(this.stackProps.mainBranch)
                            .andBranchIsNot(CiCdStack.HOTFIX_BRANCH_PATTERN)
                            .andCommitMessageIsNot(CiCdStack.SKIP_CI_PATTERN)
                    ],
                    cloneDepth: 1
            }),
            artifacts: codebuild.Artifacts.s3({
                bucket: s3SourceBucket,
                path: this.stackProps.internalShortName,
                name: artifactName,
                packageZip: true,
                includeBuildId: false
            })
        });

        this.updateCodeBuildProjectPermissions(codeBuildProject);
    }

    private setupCodeBuildForHotfixBranches(s3SourceBucket: s3.IBucket, artifactName: string): void {
        const projectName = `${this.stackProps.internalShortName}-hotfix`;
        const codeBuildProject = new codebuild.Project(this, `${projectName}-build`, {
            projectName,
            description: `${this.stackProps.internalShortName}: hotfix branches`,
            badge: false,
            environment: {
                buildImage: this.stackProps.codeBuildImage,
                computeType: this.stackProps.codeBuildComputeType,
                privileged: true,
                environmentVariables: {
                    'CODE_ARTIFACT_ACCOUNT': this.getCodeArtifactAccountForCodeBuild(),
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
                repo: this.stackProps.gitRepositoryName,
                webhook: true,
                reportBuildStatus: true,
                webhookFilters: [
                    codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH)
                        .andBranchIs(CiCdStack.HOTFIX_BRANCH_PATTERN)
                        .andCommitMessageIsNot(CiCdStack.SKIP_CI_PATTERN)
                ],
                cloneDepth: 1
            }),
            artifacts: codebuild.Artifacts.s3({
                bucket: s3SourceBucket,
                path: this.stackProps.internalShortName,
                name: artifactName,
                packageZip: true,
                includeBuildId: false
            })
        });

        this.updateCodeBuildProjectPermissions(codeBuildProject);
    }

    private setupCodeBuildPipelineProject(encryptionKey: kms.IKey): codebuild.PipelineProject {
        // only alphanumeric characters, dash and underscore are supported
        const projectName = `${this.stackProps.internalShortName}-${this.stackProps.mainBranch.replace(/[^\w]/gi, '-')}`;
        const codeBuildProject = new codebuild.PipelineProject(this, `${projectName}-build`, {
            projectName,
            description: `${this.stackProps.internalShortName}: ${this.stackProps.mainBranch} branch`,
            environment: {
                buildImage: this.stackProps.codeBuildImage,
                computeType: this.stackProps.codeBuildComputeType,
                privileged: true,
                environmentVariables: {
                    'CODE_ARTIFACT_ACCOUNT': this.getCodeArtifactAccountForCodeBuild(),
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

    private setupCodePipelineForFeatureBranches(sourceBucket: s3.IBucket, targetBucket: s3.IBucket, artifactName: string): void {
        const s3SourceArtifact = new codepipeline.Artifact();

        const codePipeline = new codepipeline.Pipeline(this, `${this.stackProps.internalShortName}-feature-pipeline`, {
            pipelineName: `${this.stackProps.internalShortName}-feature`,
            artifactBucket: targetBucket
        });

        this.addS3SourceStage(codePipeline, sourceBucket, s3SourceArtifact, artifactName);
        this.addApprovalStage(codePipeline, Stage.TEST, false);
        this.addDeployStage(codePipeline, Stage.TEST, s3SourceArtifact);
    }

    private setupCodePipelineForHotfixBranches(sourceBucket: s3.IBucket, targetBucket: s3.IBucket, artifactName: string): void {
        const s3SourceArtifact = new codepipeline.Artifact();

        const codePipeline = new codepipeline.Pipeline(this, `${this.stackProps.internalShortName}-hotfix-pipeline`, {
            pipelineName: `${this.stackProps.internalShortName}-hotfix`,
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

        const codePipeline = new codepipeline.Pipeline(this, `${this.stackProps.internalShortName}-main-pipeline`, {
            pipelineName: `${this.stackProps.internalShortName}-main`,
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
            bucketKey: `${this.stackProps.internalShortName}/${artifactName}`,
            output: s3SourceArtifact
        });
    }

    private getDeployAction(stage: Stage, buildOutput: codepipeline.Artifact): actions.CloudFormationCreateUpdateStackAction {
        return new actions.CloudFormationCreateUpdateStackAction({
            actionName: `cfn-deploy-${stage.identifier}`,
            stackName: `${stage.identifier}-${this.stackProps.internalShortName}-app`,
            templatePath: buildOutput.atPath(`${stage.identifier}-${this.stackProps.internalShortName}-app.template.json`),
            adminPermissions: true,
            parameterOverrides: {
                [this.serviceImage[stage.identifier].tagParameterName]: buildOutput.getParam('imagedefinitions.json', 'imageTag'),
            },
            extraInputs: [buildOutput],
            account: stage.env.account
        });
    }

    private getGitHubAction(sourceArtifact: codepipeline.Artifact): actions.GitHubSourceAction {
        const secret = cdk.SecretValue.secretsManager(CiCdStack.GITHUB_TOKEN_PATH);

        return new actions.GitHubSourceAction({
            actionName: 'SourceCodeCheckout',
            output: sourceArtifact,
            oauthToken: secret,
            owner: 'avrios',
            repo: this.stackProps.gitRepositoryName,
            branch: this.stackProps.mainBranch,
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
        const info = `Manual approval for deploying ${this.stackProps.internalShortName} to ${stage.getUpperCaseIdentifier()} needed.`;
        return new actions.ManualApprovalAction({
            actionName: `ManualApprovalFor${stage.getCapitalizedIdentifier()}`,
            notificationTopic: notify ? new sns.Topic(this, `manual-approval-for-${this.stackProps.internalShortName}-${stage.identifier}`, {
                displayName: `manual-approval-for-${this.stackProps.internalShortName}-${stage.identifier}`,
                topicName: `manual-approval-for-${this.stackProps.internalShortName}-${stage.identifier}`
            }) : undefined,
            notifyEmails: notify ? this.stackProps.approvalNotifyEmails : undefined,
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

    // TODO change to TOOLING when repos are migrated from avr-test to avr-tooling
    private getCodeArtifactAccountForCodeBuild(): codebuild.BuildEnvironmentVariable {
        return { 
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, 
            value: Stage.TEST.env.account 
        };
    }

    private static defaultMissingValues(stackProps: CiCdStackProps): CompletedCiCdStackProps {
        const mainBranch = stackProps.mainBranch ? stackProps.mainBranch : 'main';
        const codeBuildImage = stackProps.codeBuildImage ? stackProps.codeBuildImage : codebuild.LinuxBuildImage.STANDARD_5_0;
        const codeBuildComputeType = stackProps.codeBuildComputeType ? stackProps.codeBuildComputeType : codebuild.ComputeType.SMALL;
        const approvalNotifyEmails = stackProps.approvalNotifyEmails ? stackProps.approvalNotifyEmails : [];
        return {
            internalShortName: stackProps.internalShortName,
            gitRepositoryName: stackProps.gitRepositoryName,
            mainBranch,
            codeBuildImage,
            codeBuildComputeType,
            approvalNotifyEmails
        };
    }
}
