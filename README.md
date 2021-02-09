# Avrios Blueprint Service

## Build and run locally

### Building 
The project uses maven:
 
    mvn clean install

### Run
Choose whether to run from within the IDE, or the command line:

* *IntelliJ* - refer to shared run configurations
* *Maven* - after compiling from `code` module: `mvn exec:java -pl ms-api`
* *Docker* - from `release/docker` with `mvn docker:run`

### Update project dependencies

To find project dependencies with new versions, run the following command: 
    
    mvn -N versions:display-dependency-updates
