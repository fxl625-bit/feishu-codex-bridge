const MAX_MESSAGE_LENGTH = 240;

export interface CompletionMessageInput {
  id: string;
  status: string;
  summary: string;
  stdout?: string;
  stderr?: string;
}

export function formatCompletionMessage(task: CompletionMessageInput): string {
  const details = firstNonEmptyLine(task.stderr) ?? firstNonEmptyLine(task.stdout);
  const message = details
    ? `Task ${task.id} [${task.status}]\n${task.summary}\n${details}`
    : `Task ${task.id} [${task.status}]\n${task.summary}`;

  return truncate(message, MAX_MESSAGE_LENGTH);
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
