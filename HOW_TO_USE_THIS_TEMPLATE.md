## How to create a service from this template

1. Click the 'Use This Template' button from within Github.

2. Set an appropriate name for the repository, suffixed with `-service`:
    - e.g. If the service is called `billing`, set the repository name to `billing-service`.

3. Replace *all* references to `blueprint` and descriptions within the repository with your project specific information.
    - Your service name must match the repository name.
    - We recommend making the search case sensitive to appropriately update descriptions instead of identifiers where necessary. (e.g. `blueprint -> billing` and `Blueprint -> Billing`).
    - Failure to do so may result in a failed deployment of application and/or cicd stack.

4. Find a new port to run our service on.
    - Replace `project.properties.exec.config.port` in [pom.xml](https://github.com/avrios/blueprint-service/blob/main/pom.xml) from `9999` to a new, unique value incremented from the [Services Overview Notion page](https://www.notion.so/avrios/Services-overview-3c0a0511af714b8fb75b77a13569cf22#9154d3e620944593a9aa909b2894cf67) and update the note on the page.

5. Monitoring

    a. Opt-out of Build Monitoring Slack Notifications if you don't need them or configure them if you do.
    - Builds Notifications (e.g. from Codebuild and Codepipeline) are configured inside `release/infrastructure/lib/blueprint-cicd-stack.ts` in the `AvrEcrCodePipelineProps` Class.
    - Replace the slack channel ID with the channel ID you want to alert (must be created and/or retrieved separately). Or remove all references to slack & build notifications if you don't need them.
      - There are a number of ways to get the channel ID, it might be in the 'about' tab of the channel.

    b. Set up Datadog Synthetics.
    - Create a new Synthetics API test [here](https://app.datadoghq.eu/synthetics/tests).

    c. Set up a new Bugsnag Project.
    - This can be done on the [Bugsnag Platform](https://app.bugsnag.com/organizations/avrios/stability-center). If you do not have permissions you may need to contact a Team Lead or admin.
    - Update `bugsnag.apiKey` in the following files with the value from your new Bugsnag Project.
      - [dev.properties](https://github.com/avrios/blueprint-service/blob/main/release/config/src/main/env/dev.properties)
      - [test.properties](https://github.com/avrios/blueprint-service/blob/main/release/config/src/main/env/test.properties)
      - [staging.properties](https://github.com/avrios/blueprint-service/blob/main/release/config/src/main/env/staging.properties)
      - [prod.properties](https://github.com/avrios/blueprint-service/blob/main/release/config/src/main/env/prod.properties)

    d. Opt-out of SQS DLQ Monitor if you don't need it.
    - Projects come enabled with an SQS DLQ Datadog monitor. This can be found in `release/infrastructure/lib/blueprint-app-stack.ts` in the `AvrServiceDlqMonitor` Class. Configure it here or remove it if you don't need it.
    - Documentation on how to configure it appropriately may be found [here](https://github.com/avrios/cdk-utils/blob/main/src/aws/datadog/servicedlqmonitor.ts#L15).

6. Documentation & Service Architecture
   - [Ensure the relevant child Notion pages](https://www.notion.so/avrios/Product-Delivery-761187cf730e4f98a9a2ea033a18c4cd) have been created clearly outlining what your service does, what its purpose is and how it works.
   - Tips
     - Generally we try do adhere to the [arc24 standard](https://arc42.org/overview) when writing documentation.
     - Documentation should be clear and concise, yet plentiful.
     - [Google's style guide highlights](https://developers.google.com/style/highlights) might be a good place if you are unsure of terminology or phrasing.
     - When writing documentation keep in mind what information _you_ would like to know about a service you are unfamiliar with. What information would be helpful to you to begin developing on it?

7. Modify `README.md` to be specific to your service.

8. Provision the AWS CI/CD stack. See `AWS Infrastructure` in `README.md`.

9. Delete this file & PR all changes to your new project for review.
