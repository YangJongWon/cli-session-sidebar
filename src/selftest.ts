import path from 'path';
import { windowsCommandLine } from './daemonLauncher';
import { resolveLanguage, setLanguage } from './shared/i18n';
import { commandLines, splitArgs } from './shared/args';
import { bannerFor, buildLaunch, wrapShellScript } from './shared/launch';
import { findPathLinks } from './shared/pathLinks';
import { chooseProgram, exeQuotedInCmd, gitBashCandidates } from './which';
import { commandIcon, lettersFromName } from './shared/icon';
import { TEMPLATES, installHint, localizedMissingProgram, templatesFor } from './shared/templates';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const pieces = splitArgs(`a "b c" 'd e'`);
assert(pieces.join('|') === 'a|b c|d e', `splitArgs: ${pieces.join('|')}`);
assert(splitArgs('').length === 0, 'empty args');
const detached = windowsCommandLine('C:\\Program Files\\nodejs\\node.exe', ['C:\\Work\\daemon.js', '--storage', 'C:\\Users\\a b']);
assert(detached.startsWith('"C:\\Program Files\\nodejs\\node.exe"'), 'daemon command quotes the executable');
assert(detached.includes('"C:\\Users\\a b"'), 'daemon command quotes spaced arguments');

const run = buildLaunch({
  program: 'claude',
  args: '--verbose',
  shell: 'direct',
  resumeRecent: 'claude --continue',
  resumeSpecific: 'claude --resume {id}',
  mode: 'run',
  cliHint: 'abc',
});
assert(run.file === 'claude' && run.args.join(' ') === '--verbose', 'direct run keeps the typed arguments');
assert(run.commandLabel === 'claude --verbose', 'label');
assert(!JSON.stringify(run).includes('dangerously'), 'run does not add permission flags');
assert(!JSON.stringify(run).includes('{id}'), 'run does not consume the resume id');

const resumed = buildLaunch({
  program: 'claude',
  args: '',
  shell: 'direct',
  resumeRecent: 'claude --continue',
  resumeSpecific: 'claude --resume {id}',
  mode: 'resumeSpecific',
  cliHint: 'session 1',
});
assert(resumed.file === 'claude' && resumed.args[0] === '--resume' && resumed.args[1] === 'session 1', 'resume id substitution');

let emptyResume = false;
try {
  buildLaunch({
    program: 'claude',
    args: '',
    shell: 'direct',
    resumeRecent: '   ',
    resumeSpecific: '',
    mode: 'resumeRecent',
    cliHint: '',
  });
} catch {
  emptyResume = true;
}
assert(emptyResume, 'empty resume command does not run');

const powershell = buildLaunch({
  program: 'C:\\Tools\\claude.exe',
  args: '--verbose',
  shell: 'powershell',
  resumeRecent: '',
  resumeSpecific: '',
  mode: 'run',
  cliHint: '',
});
assert(powershell.file === 'powershell.exe', 'powershell file');
assert(powershell.args.slice(0, 3).join(' ') === '-NoLogo -NoExit -Command', 'powershell wrapper');
assert(powershell.args[3] === `& 'C:\\Tools\\claude.exe' --verbose`, 'powershell preserves arguments');
const multiline = buildLaunch({
  program: 'claude',
  args: '--verbose\nnpm test',
  shell: 'direct',
  resumeRecent: '',
  resumeSpecific: '',
  mode: 'run',
  cliHint: '',
});
assert(multiline.file === 'cmd.exe' && multiline.args[2] === 'claude --verbose && npm test', 'a newline runs the next command');
const programLines = buildLaunch({
  program: 'claude\nnpm test',
  args: '',
  shell: 'direct',
  resumeRecent: '',
  resumeSpecific: '',
  mode: 'run',
  cliHint: '',
});
assert(programLines.file === 'cmd.exe' && programLines.args[2] === 'claude && npm test', 'the program field continues on the next line');
const resumedLines = buildLaunch({
  program: 'claude',
  args: '',
  shell: 'direct',
  resumeRecent: 'claude --continue\ndir',
  resumeSpecific: '',
  mode: 'resumeRecent',
  cliHint: '',
});
assert(resumedLines.file === 'cmd.exe' && resumedLines.args[2] === 'claude --continue && dir', 'a resume command continues on the next line');
assert(commandLines('a\n\n"b\nc"\nd').join('|') === 'a|"b\nc"|d', 'quoted newlines stay inside one command');

