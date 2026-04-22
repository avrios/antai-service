# Avrios Antai Service

## Build and run locally
### Building
The project uses maven:

```bash
mvn clean install
```

### Run
Choose whether to run from within the IDE, or the command line:

* *IntelliJ* - refer to shared run configurations
* *Maven* - after compiling from `code/` module: `mvn exec:java -pl app`
* *Docker* - from `release/docker` with `mvn docker:run`

As hinted above, we use fabric8's maven plugin to abstract the Docker build commands. [See here for a full list of Maven goals](https://github.com/fabric8io/docker-maven-plugin#goals).

### Test
```bash
mvn clean test
```

### Update project dependencies

To find project dependencies with new versions, run the following command:

```bash
mvn -N versions:display-dependency-updates
```

### Default REST Endpoints

Through *Spring Actuator*, the following default REST endpoints expose information automatically:

* `/healthCheck`: Reporting overall service health, in order to determine container health and system uptime.
* `/info`: Reports overall deployment information, such as the version running as well as when it was built.

# AWS Infrastructure
In `release/infrastructure`, run `mvn clean install -P<profile>` with any of the following documented profiles:

| Profile                | Description                   | Notes                                                                                                                                           |   |   |
|------------------------|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|---|---|
| `diff-all-stacks`      | review stack changes          |                                                                                                                                                 |   |   |
| `deploy-cicd-stack`    | deploy an updated CI/CD stack |  Always deployed and updated from localhost, this creates the pipelines required for automated tests at a PR and deploying to all environments.                                                                                                                                               |   |   |
| `deploy-dev-resources` | deploy dev resources          |  The dev resources are a subset of the AWS infrastructure to be used during "local" development   (e.g. when you run the app through IntelliJ). |   |   |

# Deployments

Merges to trunk (`main` Git Branch) trigger a Codepipeline job within the tooling account which deploys to test & staging. A manual step is then required for final deployment to prod. You can find the Codepipeline project [here](https://eu-central-1.console.aws.amazon.com/codesuite/codepipeline/pipelines/antai-main/view?region=eu-central-1). This is true for both application code and AWS infrastructure*.

*The exception being tooling infrastructure, which must be deployment manually. See `AWS Infrastructure` above.

# Integration Tests

This project has sample tests for 2 types of integration tests:
 - DataJpaTest with Zonky
 - AWS infrastructure test with localstack and testcontainers

These are to provide an idea of what it might make sense to cover with integration tests and how you might go about this.

# Contributing

Anyone may contribute to the project. Propose your change via PR ensuring:
- All tests pass.
- Code has been formatted and linted.
  - As a Git Hook
    - `mvn dependency:unpack@update-checkstyle -U`
    - `cp target/checkstyle/pre-commit.py .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`
  - Through IntelliJ
    - Install CheckStyle plugin Preferences -> Plugins -> CheckStyle-IDEA
- Git history adheres to our [Conventional Commit Strategy guidelines](https://github.com/avrios/core-service/wiki/Git-Commit-Guidelines).
