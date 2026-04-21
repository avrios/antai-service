package com.avrios.antai.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class OpenApiConfiguration {
    public static final String X_AUTH_ID_TOKEN_HEADER = "X-Auth-Id-Token";

    @Bean
    public OpenAPI customOpenApi() {
        return new OpenAPI()
                .components(
                        new Components()
                                .addSecuritySchemes(X_AUTH_ID_TOKEN_HEADER, new SecurityScheme()
                                        .type(SecurityScheme.Type.APIKEY)
                                        .in(SecurityScheme.In.HEADER)
                                        .name(X_AUTH_ID_TOKEN_HEADER)))
                .security(List.of(new SecurityRequirement().addList(X_AUTH_ID_TOKEN_HEADER)));
    }
}
