#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as iam from '@aws-cdk/aws-iam';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as kms from '@aws-cdk/aws-kms';
import * as sns from '@aws-cdk/aws-sns';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as actions from '@aws-cdk/aws-codepipeline-actions';

import { Stage } from 'avr-cdk-utils';

export interface AvrCodePipelineProps {
    /**
     * Dedicated ECR repository for this application. 
     */
    readonly ecrRepository: ecr.Repository;
    
    /**
     * List of container images for all the supported stages.
     */
    readonly serviceImages: {[key: string]: ecs.TagParameterContainerImage};

    /**
     * Short-hand name of the service. Omit the '-service' suffix. 
     * Example: 'blueprint' instead of 'blueprint-service'.
     */
    readonly serviceShortName: string;
    
    /**
     * Repository name without github and owner prefix.
     * Example: blueprint-service instead of 'https://github.com/avrios/blueprint-service'.
     */
    readonly gitRepositoryName: string;

    /**
     * Name of the main branch. 
     * @default main
     */
    readonly mainBranch?: string;

    /**
     * Build image used by the code build projects. See
     * https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-codebuild.LinuxBuildImage.html
     * @default STANDARD_5_0
     */
    readonly codeBuildImage?: codebuild.IBuildImage;
    
    /**
     * Size of AWS CodeBuild instance to compile and build the docker image. See
     * https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-codebuild.ComputeType.html
     * @default ComputeType.SMALL
     */
    readonly codeBuildComputeType?: codebuild.ComputeType;
 
    /**
     * Defines who should get notified by email if an approval is needed before deployment.
     * You can also manually subscribe to the SNS topic later.
     * @default {}
     */
    readonly approvalNotifyEmails?: string[];
}

export interface CompletedAvrCodePipelineProps {
    readonly pipelineName: string;
    readonly ecrRepository: ecr.Repository;
    readonly serviceImages: {[key: string]: ecs.TagParameterContainerImage};
    readonly serviceShortName: string;
    readonly gitRepositoryName: string;
    readonly mainBranch: string;
    readonly codeBuildImage: codebuild.IBuildImage;
    readonly codeBuildComputeType: codebuild.ComputeType;
    readonly approvalNotifyEmails: string[];
}

/**
 * Base class for code pipelines. Provides the default configuration for code pipelines, 
 * various pipeline actions and stages.
 */
export abstract class AvrCodePipeline extends cdk.Construct {
    /**
     * Location of the github token in the AWS Secret Manager.
     */
    private static readonly GITHUB_TOKEN_PATH = '/dev/github.token';

    /**
     * Encryption key used to share code build artifacts.
     */
    private static readonly ENCRYPTION_KEY_ARN = 'arn:aws:kms:eu-central-1:917835067517:key/8113893a-07f6-46fa-a3b5-eada0d7c5444';

    /**
     * Commit messages matching this pattern do not trigger a build.
     */
    protected static readonly SKIP_CI_PATTERN = ".*(\\[skip ci\\]).*";

    /**
     * Pattern to identify hotfix branches.
     */
    protected static readonly HOTFIX_BRANCH_PATTERN = 'hotfix/*';

    protected readonly props: CompletedAvrCodePipelineProps;
    protected readonly encryptionKey: kms.IKey;
    protected readonly codeBuildCache: codebuild.Cache;
    protected readonly s3SourceBucket: s3.IBucket;
    protected readonly s3TargetBucket: s3.IBucket;

    /**
     * @param scope Parent of this pipeline, usually an `App` or a `Stage`, but could be any construct.
     * @param pipelineName Unique pipeline name (within this CDK app).
     * @param props Pipeline properties.
     */
    constructor(scope: cdk.Construct, pipelineName: string, props: AvrCodePipelineProps) {
        super(scope, `code-pipeline-${props.serviceShortName}-${pipelineName}`);

        this.props = this.completeProps(props, pipelineName);

        this.encryptionKey = this.setupEncryptionKey();
        this.codeBuildCache = this.setupCodeBuildCache();
        
        this.s3SourceBucket = this.setupCodeBuildArtifactBucket();
        this.s3TargetBucket = this.setupCodePipelineArtifactBucket();
    }

