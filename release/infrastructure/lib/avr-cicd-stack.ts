#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';

import { AwsAccount } from 'avr-cdk-utils';

export interface AvrCiCdStackProps {
    /**
     * Short-hand name of the service. Omit the '-service' suffix. 
     * Example: `blueprint` instead of `blueprint-service`.
     */
    readonly serviceShortName: string;

    /**
     * Repository name without github and owner prefix.
     * Example: `blueprint-service` instead of `https://github.com/avrios/blueprint-service`.
     */
     readonly gitRepositoryName: string;
}

/**
 * Base CI/CD stack for your service. 
 */
export class AvrCiCdStack extends cdk.Stack {
    protected readonly props: AvrCiCdStackProps;

    /**
     * @param scope Parent of this stack, usually an `App` or a `Stage`, but could be any construct.
     * @param props Stack properties.
     */
    constructor(scope: cdk.Construct, props: AvrCiCdStackProps) {
        const stackName = `${props.serviceShortName}-cicd`;
        super(scope, stackName, { 
            env: AwsAccount.TOOLING.env,
            description: `CI/CD stack for ${props.serviceShortName}.`,
            tags: { 'env': AwsAccount.TOOLING.identifier },
            stackName
        });

        this.props = props;
    }
}
