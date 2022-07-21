package com.avrios.blueprint.model;

import com.avrios.girders.persistence.BaseEntity;
import lombok.NoArgsConstructor;

import javax.persistence.Entity;
import javax.persistence.Table;

@Entity
@NoArgsConstructor
@Table(name = "t_blueprint_entity")
public class BlueprintEntity extends BaseEntity {
}
