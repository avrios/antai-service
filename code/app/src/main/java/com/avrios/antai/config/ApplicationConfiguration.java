package com.avrios.antai.config;

import com.avrios.girders.common.StageHolder;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

@Configuration
@Import({
    com.avrios.girders.common.config.ApplicationConfiguration.class
})
@RequiredArgsConstructor
public class ApplicationConfiguration {
    private final StageHolder stageHolder;

    @Value("${bugsnag.active:false}")
    private boolean bugsnagActive;
}
