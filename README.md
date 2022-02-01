# Avrios Blueprint Service

## How to create a service from this template

1. Click the 'Use This Template' button from within Github.
2. Set an appropriate name for the repository, suffixed with `-service`:
    - e.g. If the service is called `billing`, set the repository name to `billing-service`.
3. Replace *all* references to `blueprint` and descriptions within the repository with your project specific information.
    - Your service name must match the repository name.
    - We recommend making the search case sensitive to appropriately update descriptions instead of identifiers where necessary. (e.g. `blueprint -> billing` and `Blueprint -> Billing`).
    - Failure to do so may result in a failed deployment of application and/or cicd stack.
4. Decide whether you need build notifications in Slack by following [this guide](www.WillBeNotionDocs.com).
5. Provision the AWS CI/CD stack. See `AWS Infrastructure` below.
6. Modify this `README.md` to be specific to your service.

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

### AWS Infrastructure
In `release/infrastructure`, run `mvn clean install -P<profile>` with any of the following documented profiles:

| Profile                | Description                   | Notes                                                                                                                                           |   |   |
|------------------------|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|---|---|
| `diff-all-stacks`      | review stack changes          |                                                                                                                                                 |   |   |
| `deploy-cicd-stack`    | deploy an updated CI/CD stack |  Always deployed and updated from localhost, this creates the pipelines required for automated tests at a PR and deploying to all environments.                                                                                                                                               |   |   |
| `deploy-dev-resources` | deploy dev resources          |  The dev resources are a subset of the AWS infrastructure to be used during "local" development   (e.g. when you run the app through IntelliJ). |   |   |

# Troubleshooting
