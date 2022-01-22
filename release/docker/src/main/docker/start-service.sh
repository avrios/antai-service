#!/bin/bash

# provided by Dockerfile, see CMD to start the service
JAR_FILE="$1"
java    \
        -javaagent:/var/opt/tracking-agent/dd-java-agent.jar \
        -Dfile.encoding=UTF8 \
        -jar "${JAR_FILE}" --server.port=${container.expose.port}
