#!/bin/bash

usage() {
  echo 'Usage: ./deploy.sh [test|staging|prod|infra] <PARAMETER_OVERRIDES>'
  exit
}

if [ $# -lt 1 ]; then
  echo "Error: Stage parameter is missing."
  usage
  exit 1
fi

case $1 in
  prod )    STACK_NAME="blueprint-service-prod"
            AWS_PROFILE="avr-prod"
            STAGE_NAME="prod"
            shift
            ;;
  staging ) STACK_NAME="blueprint-service-staging"
            AWS_PROFILE="avr-staging"
            STAGE_NAME="staging"
            shift
            ;;
  test )    STACK_NAME="blueprint-service-test"
            AWS_PROFILE="avr-test"
            STAGE_NAME="test"
            shift
            ;;
  infra )   STACK_NAME="blueprint-service-infrastructure"
            AWS_PROFILE="avr-test"
            STAGE_NAME="test"
            shift
            ;;
  * )       usage;
            exit 1;
            ;;
esac

npm run build
npx cdk deploy "$STACK_NAME" --profile "$AWS_PROFILE"

if [[ $STACK_NAME == "blueprint-service-infrastructure" ]]; then
  exit 1
fi

# CDK doesn't support auto deployment when the api definition is updated.
retVal=$?
if [[ $retVal -eq 0 ]]; then
  read -r -p "Do you want to create an API Gateway deployment and make the new resources available [y/N]: " deployApiGw
    case $deployApiGw in
        [Yy]* )
          ;;
        * )
          exit;;
    esac

    echo "Creating manual API Gateway deployment..."
    REST_API_ID=$(aws --profile "$AWS_PROFILE" --region "eu-central-1" apigateway get-rest-apis | jq -r ".items[] | select(.name==\"Avrios API: $STAGE_NAME\") | .id")
    result=$(aws --profile "$AWS_PROFILE" --region "eu-central-1" apigateway create-deployment --rest-api-id "$REST_API_ID" --stage-name "$STAGE_NAME" --description "Stage deployment @ $(date)")
    if [[ -z "$result" ]]; then
      echo "Failed to deploy API Gateway. You may deploy it manually in the AWS Console."
    else
      echo "API Gateway deployment done."
    fi
fi
