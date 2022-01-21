package com.avrios.blueprint.config;

import com.avrios.girders.common.Stage;
import com.avrios.girders.common.StageHolder;
import com.avrios.girders.common.bugsnag.BugsnagClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class BugsnagConfiguration {
    @Value("${bugsnag.active:false}")
    private boolean bugsnagActive;

    @Value("${bugsnag.send_uncaught_exceptions:false}")
    private boolean sendUncaughtExceptions;

    @Value("${bugsnag.apiKey}")
    private String bugsnagApiKey;

    @Bean
    public StageHolder stageHolder() {
        return new StageHolder(Stage.getCurrent());
    }

    @Bean
    public BugsnagClient bugsnagClient(StageHolder stageHolder) {
        return new BugsnagClient(stageHolder.getCurrentStage(), bugsnagApiKey, bugsnagActive,
                sendUncaughtExceptions, "com.avrios.blueprint");
    }
}
