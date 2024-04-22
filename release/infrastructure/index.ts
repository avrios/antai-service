#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';
import { BlueprintDevStack } from './lib/blueprint-app-stack';
import { BlueprintCiCdStack } from './lib/blueprint-cicd-stack';

const app = new cdk.App();

new BlueprintCiCdStack(app, {
    serviceShortName: process.env.INTERNAL_NAME_SHORT!,
    gitRepositoryName: process.env.GIT_REPOSITORY_NAME!,
});

new BlueprintDevStack(app, process.env.INTERNAL_NAME_SHORT!);

app.synth();
