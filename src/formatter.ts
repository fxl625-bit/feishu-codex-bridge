const MAX_MESSAGE_LENGTH = 240;

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

export function formatCompletionMessage(task: CompletionMessageInput): string {
  const details = firstNonEmptyLine(task.stderr) ?? firstNonEmptyLine(task.stdout);
  const message = details
    ? `Task ${task.id} [${task.status}]\n${task.summary}\n${details}`
    : `Task ${task.id} [${task.status}]\n${task.summary}`;

  return truncate(message, MAX_MESSAGE_LENGTH);
}

export function formatQueuedMessage(task: QueuedMessageInput): string {
  return truncate(`Queued ${task.kind} task ${task.id}\n${task.prompt}`, MAX_MESSAGE_LENGTH);
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

export function summarizeCodexResult(input: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}): string {
  if (input.timedOut) {
    return 'Codex timed out before completing the task.';
  }

  if (input.exitCode === 0) {
    return firstNonEmptyLine(input.stdout) ?? 'Codex completed successfully.';
  }

  if (input.exitCode === null) {
    return firstNonEmptyLine(input.stderr) ?? 'Codex exited unexpectedly.';
  }

  return firstNonEmptyLine(input.stderr) ?? `Codex exited with code ${input.exitCode}.`;
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
  return value
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
