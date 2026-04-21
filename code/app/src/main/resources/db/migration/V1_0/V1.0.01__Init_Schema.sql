CREATE SCHEMA IF NOT EXISTS ${schema};

DO
$$
BEGIN
        IF NOT EXISTS(
                SELECT
                FROM pg_catalog.pg_roles -- SELECT list can be empty for this
                WHERE rolname = '${app-user.user}') THEN
            CREATE USER ${app-user.user} WITH PASSWORD '${app-user.password}' login;
END IF;
END
$$;

GRANT USAGE ON SCHEMA ${schema} TO ${app-user.user};
GRANT ALL ON TABLE schema_version TO ${app-user.user};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT, DELETE, UPDATE ON TABLES TO ${app-user.user};
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON SEQUENCES TO ${app-user.user};
