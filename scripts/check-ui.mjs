import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'check-output', 'ui');
await fs.mkdir(out, { recursive: true });
const theme = `:root{--vscode-foreground:#222;--vscode-sideBar-background:#fff;--vscode-editor-background:#fff;--vscode-editor-foreground:#222;--vscode-descriptionForeground:#666;--vscode-widget-border:#ddd;--vscode-input-background:#fff;--vscode-input-foreground:#222;--vscode-input-border:#ccc;--vscode-button-secondaryBackground:#eee;--vscode-button-secondaryForeground:#222;--vscode-button-background:#2869cb;--vscode-button-foreground:#fff;--vscode-list-activeSelectionBackground:#2869cb;--vscode-list-activeSelectionForeground:#fff;--vscode-focusBorder:#2869cb}`;
const fixture = `window.__sent=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__sent.push(m)}});`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${theme}</style><link rel="stylesheet" href="/media/xterm.css"><link rel="stylesheet" href="/media/main.css"></head><body><div id="app"></div><script>${fixture}</script><script src="/media/main.js"></script></body></html>`);
    } else if (['/media/main.js', '/media/main.css', '/media/xterm.css'].includes(req.url)) {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(await fs.readFile(path.join(root, req.url)));
    } else { res.statusCode = 404; res.end(); }
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const profile = { id: '11111111-1111-4111-8111-111111111111', name: '업무 CLI', program: 'custom-cli', args: '', cwd: 'C:\\Work', env: [], shell: 'direct', resumeRecent: 'custom-cli --continue', resumeSpecific: 'custom-cli --resume {id}' };
const sessions = [0, 1].map((index) => ({ id: `${index + 2}2222222-2222-4222-8222-222222222222`, name: `작업 ${index + 1}`, profileId: profile.id, cwd: profile.cwd, attached: true, status: 'running', runMode: 'fresh', exitReason: null, cliHint: '', lastCommand: '', lastError: null }));

async function send(page, message) {
  await page.evaluate((data) => window.postMessage(data, '*'), message);
  await page.waitForTimeout(40);
}
async function messages(page, type) {
  return page.evaluate((kind) => window.__sent.filter((message) => message.type === kind), type);
}
async function oneScreen(page) {
  assert.equal(await page.locator('.screen:visible').count(), 1, 'exactly one screen is visible');
  const dimensions = await page.evaluate(() => ({ body: document.body.scrollHeight, viewport: innerHeight, width: document.body.scrollWidth, viewportWidth: innerWidth }));
  assert.ok(dimensions.body <= dimensions.viewport + 1, JSON.stringify(dimensions));
  assert.ok(dimensions.width <= dimensions.viewportWidth + 1, JSON.stringify(dimensions));
}
try {
  const channel = process.env.PLAYWRIGHT_CHANNEL;
  const engines = channel ? { [channel]: chromium } : { chromium, webkit };
  for (const [name, engine] of Object.entries(engines)) {
    const browser = await engine.launch({ headless: true, ...(channel ? { channel } : {}) });
    try {
      const context = await browser.newContext({ viewport: { width: 440, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      assert.equal(await page.getByRole('tab', { name: '새 작업', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('.top .icon-button').innerText(), '+', 'the toolbar uses tabs / + / menu');
      assert.equal(await page.locator('.top .register-cli').count(), 0, 'CLI registration belongs above the agents, outside the tab bar');
      assert.equal(await page.getByRole('button', { name: 'Claude Code', exact: true }).isVisible(), true, 'the first load shows agents before any host state or user click');
      await page.locator('.agent-home').getByRole('button', { name: 'Claude Code 공식 사이트', exact: true }).click();
      assert.equal((await messages(page, 'openExternal')).at(-1).url, 'https://code.claude.com/docs');
      assert.equal((await messages(page, 'startFromTemplate')).length, 0, 'the site icon does not start the command');
      await send(page, { type: 'state', profiles: [], sessions: [], activeSessionId: null, backend: 'offline', backendNote: 'private backend status', defaultCwd: 'C:\\Work', installedTemplateIds: ['claude', 'powershell', 'cmd'] });
      const claudeRow = page.locator('.agent-home .agent-option', { hasText: 'Claude Code' });
      const codexRow = page.locator('.agent-home .agent-option', { hasText: 'Codex' });
      assert.equal(await claudeRow.locator('.install-status').getAttribute('data-tip'), '설치됨');
      assert.equal(await codexRow.locator('.install-status').getAttribute('data-tip'), '미설치');
      assert.equal(await claudeRow.locator('.install-status').innerText(), '');
      const installButton = codexRow.getByRole('button', { name: 'Codex 설치', exact: true });
      const installBox = await installButton.boundingBox();
      const statusBox = await codexRow.locator('.install-status').boundingBox();
      const commandBox = await codexRow.locator('.agent-command').boundingBox();
      assert.ok(installBox.x + installBox.width <= statusBox.x, 'the install button sits to the left of the status');
      assert.ok(installBox.y + installBox.height <= commandBox.y + 1, 'install controls stay on the label line');
      assert.equal(await claudeRow.getByRole('button', { name: 'Claude Code 삭제', exact: true }).isVisible(), true);
      const promptName = page.getByRole('button', { name: '명령 프롬프트', exact: true });
      const promptMetrics = await promptName.evaluate((node) => ({ scroll: node.scrollHeight, client: node.clientHeight }));
      assert.ok(promptMetrics.scroll <= promptMetrics.client + 1, 'a long command name stays on one line');
      await oneScreen(page);
      assert.equal(await page.locator('.agent-home:visible').count(), 1);
      assert.equal(await page.locator('.agent-home details.agent-drawer[open]').count(), 1, 'the first screen already shows the expanded agent list');
      assert.equal(await page.getByRole('button', { name: 'Claude Code', exact: true }).isVisible(), true, 'no launch choice or + click is required to see agents');
      assert.equal(await page.getByRole('button', { name: '에이전트 선택', exact: true }).count(), 0, 'the intermediate agent-selection button is removed');
      assert.equal(await page.locator('.term:visible').count(), 0);
      assert.equal(await page.getByText('private backend status').count(), 0);
      await page.screenshot({ path: path.join(out, `${name}-empty.png`) });
      const registerBounds = await page.getByRole('button', { name: '새 CLI 추가', exact: true }).boundingBox();
      const drawerBounds = await page.locator('.agent-home .agent-drawer').boundingBox();
      assert.ok(registerBounds.y + registerBounds.height <= drawerBounds.y, 'CLI registration is immediately above the agents');
      assert.equal(await page.locator('.agent-home .agent-drawer > summary').innerText().then((value) => value.includes('커맨드')), true);
      const settingsButton = page.getByRole('button', { name: '커맨드 환경 설정', exact: true });
      const settingsBounds = await settingsButton.boundingBox();
      const plusBounds = await page.getByRole('button', { name: '작업 추가', exact: true }).boundingBox();
      const lastTabBounds = await page.getByRole('tab').last().boundingBox();
      assert.ok(plusBounds.x >= lastTabBounds.x + lastTabBounds.width && plusBounds.x - lastTabBounds.x - lastTabBounds.width <= 6, '+ sits immediately after the last tab');
      assert.ok(settingsBounds.y >= drawerBounds.y && settingsBounds.y < drawerBounds.y + 50, 'command settings remain in the command heading');
      assert.equal(await page.locator('.top .command-settings').count(), 0, 'command settings are not attached to +');
      await settingsButton.click();
      assert.equal(await page.getByRole('heading', { name: '커맨드 관리', exact: true }).isVisible(), true);
      const managed = page.locator('.editor');
      assert.equal(await managed.getByRole('heading', { name: '기본 커맨드', exact: true }).isVisible(), true);
      const builtinScroll = managed.locator('.builtin-scroll');
      const scrollMetrics = await builtinScroll.evaluate((node) => {
        const page = node.closest('.editor');
        return { scroll: node.scrollHeight, client: node.clientHeight, editorScroll: page.scrollHeight, editorClient: page.clientHeight };
      });
      assert.ok(scrollMetrics.scroll > scrollMetrics.client, 'built-in commands scroll inside their section');
      assert.ok(scrollMetrics.editorScroll <= scrollMetrics.editorClient + 1, 'the command page itself stays fixed');
      await builtinScroll.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      assert.equal(await managed.getByRole('heading', { name: '커맨드 관리', exact: true }).isVisible(), true);
      assert.equal(await managed.getByRole('heading', { name: '기본 커맨드', exact: true }).isVisible(), true);
      assert.equal(await managed.getByRole('button', { name: '명령 프롬프트', exact: true }).isVisible(), true);
      await builtinScroll.evaluate((node) => { node.scrollTop = 0; });
      assert.equal(await managed.getByRole('button', { name: 'Claude Code 리셋', exact: true }).isDisabled(), true, 'an untouched built-in command has nothing to reset');
      const deleteBounds = await managed.getByRole('button', { name: 'Claude Code 삭제', exact: true }).boundingBox();
      const hideBounds = await managed.getByRole('button', { name: 'Claude Code 비표시', exact: true }).boundingBox();
      assert.ok(deleteBounds.x + deleteBounds.width <= hideBounds.x, 'delete sits to the left of hide');
      await managed.getByRole('button', { name: 'Claude Code 비표시', exact: true }).click();
      assert.equal((await messages(page, 'setTemplateHidden')).at(-1).hidden, true);
      assert.equal((await messages(page, 'setTemplateHidden')).at(-1).id, 'claude');
      await send(page, { type: 'state', profiles: [], sessions: [], activeSessionId: null, backend: 'offline', hiddenTemplateIds: ['claude'], removedTemplateIds: [] });
      assert.equal(await managed.getByRole('button', { name: 'Claude Code 표시', exact: true }).isVisible(), true);
      await page.getByRole('button', { name: '뒤로', exact: true }).click();
      assert.equal(await page.locator('.agent-home').getByRole('button', { name: 'Claude Code', exact: true }).count(), 0, 'a hidden built-in command leaves the home list');
      await page.getByRole('button', { name: '커맨드 환경 설정', exact: true }).click();
      await managed.getByRole('button', { name: 'Claude Code 표시', exact: true }).click();
      await send(page, { type: 'state', profiles: [], sessions: [], activeSessionId: null, backend: 'offline', hiddenTemplateIds: [], removedTemplateIds: [] });
      await managed.getByRole('button', { name: 'PowerShell 삭제', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click();
      assert.equal((await messages(page, 'removeTemplate')).at(-1).id, 'powershell');
      await send(page, { type: 'state', profiles: [], sessions: [], activeSessionId: null, backend: 'offline', hiddenTemplateIds: [], removedTemplateIds: ['powershell'] });
      assert.equal(await managed.getByRole('button', { name: 'PowerShell', exact: true }).count(), 0);
      await managed.getByRole('button', { name: 'PowerShell 복원', exact: true }).click();
      await send(page, { type: 'state', profiles: [], sessions: [], activeSessionId: null, backend: 'offline' });
      await page.getByRole('button', { name: '뒤로', exact: true }).click();
      assert.equal(await page.locator('.agent-home').getByRole('button', { name: 'Claude Code', exact: true }).isVisible(), true);
      assert.equal(await page.locator('.agent-home').getByRole('button', { name: 'PowerShell', exact: true }).isVisible(), true);
      assert.equal(await page.locator('.agent-home').getByRole('button', { name: 'PowerShell 7', exact: true }).isVisible(), true);
      assert.equal(await page.locator('.agent-home').getByRole('button', { name: 'Git Bash', exact: true }).isVisible(), true);
      await page.getByRole('button', { name: '커맨드 환경 설정', exact: true }).click();
      await managed.getByRole('button', { name: 'Claude Code', exact: true }).click();
      assert.equal(await page.getByRole('heading', { name: 'CLI 편집', exact: true }).isVisible(), true);
      const editFit = await page.locator('.editor.edits-command .form-scroll').evaluate((node) => ({
        vertical: node.scrollHeight - node.clientHeight,
        horizontal: node.scrollWidth - node.clientWidth,
        field: node.querySelector('[data-field="program"]').getBoundingClientRect().width,
      }));
      assert.ok(editFit.vertical <= 1, `the edit form fits without scrolling (${editFit.vertical})`);
      assert.ok(editFit.horizontal <= 1, `the edit form stays within its width (${editFit.horizontal})`);
      await page.getByText('고급 설정', { exact: true }).click();
      const openedWidth = await page.locator('.editor.edits-command [data-field="program"]').evaluate((node) => node.getBoundingClientRect().width);
      assert.ok(Math.abs(openedWidth - editFit.field) <= 1, `opening advanced keeps the field width (${editFit.field} -> ${openedWidth})`);
      const shellFit = await page.locator('.editor.edits-command').evaluate((editor) => {
        const scroll = editor.querySelector('.form-scroll');
        const select = scroll.querySelector('select');
        const scrollBox = scroll.getBoundingClientRect();
        const selectBox = select.getBoundingClientRect();
        const field = scroll.querySelector('[data-field="cwd"]');
        const fieldBox = field.getBoundingClientRect();
        return {
          selectRight: selectBox.right,
          visibleRight: scrollBox.left + scroll.clientWidth,
          fieldLeft: fieldBox.left,
          visibleLeft: scrollBox.left,
          scrollLeft: scroll.scrollLeft,
          width: scroll.scrollWidth - scroll.clientWidth,
        };
      });
      assert.ok(shellFit.scrollLeft === 0, `the form does not shift left (${JSON.stringify(shellFit)})`);
      assert.ok(shellFit.fieldLeft >= shellFit.visibleLeft - 1, `the left edge stays visible (${JSON.stringify(shellFit)})`);
      assert.ok(shellFit.selectRight <= shellFit.visibleRight + 1, `the shell menu arrow stays inside the form (${JSON.stringify(shellFit)})`);
      assert.ok(shellFit.width <= 1, `advanced settings stay within the form width (${shellFit.width})`);
      assert.equal(await page.getByLabel('실행 프로그램', { exact: true }).inputValue(), 'claude');
      assert.equal(await page.getByLabel('실행 인수', { exact: true }).inputValue(), '');
      assert.equal(await page.getByRole('button', { name: 'Claude Code 리셋', exact: true }).isVisible(), true);
      await page.getByLabel('표시 이름', { exact: true }).fill('작업용 Claude');
      await page.getByLabel('글자', { exact: true }).fill('QA');
      await page.getByLabel('색', { exact: true }).fill('#112233');
      await page.getByLabel('실행 인수', { exact: true }).fill('--debug');
      await page.getByRole('button', { name: '저장', exact: true }).click();
      const builtinSave = (await messages(page, 'saveProfile')).at(-1);
      assert.equal(builtinSave.profile.origin, 'template');
      assert.equal(builtinSave.profile.templateId, 'claude');
      assert.equal(builtinSave.profile.customized, true);
      assert.equal(builtinSave.profile.name, '작업용 Claude');
      assert.equal(builtinSave.profile.args, '--debug');
      assert.equal(builtinSave.profile.iconText, 'QA');
      assert.equal(builtinSave.profile.iconColor, '#112233');
      assert.equal(builtinSave.profile.iconImage, undefined);
      const builtinProfile = { id: 'builtin-claude', origin: 'template', templateId: 'claude', name: '작업용 Claude', program: 'claude', args: '--debug', shell: 'direct', cwd: '', env: [], resumeRecent: 'claude --continue', resumeSpecific: 'claude --resume {id}', iconText: 'QA', iconColor: '#112233', customized: true, createdAt: 1, updatedAt: 2 };
      await send(page, { type: 'state', profiles: [builtinProfile], sessions: [], activeSessionId: null, backend: 'offline' });
      await page.getByRole('button', { name: '뒤로', exact: true }).click();
      assert.equal(await page.locator('.agent-home').getByRole('button', { name: '작업용 Claude', exact: true }).isVisible(), true, 'an edited built-in command keeps its place on the home list');
      assert.equal(await page.locator('.agent-home .agent-option', { hasText: '작업용 Claude' }).locator('.agent-avatar').innerText(), 'QA');
      assert.equal(await page.locator('.agent-home').getByRole('button', { name: 'Claude Code', exact: true }).count(), 0);
      await page.getByRole('button', { name: '커맨드 환경 설정', exact: true }).click();
      await managed.getByRole('button', { name: '작업용 Claude 리셋', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click();
      assert.equal((await messages(page, 'resetTemplate')).at(-1).id, 'claude');
      await send(page, { type: 'state', profiles: [], sessions: [], activeSessionId: null, backend: 'offline' });
      assert.equal(await managed.getByRole('button', { name: 'Claude Code', exact: true }).isVisible(), true, 'reset restores the original built-in command');
      assert.equal(await managed.getByRole('button', { name: 'Claude Code 리셋', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: '뒤로', exact: true }).click();
      await page.getByRole('button', { name: '커맨드 환경 설정', exact: true }).click();
      await send(page, { type: 'state', profiles: [profile], sessions: [], activeSessionId: null, backend: 'offline' });
      assert.equal(await page.getByRole('heading', { name: '사용자 정의 커맨드', exact: true }).isVisible(), true);
      await page.getByRole('button', { name: profile.name, exact: true }).click();
      assert.equal(await page.getByLabel('실행 프로그램', { exact: true }).inputValue(), profile.program, 'registered non-agent CLIs are editable from command settings');
      await page.getByLabel('표시 이름', { exact: true }).fill('이름 변경한 CLI');
      await page.getByRole('button', { name: '저장', exact: true }).click();
      const managedSave = (await messages(page, 'saveProfile')).at(-1);
      assert.equal(managedSave.profile.id, profile.id);
      assert.equal(managedSave.profile.name, '이름 변경한 CLI');
      await send(page, { type: 'state', profiles: [{ ...profile, name: '이름 변경한 CLI' }], sessions: [], activeSessionId: null, backend: 'offline' });
      await page.getByRole('button', { name: '뒤로', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: '이름 변경한 CLI', exact: true }).isVisible(), true, 'the renamed command is shown in the main list');
      assert.equal(await page.getByRole('heading', { name: '사용자 정의 커맨드', exact: true }).isVisible(), true, 'saved commands stay under the custom heading');
      await page.getByRole('button', { name: '커맨드 환경 설정', exact: true }).click();
      await page.screenshot({ path: path.join(out, `${name}-command-settings.png`) });
      await page.getByRole('button', { name: '이름 변경한 CLI 삭제', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click();
      assert.equal((await messages(page, 'deleteProfile')).at(-1).id, profile.id);
      await send(page, { type: 'state', profiles: [], sessions: [], activeSessionId: null, backend: 'offline' });
      assert.equal(await page.getByRole('button', { name: '이름 변경한 CLI', exact: true }).count(), 0, 'settings refresh after deletion');
      await page.getByRole('button', { name: '뒤로', exact: true }).click();

      await page.getByRole('button', { name: '새 CLI 추가', exact: true }).click();
      assert.equal(await page.getByRole('tablist', { name: '작업 탭' }).isVisible(), true, 'tabs remain visible during registration');
      assert.equal(await page.locator('.profile-form:visible').count(), 1, 'registration also opens directly from the first screen');
      await page.getByRole('button', { name: '뒤로', exact: true }).click();
      assert.equal(await page.locator('.agent-home:visible').count(), 1);

      await page.getByRole('button', { name: 'Claude Code', exact: true }).click();
      assert.equal((await messages(page, 'startFromTemplate')).at(-1).id, 'claude', 'a built-in command starts with its saved defaults');
      assert.equal(await page.locator('.profile-form:visible').count(), 0, 'a built-in command does not open the registration form');
      assert.equal(await page.locator('.agent-home:visible').count(), 1);
      await oneScreen(page);
      assert.equal(await page.locator('details.agent-drawer[open]:visible').count(), 1, 'the agent drawer is expanded');
      assert.equal(await page.getByRole('button', { name: 'Claude Code', exact: true }).isVisible(), true);
      assert.equal(await page.locator('.term:visible').count(), 0);
      await page.screenshot({ path: path.join(out, `${name}-add.png`) });
      await page.locator('.agent-home .agent-drawer > summary').click();
      assert.equal(await page.getByRole('button', { name: 'Claude Code', exact: true }).isVisible(), false);
      assert.equal(await page.getByRole('button', { name: '새 CLI 추가', exact: true }).isVisible(), true, 'new CLI remains available when the agent drawer is collapsed');
      await page.locator('.agent-home .agent-drawer > summary').click();
      for (const agent of ['Claude Code', 'Codex', 'Cursor CLI', 'OpenCode', 'Antigravity', 'Devin']) {
        assert.equal(await page.getByRole('button', { name: agent, exact: true }).filter({ visible: true }).count(), 1);
      }
      await page.getByRole('button', { name: '새 CLI 추가', exact: true }).click();
      assert.equal(await page.locator('.advanced-settings[open]').count(), 0, 'advanced options start collapsed');
      assert.equal(await page.getByLabel('최근 작업 재개 명령', { exact: true }).isVisible(), false);
      assert.equal(await page.getByRole('button', { name: '저장하고 시작', exact: true }).isVisible(), true, 'footer actions are visible without scrolling');
      await page.getByLabel('표시 이름', { exact: true }).fill('사용자 CLI');
      await page.getByLabel('링크', { exact: true }).fill('example.com/cli');
      const programField = page.getByLabel('실행 프로그램', { exact: true });
      assert.equal(await programField.evaluate((node) => node.tagName), 'TEXTAREA', 'the program command accepts more than one line');
      await programField.fill('my-cli');
      await programField.press('Enter');
      assert.equal(await programField.inputValue(), 'my-cli\n', 'Enter inserts a newline in the program command');
      await programField.fill('my-cli');
      assert.equal(await page.getByLabel('실행 인수', { exact: true }).evaluate((node) => node.tagName), 'TEXTAREA', 'the command accepts more than one line');
      await page.getByLabel('실행 인수', { exact: true }).fill('--project "my work"\n다음 명령');
      await page.screenshot({ path: path.join(out, `${name}-register.png`) });
      const dark = await page.addStyleTag({ content: ':root{--vscode-foreground:#ddd;--vscode-sideBar-background:#181b20;--vscode-editor-background:#181b20;--vscode-descriptionForeground:#a1a6af;--vscode-widget-border:#ffffff20;--vscode-input-background:#22262d;--vscode-input-foreground:#eee;--vscode-input-border:#454b55;--vscode-input-placeholderForeground:#9da3ae;--vscode-button-secondaryBackground:#333941;--vscode-button-secondaryForeground:#eee;--vscode-button-background:#3674ce;--vscode-button-foreground:#fff}' });
      await page.screenshot({ path: path.join(out, `${name}-register-dark.png`) });
      await dark.evaluate((element) => element.remove());
      await page.locator('.advanced-settings > summary').click();
      await page.getByLabel('최근 작업 재개 명령', { exact: true }).fill('my-cli --continue');
      await page.getByRole('button', { name: '＋ 변수 추가', exact: true }).click();
      await page.getByLabel('환경 변수 이름', { exact: true }).fill('WORK_MODE');
      await page.getByLabel('환경 변수 값', { exact: true }).fill('review');
      await page.locator('.advanced-settings > summary').click();
      await page.setViewportSize({ width: 320, height: 640 });
      await oneScreen(page);
      assert.equal(await page.getByRole('button', { name: '저장하고 시작', exact: true }).isVisible(), true);
      await page.screenshot({ path: path.join(out, `${name}-register-narrow.png`) });
      await page.setViewportSize({ width: 440, height: 780 });
      await page.getByRole('button', { name: '저장', exact: true }).click();
      let saved = (await messages(page, 'saveProfile')).at(-1);
      assert.equal(saved.profile.program, 'my-cli');
      assert.equal(saved.profile.website, 'example.com/cli', 'a custom command can store a link');
      assert.equal(saved.profile.args, '--project "my work"\n다음 명령', 'a command can continue on the next line');
      assert.equal(saved.profile.resumeRecent, 'my-cli --continue', 'collapsed advanced values are saved');
      assert.deepEqual(saved.profile.env, [{ key: 'WORK_MODE', value: 'review' }]);
      assert.equal(saved.startName, undefined, 'saving alone does not run a program');
      await send(page, { type: 'saved', profileId: profile.id, formToken: saved.formToken });
      assert.equal(await page.locator('.toast:visible').count(), 1, 'save feedback is visible in edit screen');
      await page.getByLabel('표시 이름', { exact: true }).fill('수정한 이름');
      await page.getByRole('button', { name: '저장', exact: true }).click();
      saved = (await messages(page, 'saveProfile')).at(-1);
      assert.equal(saved.profile.id, profile.id, 'repeated save updates the existing profile');

      await send(page, { type: 'state', profiles: [profile], sessions, activeSessionId: sessions[0].id, backend: 'daemon' });
      await send(page, { type: 'started' });
      await oneScreen(page);
      assert.equal(await page.locator('.composer textarea:visible').count(), 1);
      assert.equal(await page.getByLabel('대화·작업 재개 ID').count(), 0, 'management fields stay out of the main terminal');
      assert.equal(await page.getByRole('tab').count(), 2);
      const firstTab = page.getByRole('tab', { name: sessions[0].name, exact: true });
      const closeTab = firstTab.getByRole('button', { name: `${sessions[0].name} 닫기`, exact: true });
      const tabBox = await firstTab.boundingBox();
      const closeBox = await closeTab.boundingBox();
      assert.ok(closeBox.x + closeBox.width <= tabBox.x + tabBox.width + 1 && closeBox.x > tabBox.x + tabBox.width / 2, 'each task tab has a close button on its right');
      await page.getByRole('tab', { name: sessions[1].name, exact: true }).click();
      assert.equal((await messages(page, 'selectSession')).at(-1).sessionId, sessions[1].id, 'clicking a tab selects that task directly');
      await send(page, { type: 'state', profiles: [profile], sessions, activeSessionId: sessions[1].id, backend: 'daemon' });
      assert.equal(await page.getByRole('tab', { name: sessions[1].name, exact: true }).getAttribute('aria-selected'), 'true');
      await page.getByRole('button', { name: '작업 추가', exact: true }).click();
      assert.equal(await page.getByRole('tab', { name: '새 작업', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('.agent-home details[open]').isVisible(), true, '+ directly opens an expanded new-task tab');
      await page.getByRole('tab', { name: sessions[0].name, exact: true }).click();
      await send(page, { type: 'state', profiles: [profile], sessions, activeSessionId: sessions[0].id, backend: 'daemon' });
      for (const control of [page.locator('.top .icon-button'), page.locator('.top .location summary')]) {
        const bounds = await control.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 440, `tab bar action must stay visible: ${JSON.stringify(bounds)}`);
      }
      const strip = await page.locator('.session-tabs').evaluate((node) => ({ strip: node.offsetHeight, tab: node.querySelector('.session-tab')?.offsetHeight ?? 0 }));
      assert.ok(Math.abs(strip.strip - strip.tab) <= 1, 'the tab strip has no scrollbar');
      const crowded = [0, 1, 2, 3, 4, 5].map((index) => ({ ...sessions[0], id: `${index + 3}3333333-3333-4333-8333-33333333333${index}`, name: `탭 ${index + 1}` }));
      await send(page, { type: 'state', profiles: [profile], sessions: crowded, activeSessionId: crowded[0].id, backend: 'daemon' });
      const visibleTabs = await page.locator('.session-tab').evaluateAll((nodes) => {
        const strip = document.querySelector('.session-tabs').getBoundingClientRect();
        return nodes.filter((node) => {
          const box = node.getBoundingClientRect();
          return box.left >= strip.left - 1 && box.right <= strip.right + 1;
        }).length;
      });
      assert.ok(visibleTabs >= 3, 'compact tabs show several at once');
      const nextTab = page.getByRole('button', { name: '다음 탭', exact: true });
      assert.equal(await nextTab.isVisible(), true, 'overflowing tabs offer a next arrow');
      const fromTab = await page.getByRole('tab', { name: crowded[1].name, exact: true }).boundingBox();
      const toTab = await page.getByRole('tab', { name: crowded[0].name, exact: true }).boundingBox();
      await page.mouse.move(fromTab.x + 30, fromTab.y + fromTab.height / 2);
      await page.mouse.down();
      await page.mouse.move(toTab.x + 30, toTab.y + toTab.height / 2, { steps: 12 });
      await page.mouse.up();
      assert.equal((await messages(page, 'reorderSessions')).at(-1).ids[0], crowded[1].id, 'dragging a tab reorders the tasks');
      const before = await page.locator('.session-tabs').evaluate((node) => node.scrollLeft);
      await nextTab.click();
      const after = await page.locator('.session-tabs').evaluate((node) => node.scrollLeft);
      assert.ok(after > before, 'the next arrow moves the tabs');
      await send(page, { type: 'state', profiles: [profile], sessions, activeSessionId: sessions[0].id, backend: 'daemon' });
      await page.screenshot({ path: path.join(out, `${name}-tabs.png`) });
      await page.locator('.location summary').click();
      await page.getByRole('button', { name: '작업 목록', exact: true }).click();
      await page.screenshot({ path: path.join(out, `${name}-list.png`) });
      assert.equal(await page.getByRole('button', { name: '현재 작업 보존', exact: true }).count(), 0, 'preserve stays on the day, not the list header');
      const todayHeading = await page.getByRole('heading', { name: '오늘', exact: true }).boundingBox();
      const todayPreserve = await page.getByRole('button', { name: '오늘 보존', exact: true }).boundingBox();
      assert.ok(todayHeading && todayPreserve && todayPreserve.x >= todayHeading.x + todayHeading.width - 2 && Math.abs(todayPreserve.y - todayHeading.y) < 24, 'each day has a visible preserve button');
      await page.getByRole('button', { name: '오늘 보존', exact: true }).click();
      assert.deepEqual((await messages(page, 'setSessionsPreserved')).at(-1).sessionIds, sessions.map((item) => item.id));
      assert.equal((await messages(page, 'setSessionsPreserved')).at(-1).preserved, true);
      assert.equal(await page.getByRole('button', { name: `${sessions[0].name} 보존`, exact: true }).count(), 0, 'a task row does not repeat the day preserve button');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);
      const kept = sessions.map((item, index) => index === 0 ? { ...item, preserved: true, createdAt: yesterday.getTime() } : { ...item, createdAt: Date.now() });
      await send(page, { type: 'state', profiles: [profile], sessions: kept, activeSessionId: sessions[0].id, backend: 'daemon' });
      assert.equal(await page.getByRole('heading', { name: '어제', exact: true }).isVisible(), true, 'preserved tasks stay grouped by day');
      await page.getByRole('button', { name: '어제 복원', exact: true }).click();
      assert.deepEqual((await messages(page, 'setSessionsPreserved')).at(-1).sessionIds, [sessions[0].id]);
      assert.equal((await messages(page, 'setSessionsPreserved')).at(-1).preserved, false);
      assert.equal(await page.getByRole('button', { name: `${sessions[0].name} 복원`, exact: true }).count(), 0, 'a task row does not repeat the day restore button');
      await send(page, { type: 'state', profiles: [profile], sessions, activeSessionId: sessions[0].id, backend: 'daemon' });
      const longTask = sessions.map((item, index) => index === 1 ? { ...item, name: 'Claude Code 1' } : item);
      await send(page, { type: 'state', profiles: [profile], sessions: longTask, activeSessionId: sessions[0].id, backend: 'daemon' });
      const taskLines = await page.locator('.session .name', { hasText: 'Claude Code 1' }).evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getClientRects().length;
      });
      assert.equal(taskLines, 1, 'a task name stays on one line');
      await send(page, { type: 'state', profiles: [profile], sessions, activeSessionId: sessions[0].id, backend: 'daemon' });
      const taskSearch = page.getByRole('searchbox', { name: '작업 검색', exact: true });
      await taskSearch.fill('작업 2');
      assert.equal(await page.locator('.session').count(), 1, 'task search keeps only the matching task');
      await taskSearch.fill('');
      assert.equal(await page.locator('.session').count(), 2);
      const firstHandle = page.locator('.drag-handle').first();
      await firstHandle.focus();
      await firstHandle.press('ArrowDown');
      assert.deepEqual((await messages(page, 'reorderSessions')).at(-1).ids, [sessions[1].id, sessions[0].id]);
      // Pointer drag follows the same path on desktop and touch handles.
      const from = await page.locator('.drag-handle').first().boundingBox();
      const to = await page.locator('.session').last().boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
      await page.mouse.up();
      assert.deepEqual((await messages(page, 'reorderSessions')).at(-1).ids, sessions.map((session) => session.id));
      await page.getByRole('button', { name: `${sessions[0].name} 설정`, exact: true }).click();
      await oneScreen(page);
      assert.equal(await page.getByLabel('대화·작업 재개 ID').count(), 1);
      await page.getByRole('button', { name: '중지', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '취소', exact: true }).click();
      assert.equal((await messages(page, 'stopSession')).length, 0, 'cancel leaves the running process alone');
      await page.getByRole('button', { name: '중지', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click();
      assert.equal((await messages(page, 'stopSession')).at(-1).sessionId, sessions[0].id);
      await page.getByRole('button', { name: '‹ 작업 목록', exact: true }).click();
      await page.getByRole('button', { name: `${sessions[1].name} 재연결`, exact: true }).click();
      assert.equal((await messages(page, 'reconnect')).at(-1).sessionId, sessions[1].id);
      assert.equal((await messages(page, 'rerun')).length, 0, 'refreshing a row does not restart the CLI');

      const composer = page.getByLabel('터미널에 보낼 내용');
      await composer.fill('첫 줄');
      await composer.press('End');
      await composer.press('Enter');
      assert.equal((await messages(page, 'input')).length, 0, 'Enter inserts a newline without executing');
      await composer.fill('첫 줄\n두 번째 줄');
      await page.getByRole('button', { name: '보내기', exact: true }).click();
      assert.equal((await messages(page, 'input')).at(-1).data, '\x1b[200~첫 줄\n두 번째 줄\x1b[201~\r');
      await composer.fill('입력 중');
      await composer.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true });
      assert.equal((await messages(page, 'input')).length, 1, 'IME confirmation never sends a command');
      await composer.press('Control+Enter');
      assert.equal((await messages(page, 'input')).at(-1).data, '입력 중\r');
      await page.getByRole('button', { name: '출력 검색', exact: true }).click();
      const outputSearch = page.getByRole('searchbox', { name: '출력 검색', exact: true });
      assert.equal(await outputSearch.isVisible(), true, 'output search opens over the terminal');
      await outputSearch.fill('없는 문장');
      await page.getByRole('button', { name: '검색 닫기', exact: true }).click();
      assert.equal(await outputSearch.isVisible(), false);
      await page.getByRole('button', { name: '직접 입력', exact: true }).click();
      assert.equal((await messages(page, 'directFocus')).at(-1).focused, true, 'direct input focuses the terminal');
      await page.locator('.xterm-helper-textarea').evaluate((node) => {
        node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      });
      assert.equal((await messages(page, 'input')).at(-1).data, '\x1b[A', 'arrow keys reach the process from direct input');

      await page.locator('.location summary').click();
      await page.getByRole('button', { name: 'Secondary Sidebar', exact: true }).click();
      assert.equal((await messages(page, 'setLocation')).at(-1).location, 'secondary');
      await page.setViewportSize({ width: 360, height: 400 });
      await oneScreen(page);
      const box = await composer.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 400, 'composer fits above the phone keyboard');

      const ended = sessions.map((item) => ({ ...item, attached: false, status: 'exited', exitReason: 'process-exit', exitCode: 193 }));
      await send(page, { type: 'state', profiles: [profile], sessions: ended, activeSessionId: sessions[0].id, backend: 'offline' });
      assert.equal(await page.locator('.term-closed:visible').count(), 1, 'a finished process explains why the keyboard is locked');
      const bannerBox = await page.locator('.term-closed').boundingBox();
      const termBox = await page.locator('.term').boundingBox();
      assert.ok(bannerBox && termBox && bannerBox.y <= termBox.y + 24, 'the closed notice sits at the top of the terminal');
      await page.locator('.term-closed').getByRole('button', { name: '새 실행', exact: true }).click();
      assert.equal((await messages(page, 'rerun')).at(-1).sessionId, sessions[0].id, 'the locked keyboard offers another run');
      const codexProfile = { ...profile, templateId: 'codex', program: 'codex', name: 'Codex' };
      const missing = ended.map((item, index) => index === 0 ? { ...item, profileId: codexProfile.id, exitReason: 'start-failed', lastError: '실행 파일을 찾지 못했습니다: codex\nWindows용 안내입니다.\nnpm install -g @openai/codex' } : item);
      await send(page, { type: 'state', profiles: [codexProfile], sessions: missing, activeSessionId: sessions[0].id, backend: 'offline' });
      assert.equal(await page.locator('.term-closed').getByText('실행 파일을 찾지 못했습니다: codex').isVisible(), true, 'a missing program explains the failure');
      assert.equal(await page.locator('.term-closed code').isVisible(), true, 'the install command is visible before it runs');
      await page.locator('.term-closed').getByRole('button', { name: '설치', exact: true }).click();
      assert.equal((await messages(page, 'installTemplate')).length, 0, 'install waits until the command is confirmed');
      await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click();
      assert.equal((await messages(page, 'installTemplate')).at(-1).id, 'codex', 'a missing program can run its install command');

      await page.locator('.location summary').click();
      await page.getByRole('button', { name: '환경설정', exact: true }).click();
      assert.equal(await page.getByRole('heading', { name: '환경설정', exact: true }).isVisible(), true);
      const language = page.getByRole('combobox', { name: '언어', exact: true });
      assert.equal(await language.inputValue(), 'auto');
      await language.selectOption('en');
      assert.equal((await messages(page, 'setUiLanguage')).at(-1).language, 'en');
      await send(page, { type: 'state', profiles: [profile], sessions, activeSessionId: sessions[0].id, backend: 'offline', uiLanguage: 'en' });
      assert.equal(await page.getByRole('heading', { name: 'Settings', exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('combobox', { name: 'Language', exact: true }).inputValue(), 'en');
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja');
      assert.equal((await messages(page, 'setUiLanguage')).at(-1).language, 'ja');
      await send(page, { type: 'state', profiles: [profile], sessions, activeSessionId: sessions[0].id, backend: 'offline', uiLanguage: 'ja' });
      assert.equal(await page.getByRole('heading', { name: '環境設定', exact: true }).isVisible(), true);
      await page.getByRole('combobox', { name: '言語', exact: true }).selectOption('zh');
      await send(page, { type: 'state', profiles: [profile], sessions, activeSessionId: sessions[0].id, backend: 'offline', uiLanguage: 'zh' });
      assert.equal(await page.getByRole('heading', { name: '环境设置', exact: true }).isVisible(), true);

      const mac = await browser.newContext({
        viewport: { width: 440, height: 780 },
        locale: 'ko-KR',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      });
      const macPage = await mac.newPage();
      await macPage.goto(url);
      assert.equal(await macPage.locator('.agent-home').getByRole('button', { name: 'zsh', exact: true }).isVisible(), true);
      assert.equal(await macPage.locator('.agent-home').getByRole('button', { name: 'Homebrew', exact: true }).isVisible(), true);
      for (const hidden of ['PowerShell', 'PowerShell 7', 'Git Bash', '명령 프롬프트']) {
        assert.equal(await macPage.locator('.agent-home').getByRole('button', { name: hidden, exact: true }).count(), 0, `${hidden} stays off the Mac list`);
      }
      await mac.close();

      assert.deepEqual(errors, [], `${name} browser errors`);
      console.log(`${name}: navigation, save, row management, reorder, multiline/IME, layout passed`);
      await context.close();
    } finally { await browser.close(); }
  }
} finally { await new Promise((resolve) => server.close(resolve)); }