    protected addS3SourceStage(codePipeline: codepipeline.Pipeline, sourceBucket: s3.IBucket, artifact: codepipeline.Artifact, artifactName: string): void {
        codePipeline.addStage({
            stageName: 'Source',
            actions: [
                this.getS3SourceAction(sourceBucket, artifact, artifactName)
            ]
        });
    }

    protected getS3SourceAction(sourceBucket: s3.IBucket, s3SourceArtifact: codepipeline.Artifact, artifactName: string): actions.S3SourceAction {
        return new actions.S3SourceAction({
            actionName: 'SourceCodeCheckout',
            bucket: sourceBucket,
            bucketKey: `${this.props.serviceShortName}/${artifactName}`,
            output: s3SourceArtifact
        });
    }

    protected addGithubSourceStage(codePipeline: codepipeline.Pipeline, branch: string, artifact: codepipeline.Artifact): void {
        codePipeline.addStage({
            stageName: 'Source',
            actions: [
                this.getGitHubAction(branch, artifact)
            ]
        });
    }

    protected getGitHubAction(branch: string, sourceArtifact: codepipeline.Artifact): actions.GitHubSourceAction {
        const secret = cdk.SecretValue.secretsManager(AvrCodePipeline.GITHUB_TOKEN_PATH);

        return new actions.GitHubSourceAction({
            actionName: 'SourceCodeCheckout',
            output: sourceArtifact,
            oauthToken: secret,
            owner: 'avrios',
            repo: this.props.gitRepositoryName,
            branch,
            trigger: actions.GitHubTrigger.WEBHOOK
        });
    }

    protected addCodeBuildStage(codePipeline: codepipeline.Pipeline, sourceArtifact: codepipeline.Artifact,
                                buildOutput: codepipeline.Artifact, codeBuildProject: codebuild.PipelineProject): void {
        codePipeline.addStage({
            stageName: 'Build',
            actions: [
                this.getCodeBuildAction(sourceArtifact, buildOutput, codeBuildProject)
            ]
        });
    }

    protected getCodeBuildAction(sourceArtifact: codepipeline.Artifact,
                                 imageDefinitionsArtifact: codepipeline.Artifact,
                                 codeBuildProject: codebuild.PipelineProject): actions.CodeBuildAction {
        return new actions.CodeBuildAction({
            actionName: 'BuildAndTest',
            project: codeBuildProject,
            input: sourceArtifact,
            outputs: [imageDefinitionsArtifact],
        });
    }

    protected addApprovalStage(codePipeline: codepipeline.Pipeline, stage: Stage, notify: boolean): void {
        codePipeline.addStage({
            stageName: `ApprovalFor${stage.getCapitalizedIdentifier()}`,
            actions: [
                this.getManualApprovalAction(stage, notify)
            ]
        });
    }

    protected getManualApprovalAction(stage: Stage, notify: boolean): actions.ManualApprovalAction {
        const info = `Manual approval for deploying ${this.props.serviceShortName} to ${stage.getUpperCaseIdentifier()} needed.`;
        return new actions.ManualApprovalAction({
            actionName: `ManualApprovalFor${stage.getCapitalizedIdentifier()}`,
            notificationTopic: notify ? new sns.Topic(this, `manual-approval-for-${this.props.serviceShortName}-${stage.identifier}`, {
                displayName: `manual-approval-for-${this.props.serviceShortName}-${stage.identifier}`,
                topicName: `manual-approval-for-${this.props.serviceShortName}-${stage.identifier}`
            }) : undefined,
            notifyEmails: notify ? this.props.approvalNotifyEmails : undefined,
            additionalInformation: info
        });
    }

