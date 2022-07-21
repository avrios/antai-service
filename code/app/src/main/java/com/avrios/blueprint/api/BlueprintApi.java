package com.avrios.blueprint.api;

import org.springframework.security.access.annotation.Secured;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.avrios.girders.security.session.SecurityRoleName.COMPANY_ADMIN;
import static com.avrios.girders.security.session.SecurityRoleName.READ_WRITE_USER;

@RestController
public class BlueprintApi {
    @GetMapping
    public String helloWorld() {
        return "Hello world";
    }

    @PostMapping
    @Secured({READ_WRITE_USER, COMPANY_ADMIN})
    public String saveWorld() {
        return "Saved the world";
    }
}
