import type { ReplayResult, SessionSnapshot, StartRequest } from './shared/types';
import { PtyService } from './ptyService';

export class LocalBackend {
  readonly kind = 'inprocess' as const;

  constructor(private readonly service: PtyService) {}

  onOutput(listener: (sessionId: string, data: string) => void): void {
    this.service.onOutput(listener);
  }

  onExit(listener: (sessionId: string, exitCode: number, userStop: boolean) => void): void {
    this.service.onExit(listener);
  }

  start(request: StartRequest): Promise<void> {
    this.service.start(request);
    return Promise.resolve();
  }

  write(sessionId: string, data: string): Promise<void> {
    this.service.write(sessionId, data);
    return Promise.resolve();
  }

  resize(sessionId: string, cols: number, rows: number): Promise<void> {
    this.service.resize(sessionId, cols, rows);
    return Promise.resolve();
  }

  stop(sessionId: string): Promise<void> {
    this.service.stop(sessionId);
    return Promise.resolve();
  }

  replay(sessionId: string): Promise<ReplayResult | null> {
    return Promise.resolve(this.service.replay(sessionId));
  }

  list(): Promise<SessionSnapshot[]> {
    return Promise.resolve(this.service.list());
  }

  shutdown(): Promise<void> {
    this.service.shutdown();
    return Promise.resolve();
  }

  dispose(): void {
    // In-process sessions stay up when a view closes.
  }
}
