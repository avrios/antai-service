package com.avrios.antai;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@ConfigurationPropertiesScan
@SpringBootApplication
public class AntaiServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(AntaiServiceApplication.class, args);
    }
}
