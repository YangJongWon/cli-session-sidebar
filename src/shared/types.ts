import type { UiLanguage } from './i18n';

export const SCHEMA_VERSION = 1;
export const SCROLLBACK_LIMIT = 400_000;

export type ShellKind = 'direct' | 'powershell' | 'cmd';
export type SessionStatus = 'running' | 'exited';
export type ExitReason = 'process-exit' | 'user-stop' | 'interrupted' | 'start-failed' | null;
export type SessionRunMode = 'fresh' | 'resumed' | null;
export type RunMode = 'run' | 'resumeRecent' | 'resumeSpecific';

export interface EnvEntry {
  key: string;
  value: string;
}

export interface Profile {
  id: string;
  name: string;
  program: string;
  args: string;
  shell: ShellKind;
  cwd: string;
  env: EnvEntry[];
  resumeRecent: string;
  resumeSpecific: string;
  website?: string;
  iconText?: string;
  iconColor?: string;
  iconImage?: string;
  templateId?: string;
  origin?: 'template';
  customized?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  name: string;
  profileId: string;
  cwd: string;
  status: SessionStatus;
  runMode: SessionRunMode;
  exitReason: ExitReason;
  exitCode: number | null;
  startedAt: number | null;
  endedAt: number | null;
  cliHint: string;
  lastCommand: string;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  preserved?: boolean;
}

export interface StoreData {
  schemaVersion: number;
  profiles: Profile[];
  sessions: Session[];
  activeSessionId: string | null;
  hiddenTemplateIds: string[];
  removedTemplateIds: string[];
  uiLanguage: UiLanguage;
}

export interface StartRequest {
  sessionId: string;
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  banner: string;
}

export interface SessionSnapshot {
  id: string;
  running: boolean;
  exitCode: number | null;
}

export interface ReplayResult {
  data: string;
  running: boolean;
  exitCode: number | null;
}

export interface InstallHint {
  title: string;
  command: string;
  note: string;
}

export function emptyStore(): StoreData {
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles: [],
    sessions: [],
    activeSessionId: null,
    hiddenTemplateIds: [],
    removedTemplateIds: [],
    uiLanguage: 'auto',
  };
}

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
