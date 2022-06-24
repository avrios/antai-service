package com.avrios.blueprint.model;

import com.avrios.girders.persistence.repository.filtered.CompanyBaseEntity;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import javax.persistence.Entity;
import javax.persistence.Table;
import javax.validation.constraints.NotNull;
import java.util.UUID;

@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "t_blueprint_filtered_entity")
public class BlueprintFilteredEntity extends CompanyBaseEntity {
    @NotNull
    @Type(type = "uuid-char")
    private UUID companyUuid;
}
