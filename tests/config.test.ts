import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('parses required environment values', () => {
    const config = loadConfig({
      FEISHU_APP_ID: 'app',
      FEISHU_APP_SECRET: 'secret',
      ALLOWED_OPEN_IDS: 'ou_1,ou_2',
      CODEX_WORKSPACE_ROOT: 'C:/workspace',
      CODEX_TIMEOUT_MS: '60000',
    });

    expect(config.allowedOpenIds).toEqual(['ou_1', 'ou_2']);
    expect(config.codexWorkspaceRoot).toBe('C:/workspace');
    expect(config.codexTimeoutMs).toBe(60000);
  });

  it('applies safe defaults for optional runtime settings', () => {
    const config = loadConfig({
      FEISHU_APP_ID: 'app',
      FEISHU_APP_SECRET: 'secret',
      ALLOWED_OPEN_IDS: 'ou_1',
      CODEX_WORKSPACE_ROOT: 'C:/workspace',
    });

    expect(config.codexModel).toBeUndefined();
    expect(config.codexApprovalPolicy).toBe('never');
    expect(config.codexSandboxMode).toBe('workspace-write');
    expect(config.codexTimeoutMs).toBe(900000);
    expect(config.port).toBe(8787);
  });

  it('throws when required values are missing', () => {
    expect(() =>
      loadConfig({
        FEISHU_APP_ID: 'app',
        FEISHU_APP_SECRET: '',
        ALLOWED_OPEN_IDS: '',
        CODEX_WORKSPACE_ROOT: '',
      }),
    ).toThrowError(ConfigError);
  });

  it('throws when codex runtime policy values are invalid', () => {
    expect(() =>
      loadConfig({
        FEISHU_APP_ID: 'app',
        FEISHU_APP_SECRET: 'secret',
        ALLOWED_OPEN_IDS: 'ou_1',
        CODEX_WORKSPACE_ROOT: 'C:/workspace',
        CODEX_APPROVAL_POLICY: 'later',
      }),
    ).toThrowError(ConfigError);

    expect(() =>
      loadConfig({
        FEISHU_APP_ID: 'app',
        FEISHU_APP_SECRET: 'secret',
        ALLOWED_OPEN_IDS: 'ou_1',
        CODEX_WORKSPACE_ROOT: 'C:/workspace',
        CODEX_SANDBOX_MODE: 'workspace-writee',
      }),
    ).toThrowError(ConfigError);
  });

  it('throws when the workspace root is not absolute', () => {
    expect(() =>
      loadConfig({
        FEISHU_APP_ID: 'app',
        FEISHU_APP_SECRET: 'secret',
        ALLOWED_OPEN_IDS: 'ou_1',
        CODEX_WORKSPACE_ROOT: './workspace',
      }),
    ).toThrowError(ConfigError);
  });
});
