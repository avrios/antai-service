import * as cdk from 'aws-cdk-lib';
import { AntaiDevStack } from './lib/app-stack';
import { CicdStack } from './lib/cicd-stack';

const app = new cdk.App();

new CicdStack(app, {
    serviceShortName: process.env.INTERNAL_NAME_SHORT!,
    gitRepositoryName: process.env.GIT_REPOSITORY_NAME!,
});

new AntaiDevStack(app, process.env.INTERNAL_NAME_SHORT!);

app.synth();
