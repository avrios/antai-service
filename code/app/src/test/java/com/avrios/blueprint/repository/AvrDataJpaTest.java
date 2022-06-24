package com.avrios.blueprint.repository;

import com.avrios.girders.persistence.repository.filtered.AvrEnableFilteredRepositories;
import io.zonky.test.db.AutoConfigureEmbeddedDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.test.context.ActiveProfiles;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@ActiveProfiles("dev")
@DataJpaTest(properties = {
        "spring.jpa.hibernate.ddl-auto = validate",
        "spring.flyway.locations=classpath:db/migration/V1_0"
})
@AutoConfigureEmbeddedDatabase(provider = AutoConfigureEmbeddedDatabase.DatabaseProvider.ZONKY)
@AvrEnableFilteredRepositories
@ComponentScan(basePackageClasses = BlueprintEntityRepository.class)
public @interface AvrDataJpaTest {
}
