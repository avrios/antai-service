package com.avrios.blueprint.config;

import com.avrios.girders.awsmessaging.config.sns.AvrEnableSns;
import com.avrios.girders.awsmessaging.config.sqs.AvrEnableSqs;
import com.avrios.girders.awsmessaging.config.sqs.AvrEnableSqsHealth;
import org.springframework.context.annotation.Configuration;

@AvrEnableSns
@AvrEnableSqs
@AvrEnableSqsHealth
@Configuration
public class AwsMessagingConfiguration {
}
