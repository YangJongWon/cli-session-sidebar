// Optional integration check using handide's isolated serve-web fixture.
// HANDIDE_ROOT points to a separate checkout; no production server is touched.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const extensionId = `${manifest.publisher}.${manifest.name}`;
const extensionFolder = `${extensionId}-${manifest.version}`;
const handide = process.env.HANDIDE_ROOT;
if (!handide) throw new Error('Set HANDIDE_ROOT to run the optional handide integration check.');
const { killTree } = await import(pathToFileURL(path.join(handide, '.claude/skills/mobilize-editor/scripts/lib/proxy.mjs')));
const { grantTrust, trustDisabled } = await import(pathToFileURL(path.join(handide, '.claude/skills/mobilize-editor/scripts/lib/trust.mjs')));
const selectors = JSON.parse(readFileSync(path.join(handide, 'layer/selectors.json'), 'utf8'));
const out = path.join(root, 'check-output');
mkdirSync(out, { recursive: true });
const runDir = mkdtempSync(path.join(out, 'vscode-'));
const extensionDir = path.join(runDir, 'data/extensions', extensionFolder);
mkdirSync(extensionDir, { recursive: true });
for (const name of ['package.json', 'dist', 'media']) cpSync(path.join(root, name), path.join(extensionDir, name), { recursive: true });
for (const name of ['node-pty', 'node-addon-api']) cpSync(path.join(root, 'node_modules', name), path.join(extensionDir, 'node_modules', name), { recursive: true });
const location = pathToFileURL(extensionDir);
writeFileSync(path.join(runDir, 'data/extensions/extensions.json'), JSON.stringify([{
  identifier: { id: extensionId }, version: manifest.version, relativeLocation: extensionFolder,
  location: { $mid: 1, fsPath: extensionDir, path: location.pathname, scheme: 'file' }, metadata: { source: 'vsix' },
}]));
let proxy, browser;
let page;
function cleanupFixture() {
  if (proxy) killTree(proxy.child);
  // serve-web can detach a server from its launcher on Windows. A parent-tree
  // kill alone then leaves that fixture running. Match only this unique data
  // directory; never enumerate or stop a user's unrelated editor/server.
  if (process.platform === 'win32') {
    assert.equal(path.dirname(runDir), out);
    const literal = runDir.replaceAll("'", "''");
    const command = `$ErrorActionPreference = 'Stop'; $targets = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${literal}') }); foreach ($target in $targets) { Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue }; exit 0`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
      writeFileSync(path.join(runDir, 'cleanup-required.json'), JSON.stringify({ runDir, pid: proxy?.child.pid }));
      console.error(`Fixture cleanup needs process-control permission: ${runDir}`);
      process.exitCode = 1;
    }
  }
  // Detached servers may retain these pipes; do not keep the test harness alive.
  proxy?.child.stdout.destroy();
  proxy?.child.stderr.destroy();
  proxy?.child.unref();
}
async function startPrivateProxy() {
  const workspace = path.join(runDir, 'workspace');
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, 'hello.js'), 'console.log("fixture");\n');
  const config = JSON.parse(readFileSync(path.join(handide, 'layer.config.json'), 'utf8'));
  config.importExtensions = false;
  config.companion = { ...config.companion, mode: 'extension' };
  const configFile = path.join(runDir, 'config.json');
  writeFileSync(configFile, JSON.stringify(config));
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const token = crypto.randomBytes(16).toString('hex');
  const child = spawn(process.execPath, [path.join(handide, 'proxy/server.mjs'), '--port', String(port),
    '--token', token, '--folder', workspace, '--data-dir', path.join(runDir, 'data'), '--config', configFile,
    '--server-commit', selectors.testedWith.commit, '--local', '--no-remote'], { cwd: handide, windowsHide: true });
  let log = '';
  let timer;
  const ready = await new Promise((resolve) => {
    const receive = (data) => { log += data; if (log.includes('ready. Open')) resolve(true); };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.on('exit', () => resolve(false));
    timer = setTimeout(() => resolve(false), 120000);
  }).finally(() => clearTimeout(timer));
  if (!ready) { killTree(child); throw new Error('Private proxy startup failed'); }
  return { child, url: `http://localhost:${port}/?tkn=${token}` };
}
try {
  proxy = await startPrivateProxy();
  console.log('private serve-web started');
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  page = await context.newPage();
  await page.goto(proxy.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (!(await trustDisabled(page))) await grantTrust(page);
  await page.waitForFunction(async () => {
    try { return (await (await fetch('/__handide/bridge/status', { headers: { 'x-handide': '1' } })).json()).connected; }
    catch { return false; }
  }, null, { timeout: 90000 });
  const call = (command, ...args) => page.evaluate(async ({ command, args }) => {
    const response = await (await fetch('/__handide/bridge/call', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-handide': '1' },
      body: JSON.stringify({ command, args, timeoutMs: 60000 }),
    })).json();
    if (!response.ok) throw new Error(response.error);
    return response.result;
  }, { command, args });
  const panelIsOpen = async (part) => {
    await page.waitForFunction((selector) => {
      const part = document.querySelector(selector);
      return Boolean(part && part.getBoundingClientRect().width > 0 && part.getBoundingClientRect().height > 0 && part.textContent.includes('CLI Sidebar'));
    }, selectors.parts[part], { timeout: 20000 });
  };
  const getFrame = async () => {
    for (let attempt = 0; attempt < 300; attempt++) {
      for (const frame of page.frames()) {
        if (await frame.locator('.session-tabs').count().catch(() => 0)) return frame;
      }
      await page.waitForTimeout(100);
    }
    throw new Error('CLI Sidebar webview did not render');
  };
  await call('cliSessionSidebar.setLocation', 'primary');
  await panelIsOpen('sidebar');
  let frame = await getFrame();
  await frame.locator('.agent-home details[open]').waitFor();
  console.log('primary sidebar: actual webview rendered');
  await call('cliSessionSidebar.setLocation', 'secondary');
  await panelIsOpen('auxiliarybar');
  frame = await getFrame();
  await frame.getByRole('button', { name: '새 CLI 추가', exact: true }).click();
  await frame.locator('.profile-form').waitFor();
  assert.equal(await frame.locator('.screen:visible').count(), 1);
  console.log('secondary sidebar: actual move and single-screen add passed');
  await page.screenshot({ path: path.join(runDir, 'secondary.png') });
  await call('cliSessionSidebar.setLocation', 'editor');
  await panelIsOpen('editor');
  console.log('editor: actual panel opened');
  await call('cliSessionSidebar.setLocation', 'primary');
  await panelIsOpen('sidebar');
  console.log('return to primary sidebar passed');
  await call('cliSessionSidebar.setLocation', 'secondary');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await panelIsOpen('auxiliarybar');
  console.log('secondary placement survived browser reload');
  writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({ passed: true, checks: ['primary', 'secondary', 'add-screen', 'editor', 'return-primary', 'reload-placement'] }, null, 2));
  console.log(`integration passed: ${runDir}`);
} catch (error) {
  await page?.screenshot({ path: path.join(runDir, 'failure.png') }).catch(() => {});
  writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({ passed: false, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser?.close();
  cleanupFixture();
}
