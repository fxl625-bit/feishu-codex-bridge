import { describe, expect, it } from 'vitest';
import {
  formatCompletionMessage,
  formatQueuedMessage,
  formatStatusMessage,
  summarizeCodexResult,
} from '../src/formatter.js';

describe('formatCompletionMessage', () => {
  it('includes the task id and summary for completed tasks', () => {
    const text = formatCompletionMessage({
      id: 'task_1',
      status: 'completed',
      summary: 'Updated README',
    });

    expect(text).toContain('task_1');
    expect(text).toContain('Updated README');
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

  it('formats queued task messages', () => {
    expect(
      formatQueuedMessage({
        id: 'task_3',
        kind: 'ask',
        prompt: 'inspect repo',
      }),
    ).toContain('Queued ask task task_3');
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

  it('summarizes codex results consistently', () => {
    expect(
      summarizeCodexResult({
        exitCode: 0,
        stdout: 'analysis complete\nmore',
        stderr: '',
        timedOut: false,
      }),
    ).toBe('analysis complete');

    expect(
      summarizeCodexResult({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: true,
      }),
    ).toContain('timed out');
  });
});
