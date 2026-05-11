import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { ensureCodexSessionVisible } from '../dist/codex-session-visibility.js';

async function main() {
  const [, , codexHomeDir, sessionId, ...promptParts] = process.argv;
  if (!codexHomeDir || !sessionId) {
    throw new Error('Usage: node scripts/repair-codex-session-visibility.mjs <codexHomeDir> <sessionId> [prompt]');
  }

  const prompt =
    promptParts.join(' ').trim() ||
    (await inferPromptFromSession(codexHomeDir, sessionId)) ||
    'Feishu session';

  await ensureCodexSessionVisible({
    codexHomeDir,
    sessionId,
    prompt,
    updatedAt: new Date().toISOString(),
  });
}

async function inferPromptFromSession(codexHomeDir, sessionId) {
  const sessionFile = await findSessionFile(`${codexHomeDir}/sessions`, sessionId);
  if (!sessionFile) {
    return undefined;
  }

  const content = await readFile(sessionFile, 'utf8');
  for (const rawLine of content.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    try {
      const entry = JSON.parse(line);
      if (
        entry?.type === 'event_msg' &&
        entry?.payload?.type === 'user_message' &&
        typeof entry.payload.message === 'string' &&
        entry.payload.message.trim()
      ) {
        return entry.payload.message.trim();
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function findSessionFile(directory, sessionId) {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSessionFile(candidate, sessionId);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(`${sessionId}.jsonl`)) {
      return candidate;
    }
  }

  return undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
