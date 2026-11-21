import crypto from 'crypto';
import net from 'net';
import { FrameParser, encodeFrame } from './shared/frame';
import type { ReplayResult, SessionSnapshot, StartRequest } from './shared/types';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class DaemonConnection {
  readonly kind = 'daemon' as const;
  private readonly pending = new Map<string, Pending>();
  private readonly parser = new FrameParser();
  private outputListener: ((sessionId: string, data: string) => void) | null = null;
  private exitListener: ((sessionId: string, exitCode: number, userStop: boolean) => void) | null = null;
  private closeListener: (() => void) | null = null;
  private intentionalClose = false;
  private closeNotified = false;

  private constructor(private readonly socket: net.Socket) {
    socket.on('data', (chunk) => {
      try {
        this.parser.push(chunk, (message) => this.onMessage(message));
      } catch (error) {
        this.failAll(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on('error', (error) => this.failAll(error));
    socket.on('close', () => {
      this.failAll(new Error('백엔드 연결이 닫혔습니다.'));
      this.notifyClose();
    });
  }

  static async connect(pipeName: string, token: string, timeoutMs = 5000): Promise<DaemonConnection> {
    const socket = await openPipe(pipeName, timeoutMs);
    const connection = new DaemonConnection(socket);
    await connection.request('hello', { token });
    return connection;
  }

  onOutput(listener: (sessionId: string, data: string) => void): void {
    this.outputListener = listener;
  }

  onExit(listener: (sessionId: string, exitCode: number, userStop: boolean) => void): void {
    this.exitListener = listener;
  }

  onClose(listener: () => void): void {
    this.closeListener = listener;
  }

  start(request: StartRequest): Promise<void> {
    return this.request('start', request).then(() => undefined);
  }

  write(sessionId: string, data: string): Promise<void> {
    return this.request('write', { sessionId, data }).then(() => undefined);
  }

  resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return this.request('resize', { sessionId, cols, rows }).then(() => undefined);
  }

  stop(sessionId: string): Promise<void> {
    return this.request('stop', { sessionId }).then(() => undefined);
  }

  replay(sessionId: string): Promise<ReplayResult | null> {
    return this.request('replay', { sessionId }).then((result) => {
      const record = asRecord(result);
      if (typeof record.data !== 'string') {
        return null;
      }
      return {
        data: record.data,
        running: Boolean(record.running),
        exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
      };
    });
  }

  list(): Promise<SessionSnapshot[]> {
    return this.request('list', {}).then((result) => {
      const sessions = asRecord(result).sessions;
      if (!Array.isArray(sessions)) {
        return [];
      }
      return sessions.map((item) => {
        const record = asRecord(item);
        return {
          id: typeof record.id === 'string' ? record.id : '',
          running: Boolean(record.running),
          exitCode: typeof record.exitCode === 'number' ? record.exitCode : null,
        };
      }).filter((item) => item.id);
    });
  }

  shutdown(): Promise<void> {
    this.intentionalClose = true;
    return this.request('shutdown', {}).then(() => undefined);
  }

  dispose(): void {
    this.intentionalClose = true;
    this.socket.end();
    this.socket.destroy();
  }

  private notifyClose(): void {
    if (this.intentionalClose || this.closeNotified) {
      return;
    }
    this.closeNotified = true;
    this.closeListener?.();
  }

  private request(type: string, payload: object): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('백엔드 응답 시간이 초과되었습니다.'));
      }, 20000);
      this.pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.write(encodeFrame({ type, requestId, ...payload }));
    });
  }

  private onMessage(message: unknown): void {
    const record = asRecord(message);
    if (record.type === 'output' && typeof record.sessionId === 'string' && typeof record.data === 'string') {
      this.outputListener?.(record.sessionId, record.data);
      return;
    }
    if (record.type === 'exit' && typeof record.sessionId === 'string') {
      this.exitListener?.(
        record.sessionId,
        typeof record.exitCode === 'number' ? record.exitCode : 0,
        Boolean(record.userStop),
      );
      return;
    }
    if (record.type !== 'response' || typeof record.requestId !== 'string') {
      return;
    }
    const pending = this.pending.get(record.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(record.requestId);
    if (record.ok === false) {
      pending.reject(new Error(typeof record.error === 'string' ? record.error : '백엔드 요청이 실패했습니다.'));
      return;
    }
    pending.resolve(record.result);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function openPipe(pipeName: string, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipeName);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('백엔드 파이프에 연결하지 못했습니다.'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
