import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationSessionRecord } from './conversation-store.js';
import { ensureParentDirectory } from './utils/fs.js';

export function renderConversationTranscript(session: ConversationSessionRecord): string {
  const lines: string[] = [
    `# Session ${session.sessionId}`,
    '',
    `Chat: \`${session.chatId}\``,
    `Participants: ${session.participants.map((participant) => `\`${participant}\``).join(', ') || '(none)'}`,
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
    `Last Task: ${session.lastTaskId ? `\`${session.lastTaskId}\`` : '(none)'}`,
    '',
  ];

  for (const message of session.messages) {
    lines.push(`## ${message.timestamp} ${labelForMessage(message.direction, message.source)}`);
    const metadata: string[] = [];
    if (message.taskId) {
      metadata.push(`Task: \`${message.taskId}\``);
    }
    if (message.status) {
      metadata.push(`Status: \`${message.status}\``);
    }
    if (message.messageId) {
      metadata.push(`Message: \`${message.messageId}\``);
    }
    if (metadata.length > 0) {
      lines.push(metadata.join(' | '));
    }
    lines.push('');
    lines.push(message.text);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export async function writeConversationTranscript(options: {
  session: ConversationSessionRecord;
  conversationsDir: string;
  archiveSyncDir?: string;
}): Promise<string> {
  const localFile = path.join(options.conversationsDir, `${options.session.sessionId}.md`);
  await ensureParentDirectory(localFile);
  await writeFile(localFile, renderConversationTranscript(options.session), 'utf8');

  if (options.archiveSyncDir) {
    try {
      const archiveFile = path.join(options.archiveSyncDir, `${options.session.sessionId}.md`);
      await ensureParentDirectory(archiveFile);
      await copyFile(localFile, archiveFile);
    } catch {
      // Archive sync is best-effort.
    }
  }

  return localFile;
}

function labelForMessage(direction: string, source: string): string {
  if (source === 'pc') {
    return 'PC';
  }

  if (direction === 'outbound') {
    return 'Codex';
  }

  return 'Feishu';
}
