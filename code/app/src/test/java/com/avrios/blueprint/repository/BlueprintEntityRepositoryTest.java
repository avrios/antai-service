package com.avrios.blueprint.repository;

import com.avrios.blueprint.model.BlueprintEntity;
import org.junit.jupiter.api.Test;

import javax.inject.Inject;

import static org.assertj.core.api.Assertions.assertThat;

@AvrDataJpaTest
class BlueprintEntityRepositoryTest {
    @Inject
    private BlueprintEntityRepository blueprintEntityRepository;

    @Test
    public void testSaveAndFind() {
        // given
        BlueprintEntity entity = new BlueprintEntity();

        // when
        BlueprintEntity savedEntity = blueprintEntityRepository.save(entity);

        // then
        assertThat(blueprintEntityRepository.getById(savedEntity.getUuid())).isNotNull();
    }
}
