import { matchesMessage, t } from './i18n';
import type { InstallHint, ShellKind } from './types';

export type TemplatePlatform = 'win32' | 'darwin' | 'linux';

export interface Template {
  id: string;
  label: string;
  description: string;
  program: string;
  args: string;
  shell: ShellKind;
  resumeRecent: string;
  resumeSpecific: string;
  website: string;
  platforms?: TemplatePlatform[];
  windowsInstall?: { command: string; note: string };
}

export function templatesFor(platform: string): Template[] {
  return TEMPLATES.filter((template) => !template.platforms || template.platforms.includes(platform as TemplatePlatform));
}

export const TEMPLATES: Template[] = [
  {
    id: 'powershell',
    label: 'PowerShell',
    description: 'Windows PowerShell. 터미널 동작을 확인할 때 바로 사용할 수 있습니다.',
    program: 'powershell.exe',
    args: '-NoLogo',
    shell: 'direct',
    resumeRecent: '',
    resumeSpecific: '',
    website: 'https://learn.microsoft.com/powershell/',
    platforms: ['win32'],
  },
  {
    id: 'pwsh',
    label: 'PowerShell 7',
    description: 'PowerShell 7입니다. 실행 파일은 pwsh.exe입니다.',
    program: 'pwsh.exe',
    args: '-NoLogo',
    shell: 'direct',
    resumeRecent: '',
    resumeSpecific: '',
    website: 'https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows',
    platforms: ['win32'],
  },
  {
    id: 'git-bash',
    label: 'Git Bash',
    description: 'Git for Windows의 Bash입니다. Git\\bin\\bash.exe로 로그인 셸을 엽니다.',
    program: 'bash.exe',
    args: '--login -i',
    shell: 'direct',
    resumeRecent: '',
    resumeSpecific: '',
    website: 'https://gitforwindows.org/',
    platforms: ['win32'],
  },
  {
    id: 'cmd',
    label: '명령 프롬프트',
    description: 'cmd.exe',
    program: 'cmd.exe',
    args: '',
    shell: 'direct',
    resumeRecent: '',
    resumeSpecific: '',
    website: 'https://learn.microsoft.com/windows-server/administration/windows-commands/cmd',
    platforms: ['win32'],
  },
  {
    id: 'zsh',
    label: 'zsh',
    description: 'macOS 기본 셸입니다.',
    program: 'zsh',
    args: '-l',
    shell: 'direct',
    resumeRecent: '',
    resumeSpecific: '',
    website: 'https://www.zsh.org/',
    platforms: ['darwin', 'linux'],
  },
  {
    id: 'brew',
    label: 'Homebrew',
    description: 'macOS에서 명령 프롬프트 자리에 두는 패키지 관리자입니다. 명령은 brew입니다.',
    program: 'brew',
    args: '',
    shell: 'direct',
    resumeRecent: '',
    resumeSpecific: '',
    website: 'https://brew.sh/',
    platforms: ['darwin', 'linux'],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Claude Code CLI. 저장 전에 인수와 재개 명령을 고칠 수 있습니다.',
    program: 'claude',
    args: '',
    shell: 'direct',
    resumeRecent: 'claude --continue',
    resumeSpecific: 'claude --resume {id}',
    website: 'https://code.claude.com/docs',
    windowsInstall: {
      command: 'irm https://claude.ai/install.ps1 | iex',
      note: 'Windows PowerShell에서 실행하는 공식 설치 명령입니다. macOS용 brew 명령이 아닙니다. 로그인과 권한 확인은 Claude Code가 안내합니다.',
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'OpenAI Codex CLI. 저장 전에 인수와 재개 명령을 고칠 수 있습니다.',
    program: 'codex',
    args: '',
    shell: 'direct',
    resumeRecent: 'codex resume --last',
    resumeSpecific: 'codex resume {id}',
    website: 'https://learn.chatgpt.com/docs/codex/cli',
    windowsInstall: {
      command: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
      note: 'Windows용 공식 설치 스크립트입니다. macOS용 brew 명령이 아닙니다. npm을 쓰려면 npm install -g @openai/codex 를 사용합니다. 로그인은 Codex CLI가 안내합니다.',
    },
  },
  {
    id: 'cursor',
    label: 'Cursor CLI',
    description: 'Cursor CLI. 저장 전에 인수와 재개 명령을 고칠 수 있습니다.',
    program: 'agent',
    args: '',
    shell: 'direct',
    resumeRecent: 'agent resume',
    resumeSpecific: 'agent --resume {id}',
    website: 'https://cursor.com/docs/cli/overview',
    windowsInstall: {
      command: "irm 'https://cursor.com/install?win32=true' | iex",
      note: 'Windows PowerShell에서 실행하는 공식 설치 명령입니다. 로그인은 Cursor CLI가 안내합니다.',
    },
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    description: 'OpenCode CLI. 저장 전에 인수와 재개 명령을 고칠 수 있습니다.',
    program: 'opencode',
    args: '',
    shell: 'direct',
    resumeRecent: 'opencode --continue',
    resumeSpecific: 'opencode --session {id}',
    website: 'https://opencode.ai/docs',
    windowsInstall: {
      command: 'npm install -g @opencode/cli',
      note: 'Windows에서는 npm으로 설치합니다. macOS·Linux용 brew 명령이 아닙니다. 공급자 연결은 OpenCode의 공식 안내를 따릅니다.',
    },
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    description: 'Antigravity CLI. 설치된 실행 파일과 재개 명령을 확인해 등록하세요.',
    program: 'agy',
    args: '',
    shell: 'direct',
    resumeRecent: '',
    resumeSpecific: '',
    website: 'https://antigravity.google/docs',
  },
  {
    id: 'devin',
    label: 'Devin',
    description: 'Devin CLI. 설치된 버전에 맞게 명령을 편집할 수 있습니다.',
    program: 'devin',
    args: '',
    shell: 'direct',
    resumeRecent: 'devin -c',
    resumeSpecific: 'devin -r {id}',
    website: 'https://docs.devin.ai/cli',
  },
];

const INSTALL_NOTES: Record<string, 'installNoteClaude' | 'installNoteCodex' | 'installNoteCursor' | 'installNoteOpencode'> = {
  claude: 'installNoteClaude',
  codex: 'installNoteCodex',
  cursor: 'installNoteCursor',
  opencode: 'installNoteOpencode',
};

export function installHint(templateId: string | undefined, program: string, platform: string): InstallHint | null {
  const template = TEMPLATES.find((item) => item.id === templateId)
    ?? TEMPLATES.find((item) => item.program.toLowerCase() === program.trim().toLowerCase());
  const label = template?.label ?? (program.trim() || 'CLI');
  if (platform !== 'win32') {
    const note = template?.id === 'zsh' ? t('installNoteZsh') : template?.id === 'brew' ? t('installNoteBrew') : t('installNoteOtherOs');
    return {
      title: t('installTitleMissing', { name: label }),
      command: '',
      note,
    };
  }
  if (template?.windowsInstall) {
    const noteKey = INSTALL_NOTES[template.id];
    return {
      title: t('installTitlePath', { name: label }),
      command: template.windowsInstall.command,
      note: noteKey ? t(noteKey) : template.windowsInstall.note,
    };
  }
  if (template?.id === 'powershell' || template?.id === 'cmd' || template?.id === 'pwsh' || template?.id === 'git-bash') {
    const note = template.id === 'git-bash' ? t('installNoteGitBash') : template.id === 'pwsh' ? t('installNotePwsh') : t('installNoteShell');
    return {
      title: t('installTitleMissing', { name: label }),
      command: '',
      note,
    };
  }
  return {
    title: t('installTitleMissing', { name: label }),
    command: '',
    note: t('installNoteGeneric'),
  };
}

export function localizedMissingProgram(stored: string, templateId: string | undefined, program: string, platform: string): string {
  if (!matchesMessage(stored, 'errProgramMissing')) return stored;
  const hint = installHint(templateId, program, platform);
  if (!hint) return stored;
  const name = program.trim() || stored.split(':').pop()?.split('\n')[0]?.trim() || '';
  const command = hint.command ? `\n${hint.command}` : '';
  const note = hint.note ? `\n${hint.note}` : '';
  return `${t('errProgramMissing', { program: name })}${note}${command}`;
}
