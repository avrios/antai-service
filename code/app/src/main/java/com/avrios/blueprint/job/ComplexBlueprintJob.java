package com.avrios.blueprint.job;

import com.avrios.girders.awsmessaging.sns.MessagingService;
import com.avrios.job.ExecutionScheduledMessage;
import com.avrios.job.ParallelJob;
import io.awspring.cloud.sqs.annotation.SqsListener;
import io.awspring.cloud.sqs.annotation.SqsListenerAcknowledgementMode;
import io.awspring.cloud.sqs.listener.Visibility;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;

@Slf4j
@Component
public class ComplexBlueprintJob extends ParallelJob {
    public ComplexBlueprintJob(MessagingService messagingService) {
        super(messagingService);
    }

    @SqsListener(value = "${aws.queue.complexJob}", acknowledgementMode = SqsListenerAcknowledgementMode.ALWAYS)
    public void processMessage(ExecutionScheduledMessage message, Visibility visibility) {
        super.processMessage(message, visibility);
    }

    @Override
    protected Set<UUID> getJobPhases() {
        return Set.of(UUID.randomUUID(), UUID.randomUUID());
    }

    @Override
    public long processPhase(UUID phaseUuid) {
        log.debug("Processing a complex job with phaseUuid={}.", phaseUuid);
        return 1;
    }
}
