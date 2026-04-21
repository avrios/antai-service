package com.avrios.antai;

import com.avrios.girders.persistence.repository.filtered.AvrEnableFilteredRepositories;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@AvrEnableFilteredRepositories
public class AntaiServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(AntaiServiceApplication.class, args);
    }
}
