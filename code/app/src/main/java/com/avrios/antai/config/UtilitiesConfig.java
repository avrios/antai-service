package com.avrios.antai.config;

import com.avrios.girders.monitoring.datadog.MicrometerConfiguration;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

@Configuration
@Import(MicrometerConfiguration.class)
public class UtilitiesConfig {
}
