#!/usr/bin/env bash
set -e

SERVICE_IDENTIFIER="blueprint-service"
REGION="eu-central-1"
ACCOUNT_ID="821747761766"

echo "Creating repository."
aws ecr create-repository \
  --repository-name ${SERVICE_IDENTIFIER} \
  --image-scanning-configuration scanOnPush=true \
  --profile avr-test

echo "Setting repository lifecycle policy."
aws ecr put-lifecycle-policy \
  --registry-id ${ACCOUNT_ID} \
  --repository-name ${SERVICE_IDENTIFIER} \
  --lifecycle-policy-text "file://lifecycle-policy.json" \
  --profile avr-test

echo "Setting repository policy."
aws ecr set-repository-policy \
  --registry-id ${ACCOUNT_ID} \
  --repository-name ${SERVICE_IDENTIFIER} \
  --policy-text "file://repository-policy.json" \
  --profile avr-test

# move to project root
cd ../../..

echo "Building the project."
aws ecr get-login-password --region ${REGION} --profile avr-test | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com
mvn versions:set versions:update-child-modules -DnewVersion=1
mvn clean install

echo "Pushing the docker image."
docker load -i release/docker/target/${SERVICE_IDENTIFIER}-1.tar.gz
docker tag ${SERVICE_IDENTIFIER}:1 ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${SERVICE_IDENTIFIER}:latest;
docker push ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${SERVICE_IDENTIFIER}:latest
