export type FeishuInboundMessage = {
  chatId: string;
  messageId: string;
  senderOpenId: string;
  text: string;
};

type FeishuRawTextMessageEvent = {
  sender?: {
    sender_id?: {
      open_id?: string;
    };
  };
  message?: {
    chat_id?: string;
    message_id?: string;
    message_type?: string;
    content?: string;
  };
};

type FeishuRawEnvelope = {
  event?: FeishuRawTextMessageEvent;
};

export type FeishuOutboundMessage = {
  chatId: string;
  text: string;
};

export type FeishuTransport = {
  onMessage: (handler: (message: unknown) => void | Promise<void>) => void;
  connect: () => Promise<void>;
  sendMessage?: (message: FeishuOutboundMessage) => Promise<void>;
};

export type FeishuServiceDependencies = {
  transport: FeishuTransport;
  onMessage: (message: FeishuInboundMessage) => Promise<void>;
  onError?: (error: Error) => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseTextContent(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(content) as { text?: string };
    return typeof parsed.text === 'string' ? parsed.text : undefined;
  } catch {
    return undefined;
  }
}

function isNormalizedInboundMessage(value: unknown): value is FeishuInboundMessage {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.chatId === 'string' &&
    typeof value.messageId === 'string' &&
    typeof value.senderOpenId === 'string' &&
    typeof value.text === 'string'
  );
}

export function normalizeInboundFeishuMessage(rawMessage: unknown): FeishuInboundMessage | null {
  if (isNormalizedInboundMessage(rawMessage)) {
    return rawMessage;
  }

  if (!isObject(rawMessage)) {
    return null;
  }

  const envelope = rawMessage as FeishuRawEnvelope;
  const event = envelope.event;
  const rawEvent = event && isObject(event) ? event : rawMessage;

  if (!isObject(rawEvent)) {
    return null;
  }

  const sender = isObject(rawEvent.sender) ? rawEvent.sender : undefined;
  const senderId = sender && isObject(sender.sender_id) ? sender.sender_id : undefined;
  const message = isObject(rawEvent.message) ? rawEvent.message : undefined;

  const messageType = message && typeof message.message_type === 'string' ? message.message_type : undefined;
  const content = message && typeof message.content === 'string' ? message.content : undefined;
  const chatId = message && typeof message.chat_id === 'string' ? message.chat_id : undefined;
  const messageId = message && typeof message.message_id === 'string' ? message.message_id : undefined;
  const senderOpenId = senderId && typeof senderId.open_id === 'string' ? senderId.open_id : undefined;

  if (messageType !== 'text') {
    return null;
  }

  const text = parseTextContent(content);

  if (!text || !chatId || !messageId || !senderOpenId) {
    return null;
  }

  return {
    chatId,
    messageId,
    senderOpenId,
    text,
  };
}

export function createFeishuService(deps: FeishuServiceDependencies) {
  let startPromise: Promise<void> | undefined;

  return {
    async start() {
      if (!startPromise) {
        deps.transport.onMessage(async (message) => {
          const normalizedMessage = normalizeInboundFeishuMessage(message);
          if (!normalizedMessage) {
            return;
          }

          try {
            await deps.onMessage(normalizedMessage);
          } catch (error) {
            deps.onError?.(error instanceof Error ? error : new Error(String(error)));
          }
        });

        startPromise = deps.transport.connect();
      }

      await startPromise;
    },
    async reply(message: FeishuOutboundMessage) {
      if (!deps.transport.sendMessage) {
        throw new Error('Feishu transport does not support replies');
      }

      await deps.transport.sendMessage(message);
    },
  };
}
