package com.avrios.blueprint.model;

import com.avrios.girders.persistence.BaseEntity;
import lombok.NoArgsConstructor;

import javax.persistence.Entity;
import javax.persistence.Table;

@Entity
@Table(name = "t_blueprint_entity")
@NoArgsConstructor
public class BlueprintEntity extends BaseEntity {
}
