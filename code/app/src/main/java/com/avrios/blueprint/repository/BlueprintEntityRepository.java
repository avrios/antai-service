package com.avrios.blueprint.repository;

import com.avrios.blueprint.model.BlueprintEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface BlueprintEntityRepository extends JpaRepository<BlueprintEntity, UUID> {
}
