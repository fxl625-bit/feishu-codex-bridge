import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, resolveRuntimePaths } from '../src/config.js';

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
    expect(config.nativeSessionIdleTimeoutMs).toBe(24 * 60 * 60 * 1000);
    expect(config.port).toBe(8787);
  });

  it('treats an empty codex model as undefined', () => {
    const config = loadConfig({
      FEISHU_APP_ID: 'app',
      FEISHU_APP_SECRET: 'secret',
      ALLOWED_OPEN_IDS: 'ou_1',
      CODEX_WORKSPACE_ROOT: 'C:/workspace',
      CODEX_MODEL: '   ',
    });

    expect(config.codexModel).toBeUndefined();
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

  it('resolves Windows service runtime paths under LOCALAPPDATA by default', () => {
    const runtimePaths = resolveRuntimePaths({
      env: {},
      localAppData: 'C:/Users/example/AppData/Local',
      port: 8787,
    });

    expect(runtimePaths.serviceBaseDir).toBe(
      path.join('C:/Users/example/AppData/Local', 'feishu-codex-bridge'),
    );
    expect(runtimePaths.tasksFile).toBe(
      path.join('C:/Users/example/AppData/Local', 'feishu-codex-bridge', 'data', 'tasks.json'),
    );
    expect(runtimePaths.conversationsFile).toBe(
      path.join(
        'C:/Users/example/AppData/Local',
        'feishu-codex-bridge',
        'data',
        'conversations.json',
      ),
    );
    expect(runtimePaths.conversationsDir).toBe(
      path.join('C:/Users/example/AppData/Local', 'feishu-codex-bridge', 'conversations'),
    );
    expect(runtimePaths.nativeSessionRegistryFile).toBe(
      path.join(
        'C:/Users/example/AppData/Local',
        'feishu-codex-bridge',
        'data',
        'native-sessions.json',
      ),
    );
    expect(runtimePaths.stdoutLogFile).toBe(
      path.join(
        'C:/Users/example/AppData/Local',
        'feishu-codex-bridge',
        'logs',
        'bridge.stdout.log',
      ),
    );
    expect(runtimePaths.pidFile).toBe(
      path.join('C:/Users/example/AppData/Local', 'feishu-codex-bridge', 'run', 'bridge.pid'),
    );
    expect(runtimePaths.archiveSyncDir).toBe(
      path.join('F:/obsidian/wiki/raw/AI-projects/feishu-codex-bridge', 'conversations'),
    );
    expect(runtimePaths.healthUrl).toBe('http://127.0.0.1:8787/health');
  });

  it('allows absolute overrides for service runtime directories', () => {
    const runtimePaths = resolveRuntimePaths({
      env: {
        BRIDGE_SERVICE_BASE_DIR: 'D:/Bridge',
        BRIDGE_DATA_DIR: 'D:/Bridge/state',
        BRIDGE_LOG_DIR: 'D:/Bridge/logs',
        BRIDGE_RUN_DIR: 'D:/Bridge/run',
        BRIDGE_NATIVE_SESSION_REGISTRY_FILE: 'D:/Bridge/state/native-worker-registry.json',
        BRIDGE_ARCHIVE_SYNC_DIR: 'D:/Archive/bridge',
      },
      localAppData: 'C:/Users/example/AppData/Local',
      port: 8899,
    });

    expect(runtimePaths.serviceBaseDir).toBe('D:/Bridge');
    expect(runtimePaths.tasksFile).toBe(path.join('D:/Bridge', 'state', 'tasks.json'));
    expect(runtimePaths.conversationsFile).toBe(path.join('D:/Bridge', 'state', 'conversations.json'));
    expect(runtimePaths.conversationsDir).toBe(path.join('D:/Bridge', 'conversations'));
    expect(runtimePaths.nativeSessionRegistryFile).toBe(
      'D:/Bridge/state/native-worker-registry.json',
    );
    expect(runtimePaths.stderrLogFile).toBe(path.join('D:/Bridge', 'logs', 'bridge.stderr.log'));
    expect(runtimePaths.pidFile).toBe(path.join('D:/Bridge', 'run', 'bridge.pid'));
    expect(runtimePaths.archiveSyncDir).toBe('D:/Archive/bridge');
    expect(runtimePaths.healthUrl).toBe('http://127.0.0.1:8899/health');
  });

  it('rejects relative overrides for service runtime directories', () => {
    expect(() =>
      resolveRuntimePaths({
        env: {
          BRIDGE_LOG_DIR: './logs',
        },
        localAppData: 'C:/Users/example/AppData/Local',
        port: 8787,
      }),
    ).toThrowError(ConfigError);
  });
});