const shimPaths = ['C:\\npm\\claude', 'C:\\npm\\claude.cmd'];
assert(chooseProgram(shimPaths) === 'C:\\npm\\claude.cmd', 'Windows prefers the cmd shim over the shell script');
assert(chooseProgram(['C:\\npm\\claude.exe', 'C:\\npm\\claude.cmd']) === 'C:\\npm\\claude.exe', 'Windows prefers an executable');
assert(chooseProgram(['/usr/local/bin/claude']) === '/usr/local/bin/claude', 'a single program path is kept');
assert(exeQuotedInCmd('"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*', 'C:\\npm\\claude.cmd') === 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe', 'npm cmd shim points at the real executable');

const wrapped = wrapShellScript('C:\\npm\\claude.cmd', ['--verbose'], 'win32', 'C:\\Windows\\System32\\cmd.exe');
assert(wrapped.file === 'C:\\Windows\\System32\\cmd.exe', 'cmd shim wrapper');
assert(wrapped.args[0] === '/d' && wrapped.args[1] === '/c' && wrapped.args[2] === 'C:\\npm\\claude.cmd', 'cmd shim args');

for (const template of TEMPLATES) {
  const blob = JSON.stringify(template).toLowerCase();
  assert(!blob.includes('brew install'), `${template.id} must not suggest brew install`);
  assert(!blob.includes('dangerously'), `${template.id} must not add permission skips`);
  assert(!blob.includes('skip-permissions'), `${template.id} must not add permission skips`);
  assert(!blob.includes('--yolo'), `${template.id} must not add yolo`);
  assert(!blob.includes('--auto'), `${template.id} must not add auto approve`);
  assert(template.website.startsWith('https://'), `${template.id} links to its official site`);
}

const gitBash = TEMPLATES.find((template) => template.id === 'git-bash');
assert(gitBash?.program === 'bash.exe' && gitBash.args === '--login -i', 'Git Bash opens a login shell from Git for Windows');
assert(gitBashCandidates().some((file) => file.endsWith(`${path.sep}Git${path.sep}bin${path.sep}bash.exe`)), 'Git Bash candidates stay inside a Git install');
const cursor = TEMPLATES.find((template) => template.id === 'cursor');
assert(cursor?.program === 'agent' && cursor.resumeRecent === 'agent resume' && cursor.resumeSpecific === 'agent --resume {id}', 'Cursor CLI uses the agent command');
const cursorHint = installHint('cursor', 'agent', 'win32');
assert(cursorHint?.command === "irm 'https://cursor.com/install?win32=true' | iex", 'Windows Cursor CLI install command');
const windowsHint = installHint('claude', 'claude', 'win32');
assert(windowsHint?.command.includes('irm https://claude.ai/install.ps1'), 'Windows Claude install command');
assert(!JSON.stringify(windowsHint).toLowerCase().includes('brew install'), 'Windows hint is not brew');
assert(commandIcon({ name: 'Claude Code', kind: 'claude' }).text === 'C', 'known commands keep their icon');
assert(lettersFromName('My Tool') === 'MT' && commandIcon({ name: 'codex' }).text === 'CO', 'other icons come from the name');
assert(commandIcon({ name: '업무용 Codex' }).text === '업C', 'mixed names use the first letter of each word');
assert(commandIcon({ name: 'Claude', kind: 'claude', iconText: 'QA', iconColor: '#112233' }).text === 'QA', 'a chosen icon letter replaces the automatic one');
assert(commandIcon({ name: 'Claude', kind: 'claude', iconText: 'QA', iconColor: '#112233' }).color === '#112233', 'a chosen icon color is kept');
assert(commandIcon({ name: 'Claude', iconImage: 'data:text/plain,hi' }).image === undefined, 'only image files become the icon');
const macShells = templatesFor('darwin').map((template) => template.id);
assert(macShells.includes('zsh') && macShells.includes('brew'), 'Mac lists zsh and Homebrew');
assert(!macShells.some((id) => ['powershell', 'pwsh', 'git-bash', 'cmd'].includes(id)), 'Mac hides Windows shells');
assert(templatesFor('win32').some((template) => template.id === 'cmd') && !templatesFor('win32').some((template) => template.id === 'brew'), 'Windows keeps Command Prompt');
const macHint = installHint('codex', 'codex', 'darwin');
assert(macHint?.command === '', 'non-Windows gets no install command');
assert(!JSON.stringify(macHint).toLowerCase().includes('brew'), 'non-Windows hint does not mention brew');

assert(resolveLanguage('auto', 'ko-KR') === 'ko', 'Korean user language');
assert(resolveLanguage('auto', 'ja') === 'ja', 'Japanese user language');
assert(resolveLanguage('auto', 'zh-CN') === 'zh', 'Chinese user language');
assert(resolveLanguage('auto', 'en-US') === 'en', 'English user language');
assert(resolveLanguage('ja', 'ko-KR') === 'ja', 'explicit language overrides the user language');
assert(resolveLanguage('auto', 'fr-FR') === 'en', 'unsupported user language falls back to English');

setLanguage('en');
const banner = bannerFor('run', 'claude', new Date('2026-01-02T03:04:00'));
assert(banner.includes('does not restore the previous conversation'), 'banner follows the selected language');
assert(banner.includes('claude'), 'banner keeps the command');
const englishHint = installHint('claude', 'claude', 'win32');
assert(englishHint?.title.includes('not on PATH') === true, 'install title follows the selected language');
assert(englishHint?.command.includes('irm https://claude.ai/install.ps1') === true, 'install command stays the official command');
const rewritten = localizedMissingProgram('실행 파일을 찾지 못했습니다: codex\n이전 안내', 'codex', 'codex', 'win32');
assert(rewritten.startsWith('The program was not found: codex'), 'a stored failure follows the current language');
assert(rewritten.includes('irm https://chatgpt.com/codex/install.ps1'), 'a stored failure keeps the install command');
assert(localizedMissingProgram('작업 폴더가 없습니다: C:\\a', 'codex', 'codex', 'win32').includes('작업 폴더'), 'other stored failures stay unchanged');
setLanguage('ko');

const sample = 'see C:\\foo\\bar.ts:12:3, src/main.ts:12, "C:\\Program Files\\app\\main.ts", and https://example.com/a/b';
const links = findPathLinks(sample);
const windows = links.find((link) => link.file === 'C:\\foo\\bar.ts');
assert(windows?.line === 12 && windows.column === 3, 'windows path keeps the line and column');
const relative = links.find((link) => link.file === 'src/main.ts');
assert(relative?.line === 12, 'relative path keeps the line');
assert(links.some((link) => link.file === 'C:\\Program Files\\app\\main.ts'), 'quoted path keeps spaces');
assert(!links.some((link) => link.file.includes('example.com')), 'web addresses are not file links');

console.log('selftest ok');
