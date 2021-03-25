#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';
import { BlueprintCiCdStack } from './lib/blueprint-cicd-stack';

const app = new cdk.App();

new BlueprintCiCdStack(app, {
    serviceShortName: process.env.INTERNAL_NAME_SHORT!,
    gitRepositoryName: process.env.GIT_REPOSITORY_NAME!
});

app.synth();
