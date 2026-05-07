import { describe, expect, it } from 'vitest';

import {
  createFeishuService,
  type FeishuInboundMessage,
} from '../src/feishu.js';

function createInboundMessage(
  overrides: Partial<FeishuInboundMessage> = {},
): FeishuInboundMessage {
  return {
    chatId: 'oc_1',
    messageId: 'om_1',
    senderOpenId: 'ou_1',
    text: 'inspect repo',
    ...overrides,
  };
}

describe('feishu service', () => {
  it('registers a message handler during start', async () => {
    const registrations: Array<(message: unknown) => void | Promise<void>> = [];
    let connectCount = 0;

    const service = createFeishuService({
      transport: {
        onMessage(handler) {
          registrations.push(handler);
        },
        async connect() {
          connectCount += 1;
        },
      },
      onMessage: async () => {},
    });

    await service.start();

    expect(registrations.length).toBe(1);
    expect(connectCount).toBe(1);
  });

  it('forwards transport messages to the provided handler', async () => {
    const registrations: Array<(message: unknown) => void | Promise<void>> = [];
    const seen: FeishuInboundMessage[] = [];

    const service = createFeishuService({
      transport: {
        onMessage(handler) {
          registrations.push(handler);
        },
        async connect() {},
      },
      onMessage: async (message) => {
        seen.push(message);
      },
    });

    await service.start();
    await registrations[0](createInboundMessage({ messageId: 'om_forward' }));

    expect(seen).toEqual([createInboundMessage({ messageId: 'om_forward' })]);
  });

  it('normalizes supported text payloads before forwarding them', async () => {
    const registrations: Array<(message: unknown) => void | Promise<void>> = [];
    const seen: FeishuInboundMessage[] = [];

    const service = createFeishuService({
      transport: {
        onMessage(handler) {
          registrations.push(handler);
        },
        async connect() {},
      },
      onMessage: async (message) => {
        seen.push(message);
      },
    });

    await service.start();
    await registrations[0]({
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_text',
          },
        },
        message: {
          message_id: 'om_text',
          chat_id: 'oc_text',
          message_type: 'text',
          content: JSON.stringify({ text: '/ask inspect repo' }),
        },
      },
    });

    expect(seen).toEqual([
      {
        chatId: 'oc_text',
        messageId: 'om_text',
        senderOpenId: 'ou_text',
        text: '/ask inspect repo',
      },
    ]);
  });

  it('filters unsupported inbound payloads', async () => {
    const registrations: Array<(message: unknown) => void | Promise<void>> = [];
    const seen: FeishuInboundMessage[] = [];

    const service = createFeishuService({
      transport: {
        onMessage(handler) {
          registrations.push(handler);
        },
        async connect() {},
      },
      onMessage: async (message) => {
        seen.push(message);
      },
    });

    await service.start();
    await registrations[0]({
      event: {
        sender: {
          sender_id: {
            open_id: 'ou_file',
          },
        },
        message: {
          message_id: 'om_file',
          chat_id: 'oc_file',
          message_type: 'image',
          content: JSON.stringify({ image_key: 'img_123' }),
        },
      },
    });

    expect(seen).toEqual([]);
  });

  it('catches async handler rejections inside the transport wrapper', async () => {
    const registrations: Array<(message: unknown) => void | Promise<void>> = [];
    const failures: Error[] = [];

    const service = createFeishuService({
      transport: {
        onMessage(handler) {
          registrations.push(handler);
        },
        async connect() {},
      },
      onMessage: async () => {
        throw new Error('handler failed');
      },
      onError(error) {
        failures.push(error);
      },
    });

    await service.start();
    await registrations[0](createInboundMessage());

    expect(failures.length).toBe(1);
    expect(failures[0]?.message).toBe('handler failed');
  });

  it('start is idempotent across repeated calls', async () => {
    const registrations: Array<(message: unknown) => void | Promise<void>> = [];
    let connectCount = 0;

    const service = createFeishuService({
      transport: {
        onMessage(handler) {
          registrations.push(handler);
        },
        async connect() {
          connectCount += 1;
        },
      },
      onMessage: async () => {},
    });

    await service.start();
    await service.start();

    expect(registrations.length).toBe(1);
    expect(connectCount).toBe(1);
  });

  it('exposes a reply abstraction that delegates to transport', async () => {
    const outbound: Array<{ chatId: string; text: string }> = [];

    const service = createFeishuService({
      transport: {
        onMessage() {},
        async connect() {},
        async sendMessage(message) {
          outbound.push(message);
        },
      },
      onMessage: async () => {},
    });

    await service.reply({
      chatId: 'oc_reply',
      text: 'Task finished.',
    });

    expect(outbound).toEqual([
      {
        chatId: 'oc_reply',
        text: 'Task finished.',
      },
    ]);
  });
});
