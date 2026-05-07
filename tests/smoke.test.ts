import { describe, expect, it } from 'vitest';
import { createAppMetadata } from '../src/index.js';

describe('createAppMetadata', () => {
  it('returns the application name for smoke verification', () => {
    expect(createAppMetadata().name).toBe('feishu-codex-bridge');
  });
});
