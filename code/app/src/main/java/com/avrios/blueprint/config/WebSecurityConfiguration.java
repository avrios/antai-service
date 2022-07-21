package com.avrios.blueprint.config;

import com.avrios.girders.security.cors.AvrEnableCors;
import com.avrios.girders.security.cors.DefaultCorsConfiguration;
import com.avrios.girders.security.jwt.JwtConfiguration;
import com.avrios.girders.security.jwt.JwtFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.method.configuration.EnableGlobalMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@Import({JwtConfiguration.class, DefaultCorsConfiguration.class})
@EnableWebSecurity
@AvrEnableCors
@RequiredArgsConstructor
@EnableGlobalMethodSecurity(prePostEnabled = true, jsr250Enabled = true, securedEnabled = true)
public class WebSecurityConfiguration {
    private final JwtFilter jwtFilter;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .sessionManagement().disable()
                .cors().and()
                .csrf().disable()

                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
                .authorizeRequests()
                .regexMatchers("^/healthCheck.*").permitAll()
                .anyRequest().authenticated();
        return http.build();
    }
}
