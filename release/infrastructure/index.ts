#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';

import { InfrastructureStack } from './lib/infrastructure-stack';

const app = new cdk.App();

new InfrastructureStack(app, process.env.INTERNAL_NAME_SHORT!, process.env.GIT_REPOSITORY_NAME!);

app.synth();
