#!/bin/bash

# provided by Dockerfile, see CMD to start the service
JAR_FILE="$1"
java    \
        -javaagent:/var/opt/tracking-agent/dd-java-agent.jar \
        -XX:+UseThreadPriorities \
        -Xms"${XMS}" \
        -Xmx"${XMX}" \
        -Dspring.profiles.active="${STAGE}" \
        -XX:+HeapDumpOnOutOfMemoryError \
        -Dfile.encoding=UTF8 \
        -Dlog4j.configurationFile=log4j2.xml \
        -Djasypt.encryptor.password=${ENCRYPTOR_PASSWORD} \
        -Dcom.avrios.service.name=${APP_NAME} \
        -jar "${JAR_FILE}" --server.port=${container.expose.port}
