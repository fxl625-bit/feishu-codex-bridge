export interface AppMetadata {
  name: string;
  version: string;
}

export type CommandKind = 'ask' | 'run' | 'status' | 'session' | 'sessions' | 'history' | 'help';

export interface AskCommand {
  kind: 'ask';
  prompt: string;
}

export interface RunCommand {
  kind: 'run';
  prompt: string;
}

export interface StatusCommand {
  kind: 'status';
  taskId?: string;
}

export interface SessionCommand {
  kind: 'session';
}

export interface SessionsCommand {
  kind: 'sessions';
}

export interface HistoryCommand {
  kind: 'history';
  count?: number;
}

export interface HelpCommand {
  kind: 'help';
}

export type BridgeCommand =
  | AskCommand
  | RunCommand
  | StatusCommand
  | SessionCommand
  | SessionsCommand
  | HistoryCommand
  | HelpCommand;

export interface AppConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  allowedOpenIds: string[];
  codexWorkspaceRoot: string;
  codexModel?: string;
  codexApprovalPolicy: CodexApprovalPolicy;
  codexSandboxMode: CodexSandboxMode;
  codexTimeoutMs: number;
  nativeSessionIdleTimeoutMs: number;
  port: number;
}

export interface RuntimeSummaryInput {
  transport: 'long-connection';
  workspaceRoot: string;
}

export interface RuntimePaths {
  serviceBaseDir: string;
  dataDir: string;
  logDir: string;
  runDir: string;
  tasksFile: string;
  conversationsFile: string;
  conversationsDir: string;
  nativeSessionRegistryFile: string;
  stdoutLogFile: string;
  stderrLogFile: string;
  pidFile: string;
  healthUrl: string;
  archiveSyncDir?: string;
  codexHomeDir: string;
}

export type NativeSessionWorkerKind = 'ask' | 'run';

export interface NativeSessionBinding {
  chatId: string;
  codexSessionId: string;
  workerKind: NativeSessionWorkerKind;
  workspaceRoot: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface NativeSessionBindingInput {
  chatId: string;
  codexSessionId: string;
  workerKind: NativeSessionWorkerKind;
  workspaceRoot: string;
}

export type CodexApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
