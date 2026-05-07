import { describe, expect, it } from 'vitest';

import {
  acceptedMessage,
  createBridge,
  unauthorizedMessage,
  type BridgeInboundMessage,
} from '../src/bridge.js';

function createMessage(
  overrides: Partial<BridgeInboundMessage> = {},
): BridgeInboundMessage {
  return {
    chatId: 'oc_1',
    messageId: 'om_1',
    senderOpenId: 'ou_1',
    text: '/ask inspect repo',
    ...overrides,
  };
}

describe('bridge', () => {
  it('rejects unauthorized users before execution', async () => {
    const calls: Array<{ chatId: string; text: string }> = [];
    let runCount = 0;

    const bridge = createBridge({
      isAuthorized: () => false,
      sendReply: async (message) => {
        calls.push(message);
      },
      runTask: async () => {
        runCount += 1;
      },
    });

    await bridge.handleMessage(createMessage({ senderOpenId: 'ou_no' }));

    expect(runCount).toBe(0);
    expect(calls).toEqual([
      {
        chatId: 'oc_1',
        text: unauthorizedMessage,
      },
    ]);
  });

  it('sends an acknowledgement before running an authorized task', async () => {
    const replyTexts: string[] = [];
    const runInputs: BridgeInboundMessage[] = [];

    const bridge = createBridge({
      isAuthorized: (openId) => openId === 'ou_ok',
      sendReply: async (message) => {
        replyTexts.push(message.text);
      },
      runTask: async (message) => {
        runInputs.push(message);
        return { summary: 'done' };
      },
    });

    const inbound = createMessage({
      senderOpenId: 'ou_ok',
      text: '/run update README',
    });

    await bridge.handleMessage(inbound);

    expect(replyTexts).toEqual(['Request received. Starting task.']);
    expect(runInputs).toEqual([inbound]);
  });

  it('returns after acknowledgement while the task continues asynchronously', async () => {
    const events: string[] = [];
    let resolveTask: (() => void) | undefined;
    let taskStarted = false;
    let handleReturned = false;

    const taskFinished = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    const bridge = createBridge({
      isAuthorized: () => true,
      sendReply: async (message) => {
        events.push(`reply:${message.text}`);
      },
      runTask: async () => {
        taskStarted = true;
        events.push('task:start');
        await taskFinished;
        events.push('task:end');
      },
    });

    const handlePromise = bridge.handleMessage(createMessage({ senderOpenId: 'ou_ok' }));
    events.push('after-call');

    await handlePromise;
    handleReturned = true;
    events.push('after-return');

    expect(events[0]).toBe(`reply:${acceptedMessage}`);
    expect(events).toContain('after-call');
    expect(events).toContain('after-return');
    expect(events).not.toContain('task:end');

    resolveTask?.();
    await taskFinished;

    expect(taskStarted).toBe(true);
    expect(handleReturned).toBe(true);
    expect(events.at(-1)).toBe('task:end');
  });

  it('still runs an authorized task when acknowledgement send fails', async () => {
    const events: string[] = [];

    const bridge = createBridge({
      isAuthorized: () => true,
      sendReply: async () => {
        events.push('reply:attempt');
        throw new Error('send failed');
      },
      runTask: async () => {
        events.push('task:run');
      },
    });

    await bridge.handleMessage(createMessage({ senderOpenId: 'ou_ok' }));

    expect(events).toEqual(['reply:attempt', 'task:run']);
  });

  it('can wire a transport handler to the same message pipeline', async () => {
    const seen: string[] = [];

    const bridge = createBridge({
      isAuthorized: () => true,
      sendReply: async () => {},
      runTask: async (message) => {
        seen.push(message.messageId);
      },
    });

    const handler = bridge.createMessageHandler();
    await handler(createMessage({ messageId: 'om_wire' }));

    expect(seen).toEqual(['om_wire']);
  });
});
