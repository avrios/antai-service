#!/usr/bin/env node

import { ComputeType } from '@aws-cdk/aws-codebuild';

/**
 * Size of AWS CodeBuild instance to compile and build the docker image.
 * You may start with ComputeType.SMALL and increase the size of the instance
 * if building takes too long or you run out of memory.
 */
export const CODE_BUILD_COMPUTE_TYPE           = ComputeType.SMALL;

/**
 * Before the service is deployed to production, a manual approval step is added.
 * You can define who should receive approval mails here. You can also manually
 * subscribe to the SNS topic later.
 */
export const APPROVAL_NOTIFY_EMAILS            = [];

/////////////////
// ATTENTION:
// You may change settings below, but most of the time this is not needed.
/////////////////

/**
 * Name of the main branch. The infrastructure stack creates a deployment pipeline for this branch.
 */
export const MAIN_BRANCH                       = 'main';
