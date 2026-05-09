import { describe, expect, it } from 'vitest';
import {
  formatCompletionMessage,
  formatHistoryMessage,
  formatSessionMessage,
  formatSessionsMessage,
  formatStatusMessage,
  summarizeCodexResult,
} from '../src/formatter.js';

describe('formatCompletionMessage', () => {
  it('returns the summary directly for completed tasks', () => {
    const text = formatCompletionMessage({
      id: 'task_1',
      status: 'completed',
      summary: 'Updated README',
    });

    expect(text).toBe('Updated README');
  });

  it('truncates long output details to keep messages short', () => {
    const text = formatCompletionMessage({
      id: 'task_2',
      status: 'failed',
      summary: 'Codex failed',
      stderr: 'x'.repeat(500),
    });

    expect(text).toContain('Codex failed');
    expect(text.length).toBeLessThan(260);
    expect(text).toContain('...');
  });

  it('filters codex startup noise from completion details', () => {
    const text = formatCompletionMessage({
      id: 'task_noise',
      status: 'completed',
      summary: 'bridge inbound ok',
      stdout: 'bridge inbound ok\n',
      stderr: 'Reading additional input from stdin...\nOpenAI Codex v0.120.0\nbridge inbound ok\n',
    });

    expect(text).toContain('bridge inbound ok');
    expect(text).not.toContain('Reading additional input from stdin...');
    expect(text).not.toContain('OpenAI Codex v0.120.0');
  });

  it('formats status replies for missing and existing tasks', () => {
    expect(formatStatusMessage(undefined)).toBe('No matching tasks found.');
    expect(
      formatStatusMessage({
        id: 'task_4',
        status: 'running',
        prompt: 'inspect repo',
      }),
    ).toContain('task_4');
  });

  it('formats session summaries and history concisely', () => {
    expect(
      formatSessionMessage({
        sessionId: 'session_oc_1',
        chatId: 'oc_1',
        participants: ['ou_1'],
        createdAt: '2026-05-08T00:00:00.000Z',
        updatedAt: '2026-05-08T00:01:00.000Z',
        lastTaskId: 'task_7',
        messages: [],
      }),
    ).toContain('session_oc_1');

    expect(
      formatSessionsMessage([
        {
          sessionId: 'session_oc_1',
          chatId: 'oc_1',
          participants: ['ou_1'],
          createdAt: '2026-05-08T00:00:00.000Z',
          updatedAt: '2026-05-08T00:01:00.000Z',
          lastTaskId: 'task_7',
          messages: [],
        },
      ]),
    ).toContain('session_oc_1');

    expect(
      formatHistoryMessage([
        {
          id: 'msg_1',
          direction: 'inbound',
          source: 'feishu',
          text: 'First question',
          timestamp: '2026-05-08T00:00:00.000Z',
        },
        {
          id: 'msg_2',
          direction: 'outbound',
          source: 'codex',
          text: 'Answer',
          timestamp: '2026-05-08T00:00:10.000Z',
        },
      ]),
    ).toContain('Answer');
  });

  it('summarizes codex results consistently', () => {
    expect(
      summarizeCodexResult({
        exitCode: 0,
        stdout: 'analysis complete\nmore',
        stderr: '',
        timedOut: false,
        lastMessage: 'final answer only',
      }),
    ).toBe('final answer only');

    expect(
      summarizeCodexResult({
        exitCode: 0,
        stdout: 'Request received. Starting task.\nQueued ask task task_1\n在吗\n',
        stderr: '',
        timedOut: false,
      }),
    ).toBe('在吗');

    expect(
      summarizeCodexResult({
        exitCode: 1,
        stdout: '',
        stderr: 'Reading additional input from stdin...\nWARN codex_core::x\nreal failure\n',
        timedOut: false,
      }),
    ).toBe('real failure');

    expect(
      summarizeCodexResult({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: true,
      }),
    ).toContain('timed out');
  });

  it('keeps failed completion messages concise but task-aware', () => {
    const text = formatCompletionMessage({
      id: 'task_5',
      status: 'failed',
      summary: 'fatal: unable to inspect repository',
      stderr: 'fatal: unable to inspect repository',
    });

    expect(text).toContain('Task task_5 [failed]');
    expect(text).toContain('fatal: unable to inspect repository');
  });

  it('filters request and queue boilerplate from summary candidates', () => {
    expect(
      summarizeCodexResult({
        exitCode: 0,
        stdout: 'Request received. Starting task.\nQueued ask task task_9\nbridge inbound ok\n',
        stderr: '',
        timedOut: false,
      }),
    ).toBe('bridge inbound ok');
  });
});
