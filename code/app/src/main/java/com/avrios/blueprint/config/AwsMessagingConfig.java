package com.avrios.blueprint.config;

import com.avrios.girders.awsmessaging.config.sns.AvrEnableSns;
import com.avrios.girders.awsmessaging.config.sns.DefaultSnsConfiguration;
import com.avrios.girders.awsmessaging.config.sqs.AvrEnableSqs;
import com.avrios.girders.awsmessaging.config.sqs.AvrEnableSqsHealth;
import com.avrios.girders.awsmessaging.config.sqs.DefaultSqsConfiguration;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

@AvrEnableSns
@AvrEnableSqs
@AvrEnableSqsHealth
@Configuration
@Import({DefaultSqsConfiguration.class, DefaultSnsConfiguration.class})
public class AwsMessagingConfig {
}
