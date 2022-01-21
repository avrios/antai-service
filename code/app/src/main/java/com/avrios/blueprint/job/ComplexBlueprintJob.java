package com.avrios.blueprint.job;

import com.avrios.girders.awsmessaging.sns.MessagingService;
import com.avrios.job.ExecutionScheduledMessage;
import com.avrios.job.PhasedJob;
import io.awspring.cloud.messaging.listener.SqsMessageDeletionPolicy;
import io.awspring.cloud.messaging.listener.annotation.SqsListener;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;

@Slf4j
@Component
public class ComplexBlueprintJob extends PhasedJob {
    public ComplexBlueprintJob(MessagingService messagingService) {
        super(messagingService);
    }

    @SqsListener(value = "${aws.queue.complexJob}", deletionPolicy = SqsMessageDeletionPolicy.ALWAYS)
    public void processMessage(ExecutionScheduledMessage message) {
        super.processMessage(message);
    }

    @Override
    protected Set<UUID> getJobPhases() {
        return Set.of(UUID.randomUUID(), UUID.randomUUID());
    }

    @Override
    public long processPhase(UUID phaseUuid) {
        log.debug("Processing a simple job with phaseUuid={}.", phaseUuid);
        return 1;
    }
}
