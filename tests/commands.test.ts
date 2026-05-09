import { describe, expect, it } from 'vitest';
import { CommandParseError, parseCommand } from '../src/commands.js';

describe('parseCommand', () => {
  it('treats plain text as ask mode', () => {
    expect(parseCommand('inspect the repo')).toMatchObject({
      kind: 'ask',
      prompt: 'inspect the repo',
    });
  });

  it('parses explicit run mode', () => {
    expect(parseCommand('/run update README')).toMatchObject({
      kind: 'run',
      prompt: 'update README',
    });
  });

  it('parses status with an optional task id', () => {
    expect(parseCommand('/status task_123')).toMatchObject({
      kind: 'status',
      taskId: 'task_123',
    });
  });

  it('parses help explicitly', () => {
    expect(parseCommand('/help')).toMatchObject({
      kind: 'help',
    });
  });

  it('parses session inspection commands', () => {
    expect(parseCommand('/session')).toMatchObject({
      kind: 'session',
    });
    expect(parseCommand('/sessions')).toMatchObject({
      kind: 'sessions',
    });
    expect(parseCommand('/history 8')).toMatchObject({
      kind: 'history',
      count: 8,
    });
  });

  it('raises a usage error when a prompt command is empty', () => {
    expect(() => parseCommand('/ask   ')).toThrowError(CommandParseError);
  });

  it('raises a usage error for unknown slash commands', () => {
    expect(() => parseCommand('/deploy now')).toThrowError(CommandParseError);
  });
});
