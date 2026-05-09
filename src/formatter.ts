const MAX_MESSAGE_LENGTH = 240;
const DEFAULT_HISTORY_COUNT = 5;

export interface CompletionMessageInput {
  id: string;
  status: string;
  summary: string;
  stdout?: string;
  stderr?: string;
}

export interface QueuedMessageInput {
  id: string;
  kind: string;
  prompt: string;
}

export interface StatusMessageInput {
  id: string;
  status: string;
  prompt: string;
  summary?: string;
}

export interface SessionSummaryMessageInput {
  sessionId: string;
  chatId: string;
  participants: string[];
  createdAt: string;
  updatedAt: string;
  lastTaskId?: string;
  messages: Array<{ text: string }>;
}

export interface HistoryMessageInput {
  id: string;
  direction: 'inbound' | 'outbound' | 'local';
  source: 'feishu' | 'codex' | 'pc';
  text: string;
  timestamp: string;
}

export function formatCompletionMessage(task: CompletionMessageInput): string {
  if (task.status === 'completed') {
    return truncate(task.summary, MAX_MESSAGE_LENGTH);
  }

  const details = firstUsefulLine(task.stderr) ?? firstUsefulLine(task.stdout);
  const body = details && details !== task.summary ? `${task.summary}\n${details}` : task.summary;
  const message = `Task ${task.id} [${task.status}]\n${body}`;

  return truncate(message, MAX_MESSAGE_LENGTH);
}

export function formatStatusMessage(task: StatusMessageInput | undefined): string {
  if (!task) {
    return 'No matching tasks found.';
  }

  return truncate(
    `Task ${task.id} [${task.status}]\n${task.summary ?? task.prompt}`,
    MAX_MESSAGE_LENGTH,
  );
}

export function formatSessionMessage(session: SessionSummaryMessageInput | undefined): string {
  if (!session) {
    return 'No active session for this chat.';
  }

  return truncate(
    [
      session.sessionId,
      session.lastTaskId ? `last ${session.lastTaskId}` : undefined,
      session.messages.at(-1)?.text,
    ]
      .filter(Boolean)
      .join(' | '),
    MAX_MESSAGE_LENGTH,
  );
}

export function formatSessionsMessage(sessions: SessionSummaryMessageInput[]): string {
  if (sessions.length === 0) {
    return 'No sessions found.';
  }

  return truncate(
    sessions
      .map((session) =>
        [
          session.sessionId,
          session.lastTaskId ? `last ${session.lastTaskId}` : undefined,
          session.messages.at(-1)?.text,
        ]
          .filter(Boolean)
          .join(' | '),
      )
      .join('\n'),
    MAX_MESSAGE_LENGTH,
  );
}

export function formatHistoryMessage(
  history: HistoryMessageInput[],
  count = DEFAULT_HISTORY_COUNT,
): string {
  if (history.length === 0) {
    return 'No recent history for this chat.';
  }

  return truncate(
    history
      .slice(-count)
      .map((entry) => `${historyLabel(entry)} ${entry.text}`)
      .join('\n'),
    MAX_MESSAGE_LENGTH,
  );
}

export function summarizeCodexResult(input: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  lastMessage?: string;
}): string {
  if (input.timedOut) {
    return 'Codex timed out before completing the task.';
  }

  if (input.exitCode === 0) {
    return firstUsefulLine(input.lastMessage) ?? firstUsefulLine(input.stdout) ?? 'Codex completed successfully.';
  }

  if (input.exitCode === null) {
    return firstUsefulLine(input.stderr) ?? 'Codex exited unexpectedly.';
  }

  return firstUsefulLine(input.stderr) ?? `Codex exited with code ${input.exitCode}.`;
}

function firstUsefulLine(value: string | undefined): string | undefined {
  return value
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => Boolean(line) && !isNoiseLine(line));
}

function isNoiseLine(line: string): boolean {
  return (
    line === 'Reading additional input from stdin...' ||
    line.startsWith('OpenAI Codex v') ||
    line.startsWith('workdir:') ||
    line.startsWith('model:') ||
    line.startsWith('provider:') ||
    line.startsWith('approval:') ||
    line.startsWith('sandbox:') ||
    line.startsWith('reasoning effort:') ||
    line.startsWith('reasoning summaries:') ||
    line.startsWith('session id:') ||
    line === 'Request received. Starting task.' ||
    line.startsWith('Queued ask task ') ||
    line.startsWith('Queued run task ') ||
    line.startsWith('Task task_') ||
    line === '--------' ||
    line === 'user' ||
    line === 'codex' ||
    line === 'exec' ||
    line.startsWith('tokens used') ||
    line.startsWith('WARN ') ||
    line.includes('WARN codex_') ||
    line.includes('succeeded in ')
  );
}

function historyLabel(entry: HistoryMessageInput): string {
  if (entry.source === 'pc') {
    return 'PC:';
  }

  if (entry.direction === 'outbound') {
    return 'Codex:';
  }

  return 'User:';
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
