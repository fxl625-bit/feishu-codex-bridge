import type { BridgeCommand } from './types.js';

const HELP_TEXT = [
  'Supported commands:',
  '/ask <prompt>',
  '/run <prompt>',
  '/status [task-id]',
  '/help',
].join('\n');

export class CommandParseError extends Error {
  constructor(message = HELP_TEXT) {
    super(message);
    this.name = 'CommandParseError';
  }
}

function requirePrompt(prompt: string): string {
  const normalizedPrompt = prompt.trim();

  if (!normalizedPrompt) {
    throw new CommandParseError();
  }

  return normalizedPrompt;
}

export function getCommandHelpText(): string {
  return HELP_TEXT;
}

export function parseCommand(text: string): BridgeCommand {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new CommandParseError();
  }

  if (!trimmed.startsWith('/')) {
    return {
      kind: 'ask',
      prompt: requirePrompt(trimmed),
    };
  }

  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const argumentText = rest.join(' ').trim();

  switch (rawCommand.toLowerCase()) {
    case '/ask':
      return {
        kind: 'ask',
        prompt: requirePrompt(argumentText),
      };
    case '/run':
      return {
        kind: 'run',
        prompt: requirePrompt(argumentText),
      };
    case '/status':
      return {
        kind: 'status',
        taskId: argumentText || undefined,
      };
    case '/help':
      return {
        kind: 'help',
      };
    default:
      throw new CommandParseError();
  }
}
