#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';

import { CiCdStack } from './lib/cicd-stack';

const app = new cdk.App();

new CiCdStack(app, process.env.INTERNAL_NAME_SHORT!, process.env.GIT_REPOSITORY_NAME!);

app.synth();
