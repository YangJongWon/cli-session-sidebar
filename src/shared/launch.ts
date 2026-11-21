import { commandLines, quoteCmd, quotePowerShell, splitArgs } from './args';
import { t } from './i18n';
import { UserError, type RunMode, type ShellKind } from './types';

export interface LaunchInput {
  program: string;
  args: string;
  shell: ShellKind;
  resumeRecent: string;
  resumeSpecific: string;
  mode: RunMode;
  cliHint: string;
}

export interface LaunchSpec {
  file: string;
  args: string[];
  commandLabel: string;
}

export function buildLaunch(input: LaunchInput): LaunchSpec {
  if (input.mode === 'run') {
    return buildRun(input);
  }
  const command = resumeCommand(input);
  const lines = commandLines(command);
  if (lines.length > 1) {
    return chainedCommands(lines, input.shell);
  }
  if (input.shell === 'powershell') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', command],
      commandLabel: command,
    };
  }
  if (input.shell === 'cmd') {
    return {
      file: 'cmd.exe',
      args: ['/d', '/k', command],
      commandLabel: command,
    };
  }
  const parts = splitResume(input);
  if (parts.length === 0) {
    throw new UserError(t('errResumeProgram'));
  }
  return {
    file: parts[0],
    args: parts.slice(1),
    commandLabel: parts.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' '),
  };
}

export function buildEnv(base: Record<string, string | undefined>, entries: { key: string; value: string }[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    env[key] = entry.value;
  }
  if (!env.TERM) {
    env.TERM = 'xterm-256color';
  }
  return env;
}

export function wrapShellScript(file: string, args: string[], platform: string, comSpec?: string): { file: string; args: string[] } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    return {
      file: comSpec || 'cmd.exe',
      args: ['/d', '/c', file, ...args],
    };
  }
  return { file, args };
}

export function bannerFor(mode: RunMode, commandLabel: string, when = new Date()): string {
  const stamp = formatStamp(when);
  return t(mode === 'run' ? 'bannerRun' : 'bannerResume', { stamp, command: commandLabel });
}

function buildRun(input: LaunchInput): LaunchSpec {
  const programLines = commandLines(input.program);
  const argLines = commandLines(input.args);
  const program = programLines[0] ?? '';
  if (!program) {
    throw new UserError(t('errProgramEmpty'));
  }
  if (programLines.length > 1 || argLines.length > 1) {
    const head = programLines.length > 1 ? splitArgs(program) : [program];
    const executable = head[0] ?? '';
    if (!executable) throw new UserError(t('errProgramEmpty'));
    const firstArgs = [head.slice(1).join(' '), argLines[0] ?? ''].filter(Boolean).join(' ');
    return chainedRun(executable, [firstArgs, ...programLines.slice(1), ...argLines.slice(1)], input.shell);
  }
  const args = argLines[0] ?? '';
  const commandLabel = args ? `${program} ${args}` : program;
  if (input.shell === 'powershell') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', `& ${quotePowerShell(program)}${args ? ` ${args}` : ''}`],
      commandLabel,
    };
  }
  if (input.shell === 'cmd') {
    return {
      file: 'cmd.exe',
      args: ['/d', '/k', `${quoteCmd(program)}${args ? ` ${args}` : ''}`],
      commandLabel,
    };
  }
  return {
    file: program,
    args: splitArgs(input.args),
    commandLabel,
  };
}

function chainedRun(program: string, lines: string[], shell: ShellKind): LaunchSpec {
  const [first, ...rest] = lines;
  const head = `${quoteCmd(program)}${first ? ` ${first}` : ''}`;
  if (shell === 'powershell') {
    const statements = [`& ${quotePowerShell(program)}${first ? ` ${first}` : ''}`, ...rest];
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', statements.join('\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n')],
      commandLabel: [head, ...rest].join(' && '),
    };
  }
  return chainedCommands([head, ...rest], shell);
}

function chainedCommands(lines: string[], shell: ShellKind): LaunchSpec {
  const label = lines.join(' && ');
  if (shell === 'powershell') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', lines.join('\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n')],
      commandLabel: label,
    };
  }
  return {
    file: 'cmd.exe',
    args: ['/d', '/k', label],
    commandLabel: label,
  };
}

function resumeCommand(input: LaunchInput): string {
  const template = resumeTemplate(input);
  if (!template.includes('{id}')) {
    return template;
  }
  const hint = requiredHint(input);
  return template.split('{id}').join(quoteForShell(input.shell, hint, template));
}

function splitResume(input: LaunchInput): string[] {
  const template = resumeTemplate(input);
  if (!template.includes('{id}')) {
    return splitArgs(template);
  }
  const hint = requiredHint(input);
  const marker = '\u0000';
  return splitArgs(template.split('{id}').join(marker)).map((part) => part.split(marker).join(hint));
}

function resumeTemplate(input: LaunchInput): string {
  const template = (input.mode === 'resumeRecent' ? input.resumeRecent : input.resumeSpecific).trim();
  if (!template) {
    throw new UserError(t(input.mode === 'resumeRecent' ? 'errResumeRecentEmpty' : 'errResumeSpecificEmpty'));
  }
  return template;
}

function requiredHint(input: LaunchInput): string {
  const hint = input.cliHint.trim();
  if (!hint) {
    throw new UserError(t('errResumeIdEmpty'));
  }
  return hint;
}

function quoteForShell(shell: ShellKind, hint: string, template: string): string {
  const quotedInTemplate = template.includes(`"{id}"`) || template.includes(`'{id}'`);
  if (quotedInTemplate || shell === 'direct') {
    return hint;
  }
  if (shell === 'powershell') {
    return quotePowerShell(hint);
  }
  return quoteCmd(hint);
}

function formatStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
