package com.avrios.blueprint.config;

import com.avrios.girders.security.jwt.AvrEnableJwtResourceServer;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.method.configuration.EnableGlobalMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

import static com.avrios.girders.security.jwt.AvrEnableJwtResourceServerConfigurer.avrConfigureJwtResourceServer;

@Configuration
@EnableWebSecurity
@AvrEnableJwtResourceServer
@EnableGlobalMethodSecurity(prePostEnabled = true, jsr250Enabled = true, securedEnabled = true)
public class WebSecurityConfiguration {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .sessionManagement().sessionCreationPolicy(SessionCreationPolicy.STATELESS).and()
                .apply(avrConfigureJwtResourceServer()).and()
                .csrf().disable()

                .authorizeRequests()
                .regexMatchers("^/healthCheck.*").permitAll()
                .anyRequest().authenticated();
        return http.build();
    }
}