    protected addDeployStage(codePipeline: codepipeline.Pipeline, stage: Stage, artifact: codepipeline.Artifact): void {
        codePipeline.addStage({
            stageName: `DeployTo${stage.getCapitalizedIdentifier()}`,
            actions: [
                this.getDeployAction(stage, artifact)
            ]
        });
    }

    protected getDeployAction(stage: Stage, buildOutput: codepipeline.Artifact): actions.CloudFormationCreateUpdateStackAction {
        return new actions.CloudFormationCreateUpdateStackAction({
            actionName: `cfn-deploy-${stage.identifier}`,
            stackName: `${stage.identifier}-${this.props.serviceShortName}-app`,
            templatePath: buildOutput.atPath(`${stage.identifier}-${this.props.serviceShortName}-app.template.json`),
            adminPermissions: true,
            parameterOverrides: {
                [this.props.serviceImages[stage.identifier].tagParameterName]: buildOutput.getParam('imagedefinitions.json', 'imageTag'),
            },
            extraInputs: [buildOutput],
            account: stage.env.account
        });
    }

    // TODO change to TOOLING when repos are migrated from avr-test to avr-tooling
    protected getCodeArtifactAccountForCodeBuild(): codebuild.BuildEnvironmentVariable {
        return { 
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT, 
            value: Stage.TEST.env.account 
        };
    }

    protected updateCodeBuildProjectPermissions(project: codebuild.Project): void {
        const ec2PowerUserPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser');
        project.role?.addManagedPolicy(ec2PowerUserPolicy);

        const codeArtifactAdminPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeArtifactAdminAccess');
        project.role?.addManagedPolicy(codeArtifactAdminPolicy);

        project.addToRolePolicy(new iam.PolicyStatement({
            actions: ['sts:GetServiceBearerToken'],
            resources: ['*'],
        }));
    }

    private setupEncryptionKey(): kms.IKey {
        return kms.Key.fromKeyArn(this, `code-pipeline-artifact-key-${this.props.pipelineName}`, AvrCodePipeline.ENCRYPTION_KEY_ARN);
    }

    private setupCodeBuildArtifactBucket(): s3.IBucket {
        return s3.Bucket.fromBucketAttributes(this, `avr-awscodebuild-artifacts-${this.props.pipelineName}`, {
            bucketArn: 'arn:aws:s3:::avr-awscodebuild-artifacts',
            encryptionKey: this.encryptionKey
        });
    }
    
    private setupCodePipelineArtifactBucket(): s3.IBucket {
        return s3.Bucket.fromBucketAttributes(this, `avr-awscodepipeline-artifacts-${this.props.pipelineName}`, {
            bucketArn: 'arn:aws:s3:::avr-awscodepipeline-artifacts',
            encryptionKey: this.encryptionKey
        });
    }    
    
    private setupCodeBuildCache(): codebuild.Cache {
        const s3Cache = s3.Bucket.fromBucketAttributes(this, `avr-awscodebuild-cache-${this.props.pipelineName}`, {
            bucketArn: 'arn:aws:s3:::avr-awscodebuild-cache',
            encryptionKey: this.encryptionKey
        });
        return codebuild.Cache.bucket(s3Cache, { prefix: this.props.serviceShortName });
    }

    private completeProps(props: AvrCodePipelineProps, pipelineName: string): CompletedAvrCodePipelineProps {
        return {
            pipelineName,
            ecrRepository: props.ecrRepository,
            serviceImages: props.serviceImages,
            serviceShortName: props.serviceShortName,
            gitRepositoryName: props.gitRepositoryName,
            mainBranch: props.mainBranch ? props.mainBranch : 'main',
            codeBuildImage: props.codeBuildImage ? props.codeBuildImage : codebuild.LinuxBuildImage.STANDARD_5_0,
            codeBuildComputeType: props.codeBuildComputeType ? props.codeBuildComputeType : codebuild.ComputeType.SMALL,
            approvalNotifyEmails: props.approvalNotifyEmails ? props.approvalNotifyEmails : []
        }
    }
}
