export interface AppMetadata {
  name: string;
  version: string;
}

export type CommandKind = 'ask' | 'run' | 'status' | 'help';

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

export interface HelpCommand {
  kind: 'help';
}

export type BridgeCommand = AskCommand | RunCommand | StatusCommand | HelpCommand;

export interface AppConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  allowedOpenIds: string[];
  codexWorkspaceRoot: string;
  codexModel?: string;
  codexApprovalPolicy: string;
  codexSandboxMode: string;
  port: number;
}

export interface RuntimeSummaryInput {
  transport: 'long-connection';
  workspaceRoot: string;
}
