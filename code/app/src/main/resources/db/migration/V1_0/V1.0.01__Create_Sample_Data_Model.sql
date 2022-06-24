CREATE TABLE t_blueprint_entity
(
    uuid         CHARACTER VARYING(255) PRIMARY KEY NOT NULL,
    datecreated  TIMESTAMP WITHOUT TIME ZONE        NOT NULL,
    lastmodified TIMESTAMP WITHOUT TIME ZONE        NOT NULL
);

CREATE TABLE t_blueprint_filtered_entity
(
    uuid         CHARACTER VARYING(255) PRIMARY KEY NOT NULL,
    datecreated  TIMESTAMP WITHOUT TIME ZONE        NOT NULL,
    lastmodified TIMESTAMP WITHOUT TIME ZONE        NOT NULL,
    companyuuid  CHARACTER VARYING(255)             NOT NULL
);
