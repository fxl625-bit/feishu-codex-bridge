import { describe, expect, it } from 'vitest';
import { formatCompletionMessage } from '../src/formatter.js';

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
});
