package com.avrios.blueprint.job;

import com.avrios.girders.awsmessaging.sns.MessagingService;
import com.avrios.job.ExecutionScheduledMessage;
import com.avrios.job.SimpleJob;
import io.awspring.cloud.sqs.annotation.SqsListener;
import io.awspring.cloud.sqs.annotation.SqsListenerAcknowledgementMode;
import io.awspring.cloud.sqs.listener.Visibility;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Slf4j
@Component
public class SimpleBlueprintJob extends SimpleJob {
    public SimpleBlueprintJob(MessagingService messagingService) {
        super(messagingService);
    }

    @SqsListener(value = "${aws.queue.simpleJob}", acknowledgementMode = SqsListenerAcknowledgementMode.ALWAYS)
    public void processMessage(ExecutionScheduledMessage message, Visibility visibility) {
        super.processMessage(message, visibility);
    }

    @Override
    public long processJob() {
        log.debug("Processing a simple job.");
        return 1;
    }

    @Override
    public long processPhase(UUID phaseUuid) {
        log.debug("Processing a simple job with phaseUuid={}.", phaseUuid);
        return 1;
    }
}
