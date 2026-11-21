import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type * as PtyTypes from 'node-pty';
import { t } from './shared/i18n';
import { SCROLLBACK_LIMIT, UserError, isUuid, type ReplayResult, type SessionSnapshot, type StartRequest } from './shared/types';

interface LiveProcess {
  pty: PtyTypes.IPty;
  running: boolean;
  exitCode: number | null;
  userStop: boolean;
}

function loadPty(): typeof PtyTypes {
  return require('node-pty') as typeof PtyTypes;
}

export class PtyService {
  private readonly processes = new Map<string, LiveProcess>();
  private readonly buffers = new Map<string, string>();
  private readonly loaded = new Set<string>();
  private readonly dirty = new Set<string>();
  private readonly pending = new Map<string, string>();
  private diskTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private outputListeners: ((sessionId: string, data: string) => void)[] = [];
  private exitListeners: ((sessionId: string, exitCode: number, userStop: boolean) => void)[] = [];

  constructor(private readonly storageDir: string) {
    fs.mkdirSync(this.logDir(), { recursive: true });
  }

  onOutput(listener: (sessionId: string, data: string) => void): void {
    this.outputListeners.push(listener);
  }

  onExit(listener: (sessionId: string, exitCode: number, userStop: boolean) => void): void {
    this.exitListeners.push(listener);
  }

  start(request: StartRequest): { pid: number } {
    this.assertId(request.sessionId);
    const existing = this.processes.get(request.sessionId);
    if (existing?.running) {
      throw new UserError(t('errAlreadyRunningTask'));
    }
    if (!request.file.trim()) {
      throw new UserError(t('errEmptyFile'));
    }
    if (!fs.existsSync(request.cwd)) {
      throw new UserError(t('errMissingFolder', { path: request.cwd }));
    }
    this.ensureLoaded(request.sessionId);
    if (request.banner) {
      this.append(request.sessionId, request.banner);
      this.queue(request.sessionId, request.banner);
    }
    let pty: PtyTypes.IPty;
    try {
      pty = loadPty().spawn(request.file, request.args, {
        name: 'xterm-256color',
        cols: request.cols || 80,
        rows: request.rows || 24,
        cwd: request.cwd,
        env: request.env,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UserError(t('errPtyStart', { message }));
    }
    const record: LiveProcess = { pty, running: true, exitCode: null, userStop: false };
    this.processes.set(request.sessionId, record);
    pty.onData((data) => {
      if (!data) {
        return;
      }
      this.append(request.sessionId, data);
      this.queue(request.sessionId, data);
    });
    pty.onExit(({ exitCode }) => {
      record.running = false;
      record.exitCode = exitCode;
      this.flushDisk();
      for (const listener of this.exitListeners) {
        listener(request.sessionId, exitCode, record.userStop);
      }
    });
    return { pid: pty.pid };
  }

  write(sessionId: string, data: string): void {
    const record = this.requireRunning(sessionId);
    record.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const record = this.processes.get(sessionId);
    if (!record?.running || cols < 2 || rows < 2) {
      return;
    }
    try {
      record.pty.resize(cols, rows);
    } catch {
      // The process can exit between the check and the resize.
    }
  }

  stop(sessionId: string): void {
    const record = this.processes.get(sessionId);
    if (!record?.running) {
      return;
    }
    record.userStop = true;
    const pid = record.pty.pid;
    try {
      record.pty.kill();
    } catch {
      // taskkill below is the Windows fallback.
    }
    setTimeout(() => {
      if (!record.running && process.platform === 'win32') {
        return;
      }
      if (!record.running) {
        return;
      }
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
        return;
      }
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }, 700);
  }

  replay(sessionId: string): ReplayResult | null {
    this.assertId(sessionId);
    this.ensureLoaded(sessionId);
    const record = this.processes.get(sessionId);
    return {
      data: this.buffers.get(sessionId) ?? '',
      running: Boolean(record?.running),
      exitCode: record?.exitCode ?? null,
    };
  }

  list(): SessionSnapshot[] {
    return [...this.processes.entries()].map(([id, record]) => ({
      id,
      running: record.running,
      exitCode: record.exitCode,
    }));
  }

  persist(): void {
    this.flushDisk();
  }

  shutdown(): void {
    for (const record of this.processes.values()) {
      if (!record.running) {
        continue;
      }
      record.userStop = true;
      try {
        record.pty.kill();
      } catch {
        // Ignore processes that have already exited.
      }
    }
    this.flushDisk();
  }

  private requireRunning(sessionId: string): LiveProcess {
    const record = this.processes.get(sessionId);
    if (!record?.running) {
      throw new UserError(t('errNoRunningProcess'));
    }
    return record;
  }

  private ensureLoaded(sessionId: string): void {
    if (this.loaded.has(sessionId)) {
      return;
    }
    this.loaded.add(sessionId);
    const file = this.logFile(sessionId);
    if (!fs.existsSync(file)) {
      this.buffers.set(sessionId, '');
      return;
    }
    const text = fs.readFileSync(file, 'utf8');
    this.buffers.set(sessionId, text.length > SCROLLBACK_LIMIT ? text.slice(text.length - SCROLLBACK_LIMIT) : text);
  }

  private append(sessionId: string, data: string): void {
    let next = (this.buffers.get(sessionId) ?? '') + data;
    if (next.length > SCROLLBACK_LIMIT) {
      next = next.slice(next.length - SCROLLBACK_LIMIT);
    }
    this.buffers.set(sessionId, next);
    this.dirty.add(sessionId);
    if (!this.diskTimer) {
      this.diskTimer = setTimeout(() => this.flushDisk(), 400);
    }
  }

  private queue(sessionId: string, data: string): void {
    this.pending.set(sessionId, (this.pending.get(sessionId) ?? '') + data);
    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => this.flushEmit(), 16);
    }
  }

  private flushEmit(): void {
    this.emitTimer = null;
    const batch = [...this.pending.entries()];
    this.pending.clear();
    for (const [sessionId, data] of batch) {
      for (const listener of this.outputListeners) {
        listener(sessionId, data);
      }
    }
  }

  private flushDisk(): void {
    if (this.diskTimer) {
      clearTimeout(this.diskTimer);
      this.diskTimer = null;
    }
    for (const sessionId of this.dirty) {
      fs.mkdirSync(this.logDir(), { recursive: true });
      fs.writeFileSync(this.logFile(sessionId), this.buffers.get(sessionId) ?? '', 'utf8');
    }
    this.dirty.clear();
  }

  private logDir(): string {
    return path.join(this.storageDir, 'logs');
  }

  private logFile(sessionId: string): string {
    this.assertId(sessionId);
    return path.join(this.logDir(), `${sessionId}.txt`);
  }

  private assertId(sessionId: string): void {
    if (!isUuid(sessionId)) {
      throw new UserError(t('errBadSessionId'));
    }
  }
}
