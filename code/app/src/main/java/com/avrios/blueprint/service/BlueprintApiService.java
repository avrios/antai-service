package com.avrios.blueprint.service;

import com.avrios.girders.awsmessaging.sns.MessagingService;
import com.avrios.girders.awsmessagingtypes.BaseMessage;
import com.avrios.girders.common.service.ApiService;
import lombok.EqualsAndHashCode;
import lombok.RequiredArgsConstructor;
import lombok.Value;
import lombok.experimental.SuperBuilder;
import lombok.extern.jackson.Jacksonized;

@ApiService
@RequiredArgsConstructor
public class BlueprintApiService {
    private final MessagingService messagingService;

    public void send(String message) {
        messagingService.send(BlueprintMessage.builder()
                .message(message)
                .build());
    }

    @Value
    @SuperBuilder
    @Jacksonized
    @EqualsAndHashCode(callSuper = true)
    public static class BlueprintMessage extends BaseMessage {
        private static final String STAGE_UNAWARE_TOPIC_NAME = "blueprint-events";
        String message;

        @Override
        public String getTopic() {
            return STAGE_UNAWARE_TOPIC_NAME;
        }
    }
}
