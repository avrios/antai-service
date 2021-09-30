# Avrios Blueprint Service

## Build and run locally

### Building 
The project uses maven:
 
    mvn clean install

### Run
Choose whether to run from within the IDE, or the command line:

* *IntelliJ* - refer to shared run configurations
* *Maven* - after compiling from `code` module: `mvn exec:java -pl bp-api`
* *Docker* - from `release/docker` with `mvn docker:run`

### Update project dependencies

To find project dependencies with new versions, run the following command: 
    
    mvn -N versions:display-dependency-updates

### Default REST Endpoints

Through *Spring Actuator*, the following default REST endpoints expose information automatically:

* **healthCheck**: Reporting overall service health, in order to determine container health and system uptime.
* **info**: Reports overall deployment information, such as the version running as well as when it was built.

### AWS Infrastructure
In `release/infrastructure`, run ` mvn clean install -P<profile>`, in order to

* review stack changes: `diff-all-stacks`
* deploy an updated CI/CD stack: `deploy-cicd-stack`

  **Caution**: deploying the update runs non-interactively, you're not going to be asked to review
  IAM changes. Use `diff-all-stacks` first in order to review changes.

* deploy dev resources: `deploy-dev-resources`

  **Note**: The dev resources are a subset of the AWS infrastructure to be used during "local" development
  (e.g. when you run the app through IntelliJ) 
