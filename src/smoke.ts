import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DaemonConnection } from './daemonConnection';
import { connectDaemon, readLock } from './daemonLauncher';
import { buildEnv } from './shared/launch';
import { isPidAlive } from './which';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-session-sidebar-'));
const extensionPath = path.resolve(__dirname, '..');
let connection: DaemonConnection | undefined;
let cleaned = false;

const timer = setTimeout(() => {
  console.error('smoke timed out');
  void cleanup().finally(() => process.exit(1));
}, 50000);

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(timer);
    await cleanup();
  });

async function main(): Promise<void> {
  connection = await connectDaemon({
    storageDir,
    extensionPath,
    execPath: process.execPath,
  });
  const helloId = crypto.randomUUID();
  let helloText = '';
  connection.onOutput((sessionId, data) => {
    if (sessionId === helloId) {
      helloText += data;
    }
  });
  await connection.start({
    sessionId: helloId,
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-Command', 'Write-Output hello-sidebar'],
    cwd: os.homedir(),
    env: buildEnv(process.env, []),
    cols: 100,
    rows: 30,
    banner: '\r\n--- smoke hello ---\r\n',
  });
  await waitFor(async () => {
    const replay = await connection!.replay(helloId);
    return helloText.includes('hello-sidebar') || Boolean(replay?.data.includes('hello-sidebar'));
  }, 20000);
  console.log('hello output ok');

  const stayId = crypto.randomUUID();
  let stayText = '';
  connection.onOutput((sessionId, data) => {
    if (sessionId === stayId) {
      stayText += data;
    }
  });
  await connection.start({
    sessionId: stayId,
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NoExit'],
    cwd: os.homedir(),
    env: buildEnv(process.env, []),
    cols: 100,
    rows: 30,
    banner: '',
  });
  await delay(800);
  await connection.write(stayId, 'Write-Output stay-alive\r');
  await waitFor(async () => {
    const replay = await connection!.replay(stayId);
    return stayText.includes('stay-alive') || Boolean(replay?.data.includes('stay-alive'));
  }, 15000);
  const before = await connection.replay(stayId);
  if (!before?.running) {
    throw new Error('expected the second PowerShell to keep running');
  }
  connection.dispose();
  connection = undefined;

  const again = await connectDaemon({
    storageDir,
    extensionPath,
    execPath: process.execPath,
  });
  connection = again;
  const replay = await again.replay(stayId);
  if (!replay?.running || !replay.data.includes('stay-alive')) {
    throw new Error(`reconnect did not keep the process: running=${replay?.running} data=${replay?.data.slice(-200)}`);
  }
  console.log('reconnect kept the process');
  let exited = false;
  again.onExit((sessionId) => {
    if (sessionId === stayId) {
      exited = true;
    }
  });
  await again.stop(stayId);
  await waitFor(async () => {
    if (exited) {
      return true;
    }
    const after = await again.replay(stayId);
    return after?.running === false;
  }, 10000);
  console.log('stop ok');
  await again.shutdown();
  connection = undefined;
  await delay(1200);
  const lock = readLock(storageDir);
  if (lock && isPidAlive(lock.pid)) {
    throw new Error('backend still alive after shutdown');
  }
  console.log('smoke ok');
}

async function cleanup(): Promise<void> {
  if (cleaned) {
    return;
  }
  cleaned = true;
  try {
    await connection?.shutdown();
  } catch {
    // The backend may already be gone.
  }
  connection?.dispose();
  const lock = readLock(storageDir);
  if (lock && isPidAlive(lock.pid)) {
    spawn('taskkill', ['/pid', String(lock.pid), '/t', '/f'], { windowsHide: true });
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return;
    }
    await delay(200);
  }
  throw new Error('timed out waiting for terminal output');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
