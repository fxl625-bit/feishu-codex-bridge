import type { TaskStatus } from './task-store.js';
import { readJsonFile, writeJsonFile } from './utils/fs.js';

export type ConversationMessageDirection = 'inbound' | 'outbound' | 'local';
export type ConversationMessageSource = 'feishu' | 'codex' | 'pc';

export interface ConversationMessageRecord {
  id: string;
  direction: ConversationMessageDirection;
  source: ConversationMessageSource;
  text: string;
  timestamp: string;
  taskId?: string;
  status?: TaskStatus;
  messageId?: string;
}

export interface ConversationSessionRecord {
  sessionId: string;
  chatId: string;
  participants: string[];
  createdAt: string;
  updatedAt: string;
  lastTaskId?: string;
  messages: ConversationMessageRecord[];
}

export interface AppendConversationMessageInput {
  chatId: string;
  participantOpenId?: string;
  direction: ConversationMessageDirection;
  source: ConversationMessageSource;
  text: string;
  taskId?: string;
  status?: TaskStatus;
  messageId?: string;
}

export interface ConversationStore {
  appendMessage(input: AppendConversationMessageInput): Promise<ConversationSessionRecord>;
  getBySessionId(sessionId: string): Promise<ConversationSessionRecord | undefined>;
  getByChatId(chatId: string): Promise<ConversationSessionRecord | undefined>;
  list(options?: { participantOpenId?: string; limit?: number }): Promise<ConversationSessionRecord[]>;
}

interface ConversationStoreState {
  sessions: ConversationSessionRecord[];
}

const EMPTY_STATE: ConversationStoreState = { sessions: [] };

export function createConversationStore(options: { dataFile: string }): ConversationStore {
  const optionsDataFile = options.dataFile;

  return {
    async appendMessage(input) {
      const state = await loadState(optionsDataFile);
      const index = state.sessions.findIndex((session) => session.chatId === input.chatId);
      const timestamp = nextTimestamp(index >= 0 ? state.sessions[index]?.updatedAt : undefined);
      const message: ConversationMessageRecord = {
        id: createMessageId(),
        direction: input.direction,
        source: input.source,
        text: input.text,
        timestamp,
        taskId: input.taskId,
        status: input.status,
        messageId: input.messageId,
      };

      if (index < 0) {
        const session: ConversationSessionRecord = {
          sessionId: createSessionId(input.chatId),
          chatId: input.chatId,
          participants: input.participantOpenId ? [input.participantOpenId] : [],
          createdAt: timestamp,
          updatedAt: timestamp,
          lastTaskId: input.taskId,
          messages: [message],
        };
        state.sessions.push(session);
        await saveState(optionsDataFile, state);
        return cloneSessionOrThrow(session);
      }

      const current = state.sessions[index];
      const next: ConversationSessionRecord = {
        ...current,
        participants: mergeParticipants(current.participants, input.participantOpenId),
        updatedAt: timestamp,
        lastTaskId: input.taskId ?? current.lastTaskId,
        messages: [...current.messages, message].sort((left, right) =>
          left.timestamp.localeCompare(right.timestamp),
        ),
      };
      state.sessions[index] = next;
      await saveState(optionsDataFile, state);
      return cloneSessionOrThrow(next);
    },

    async getBySessionId(sessionId) {
      const state = await loadState(optionsDataFile);
      return cloneSession(state.sessions.find((session) => session.sessionId === sessionId));
    },

    async getByChatId(chatId) {
      const state = await loadState(optionsDataFile);
      return cloneSession(state.sessions.find((session) => session.chatId === chatId));
    },

    async list(options) {
      const state = await loadState(optionsDataFile);
      const filtered = state.sessions
        .filter((session) =>
          options?.participantOpenId ? session.participants.includes(options.participantOpenId) : true,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const limited = options?.limit ? filtered.slice(0, options.limit) : filtered;
      return limited.map((session) => cloneSessionOrThrow(session));
    },
  };
}

async function loadState(dataFile: string): Promise<ConversationStoreState> {
  const state = await readJsonFile<ConversationStoreState>(dataFile, EMPTY_STATE);
  return {
    sessions: state.sessions.map((session) => cloneSessionOrThrow(session)),
  };
}

async function saveState(dataFile: string, state: ConversationStoreState): Promise<void> {
  await writeJsonFile(dataFile, {
    sessions: state.sessions.map((session) => cloneSessionOrThrow(session)),
  });
}

function cloneSession(session: ConversationSessionRecord | undefined): ConversationSessionRecord | undefined {
  if (!session) {
    return undefined;
  }

  return {
    ...session,
    participants: [...session.participants],
    messages: session.messages.map((message) => ({ ...message })),
  };
}

function cloneSessionOrThrow(session: ConversationSessionRecord): ConversationSessionRecord {
  return {
    ...session,
    participants: [...session.participants],
    messages: session.messages.map((message) => ({ ...message })),
  };
}

function mergeParticipants(participants: string[], nextParticipant?: string): string[] {
  if (!nextParticipant) {
    return [...participants];
  }

  return [...new Set([...participants, nextParticipant])];
}

function createSessionId(chatId: string): string {
  return `session_${chatId}`;
}

function createMessageId(): string {
  return `msg_${Math.random().toString(36).slice(2, 10)}`;
}

function nextTimestamp(previous?: string): string {
  const currentTime = Date.now();
  if (!previous) {
    return new Date(currentTime).toISOString();
  }

  const previousTime = Date.parse(previous);
  return new Date(Math.max(currentTime, previousTime + 1)).toISOString();
}
