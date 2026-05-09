import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConversationStore } from '../src/conversation-store.js';

const tempDirectories: string[] = [];

async function createTempConversationFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'feishu-conversation-store-'));
  tempDirectories.push(directory);
  return path.join(directory, 'conversations.json');
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('conversation store', () => {
  it('creates a session on the first inbound message and appends later turns to the same chat session', async () => {
    const dataFile = await createTempConversationFile();
    const store = createConversationStore({ dataFile });

    const first = await store.appendMessage({
      chatId: 'oc_1',
      participantOpenId: 'ou_1',
      direction: 'inbound',
      source: 'feishu',
      text: 'inspect the repo',
    });
    const second = await store.appendMessage({
      chatId: 'oc_1',
      direction: 'outbound',
      source: 'codex',
      text: 'Here is the answer.',
      taskId: 'task_1',
      status: 'completed',
    });

    expect(first.sessionId).toBe('session_oc_1');
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.participants).toEqual(['ou_1']);
    expect(second.lastTaskId).toBe('task_1');
    expect(second.messages).toHaveLength(2);
    expect(second.messages.map((message) => message.text)).toEqual([
      'inspect the repo',
      'Here is the answer.',
    ]);
  });

  it('lists sessions by most recently updated timestamp', async () => {
    const dataFile = await createTempConversationFile();
    const store = createConversationStore({ dataFile });

    await store.appendMessage({
      chatId: 'oc_1',
      participantOpenId: 'ou_1',
      direction: 'inbound',
      source: 'feishu',
      text: 'first',
    });
    await store.appendMessage({
      chatId: 'oc_2',
      participantOpenId: 'ou_1',
      direction: 'inbound',
      source: 'feishu',
      text: 'second',
    });
    await store.appendMessage({
      chatId: 'oc_1',
      direction: 'outbound',
      source: 'codex',
      text: 'follow-up',
    });

    const sessions = await store.list({ participantOpenId: 'ou_1' });

    expect(sessions.map((session) => session.chatId)).toEqual(['oc_1', 'oc_2']);
  });
});
