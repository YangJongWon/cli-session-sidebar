import fs from 'fs';
import net from 'net';
import path from 'path';
import { FrameParser, encodeFrame } from './shared/frame';
import { isUiLanguage, resolveLanguage, setLanguage, t } from './shared/i18n';
import type { StartRequest } from './shared/types';
import { PtyService } from './ptyService';

interface ClientState {
  socket: net.Socket;
  parser: FrameParser;
  hello: boolean;
}

const storageDir = argument('--storage');
const pipeName = argument('--pipe');
applyStoredLanguage(storageDir);
captureLog(storageDir);
const token = readToken(storageDir);
const service = new PtyService(storageDir);
const clients = new Set<ClientState>();

service.onOutput((sessionId, data) => {
  broadcast({ type: 'output', sessionId, data });
});
service.onExit((sessionId, exitCode, userStop) => {
  broadcast({ type: 'exit', sessionId, exitCode, userStop });
});

const server = net.createServer((socket) => {
  const client: ClientState = { socket, parser: new FrameParser(), hello: false };
  clients.add(client);
  socket.on('data', (chunk) => {
    try {
      client.parser.push(chunk, (message) => handle(client, message));
    } catch (error) {
      send(socket, { type: 'response', requestId: '', ok: false, error: errorText(error) });
      socket.destroy();
    }
  });
  socket.on('close', () => {
    clients.delete(client);
    if (clients.size === 0) service.persist();
  });
  socket.on('error', () => clients.delete(client));
});

server.on('error', (error) => {
  console.error(errorText(error));
  process.exit(1);
});

server.listen(pipeName, () => {
  fs.writeFileSync(path.join(storageDir, 'backend.lock'), JSON.stringify({
    pid: process.pid,
    pipe: pipeName,
    startedAt: Date.now(),
  }));
  console.log(`listening ${pipeName} pid ${process.pid}`);
});

function handle(client: ClientState, message: unknown): void {
  const record = asRecord(message);
  const type = typeof record.type === 'string' ? record.type : '';
  const requestId = typeof record.requestId === 'string' ? record.requestId : '';
  if (!client.hello) {
    if (type !== 'hello' || record.token !== token) {
      send(client.socket, { type: 'response', requestId, ok: false, error: '백엔드 인증에 실패했습니다.' });
      client.socket.destroy();
      return;
    }
    client.hello = true;
    send(client.socket, { type: 'response', requestId, ok: true, result: { pid: process.pid } });
    return;
  }
  try {
    const result = dispatch(type, record);
    if (result instanceof Promise) {
      result
        .then((value) => send(client.socket, { type: 'response', requestId, ok: true, result: value ?? {} }))
        .catch((error) => send(client.socket, { type: 'response', requestId, ok: false, error: errorText(error) }));
      return;
    }
    send(client.socket, { type: 'response', requestId, ok: true, result: result ?? {} });
  } catch (error) {
    send(client.socket, { type: 'response', requestId, ok: false, error: errorText(error) });
  }
}

function dispatch(type: string, record: Record<string, unknown>): unknown {
  if (type === 'start') {
    return service.start(asStart(record));
  }
  if (type === 'write') {
    service.write(stringField(record, 'sessionId'), stringField(record, 'data'));
    return {};
  }
  if (type === 'resize') {
    service.resize(stringField(record, 'sessionId'), numberField(record, 'cols'), numberField(record, 'rows'));
    return {};
  }
  if (type === 'stop') {
    service.stop(stringField(record, 'sessionId'));
    return {};
  }
  if (type === 'replay') {
    return service.replay(stringField(record, 'sessionId'));
  }
  if (type === 'list') {
    return { sessions: service.list() };
  }
  if (type === 'shutdown') {
    service.shutdown();
    setTimeout(() => {
      fs.rmSync(path.join(storageDir, 'backend.lock'), { force: true });
      process.exit(0);
    }, 900);
    return {};
  }
  throw new Error(`알 수 없는 요청입니다: ${type}`);
}

function asStart(record: Record<string, unknown>): StartRequest {
  const envRecord = asRecord(record.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envRecord)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  const args = Array.isArray(record.args) ? record.args.filter((item): item is string => typeof item === 'string') : [];
  return {
    sessionId: stringField(record, 'sessionId'),
    file: stringField(record, 'file'),
    args,
    cwd: stringField(record, 'cwd'),
    env,
    cols: numberField(record, 'cols'),
    rows: numberField(record, 'rows'),
    banner: typeof record.banner === 'string' ? record.banner : '',
  };
}

function broadcast(message: unknown): void {
  for (const client of clients) {
    if (client.hello) {
      send(client.socket, message);
    }
  }
}

function send(socket: net.Socket, message: unknown): void {
  if (!socket.destroyed) {
    socket.write(encodeFrame(message));
  }
}

function captureLog(storage: string): void {
  const stream = fs.createWriteStream(path.join(storage, 'daemon.log'), { flags: 'a' });
  const write = (level: string, args: unknown[]) => {
    stream.write(`[${level}] ${args.map((item) => String(item)).join(' ')}\n`);
  };
  console.log = (...args: unknown[]) => write('info', args);
  console.error = (...args: unknown[]) => write('error', args);
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
  return value;
}

function readToken(storage: string): string {
  const file = path.join(storage, 'auth-token');
  if (!fs.existsSync(file)) {
    console.error('auth-token missing');
    process.exit(1);
  }
  const tokenValue = fs.readFileSync(file, 'utf8').trim();
  if (tokenValue.length < 16) {
    console.error('auth-token invalid');
    process.exit(1);
  }
  return tokenValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(t('errMissingValue', { key }));
  }
  return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function applyStoredLanguage(dir: string): void {
  let setting: 'auto' | 'ko' | 'ja' | 'zh' | 'en' = 'auto';
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8')) as { uiLanguage?: unknown };
    if (isUiLanguage(raw.uiLanguage)) setting = raw.uiLanguage;
  } catch {
    setting = 'auto';
  }
  setLanguage(resolveLanguage(setting, Intl.DateTimeFormat().resolvedOptions().locale || 'en'));
}
