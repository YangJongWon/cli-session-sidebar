import { spawn, execFile, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { quoteCmd } from './shared/args';
import { DaemonConnection } from './daemonConnection';
import { isPidAlive } from './which';

export interface LaunchPaths {
  storageDir: string;
  extensionPath: string;
  execPath: string;
}

interface LockFile {
  pid: number;
  pipe: string;
  startedAt: number;
}

export async function connectDaemon(paths: LaunchPaths): Promise<DaemonConnection> {
  fs.mkdirSync(paths.storageDir, { recursive: true });
  const token = loadToken(paths.storageDir);
  const pipeName = pipeFor(paths.storageDir);
  const existing = await connectExisting(paths.storageDir, token);
  if (existing) {
    return existing;
  }
  const nodePath = await findNode();
  const candidates = [
    nodePath ? { executable: nodePath, electron: false } : undefined,
    paths.execPath ? { executable: paths.execPath, electron: true } : undefined,
  ].filter((item): item is { executable: string; electron: boolean } => Boolean(item));
  const seen = new Set<string>();
  let lastError = '실행 백엔드를 시작하지 못했습니다.';
  for (const candidate of candidates) {
    const key = candidate.executable.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const childPid = spawnDaemon(candidate.executable, paths, pipeName, candidate.electron);
    try {
      return await waitForDaemon(pipeName, token, 8000);
    } catch (error) {
      lastError = `${errorText(error)}\n${tail(path.join(paths.storageDir, 'daemon.log'))}`;
      if (childPid && isPidAlive(childPid) && !fs.existsSync(path.join(paths.storageDir, 'backend.lock'))) {
        try {
          process.kill(childPid);
        } catch {
          // The child may already have exited.
        }
      }
    }
  }
  throw new Error(lastError.trim());
}

export async function connectExisting(storageDir: string, token = loadToken(storageDir)): Promise<DaemonConnection | null> {
  const lock = readLock(storageDir);
  if (!lock || !isPidAlive(lock.pid)) {
    return null;
  }
  try {
    return await waitForDaemon(lock.pipe, token, 3000);
  } catch {
    return null;
  }
}

export function loadToken(storageDir: string): string {
  const file = path.join(storageDir, 'auth-token');
  if (fs.existsSync(file)) {
    const token = fs.readFileSync(file, 'utf8').trim();
    if (token.length >= 16) {
      return token;
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, token, 'utf8');
  return token;
}

export function pipeFor(storageDir: string): string {
  const hash = crypto.createHash('sha256').update(path.resolve(storageDir)).digest('hex').slice(0, 16);
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\cli-session-sidebar-${hash}`;
  }
  return path.join(storageDir, 'backend.sock');
}

export function readLock(storageDir: string): LockFile | null {
  const file = path.join(storageDir, 'backend.lock');
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LockFile>;
    if (typeof parsed.pid !== 'number' || typeof parsed.pipe !== 'string') {
      return null;
    }
    return { pid: parsed.pid, pipe: parsed.pipe, startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0 };
  } catch {
    return null;
  }
}

export function windowsCommandLine(executable: string, args: string[]): string {
  return [quoteCmd(executable), ...args.map((arg) => quoteCmd(arg))].join(' ');
}

function spawnDaemon(executable: string, paths: LaunchPaths, pipeName: string, electronAsNode: boolean): number | undefined {
  const script = path.join(paths.extensionPath, 'dist', 'daemon.js');
  const args = [script, '--storage', paths.storageDir, '--pipe', pipeName];
  const env = { ...process.env };
  if (electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  else delete env.ELECTRON_RUN_AS_NODE;
  if (process.platform === 'win32') {
    const outside = spawnOutsideWindowsJob(executable, args, env, paths);
    if (outside) return outside;
  }
  const child = spawn(executable, args, {
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

function spawnOutsideWindowsJob(executable: string, args: string[], env: NodeJS.ProcessEnv, paths: LaunchPaths): number | undefined {
  const script = path.join(paths.extensionPath, 'scripts', 'spawn-detached.ps1');
  if (!fs.existsSync(script)) return undefined;
  const specPath = path.join(paths.storageDir, 'spawn-detached.json');
  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') cleanEnv[key] = value;
  }
  fs.writeFileSync(specPath, JSON.stringify({
    commandLine: windowsCommandLine(executable, args),
    cwd: paths.storageDir,
    env: cleanEnv,
  }), 'utf8');
  try {
    const stdout = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Spec', specPath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
    });
    const pid = Number(stdout.trim().split(/\s+/).pop());
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  } finally {
    fs.rmSync(specPath, { force: true });
  }
}

async function waitForDaemon(pipeName: string, token: string, timeoutMs: number): Promise<DaemonConnection> {
  const started = Date.now();
  let lastError: Error | undefined;
  while (Date.now() - started < timeoutMs) {
    try {
      return await DaemonConnection.connect(pipeName, token, 1000);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await delay(200);
    }
  }
  throw lastError ?? new Error('백엔드 파이프에 연결하지 못했습니다.');
}

function findNode(): Promise<string | undefined> {
  if (process.platform !== 'win32') {
    return Promise.resolve('node');
  }
  return new Promise((resolve) => {
    execFile('where.exe', ['node'], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const match = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.toLowerCase().endsWith('node.exe'));
      resolve(match);
    });
  });
}

function tail(file: string): string {
  if (!fs.existsSync(file)) {
    return '';
  }
  return fs.readFileSync(file, 'utf8').slice(-2000);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
