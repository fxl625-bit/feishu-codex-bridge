import path from 'node:path';
import { z } from 'zod';
import type { AppConfig } from './types.js';

const DEFAULT_APPROVAL_POLICY = 'never';
const DEFAULT_SANDBOX_MODE = 'workspace-write';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_PORT = 8787;

const approvalPolicySchema = z.enum(['untrusted', 'on-failure', 'on-request', 'never']);
const sandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access']);

const envSchema = z.object({
  FEISHU_APP_ID: z.string().trim().min(1, 'FEISHU_APP_ID is required'),
  FEISHU_APP_SECRET: z.string().trim().min(1, 'FEISHU_APP_SECRET is required'),
  ALLOWED_OPEN_IDS: z.string().trim().min(1, 'ALLOWED_OPEN_IDS is required'),
  CODEX_WORKSPACE_ROOT: z.string().trim().min(1, 'CODEX_WORKSPACE_ROOT is required'),
  CODEX_MODEL: z.string().trim().min(1).optional(),
  CODEX_APPROVAL_POLICY: approvalPolicySchema.default(DEFAULT_APPROVAL_POLICY),
  CODEX_SANDBOX_MODE: sandboxModeSchema.default(DEFAULT_SANDBOX_MODE),
  CODEX_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
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
    port: values.PORT,
  };
}
