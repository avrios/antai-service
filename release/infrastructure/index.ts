#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';

import { FargateStack } from './lib/fargate-stack';
import { InfrastructureStack } from './lib/infrastructure-stack';
import { INTERNAL_NAME, DEPLOY_TO_TEST } from './lib/project-settings';
import { Stage } from 'avr-cdk-utils';

const app = new cdk.App();

const fargateService: {[key: string]: ecs.FargateService} = {};

if (DEPLOY_TO_TEST) {
    const fargateStackTest = new FargateStack(app, `${INTERNAL_NAME}-test`, { stage: Stage.TEST, env: Stage.TEST.env });
    fargateService[Stage.TEST.getUpperCaseIdentifier()] = fargateStackTest.fargateService;
    cdk.Tags.of(fargateStackTest).add('env', Stage.TEST.identifier);
}

const fargateStackStaging = new FargateStack(app, `${INTERNAL_NAME}-staging`, { stage: Stage.STAGING, env: Stage.STAGING.env });
fargateService[Stage.STAGING.getUpperCaseIdentifier()] = fargateStackStaging.fargateService;
cdk.Tags.of(fargateStackStaging).add('env', Stage.STAGING.identifier);

const fargateStackProd = new FargateStack(app, `${INTERNAL_NAME}-prod`, { stage: Stage.PROD, env: Stage.PROD.env });
fargateService[Stage.PROD.getUpperCaseIdentifier()] = fargateStackProd.fargateService;
cdk.Tags.of(fargateStackProd).add('env', Stage.PROD.identifier);

const infraStack = new InfrastructureStack(app, `${INTERNAL_NAME}-infrastructure`, {
    env: Stage.TEST.env,
    fargateService
});
cdk.Tags.of(infraStack).add('env', Stage.TEST.identifier);

app.synth();
