package com.avrios.blueprint;

import com.amazonaws.services.sns.AmazonSNSAsync;
import com.amazonaws.services.sns.AmazonSNSAsyncClientBuilder;
import com.amazonaws.services.sqs.AmazonSQSAsync;
import com.amazonaws.services.sqs.AmazonSQSAsyncClientBuilder;
import com.amazonaws.services.sqs.model.GetQueueAttributesResult;
import com.amazonaws.services.sqs.model.QueueAttributeName;
import com.avrios.blueprint.config.BugsnagConfiguration;
import com.avrios.blueprint.config.WebSecurityConfiguration;
import com.avrios.girders.awsmessaging.config.sns.SnsConfigurer;
import com.avrios.girders.awsmessaging.config.sqs.AwsSqsHealthConfiguration;
import com.avrios.girders.awsmessaging.config.sqs.SqsConfigurer;
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
import org.junit.jupiter.api.extension.BeforeAllCallback;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.extension.ExtensionContext;
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

import javax.inject.Inject;
import java.time.Duration;
import java.util.List;

import static com.avrios.blueprint.BlueprintMessagingIntegrationTest.INTEGRATION_TEST_STAGE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.when;

@ActiveProfiles("dev")
@Testcontainers
@ExtendWith(BlueprintMessagingIntegrationTest.TestQueueCreator.class)
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
    // This defines the version of the localstack docker image that testcontainers deploys
    public static final String LOCALSTACK_IMAGE_NAME = "localstack/localstack:1.1.0";
    public static final DockerImageName LOCALSTACK_IMAGE = DockerImageName.parse(LOCALSTACK_IMAGE_NAME);
    @Container
    private static final LocalStackContainer localstack = new LocalStackContainer(LOCALSTACK_IMAGE)
            .withServices(LocalStackContainer.Service.SQS, LocalStackContainer.Service.SNS);

    public static final String INTEGRATION_TEST_STAGE = "integration-test";
    public static final String STAGE_UNAWARE_TOPIC_NAME = "blueprint-events";
    public static final String QUEUE_NAME = INTEGRATION_TEST_STAGE + "-" + STAGE_UNAWARE_TOPIC_NAME;
    public static final String TOPIC_NAME = QUEUE_NAME;

    static {
        System.setProperty("spring.profiles.active", "dev");
    }

    @MockBean
    private AwsSqsHealthConfiguration sqsQueueHealthIndicator;
    @MockBean
    private BugsnagConfiguration bugsnagConfiguration;
    @MockBean
    private WebSecurityConfiguration webSecurityConfiguration;
    @MockBean
    private StageHolder stageHolder;
    @Inject
    private AmazonSQSAsync amazonSQS;
    @Inject
    private AmazonSNSAsync amazonSNS;
    @Inject
    private MessagingService messagingService;

    @BeforeEach
    void setUp() {
        Awaitility.setDefaultTimeout(Durations.ONE_MINUTE);
        when(stageHolder.getCurrentStage()).thenReturn(Stage.DEV);
    }

    @Test
    void apiCallSendsMessage() {
        // given
        String queueUrl = amazonSQS.getQueueUrl(QUEUE_NAME).getQueueUrl();
        amazonSNS.subscribe("arn:aws:sns:" + localstack.getRegion() + ":000000000000:" + TOPIC_NAME, "sqs", queueUrl);

        // when
        messagingService.send(TestMessage.builder().message("some-message").build());

        // then
        await().atMost(Duration.ofSeconds(1)).untilAsserted(() -> {
            assertThat(numberOfMessagesInQueue(queueUrl)).isEqualTo(1);
        });
    }

    private Integer numberOfMessagesInQueue(String queueUrl) {
        // see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_GetQueueAttributes.html
        String attributeName = QueueAttributeName.ApproximateNumberOfMessages.toString();
        GetQueueAttributesResult attributes = amazonSQS.getQueueAttributes(queueUrl, List.of(attributeName));
        return Integer.parseInt(attributes.getAttributes().get(attributeName));
    }

    @TestConfiguration
    static class LocalstackTestConfiguration {
        @Bean
        @Primary
        public SnsConfigurer snsConfigurer() {
            return new SnsConfigurer() {
                @Override
                public void configureSnsClient(AmazonSNSAsyncClientBuilder amazonSNSAsync) {
                    amazonSNSAsync.setEndpointConfiguration(localstack.getEndpointConfiguration(LocalStackContainer.Service.SNS));
                    amazonSNSAsync.setCredentials(localstack.getDefaultCredentialsProvider());

                }
            };
        }

        @Bean
        @Primary
        public SqsConfigurer sqsConfigurer() {
            return new SqsConfigurer() {
                @Override
                public void configureSqsClient(AmazonSQSAsyncClientBuilder amazonSQSAsync) {
                    amazonSQSAsync.setEndpointConfiguration(localstack.getEndpointConfiguration(LocalStackContainer.Service.SQS));
                    amazonSQSAsync.setCredentials(localstack.getDefaultCredentialsProvider());
                }
            };
        }
    }

    /**
     * Must be placed between annotations {@link Testcontainers} and {@link SpringBootTest} for the "correct" order to be respected:
     * Localstack must be ready, but the Spring Application Context not yet initialized.
     */
    static class TestQueueCreator implements BeforeAllCallback {
        @Override
        public void beforeAll(ExtensionContext context) throws Exception {
            localstack.execInContainer("awslocal", "sqs", "create-queue", "--queue-name", QUEUE_NAME);
            localstack.execInContainer("awslocal", "sns", "create-topic", "--name", TOPIC_NAME);
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
