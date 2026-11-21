import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

export function gitBashCandidates(): string[] {
  const env = process.env;
  const roots = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']].filter((root): root is string => Boolean(root));
  const paths = roots.map((root) => path.join(root, 'Git', 'bin', 'bash.exe'));
  if (env.LOCALAPPDATA) paths.push(path.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  return [...new Set(paths)];
}

export function gitBashPath(): string | undefined {
  return gitBashCandidates().find((file) => fs.existsSync(file));
}

export function findProgram(program: string): Promise<string[]> {
  const trimmed = program.trim().replace(/^"(.*)"$/, '$1');
  if (!trimmed) {
    return Promise.resolve([]);
  }
  if (path.isAbsolute(trimmed) || /[\\/]/.test(trimmed)) {
    return Promise.resolve(fs.existsSync(trimmed) ? [path.resolve(trimmed)] : []);
  }
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFile(command, [trimmed], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    });
  });
}

const WINDOWS_RANK: Record<string, number> = { '.exe': 0, '.com': 0, '.cmd': 1, '.bat': 1, '.ps1': 2 };

export function chooseProgram(paths: string[]): string | undefined {
  let best: string | undefined;
  let bestRank = 99;
  for (const file of paths) {
    const rank = WINDOWS_RANK[path.extname(file).toLowerCase()] ?? 9;
    if (rank < bestRank) {
      best = file;
      bestRank = rank;
    }
  }
  return best;
}

export function exeQuotedInCmd(text: string, cmdFile: string): string | undefined {
  const match = text.match(/"([^"\r\n]+\.exe)"/i);
  if (!match) return undefined;
  const dir = path.dirname(cmdFile);
  const expanded = match[1]
    .replace(/%~dp0%/gi, `${dir}\\`)
    .replace(/%dp0%/gi, `${dir}\\`)
    .replace(/%~dp0/gi, `${dir}\\`)
    .replace(/%dp0/gi, `${dir}\\`);
  return path.win32.normalize(expanded);
}

export function runnableProgram(file: string): string {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return file;
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return file;
  }
  if (text.length > 8000) return file;
  const exe = exeQuotedInCmd(text, file);
  return exe && fs.existsSync(exe) ? exe : file;
}

export function isPidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
