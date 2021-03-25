#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as ecr from '@aws-cdk/aws-ecr';

import { Stage } from 'avr-cdk-utils';

export interface AvrEcrRepositoryProps {
    /**
     * Name for the repository, usually the `serviceShortName`.
     * Example: `blueprint`.
     */
    readonly repositoryName: string;
}

/**
 * Defines an ecr.Repository with our default settings for lifecycle rules, 
 * repository policy (cross-account access) and the repository name. 
 */
export class AvrEcrRepository extends cdk.Construct {
    protected readonly props: AvrEcrRepositoryProps;
    public readonly repository: ecr.Repository;

    /**
     * @param scope The construct tree node associated with this construct.
     * @param repositoryName 
     */
    constructor(scope: cdk.Construct, props: AvrEcrRepositoryProps) {
        super(scope, `${props.repositoryName}-ecr`);

        this.props = props;

        this.repository = this.createEcrRepository();
    }

    private createEcrRepository(): ecr.Repository {
        const repository = new ecr.Repository(this, `${this.props.repositoryName}-ecr`, { 
            repositoryName: this.props.repositoryName 
        });
        
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
}
