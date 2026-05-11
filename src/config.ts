import path from 'node:path';
import { z } from 'zod';
import type { AppConfig, RuntimePaths } from './types.js';

const DEFAULT_APPROVAL_POLICY = 'never';
const DEFAULT_SANDBOX_MODE = 'workspace-write';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_NATIVE_SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PORT = 8787;
const DEFAULT_SERVICE_DIR_NAME = 'feishu-codex-bridge';
const DEFAULT_ARCHIVE_SYNC_DIR = path.join(
  'F:/obsidian/wiki/raw/AI-projects/feishu-codex-bridge',
  'conversations',
);

const approvalPolicySchema = z.enum(['untrusted', 'on-failure', 'on-request', 'never']);
const sandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access']);
const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? undefined : trimmedValue;
}, z.string().min(1).optional());

const envSchema = z.object({
  FEISHU_APP_ID: z.string().trim().min(1, 'FEISHU_APP_ID is required'),
  FEISHU_APP_SECRET: z.string().trim().min(1, 'FEISHU_APP_SECRET is required'),
  ALLOWED_OPEN_IDS: z.string().trim().min(1, 'ALLOWED_OPEN_IDS is required'),
  CODEX_WORKSPACE_ROOT: z.string().trim().min(1, 'CODEX_WORKSPACE_ROOT is required'),
  CODEX_MODEL: optionalTrimmedString,
  CODEX_APPROVAL_POLICY: approvalPolicySchema.default(DEFAULT_APPROVAL_POLICY),
  CODEX_SANDBOX_MODE: sandboxModeSchema.default(DEFAULT_SANDBOX_MODE),
  CODEX_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  NATIVE_SESSION_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_NATIVE_SESSION_IDLE_TIMEOUT_MS),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

interface ResolveRuntimePathsOptions {
  env: Record<string, string | undefined>;
  localAppData?: string | undefined;
  port: number;
}

function parseAllowedOpenIds(value: string): string[] {
  const allowedOpenIds = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (allowedOpenIds.length === 0) {
    throw new ConfigError('ALLOWED_OPEN_IDS must contain at least one open id');
  }

  return allowedOpenIds;
}

function validateWorkspaceRoot(value: string): string {
  if (!path.isAbsolute(value)) {
    throw new ConfigError('CODEX_WORKSPACE_ROOT must be an absolute path');
  }

  return value;
}

function resolveAbsoluteDirectory(
  env: Record<string, string | undefined>,
  envKey: string,
  fallback: string,
): string {
  const rawValue = env[envKey]?.trim();

  if (!rawValue) {
    return fallback;
  }

  if (!path.isAbsolute(rawValue)) {
    throw new ConfigError(`${envKey} must be an absolute path`);
  }

  return rawValue;
}

export function resolveRuntimePaths(options: ResolveRuntimePathsOptions): RuntimePaths {
  const localAppData = options.localAppData?.trim();

  if (!localAppData || !path.isAbsolute(localAppData)) {
    throw new ConfigError('LOCALAPPDATA must be set to an absolute path');
  }

  const serviceBaseDir = resolveAbsoluteDirectory(
    options.env,
    'BRIDGE_SERVICE_BASE_DIR',
    path.join(localAppData, DEFAULT_SERVICE_DIR_NAME),
  );
  const dataDir = resolveAbsoluteDirectory(
    options.env,
    'BRIDGE_DATA_DIR',
    path.join(serviceBaseDir, 'data'),
  );
  const logDir = resolveAbsoluteDirectory(
    options.env,
    'BRIDGE_LOG_DIR',
    path.join(serviceBaseDir, 'logs'),
  );
  const runDir = resolveAbsoluteDirectory(
    options.env,
    'BRIDGE_RUN_DIR',
    path.join(serviceBaseDir, 'run'),
  );
  const conversationsDir = resolveAbsoluteDirectory(
    options.env,
    'BRIDGE_CONVERSATIONS_DIR',
    path.join(serviceBaseDir, 'conversations'),
  );
  const archiveSyncDir = resolveAbsoluteDirectory(
    options.env,
    'BRIDGE_ARCHIVE_SYNC_DIR',
    DEFAULT_ARCHIVE_SYNC_DIR,
  );
  const nativeSessionRegistryFile = resolveAbsoluteDirectory(
    options.env,
    'BRIDGE_NATIVE_SESSION_REGISTRY_FILE',
    path.join(dataDir, 'native-sessions.json'),
  );

  return {
    serviceBaseDir,
    dataDir,
    logDir,
    runDir,
    tasksFile: path.join(dataDir, 'tasks.json'),
    conversationsFile: path.join(dataDir, 'conversations.json'),
    conversationsDir,
    nativeSessionRegistryFile,
    stdoutLogFile: path.join(logDir, 'bridge.stdout.log'),
    stderrLogFile: path.join(logDir, 'bridge.stderr.log'),
    pidFile: path.join(runDir, 'bridge.pid'),
    healthUrl: `http://127.0.0.1:${options.port}/health`,
    archiveSyncDir,
  };
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsedEnv = envSchema.safeParse(env);

  if (!parsedEnv.success) {
    const message = parsedEnv.error.issues.map((issue) => issue.message).join('; ');
    throw new ConfigError(message);
  }

  const values = parsedEnv.data;

  return {
    feishuAppId: values.FEISHU_APP_ID,
    feishuAppSecret: values.FEISHU_APP_SECRET,
    allowedOpenIds: parseAllowedOpenIds(values.ALLOWED_OPEN_IDS),
    codexWorkspaceRoot: validateWorkspaceRoot(values.CODEX_WORKSPACE_ROOT),
    codexModel: values.CODEX_MODEL,
    codexApprovalPolicy: values.CODEX_APPROVAL_POLICY,
    codexSandboxMode: values.CODEX_SANDBOX_MODE,
    codexTimeoutMs: values.CODEX_TIMEOUT_MS,
    nativeSessionIdleTimeoutMs: values.NATIVE_SESSION_IDLE_TIMEOUT_MS,
    port: values.PORT,
  };
}
