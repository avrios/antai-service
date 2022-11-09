package com.avrios.blueprint.api;

import com.avrios.blueprint.service.BlueprintApiService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.annotation.Secured;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import static com.avrios.girders.security.session.SecurityRoleName.COMPANY_ADMIN;
import static com.avrios.girders.security.session.SecurityRoleName.READ_WRITE_USER;
import static org.springframework.http.MediaType.APPLICATION_JSON_VALUE;

@RestController
@RequestMapping(path = "/dummy", produces = APPLICATION_JSON_VALUE)
@RequiredArgsConstructor
public class BlueprintApi {
    private final BlueprintApiService blueprintApiService;

    @GetMapping
    public String helloWorld() {
        return "Hello world";
    }

    @PostMapping
    @Secured({READ_WRITE_USER, COMPANY_ADMIN})
    public String saveWorld() {
        return "Saved the world";
    }

    @PostMapping("/queue")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Secured({READ_WRITE_USER, COMPANY_ADMIN})
    public void sendWorld() {
        blueprintApiService.send("world");
    }
}
