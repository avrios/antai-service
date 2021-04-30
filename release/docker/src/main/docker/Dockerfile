FROM 821747761766.dkr.ecr.eu-central-1.amazonaws.com/docker-base-image-java:1.1

RUN mkdir -p ${container.work.dir}

WORKDIR ${container.work.dir}

COPY ["maven/${docker.jar.name}", \
      "maven/application-*.properties", \
      "maven/start-service.sh", \
      "./"]

EXPOSE ${container.expose.port}

HEALTHCHECK --start-period=30s \
            --retries=3 \
            --timeout=2s \
            --interval=10s \
            CMD curl --fail http://localhost:${container.expose.port}${container.healthcheck.path} || exit 1

CMD ["/bin/bash", "start-service.sh", "${docker.jar.name}"]
