package com.avrios.blueprint.repository;

import com.avrios.blueprint.model.BlueprintFilteredEntity;
import com.avrios.girders.security.AvriosUserDetails;
import com.avrios.girders.security.session.SessionOwnerType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextImpl;

import javax.inject.Inject;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@AvrDataJpaTest
class BlueprintFilteredEntityRepositoryTest {
    private static final UUID AUTHENTICATED_COMPANY_UUID = UUID.randomUUID();
    @Inject
    private BlueprintFilteredEntityRepository blueprintFilteredEntityRepository;

    @BeforeEach
    void setup() {
        AvriosUserDetails technicalUserDetails = AvriosUserDetails.builder()
                .companyUuid(AUTHENTICATED_COMPANY_UUID)
                .sessionOwnerType(SessionOwnerType.USER)
                .build();
        TestingAuthenticationToken authentication = new TestingAuthenticationToken(technicalUserDetails, null);
        SecurityContextHolder.setContext(new SecurityContextImpl(authentication));
    }

    @Test
    public void testSaveAndFindFiltered() {
        // given
        BlueprintFilteredEntity authenticatedEntity = BlueprintFilteredEntity.builder()
                .companyUuid(AUTHENTICATED_COMPANY_UUID)
                .build();

        BlueprintFilteredEntity nonAuthenticatedEntity = BlueprintFilteredEntity.builder()
                .companyUuid(UUID.randomUUID())
                .build();

        // when
        blueprintFilteredEntityRepository.save(authenticatedEntity);
        blueprintFilteredEntityRepository.save(nonAuthenticatedEntity);

        // then
        assertThat(blueprintFilteredEntityRepository.findAll()).containsExactly(authenticatedEntity);
    }
}
