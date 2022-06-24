package com.avrios.blueprint;

import com.avrios.girders.persistence.repository.filtered.AvrEnableFilteredRepositories;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@AvrEnableFilteredRepositories
public class BlueprintServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(BlueprintServiceApplication.class, args);
    }
}
