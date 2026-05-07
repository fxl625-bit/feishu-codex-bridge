import { describe, expect, it } from 'vitest';
import { isAuthorizedUser } from '../src/authz.js';

describe('isAuthorizedUser', () => {
  it('allows known open ids', () => {
    expect(isAuthorizedUser(['ou_1'], 'ou_1')).toBe(true);
  });

  it('rejects unknown open ids', () => {
    expect(isAuthorizedUser(['ou_1'], 'ou_2')).toBe(false);
  });

  it('rejects blank sender ids', () => {
    expect(isAuthorizedUser(['ou_1'], '')).toBe(false);
  });
});
