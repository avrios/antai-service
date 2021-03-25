#!/usr/bin/env node

import * as cdk from '@aws-cdk/core';

import { Stage } from 'avr-cdk-utils';

export interface AvrAppStackProps {
    /**
     * Application stage of this application.
     */
    readonly stage: Stage;

    /**
     * Short-hand name of the service. Omit the '-service' suffix. 
     * Example: `blueprint` instead of `blueprint-service`.
     */
    readonly serviceShortName: string;
}

/**
 * Base application stack for your service. 
 */
export class AvrAppStack extends cdk.Stack {
    protected readonly props: AvrAppStackProps;

    /**
     * @param scope Parent of this stack, usually an `App` or a `Stage`, but could be any construct.
     * @param props Stack properties.
     */
    constructor(scope: cdk.Construct, props: AvrAppStackProps) {
        const stackName = `${props.stage.identifier}-${props.serviceShortName}-app`;
        super(scope, stackName, {
            env: props.stage.env,
            description: `Application stack for ${props.serviceShortName} on ${props.stage.identifier}.`,
            stackName
        });

        this.props = props;

        cdk.Tags.of(this).add('env', props.stage.identifier);
    }
}
