import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  renderConversationTranscript,
  writeConversationTranscript,
} from '../src/conversation-export.js';
import type { ConversationSessionRecord } from '../src/conversation-store.js';

const tempDirectories: string[] = [];

async function createTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
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

function createSession(): ConversationSessionRecord {
  return {
    sessionId: 'session_oc_1',
    chatId: 'oc_1',
    participants: ['ou_1'],
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:01:00.000Z',
    lastTaskId: 'task_1',
    messages: [
      {
        id: 'msg_1',
        direction: 'inbound',
        source: 'feishu',
        text: 'Please inspect the repo.',
        timestamp: '2026-05-08T00:00:00.000Z',
      },
      {
        id: 'msg_2',
        direction: 'outbound',
        source: 'codex',
        text: 'Repo inspected.',
        timestamp: '2026-05-08T00:01:00.000Z',
        taskId: 'task_1',
        status: 'completed',
      },
    ],
  };
}

describe('conversation export', () => {
  it('renders a human-readable markdown transcript in chronological order', () => {
    const transcript = renderConversationTranscript(createSession());

    expect(transcript).toContain('# Session session_oc_1');
    expect(transcript.indexOf('Please inspect the repo.')).toBeLessThan(
      transcript.indexOf('Repo inspected.'),
    );
    expect(transcript).toContain('Task: `task_1`');
  });

  it('writes transcripts locally and mirrors them to the archive directory when available', async () => {
    const localDir = await createTempDirectory('feishu-transcript-local-');
    const archiveDir = await createTempDirectory('feishu-transcript-archive-');

    const localFile = await writeConversationTranscript({
      session: createSession(),
      conversationsDir: localDir,
      archiveSyncDir: archiveDir,
    });

    const archiveFile = path.join(archiveDir, 'session_oc_1.md');
    await expect(readFile(localFile, 'utf8')).resolves.toContain('Repo inspected.');
    await expect(readFile(archiveFile, 'utf8')).resolves.toContain('Repo inspected.');
  });
});
