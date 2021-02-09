#!/usr/bin/env node

import { ComputeType } from '@aws-cdk/aws-codebuild';

/**
 * Short-hand name of the service, mostly used for setting up the ALB routing rules.
 */
export const INTERNAL_NAME_SHORT               = 'blueprint';

/**
 * Internal service name used through out the project. It should be <SERVICE>-service.
 */
export const INTERNAL_NAME                     = `${INTERNAL_NAME_SHORT}-service`;

/**
 * Minimal amount of memory for the service in MB.
 * Should be less than TASK_MEMORY_LIMIT_MIB.
 */
export const SERVICE_XMS                       = 750;

/**
 * Maximum amount of memory for the service in MB.
 * Should be less than TASK_MEMORY_LIMIT_MIB and is usually equals to SERVICE_XMS.
 */
export const SERVICE_XMX                       = SERVICE_XMS;

/**
 * The number of cpu units used by the task.
 * See ApplicationLoadBalancedFargateServiceProps for possible values.
 */
export const TASK_CPU                          = 512;

/**
 * The amount (in MiB) of memory used by the task.
 * See ApplicationLoadBalancedFargateServiceProps for possible values.
 * Depends on TASK_CPU.
 */
export const TASK_MEMORY_LIMIT_MIB             = 1024;

/**
 * The number of cpu units used by the tracking agent container.
 * See ContainerDefinitionOptions for possible values.
 *
 * The CPU amount recommended by datadog: https://docs.datadoghq.com/integrations/ecs_fargate/.
 */
export const TRACKING_AGENT_TASK_CPU           = 10;

/**
 * The amount (in MiB) of memory used by the tracking agent container.
 * See ContainerDefinitionOptions for possible values.
 * Depends on TASK_CPU.
 *
 * The memory amount recommended by datadog: https://docs.datadoghq.com/integrations/ecs_fargate/.
 */
export const TRACKING_AGENT_MEMORY_LIMIT_MIB   = 256;

/**
 * The number of cpu units used by the log router container.
 * See ContainerDefinitionOptions for possible values.
 *
 * The cpu amount is based on the following study:
 * https://aws.amazon.com/blogs/containers/under-the-hood-firelens-for-amazon-ecs-tasks/
 */
export const LOGS_ROUTER_TASK_CPU              = 5;

/**
 * The amount (in MiB) of memory used by the log router container.
 * See ContainerDefinitionOptions for possible values.
 * Depends on TASK_CPU.
 *
 * The memory amount is based on the following study:
 * https://aws.amazon.com/blogs/containers/under-the-hood-firelens-for-amazon-ecs-tasks/
 */
export const LOGS_ROUTER_MEMORY_LIMIT_MIB      = 100;

/**
 * The period of time, in seconds, that the Amazon ECS service scheduler ignores unhealthy
 * Elastic Load Balancing target health checks after a task has first started.
 */
export const TASK_HEALTH_CHECK_GRACE_PERIOD    = 60;

/**
 * The port number on the container that is bound to the user-specified host port.
 */
export const CONTAINER_PORT                    = 8080;

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
export const APPROVAL_NOTIFY_EMAILS            = [ 'roger@avrios.com', 'saifeddine.romdhane@avrios.com' ];

/////////////////
// ATTENTION:
// You may change settings below, but most of the time this is not needed.
/////////////////

/**
 * Set to false if the service shouldn't be deployed to test. Currently
 * all services are on test, staging and prod. In the future we will
 * probably consolidate this and get rid of test.avrios.io.
 */
export const DEPLOY_TO_TEST                    = true;

/**
 * Repository name without github and owner prefix:
 * https://github.com/Avrios/blueprint-service => 'blueprint-service'.
 * This is usually the same as INTERNAL_NAME.
 */
export const REPO_NAME                         = INTERNAL_NAME;

/**
 * Name of the main branch. The infrastructure stack creates a deployment pipeline for this branch.
 */
export const MAIN_BRANCH                       = 'master';

/**
 * Location of the github token in the AWS Secret Manager.
 */
export const GITHUB_TOKEN_PATH                 = '/dev/github.token';

/**
 * Encryption key used to share code pipeline artifacts.
 */
export const ENCRYPTION_KEY                    = 'arn:aws:kms:eu-central-1:821747761766:key/656022f0-aa97-4c56-bb5f-db7d5a8f29b9';

/**
 * Logs Agent host.
 */
export const LOGS_AGENT_HOST                   = 'http-intake.logs.datadoghq.eu';
