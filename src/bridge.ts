export type BridgeInboundMessage = {
  chatId: string;
  messageId: string;
  senderOpenId: string;
  text: string;
};

export type BridgeReply = {
  chatId: string;
  text: string;
};

export const unauthorizedMessage = 'Unauthorized';

export type BridgeDependencies = {
  isAuthorized: (senderOpenId: string, message: BridgeInboundMessage) => boolean;
  sendReply: (reply: BridgeReply) => Promise<void>;
  runTask: (message: BridgeInboundMessage) => Promise<unknown>;
  onError?: (error: unknown, context: { phase: 'task'; message: BridgeInboundMessage }) => void;
};

export function createBridge(deps: BridgeDependencies) {
  async function handleMessage(message: BridgeInboundMessage) {
    if (!deps.isAuthorized(message.senderOpenId, message)) {
      await deps.sendReply({
        chatId: message.chatId,
        text: unauthorizedMessage,
      });
      return;
    }

    void deps.runTask(message).catch((error) => {
      deps.onError?.(error, { phase: 'task', message });
    });
  }

  return {
    handleMessage,
    createMessageHandler() {
      return handleMessage;
    },
  };
}
