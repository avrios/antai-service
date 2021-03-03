#!/bin/bash

# provided by Dockerfile, see CMD to start the service
JAR_FILE="$1"
java    \
        -javaagent:/var/opt/tracking-agent/dd-java-agent.jar \
        -Dfile.encoding=UTF8 \
        -Dlog4j.configurationFile=log4j2.xml \
        -jar "${JAR_FILE}" --server.port=${container.expose.port}
