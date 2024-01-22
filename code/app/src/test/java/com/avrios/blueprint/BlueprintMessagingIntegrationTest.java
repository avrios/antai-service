package com.avrios.blueprint;

import com.avrios.blueprint.config.BugsnagConfiguration;
import com.avrios.blueprint.config.WebSecurityConfiguration;
import com.avrios.girders.awscommon.config.AwsCredentialsProviderConfiguration;
import com.avrios.girders.awsmessaging.config.sqs.AwsSqsHealthConfiguration;
import com.avrios.girders.awsmessaging.sns.MessagingService;
import com.avrios.girders.awsmessagingtypes.BaseMessage;
import com.avrios.girders.common.Stage;
import com.avrios.girders.common.StageHolder;
import io.zonky.test.db.AutoConfigureEmbeddedDatabase;
import lombok.EqualsAndHashCode;
import lombok.Value;
import lombok.experimental.SuperBuilder;
import lombok.extern.jackson.Jacksonized;
import org.awaitility.Awaitility;
import org.awaitility.Durations;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sns.model.SubscribeRequest;
import software.amazon.awssdk.services.sqs.SqsAsyncClient;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesResponse;
import software.amazon.awssdk.services.sqs.model.GetQueueUrlRequest;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

import javax.annotation.PostConstruct;
import javax.inject.Inject;
import java.time.Duration;
import java.util.concurrent.ExecutionException;

import static com.avrios.blueprint.BlueprintMessagingIntegrationTest.INTEGRATION_TEST_STAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.when;

@ActiveProfiles("dev")
@Testcontainers
@SpringBootTest(
        properties = {
                "jasypt.encryptor.password=secret",
                "spring.profiles.active=" + INTEGRATION_TEST_STAGE,
                "aws.avrios.stage=" + INTEGRATION_TEST_STAGE,
                "avrios.flyway.env=" + INTEGRATION_TEST_STAGE,
                "spring.flyway.locations=classpath:db/migration/V1_0",
                "jwtIssuer.userpools=placeholder_pool"
        },
        webEnvironment = SpringBootTest.WebEnvironment.NONE
)
@AutoConfigureEmbeddedDatabase(provider = AutoConfigureEmbeddedDatabase.DatabaseProvider.ZONKY)
@Import({BlueprintMessagingIntegrationTest.LocalstackTestConfiguration.class, BlueprintServiceApplication.class})
/**
 * This is a sample test for a setup using testcontainers and localstack to mirror an aws environment.
 * Testcontainers allows for launching (and control) of docker containers within a test and localstack provides AWS functionality.
 * In this case we have set up an SQS subscription on the SNS topic
 * (as we tend to do in our real infrastructure) to check that a notification is added to the topic when a particular method is called.
 *
 * This style of test can be used for a variety of aws integration test e.g.
 *  - testing the reaction to a message on a queue
 *  - checking messages are queue (as here)
 *  - checking files are added to s3 (or moved around within s3)
 *
 * Multiple AWS services can be launched at once within the localstack image.
 * Unfortunately all the AWS infrastructure has to be created with command line scripts, the cloudformation cannot be used.
 */
class BlueprintMessagingIntegrationTest {
    @Container
    private static final LocalStackContainer localstack =
            new LocalStackContainer(DockerImageName.parse("localstack/localstack:1.3.1"))
                    .withServices(LocalStackContainer.Service.SQS, LocalStackContainer.Service.SNS)
                    .withReuse(true);

    public static final String INTEGRATION_TEST_STAGE = "integration-test";
    public static final String STAGE_UNAWARE_TOPIC_NAME = "blueprint-events";
    public static final String QUEUE_NAME = INTEGRATION_TEST_STAGE + "-" + STAGE_UNAWARE_TOPIC_NAME;
    public static final String TOPIC_NAME = QUEUE_NAME;

    static {
        System.setProperty("spring.profiles.active", "dev");
    }

    @MockBean
    private BugsnagConfiguration bugsnagConfiguration;
    @MockBean
    private WebSecurityConfiguration webSecurityConfiguration;
    @MockBean
    private StageHolder stageHolder;
    @Inject
    private SqsAsyncClient sqsAsyncClient;
    @Inject
    private SnsClient snsClient;
    @Inject
    private MessagingService messagingService;

