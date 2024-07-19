package com.avrios.blueprint.config;

import com.avrios.girders.security.jwt.AvrEnableJwtResourceServer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

import static com.avrios.girders.security.jwt.AvrEnableJwtResourceServerConfigurer.avrConfigureJwtResourceServer;

@Configuration
@EnableWebSecurity
@AvrEnableJwtResourceServer
@EnableMethodSecurity(jsr250Enabled = true, securedEnabled = true)
public class WebSecurityConfiguration {
    @Value("${springdoc.swagger-ui.enabled}")
    private Boolean swaggerUiEnabled;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .securityContext(securityContext -> securityContext.requireExplicitSave(true))
            .sessionManagement(sessions -> sessions.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .with(avrConfigureJwtResourceServer(), Customizer.withDefaults())
            .csrf(AbstractHttpConfigurer::disable)

            .authorizeHttpRequests(authorize -> authorize
                .requestMatchers("/healthCheck/**").permitAll()
                .requestMatchers(addSwaggerPermissions()).permitAll()
                .anyRequest().authenticated());

        return http.build();
    }

    private String[] addSwaggerPermissions() {
        return swaggerUiEnabled ? new String[]{"/swagger-ui/**", "/v3/api-docs/**"} : new String[0];
    }
}
