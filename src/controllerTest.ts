import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Controller } from './controller';
import { emptyStore, type Profile, type Session } from './shared/types';
import { findProgram } from './which';

async function main(): Promise<void> {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-sidebar-state-'));
  const file = path.join(storageDir, 'store.json');
  const data = emptyStore();
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  data.sessions = ids.map((id, index): Session => ({
    id, name: `task ${index}`, profileId: 'profile', cwd: storageDir,
    status: 'exited', runMode: null, exitReason: null, exitCode: null,
    startedAt: null, endedAt: null, cliHint: '', lastCommand: '', lastError: null,
    createdAt: 0, updatedAt: 0,
  }));
  data.activeSessionId = ids[0];
  fs.writeFileSync(file, JSON.stringify(data));
  const create = () => new Controller({ storageDir, extensionPath: path.resolve(__dirname, '..'), execPath: process.execPath }, {
    defaultCwd: () => storageDir, pickFolder: async () => undefined, pickProgram: async () => undefined,
    openInEditor() {}, focusSidebar() {}, log() {},
  });
  const replies: any[] = [];
  const reply = (message: unknown) => replies.push(message);
  const controller = create();
  // A stale two-item browser list must not erase the third task added elsewhere.
  await controller.handle({ type: 'reorderSessions', ids: [ids[1], ids[0]] }, reply);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).sessions.map((session: Session) => session.id), [ids[1], ids[0], ids[2]]);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).activeSessionId, ids[0]);
  const reopened = create();
  await reopened.handle({ type: 'ready' }, reply);
  assert.deepEqual([...replies].reverse().find((item) => item.type === 'state').sessions.map((session: Session) => session.id), [ids[1], ids[0], ids[2]]);
  await reopened.handle({ type: 'reorderSessions', ids: [ids[0], ids[0]] }, reply);
  assert.equal(replies.at(-1).type, 'error');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sessions.length, 3);

  const draft = { name: 'custom', program: `missing-cli-${crypto.randomUUID()}`, shell: 'direct', args: '' };
  await reopened.handle({ type: 'saveProfile', profile: draft, formToken: 'a' }, reply);
  const saved = replies.at(-1);
  assert.equal(saved.type, 'saved');
  assert.equal(saved.formToken, 'a');
  assert.equal(fs.existsSync(path.join(storageDir, 'backend.lock')), false, 'save must not start a backend');
  const from = replies.length;
  await reopened.handle({ type: 'saveProfile', profile: { ...draft, id: saved.profileId }, startName: 'bad start' }, reply);
  const failed = replies.slice(from);
  assert.equal(failed.at(-1).type, 'error');
  assert.equal(failed.some((item) => item.type === 'started'), false, 'failed CLI launch must never report started');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).profiles.length, 1, 'editing an existing profile keeps its identity');
  await reopened.handle({ type: 'setTemplateHidden', id: 'claude', hidden: true }, reply);
  await reopened.handle({ type: 'removeTemplate', id: 'powershell' }, reply);
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(catalog.hiddenTemplateIds, ['claude']);
  assert.deepEqual(catalog.removedTemplateIds, ['powershell']);
  const restoredHost = create();
  await restoredHost.handle({ type: 'ready' }, reply);
  const catalogState = [...replies].reverse().find((item) => item.type === 'state');
  assert.deepEqual(catalogState.hiddenTemplateIds, ['claude'], 'hidden built-in commands persist');
  assert.deepEqual(catalogState.removedTemplateIds, ['powershell'], 'removed built-in commands persist');
  await restoredHost.handle({ type: 'restoreTemplate', id: 'powershell' }, reply);
  await restoredHost.handle({ type: 'setTemplateHidden', id: 'not-a-template', hidden: true }, reply);
  assert.equal(replies.at(-1).type, 'error');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).removedTemplateIds, []);
  await restoredHost.handle({ type: 'setUiLanguage', language: 'ja' }, reply);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).uiLanguage, 'ja');
  await restoredHost.handle({ type: 'setUiLanguage', language: 'latin' }, reply);
  assert.equal(replies.at(-1).type, 'error');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).uiLanguage, 'ja');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).hiddenTemplateIds, ['claude']);
  await restoredHost.handle({ type: 'installTemplate', id: 'antigravity' }, reply);
  assert.equal(replies.at(-1).type, 'error');
  await restoredHost.handle({ type: 'removeTemplate', id: 'codex' }, reply);
  await restoredHost.handle({ type: 'startFromTemplate', id: 'codex' }, reply);
  assert.equal(replies.at(-1).type, 'error');
  await restoredHost.handle({ type: 'restoreTemplate', id: 'codex' }, reply);
  if ((await findProgram('claude')).length === 0) {
    const before = JSON.parse(fs.readFileSync(file, 'utf8')).sessions.length;
    await restoredHost.handle({ type: 'startFromTemplate', id: 'claude' }, reply);
    assert.equal(replies.at(-1).type, 'error');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const automatic = stored.profiles.filter((profile: Profile) => profile.origin === 'template' && profile.templateId === 'claude');
    assert.equal(automatic.length, 1);
    assert.equal(automatic[0].program, 'claude');
    assert.equal(automatic[0].args, '');
    assert.equal(automatic[0].cwd, '');
    assert.equal(automatic[0].resumeRecent, 'claude --continue');
    assert.equal(stored.sessions.length, before + 1, 'a built-in command records a task without a form');
    await restoredHost.handle({ type: 'startFromTemplate', id: 'claude' }, reply);
    const again = JSON.parse(fs.readFileSync(file, 'utf8')).profiles.filter((profile: Profile) => profile.origin === 'template' && profile.templateId === 'claude');
    assert.equal(again.length, 1, 'starting the same built-in command reuses its defaults');
  }
  const builtin = {
    origin: 'template',
    templateId: 'cursor',
    name: '내 Cursor',
    program: 'agent',
    args: '--profile work',
    shell: 'direct',
    cwd: 'C:\\work',
    env: [{ key: 'A', value: 'b' }],
    resumeRecent: 'agent resume',
    resumeSpecific: 'agent --resume {id}',
    iconText: 'QA',
    iconColor: '#112233',
    iconImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    customized: true,
  };
  await restoredHost.handle({ type: 'saveProfile', profile: builtin }, reply);
  const savedBuiltin = JSON.parse(fs.readFileSync(file, 'utf8')).profiles.filter((item: Profile) => item.origin === 'template' && item.templateId === 'cursor');
  assert.equal(savedBuiltin.length, 1);
  assert.equal(savedBuiltin[0].customized, true);
  assert.equal(savedBuiltin[0].iconText, 'QA');
  assert.equal(savedBuiltin[0].iconColor, '#112233');
  assert.ok(String(savedBuiltin[0].iconImage).startsWith('data:image/png;base64,'));
  assert.equal(savedBuiltin[0].args, '--profile work');
  await restoredHost.handle({ type: 'saveProfile', profile: { ...builtin, id: 'other-id', name: '다른 이름' } }, reply);
  const renamedBuiltin = JSON.parse(fs.readFileSync(file, 'utf8')).profiles.filter((item: Profile) => item.origin === 'template' && item.templateId === 'cursor');
  assert.equal(renamedBuiltin.length, 1, 'editing a built-in command keeps a single profile');
  assert.equal(renamedBuiltin[0].id, savedBuiltin[0].id);
  assert.equal(renamedBuiltin[0].name, '다른 이름');
  await restoredHost.handle({ type: 'resetTemplate', id: 'cursor' }, reply);
  const resetBuiltin = JSON.parse(fs.readFileSync(file, 'utf8')).profiles.find((item: Profile) => item.id === savedBuiltin[0].id);
  assert.equal(resetBuiltin.name, 'Cursor CLI');
  assert.equal(resetBuiltin.program, 'agent');
  assert.equal(resetBuiltin.args, '');
  assert.equal(resetBuiltin.cwd, '');
  assert.equal(resetBuiltin.env.length, 0);
  assert.equal(resetBuiltin.resumeRecent, 'agent resume');
  assert.equal(resetBuiltin.customized, undefined);
  assert.equal(resetBuiltin.website, 'https://cursor.com/docs/cli/overview');
  assert.equal(resetBuiltin.iconText, undefined);
  assert.equal(resetBuiltin.iconColor, undefined);
  assert.equal(resetBuiltin.iconImage, undefined);
  await restoredHost.handle({ type: 'saveProfile', profile: { ...builtin, iconText: 'TOO' } }, reply);
  assert.equal(replies.at(-1).type, 'error');
  await restoredHost.handle({ type: 'saveProfile', profile: { ...builtin, iconColor: 'blue' } }, reply);
  assert.equal(replies.at(-1).type, 'error');
  await restoredHost.handle({ type: 'saveProfile', profile: { ...builtin, iconImage: 'data:image/svg+xml;base64,PHN2Zz4=' } }, reply);
  assert.equal(replies.at(-1).type, 'error');
  await restoredHost.handle({ type: 'saveProfile', profile: { ...builtin, website: 'javascript:alert(1)' } }, reply);
  assert.equal(replies.at(-1).type, 'error');
  await restoredHost.handle({ type: 'saveProfile', profile: { ...builtin, website: 'cursor.com/cli' } }, reply);
  const linkedBuiltin = JSON.parse(fs.readFileSync(file, 'utf8')).profiles.find((item: Profile) => item.id === savedBuiltin[0].id);
  assert.equal(linkedBuiltin.website, 'https://cursor.com/cli');
  assert.equal(linkedBuiltin.customized, true);
  await restoredHost.handle({ type: 'resetTemplate', id: 'cursor' }, reply);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).profiles.filter((item: Profile) => item.id === savedBuiltin[0].id).length, 1, 'reset keeps the profile used by existing tasks');
  assert.equal(path.dirname(storageDir), path.resolve(os.tmpdir()));
  assert.ok(path.basename(storageDir).startsWith('cli-sidebar-state-'));
  fs.rmSync(storageDir, { recursive: true, force: true });
  console.log('controller: reorder persistence, concurrent additions, duplicate protection, save/launch distinction passed');
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
