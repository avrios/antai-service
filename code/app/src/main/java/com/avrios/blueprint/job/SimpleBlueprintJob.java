package com.avrios.blueprint.job;

import com.avrios.girders.awsmessaging.sns.MessagingService;
import com.avrios.job.ExecutionScheduledMessage;
import com.avrios.job.SimpleJob;
import io.awspring.cloud.messaging.listener.SqsMessageDeletionPolicy;
import io.awspring.cloud.messaging.listener.annotation.SqsListener;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Slf4j
@Component
public class SimpleBlueprintJob extends SimpleJob {
    public SimpleBlueprintJob(MessagingService messagingService) {
        super(messagingService);
    }

    @SqsListener(value = "${aws.queue.simpleJob}", deletionPolicy = SqsMessageDeletionPolicy.ALWAYS)
    public void processMessage(ExecutionScheduledMessage message) {
        super.processMessage(message);
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
