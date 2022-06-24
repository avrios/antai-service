package com.avrios.blueprint.repository;

import com.avrios.blueprint.model.BlueprintFilteredEntity;
import com.avrios.girders.persistence.repository.filtered.FilteredCrudRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface BlueprintFilteredEntityRepository extends FilteredCrudRepository<BlueprintFilteredEntity> {
}