    private static synchronized void startLocalstackLazy() {
        if (!localstack.isCreated()) {
            localstack.start();
        }
    }

    private static void execInContainerOrThrow(String... commands) throws Exception {
        org.testcontainers.containers.Container.ExecResult execResult = localstack.execInContainer(commands);
        if (execResult.getExitCode() > 0) {
            throw new RuntimeException(execResult.getStderr());
        }
    }

    @BeforeEach
    void setUp() {
        Awaitility.setDefaultTimeout(Durations.ONE_MINUTE);
        when(stageHolder.getCurrentStage()).thenReturn(Stage.DEV);
    }

    @Test
    void apiCallSendsMessage() throws Exception {
        // given
        String queueUrl = sqsAsyncClient.getQueueUrl(GetQueueUrlRequest.builder().queueName(QUEUE_NAME).build()).get().queueUrl();
        snsClient.subscribe(SubscribeRequest.builder()
                .topicArn("arn:aws:sns:" + localstack.getRegion() + ":000000000000:" + TOPIC_NAME)
                .protocol("sqs")
                .endpoint(queueUrl)
                .build());

        // when
        messagingService.send(TestMessage.builder().message("some-message").build());

        // then
        await().atMost(Duration.ofSeconds(1)).untilAsserted(() -> {
            assertThat(numberOfMessagesInQueue(queueUrl)).isEqualTo(1);
        });
    }

    private Integer numberOfMessagesInQueue(String queueUrl) throws ExecutionException, InterruptedException {
        // see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_GetQueueAttributes.html
        QueueAttributeName attribute = QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES;
        GetQueueAttributesResponse getQueueAttributesResponse = sqsAsyncClient.getQueueAttributes(GetQueueAttributesRequest.builder()
                .queueUrl(queueUrl)
                .attributeNames(attribute)
                .build()).get();
        return Integer.parseInt(getQueueAttributesResponse.attributes().get(attribute));
    }

    @TestConfiguration
    static class LocalstackTestConfiguration {
        @MockBean
        private AwsSqsHealthConfiguration awsSqsHealthConfiguration;
        @MockBean
        private AwsCredentialsProviderConfiguration awsCredentialsProviderConfiguration;

        @Bean
        @Primary
        AwsCredentialsProvider overriddenAwsCredentialsProvider() {
            return () -> AwsBasicCredentials.create(localstack.getAccessKey(), localstack.getSecretKey());
        }

        @Bean
        @Primary
        SnsClient overriddenSnsClient(AwsCredentialsProvider awsCredentialsProvider) {
            startLocalstackLazy();

            return SnsClient.builder()
                    .credentialsProvider(awsCredentialsProvider)
                    .region(Region.of(localstack.getRegion()))
                    .endpointOverride(localstack.getEndpointOverride(LocalStackContainer.Service.SNS))
                    .build();
        }

        @Bean
        @Primary
        SqsAsyncClient overriddenSqsAsyncClient(AwsCredentialsProvider awsCredentialsProvider) {
            startLocalstackLazy();

            return SqsAsyncClient.builder()
                    .credentialsProvider(awsCredentialsProvider)
                    .region(Region.of(localstack.getRegion()))
                    .endpointOverride(localstack.getEndpointOverride(LocalStackContainer.Service.SQS))
                    .build();
        }

        @PostConstruct
        void prepareContext() throws Exception {
            startLocalstackLazy();

            execInContainerOrThrow("awslocal", "sqs", "create-queue", "--queue-name", QUEUE_NAME);
            execInContainerOrThrow("awslocal", "sns", "create-topic", "--name", TOPIC_NAME);

            execInContainerOrThrow("awslocal", "sqs", "create-queue",
                    "--queue-name", INTEGRATION_TEST_STAGE + "-blueprint-jobSimple.fifo",
                    "--attributes", "FifoQueue=true");
            execInContainerOrThrow("awslocal", "sqs", "create-queue",
                    "--queue-name", INTEGRATION_TEST_STAGE + "-blueprint-jobComplex.fifo",
                    "--attributes", "FifoQueue=true");
        }
    }

    @Value
    @SuperBuilder
    @Jacksonized
    @EqualsAndHashCode(callSuper = true)
    public static class TestMessage extends BaseMessage {
        String message;

        @Override
        public String getTopic() {
            return STAGE_UNAWARE_TOPIC_NAME;
        }
    }
}
