import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { connectDaemon, connectExisting, readLock } from './daemonLauncher';
import { LocalBackend } from './localBackend';
import { PtyService } from './ptyService';
import { commandExecutable, normalizeWebsite } from './shared/args';
import { iconOverrides } from './shared/icon';
import { bannerFor, buildEnv, buildLaunch, wrapShellScript } from './shared/launch';
import { isUiLanguage, resolveLanguage, setLanguage, t, type MessageKey } from './shared/i18n';
import { TEMPLATES, installHint, templatesFor } from './shared/templates';
import {
  SCROLLBACK_LIMIT,
  UserError,
  isUuid,
  type ExitReason,
  type Profile,
  type RunMode,
  type Session,
  type SessionRunMode,
  type ShellKind,
  type StartRequest,
} from './shared/types';
import { JsonStore } from './storage';
import { chooseProgram, findProgram, gitBashPath, isPidAlive, runnableProgram } from './which';

export interface HostUi {
  defaultCwd(): string;
  pickFolder(): Promise<string | undefined>;
  pickProgram(): Promise<string | undefined>;
  openInEditor(): void;
  focusSidebar(): void;
  setLocation?(location: string): Promise<void>;
  openSettings?(): void;
  locale?(): string;
  notify?(title: string, body: string, sessionId: string): void;
  setDirectInput?(focused: boolean): void;
  openPath?(filePath: string, line?: number, column?: number): Promise<void>;
  openExternal?(url: string): Promise<void>;
  log(line: string): void;
}

type Reply = (message: unknown) => void;

interface Backend {
  kind: 'daemon' | 'inprocess';
  start(request: StartRequest): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  stop(sessionId: string): Promise<void>;
  replay(sessionId: string): Promise<{ data: string; running: boolean; exitCode: number | null } | null>;
  list(): Promise<{ id: string; running: boolean; exitCode: number | null }[]>;
  shutdown(): Promise<void>;
  dispose(): void;
  onOutput(listener: (sessionId: string, data: string) => void): void;
  onExit(listener: (sessionId: string, exitCode: number, userStop: boolean) => void): void;
  onClose?(listener: () => void): void;
}

interface LaunchPaths {
  storageDir: string;
  extensionPath: string;
  execPath: string;
}

export class Controller {
  private readonly store: JsonStore;
  private readonly subscribers = new Set<Reply>();
  private readonly cache = new Map<string, string>();
  private readonly sizes = new Map<string, { cols: number; rows: number }>();
  private readonly stopping = new Set<string>();
  private attached = new Set<string>();
  private backend: Backend | null = null;
  private backendNote = t('noteIdle');
  private closed = false;

  constructor(
    private readonly paths: LaunchPaths,
    private readonly host: HostUi,
  ) {
    setLanguage(resolveLanguage('auto', host.locale?.() ?? 'en'));
    this.store = new JsonStore(path.join(paths.storageDir, 'store.json'));
    this.loadCacheFromDisk();
    if (this.store.loadError) {
      this.backendNote = this.store.loadError;
    } else {
      this.syncLanguage();
      this.backendNote = this.text('noteIdle');
    }
  }

  release(): void {
    this.closed = true;
    const backend = this.backend;
    this.backend = null;
    backend?.dispose();
  }

  subscribe(reply: Reply): () => void {
    this.subscribers.add(reply);
    return () => this.subscribers.delete(reply);
  }

  async init(): Promise<void> {
    const lock = readLock(this.paths.storageDir);
    const existing = await connectExisting(this.paths.storageDir);
    if (existing) {
      this.attachBackend(existing);
      await this.reconcile();
      this.backendNote = this.text('noteConnected');
    } else if (lock && isPidAlive(lock.pid)) {
      this.backendNote = this.text('noteConnectFailed');
    } else {
      this.markInterrupted();
    }
    this.pushState();
    const active = this.store.data.activeSessionId;
    if (active) this.broadcast(this.scrollbackMessage(active));
  }

  async handle(message: unknown, reply: Reply): Promise<void> {
    const record = asRecord(message);
    const type = typeof record.type === 'string' ? record.type : '';
    try {
      await this.dispatch(type, record, reply);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.host.log(text);
      reply({ type: 'error', message: text });
    }
  }

  async shutdownBackend(): Promise<void> {
    const running = this.store.data.sessions.filter((session) => session.status === 'running').map((session) => session.id);
    for (const id of running) {
      this.stopping.add(id);
    }
    const backend = this.backend;
    this.backend = null;
    this.attached.clear();
    if (backend) {
      try {
        await backend.shutdown();
      } catch (error) {
        this.host.log(error instanceof Error ? error.message : String(error));
      }
      backend.dispose();
    }
    this.store.update((data) => {
      const now = Date.now();
      for (const session of data.sessions) {
        if (!running.includes(session.id)) {
          continue;
        }
        session.status = 'exited';
        session.exitReason = 'user-stop';
        session.endedAt = now;
        session.updatedAt = now;
      }
    });
    this.backendNote = this.text('noteShutdown');
    this.pushState();
  }

  private async dispatch(type: string, record: Record<string, unknown>, reply: Reply): Promise<void> {
    if (type === 'ready') {
      const active = this.store.data.activeSessionId;
      reply(this.stateMessage());
      if (active) {
        reply(this.scrollbackMessage(active));
      }
      void this.refreshInstalledTemplates();
      return;
    }
    if (type === 'saveProfile') {
      const profile = this.saveProfile(asRecord(record.profile));
      this.pushState();
      if (typeof record.startName === 'string') {
        await this.startFromProfile(profile.id, record.startName);
        reply({ type: 'started', profileId: profile.id });
      } else {
        reply({ type: 'saved', profileId: profile.id, formToken: record.formToken });
      }
      return;
    }
    if (type === 'deleteProfile') {
      this.deleteProfile(stringField(record, 'id'));
      this.pushState();
      return;
    }
    if (type === 'setTemplateHidden') {
      this.setTemplateHidden(this.templateId(record), record.hidden === true);
      this.pushState();
      return;
    }
    if (type === 'removeTemplate') {
      this.removeTemplate(this.templateId(record));
      this.pushState();
      return;
    }
    if (type === 'restoreTemplate') {
      this.restoreTemplate(this.templateId(record));
      this.pushState();
      return;
    }
    if (type === 'resetTemplate') {
      this.resetTemplate(this.templateId(record));
      this.pushState();
      return;
    }
    if (type === 'setUiLanguage') {
      const language = stringField(record, 'language');
      if (!isUiLanguage(language)) throw new UserError(this.text('errBadLanguage'));
      this.store.update((data) => {
        data.uiLanguage = language;
      });
      this.syncLanguage();
      this.pushState();
      return;
    }
    if (type === 'startFromProfile') {
      await this.startFromProfile(stringField(record, 'profileId'), typeof record.name === 'string' ? record.name : '');
      reply({ type: 'started' });
      return;
    }
    if (type === 'installTemplate') {
      await this.installTemplate(this.templateId(record));
      reply({ type: 'started' });
      return;
    }
    if (type === 'startFromTemplate') {
      const id = this.templateId(record);
      if (this.store.data.removedTemplateIds.includes(id)) {
        throw new UserError(this.text('errNoTemplate'));
      }
      const template = templatesFor(process.platform).find((item) => item.id === id);
      if (!template) throw new UserError(this.text('errNoTemplate'));
      const existing = this.store.data.profiles.find((profile) => profile.origin === 'template' && profile.templateId === id);
      const profile = existing ?? this.saveProfile({
        templateId: template.id,
        origin: 'template',
        name: template.label,
        program: template.program,
        args: template.args,
        shell: template.shell,
        cwd: '',
        env: [],
        resumeRecent: template.resumeRecent,
        resumeSpecific: template.resumeSpecific,
        website: template.website,
      });
      await this.startFromProfile(profile.id, typeof record.name === 'string' ? record.name : '');
      reply({ type: 'started', profileId: profile.id });
      return;
    }
    if (type === 'setSessionPreserved') {
      this.setSessionsPreserved([stringField(record, 'sessionId')], record.preserved === true);
      this.pushState();
      return;
    }
    if (type === 'setSessionsPreserved') {
      if (!Array.isArray(record.sessionIds) || record.sessionIds.length === 0 || record.sessionIds.some((id) => typeof id !== 'string')) {
        throw new UserError(this.text('errNoSessions'));
      }
      this.setSessionsPreserved(record.sessionIds as string[], record.preserved === true);
      this.pushState();
      return;
    }
    if (type === 'reorderSessions') {
      if (!Array.isArray(record.ids) || record.ids.some((id) => typeof id !== 'string')) {
        throw new UserError(this.text('errBadOrder'));
      }
      const ids = record.ids as string[];
      if (new Set(ids).size !== ids.length) throw new UserError(this.text('errDuplicateSession'));
      this.store.update((data) => {
        const byId = new Map(data.sessions.map((session) => [session.id, session]));
        // Preserve tasks created by another window during the drag.
        data.sessions = [...ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []),
          ...data.sessions.filter((session) => !ids.includes(session.id))];
      });
      this.pushState();
      return;
    }
    if (type === 'resumeRecent') {
      await this.resume(stringField(record, 'sessionId'), 'resumeRecent', undefined);
      return;
    }
    if (type === 'resumeSpecific') {
      await this.resume(stringField(record, 'sessionId'), 'resumeSpecific', typeof record.cliHint === 'string' ? record.cliHint : '');
      return;
    }
    if (type === 'rerun') {
      await this.resume(stringField(record, 'sessionId'), 'run', undefined);
      return;
    }
    if (type === 'reconnect') {
      await this.reconnect(stringField(record, 'sessionId'));
      return;
    }
    if (type === 'stopSession') {
      await this.stopSession(stringField(record, 'sessionId'));
      return;
    }
    if (type === 'deleteSession') {
      await this.deleteSession(stringField(record, 'sessionId'));
      return;
    }
    if (type === 'updateSession') {
      this.updateSession(record);
      this.pushState();
      reply({ type: 'sessionSaved' });
      return;
    }
    if (type === 'selectSession') {
      await this.selectSession(stringField(record, 'sessionId'));
      return;
    }
    if (type === 'input') {
      await this.writeInput(stringField(record, 'sessionId'), typeof record.data === 'string' ? record.data : '');
      return;
    }
    if (type === 'directFocus') {
      this.host.setDirectInput?.(record.focused === true);
      return;
    }
    if (type === 'openExternal') {
      const website = normalizeWebsite(stringField(record, 'url'));
      if (!website || !this.host.openExternal) throw new UserError(this.text('errBadWebsite'));
      await this.host.openExternal(website);
      return;
    }
    if (type === 'openPath') {
      await this.openLinkedPath(record);
      return;
    }
    if (type === 'resize') {
      await this.resize(stringField(record, 'sessionId'), numberField(record, 'cols'), numberField(record, 'rows'));
      return;
    }
    if (type === 'checkProgram') {
      await this.checkProgram(record, reply);
      return;
    }
    if (type === 'pickFolder') {
      const folder = await this.host.pickFolder();
      if (folder) {
        reply({ type: 'picked', field: 'cwd', value: folder });
      }
      return;
    }
    if (type === 'pickProgram') {
      const program = await this.host.pickProgram();
      if (program) {
        reply({ type: 'picked', field: 'program', value: program });
      }
      return;
    }
    if (type === 'openInEditor') {
      this.host.openInEditor();
      return;
    }
    if (type === 'focusSidebar') {
      this.host.focusSidebar();
      return;
    }
    if (type === 'setLocation') {
      if (!this.host.setLocation) throw new UserError(this.text('errNoLocation'));
      await this.host.setLocation(stringField(record, 'location'));
      return;
    }
    if (type === 'openSettings') {
      this.host.openSettings?.();
      return;
    }
    if (type === 'shutdownBackend') {
      await this.shutdownBackend();
      return;
    }
  }

  private saveProfile(draft: Record<string, unknown>): Profile {
    const requestedId = typeof draft.id === 'string' ? draft.id : '';
    const templateId = typeof draft.templateId === 'string' ? draft.templateId : '';
    const editingBuiltin = draft.origin === 'template' && TEMPLATES.some((item) => item.id === templateId);
    const now = Date.now();
    let createdAt = now;
    let id = requestedId;
    if (editingBuiltin) {
      const existing = this.store.data.profiles.find((profile) => profile.origin === 'template' && profile.templateId === templateId);
      if (existing) {
        id = existing.id;
        createdAt = existing.createdAt;
      } else if (requestedId) {
        const byId = this.store.data.profiles.find((profile) => profile.id === requestedId);
        if (!byId) throw new UserError(this.text('errProfileGone'));
        createdAt = byId.createdAt;
      }
    } else if (requestedId) {
      const existing = this.store.data.profiles.find((profile) => profile.id === requestedId);
      if (!existing) {
        throw new UserError(this.text('errProfileGone'));
      }
      createdAt = existing.createdAt;
      id = existing.id;
    }
    const profile = normalizeProfile(draft, id || crypto.randomUUID(), createdAt, now);
    this.store.update((data) => {
      const index = data.profiles.findIndex((item) => item.id === profile.id);
      if (index >= 0) {
        data.profiles[index] = profile;
      } else {
        data.profiles.unshift(profile);
      }
    });
    this.host.log(`프로필 저장: ${profile.name} / ${profile.program} ${profile.args}`.trim());
    return profile;
  }

  private templateId(record: Record<string, unknown>): string {
    const id = stringField(record, 'id');
    if (!TEMPLATES.some((template) => template.id === id)) {
      throw new UserError(this.text('errNoTemplate'));
    }
    return id;
  }

  private setTemplateHidden(id: string, hidden: boolean): void {
    this.store.update((data) => {
      data.removedTemplateIds = data.removedTemplateIds.filter((item) => item !== id);
      data.hiddenTemplateIds = data.hiddenTemplateIds.filter((item) => item !== id);
      if (hidden) data.hiddenTemplateIds.push(id);
    });
  }

  private removeTemplate(id: string): void {
    this.store.update((data) => {
      data.hiddenTemplateIds = data.hiddenTemplateIds.filter((item) => item !== id);
      if (!data.removedTemplateIds.includes(id)) data.removedTemplateIds.push(id);
    });
  }

  private restoreTemplate(id: string): void {
    this.store.update((data) => {
      data.removedTemplateIds = data.removedTemplateIds.filter((item) => item !== id);
      data.hiddenTemplateIds = data.hiddenTemplateIds.filter((item) => item !== id);
    });
  }

  private setSessionsPreserved(sessionIds: string[], preserved: boolean): void {
    const ids = [...new Set(sessionIds)];
    for (const id of ids) this.session(id);
    this.store.update((data) => {
      const selected = new Set(ids);
      for (const session of data.sessions) {
        if (!selected.has(session.id)) continue;
        session.preserved = preserved;
        session.updatedAt = Date.now();
      }
      if (preserved && data.activeSessionId && selected.has(data.activeSessionId)) {
        data.activeSessionId = data.sessions.find((item) => !selected.has(item.id) && !item.preserved)?.id ?? null;
      }
      if (!preserved) data.activeSessionId = data.sessions.find((item) => selected.has(item.id))?.id ?? data.activeSessionId;
    });
  }

  private resetTemplate(id: string): void {
    const template = TEMPLATES.find((item) => item.id === id);
    if (!template) throw new UserError(this.text('errNoTemplate'));
    const existing = this.store.data.profiles.find((profile) => profile.origin === 'template' && profile.templateId === id);
    if (!existing?.customized) return;
    this.store.update((data) => {
      const profile = data.profiles.find((item) => item.id === existing.id);
      if (!profile) return;
      profile.name = template.label;
      profile.program = template.program;
      profile.args = template.args;
      profile.shell = template.shell;
      profile.cwd = '';
      profile.env = [];
      profile.resumeRecent = template.resumeRecent;
      profile.resumeSpecific = template.resumeSpecific;
      profile.website = template.website;
      delete profile.iconText;
      delete profile.iconColor;
      delete profile.iconImage;
      delete profile.customized;
      profile.updatedAt = Date.now();
    });
  }

  private deleteProfile(id: string): void {
    if (this.store.data.sessions.some((session) => session.profileId === id)) {
      throw new UserError(this.text('errProfileBusy'));
    }
    this.store.update((data) => {
      data.profiles = data.profiles.filter((profile) => profile.id !== id);
    });
  }

  private async installTemplate(id: string): Promise<void> {
    if (this.store.data.removedTemplateIds.includes(id)) throw new UserError(this.text('errNoTemplate'));
    const template = TEMPLATES.find((item) => item.id === id);
    const command = process.platform === 'win32' ? template?.windowsInstall?.command : '';
    if (!template || !command) throw new UserError(this.text('noInstallCommand'));
    const marker = `install:${template.id}`;
    const existing = this.store.data.profiles.find((profile) => profile.origin === 'template' && profile.templateId === marker);
    const profile = existing ?? this.saveProfile({
      templateId: marker,
      origin: 'template',
      name: `${template.label} 설치`,
      program: 'powershell.exe',
      args: '',
      shell: 'direct',
      cwd: '',
      env: [],
      resumeRecent: command,
      resumeSpecific: '',
    });
    await this.startFromProfile(profile.id, `${template.label} 설치`);
  }

  private async startFromProfile(profileId: string, requestedName: string): Promise<void> {
    const profile = this.profile(profileId);
    const name = requestedName.trim() || `${profile.name} ${this.store.data.sessions.filter((session) => session.profileId === profile.id).length + 1}`;
    await this.createAndLaunch(profile, name, 'run', '');
  }

  private async resume(sessionId: string, mode: RunMode, cliHint: string | undefined): Promise<void> {
    const current = this.session(sessionId);
    if (current.status === 'running' && this.attached.has(current.id)) {
      throw new UserError(this.text('errAlreadyRunning'));
    }
    if (cliHint !== undefined) {
      this.store.update((data) => {
        const session = data.sessions.find((item) => item.id === sessionId);
        if (session) {
          session.cliHint = cliHint;
          session.updatedAt = Date.now();
        }
      });
    }
    const session = this.session(sessionId);
    const profile = this.profile(session.profileId);
    await this.launchIntoSession(session, profile, mode, session.cliHint);
  }

  private async createAndLaunch(profile: Profile, name: string, mode: RunMode, cliHint: string): Promise<void> {
    const id = crypto.randomUUID();
    const cwd = this.resolveCwd(profile.cwd, '');
    const session = blankSession(id, name, profile.id, cwd, cliHint);
    let launched = false;
    let errorText = '';
    try {
      await this.launchProcess(session, profile, mode, cliHint);
      launched = true;
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
    }
    const finished = fillSession(session, launched, errorText, mode);
    this.store.update((data) => {
      data.sessions.unshift(finished);
      data.activeSessionId = finished.id;
    });
    this.pushState();
    this.broadcast(this.scrollbackMessage(finished.id));
    if (!launched) {
      throw new UserError(errorText);
    }
  }

  private async launchIntoSession(session: Session, profile: Profile, mode: RunMode, cliHint: string): Promise<void> {
    let launched = false;
    let errorText = '';
    let launchedCwd = session.cwd;
    let launchedCommand = session.lastCommand;
    try {
      const result = await this.launchProcess(session, profile, mode, cliHint);
      launched = true;
      launchedCwd = result.cwd;
      launchedCommand = result.lastCommand;
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
      if (errorText.includes('이미 실행 중')) {
        await this.reconnect(session.id);
        return;
      }
    }
    this.store.update((data) => {
      const target = data.sessions.find((item) => item.id === session.id);
      if (!target) {
        return;
      }
      const finished = fillSession({
        ...target,
        cwd: launched ? launchedCwd : target.cwd,
        lastCommand: launched ? launchedCommand : target.lastCommand,
      }, launched, errorText, mode);
      Object.assign(target, finished);
      data.activeSessionId = target.id;
    });
    this.pushState();
    this.broadcast(this.scrollbackMessage(session.id));
    if (!launched) {
      throw new UserError(errorText);
    }
  }

  private async launchProcess(session: Session, profile: Profile, mode: RunMode, cliHint: string): Promise<{ cwd: string; lastCommand: string }> {
    const cwd = this.resolveCwd(profile.cwd, session.cwd);
    if (!fs.existsSync(cwd)) {
      throw new UserError(this.text('errMissingFolder', { path: cwd }));
    }
    let spec = profile.templateId?.startsWith('install:')
      ? { file: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', profile.resumeRecent], commandLabel: profile.resumeRecent }
      : buildLaunch({
        program: profile.program,
        args: profile.args,
        shell: profile.shell,
        resumeRecent: profile.resumeRecent,
        resumeSpecific: profile.resumeSpecific,
        mode,
        cliHint,
      });
    let executable = commandExecutable(profile.program);
    if (profile.templateId === 'git-bash' && /^bash(\.exe)?$/i.test(executable)) {
      const bash = gitBashPath();
      if (!bash) throw new UserError(missingProgram(profile, 'bash.exe'));
      spec = { ...spec, file: bash };
      executable = bash;
    }
    if (mode === 'run') {
      const programPaths = await findProgram(executable);
      if (programPaths.length === 0) {
        throw new UserError(missingProgram(profile, profile.templateId === 'git-bash' ? 'bash.exe' : executable));
      }
    }
    const commandName = profile.shell === 'direct' ? spec.file : spec.file;
    const commandPaths = await findProgram(commandName);
    if (commandPaths.length === 0) {
      throw new UserError(profile.shell === 'direct'
        ? missingProgram(profile, commandName)
        : this.text('errMissingShell', { name: commandName }));
    }
    const resolved = runnableProgram(chooseProgram(commandPaths) ?? commandName);
    const wrapped = wrapShellScript(resolved, spec.args, process.platform, process.env.ComSpec);
    await this.ensureBackend();
    const size = this.sizes.get(session.id) ?? { cols: 80, rows: 24 };
    await this.backend!.start({
      sessionId: session.id,
      file: wrapped.file,
      args: wrapped.args,
      cwd,
      env: buildEnv(process.env, profile.env),
      cols: size.cols,
      rows: size.rows,
      banner: bannerFor(mode, spec.commandLabel),
    });
    session.cwd = cwd;
    session.lastCommand = spec.commandLabel;
    this.attached.add(session.id);
    this.host.log(`실행: ${spec.commandLabel}`);
    if (wrapped.file !== spec.file) {
      this.host.log(`실행 파일: ${wrapped.file} ${wrapped.args.join(' ')}`);
    }
    return { cwd, lastCommand: spec.commandLabel };
  }

  private async reconnect(sessionId: string): Promise<void> {
    const session = this.session(sessionId);
    await this.ensureBackend();
    const live = (await this.backend!.list()).find((item) => item.id === sessionId && item.running);
    const replay = await this.backend!.replay(sessionId);
    if (replay) {
      this.cache.set(sessionId, replay.data);
    }
    if (!live) {
      if (session.status === 'running') {
        this.store.update((data) => {
          const target = data.sessions.find((item) => item.id === sessionId);
          if (!target) {
            return;
          }
          target.status = 'exited';
          target.exitReason = 'interrupted';
          target.endedAt = Date.now();
          target.updatedAt = Date.now();
        });
      }
      this.attached.delete(sessionId);
      this.store.update((data) => {
        data.activeSessionId = sessionId;
      });
      this.pushState();
      this.broadcast(this.scrollbackMessage(sessionId));
      throw new UserError(this.text('errNotRunningResume'));
    }
    this.attached.add(sessionId);
    this.store.update((data) => {
      const target = data.sessions.find((item) => item.id === sessionId);
      if (!target) {
        return;
      }
      target.status = 'running';
      target.exitReason = null;
      target.updatedAt = Date.now();
      data.activeSessionId = sessionId;
    });
    this.backendNote = this.text('noteReconnected');
    this.pushState();
    this.broadcast(this.scrollbackMessage(sessionId));
  }

  private async stopSession(sessionId: string): Promise<void> {
    this.session(sessionId);
    if (!this.attached.has(sessionId)) {
      throw new UserError(this.text('errNotRunningStop'));
    }
    await this.ensureBackend();
    this.stopping.add(sessionId);
    await this.backend!.stop(sessionId);
  }

  private async deleteSession(sessionId: string): Promise<void> {
    this.session(sessionId);
    if (this.attached.has(sessionId) && this.backend) {
      this.stopping.add(sessionId);
      await this.backend.stop(sessionId);
    }
    this.cache.delete(sessionId);
    this.attached.delete(sessionId);
    fs.rmSync(path.join(this.paths.storageDir, 'logs', `${sessionId}.txt`), { force: true });
    this.store.update((data) => {
      data.sessions = data.sessions.filter((session) => session.id !== sessionId);
      if (data.activeSessionId === sessionId) {
        data.activeSessionId = data.sessions[0]?.id ?? null;
      }
    });
    this.pushState();
    const active = this.store.data.activeSessionId;
    if (active) {
      this.broadcast(this.scrollbackMessage(active));
    }
  }

  private updateSession(record: Record<string, unknown>): void {
    const sessionId = stringField(record, 'sessionId');
    this.session(sessionId);
    this.store.update((data) => {
      const session = data.sessions.find((item) => item.id === sessionId);
      if (!session) {
        return;
      }
      if (typeof record.name === 'string' && record.name.trim()) {
        session.name = record.name.trim();
      }
      if (typeof record.cwd === 'string') {
        session.cwd = record.cwd.trim() ? path.resolve(record.cwd.trim()) : session.cwd;
      }
      if (typeof record.cliHint === 'string') {
        session.cliHint = record.cliHint;
      }
      session.updatedAt = Date.now();
    });
  }

  private async selectSession(sessionId: string): Promise<void> {
    this.session(sessionId);
    if (this.backend) {
      const replay = await this.backend.replay(sessionId);
      if (replay) {
        this.cache.set(sessionId, replay.data);
        if (replay.running) {
          this.attached.add(sessionId);
        }
      }
    }
    this.store.update((data) => {
      data.activeSessionId = sessionId;
    });
    this.pushState();
    this.broadcast(this.scrollbackMessage(sessionId));
  }

  sendToActive(data: string): Promise<void> {
    const sessionId = this.store.data.activeSessionId;
    if (!sessionId) return Promise.resolve();
    return this.writeInput(sessionId, data).catch(() => undefined);
  }

  private lastInput = { data: '', at: 0 };

  private async writeInput(sessionId: string, data: string): Promise<void> {
    if (!data) {
      return;
    }
    const now = Date.now();
    if (data === this.lastInput.data && now - this.lastInput.at < 15) return;
    this.lastInput = { data, at: now };
    this.session(sessionId);
    if (!this.attached.has(sessionId)) {
      throw new UserError(this.text('errNotRunningInput'));
    }
    await this.ensureBackend();
    await this.backend!.write(sessionId, data);
  }

  private async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    if (!isUuid(sessionId) || cols < 2 || rows < 2) {
      return;
    }
    this.sizes.set(sessionId, { cols, rows });
    if (this.backend && this.attached.has(sessionId)) {
      await this.backend.resize(sessionId, cols, rows);
    }
  }

  private async checkProgram(record: Record<string, unknown>, reply: Reply): Promise<void> {
    const program = commandExecutable(typeof record.program === 'string' ? record.program : '');
    const templateId = typeof record.templateId === 'string' ? record.templateId : undefined;
    const paths = await findProgram(program);
    const resolved = runnableProgram(chooseProgram(paths) ?? '');
    reply({
      type: 'programCheck',
      program,
      found: Boolean(resolved),
      resolved,
      hint: resolved ? null : installHint(templateId, program, process.platform),
    });
  }

  private async ensureBackend(): Promise<void> {
    if (this.backend) {
      return;
    }
    try {
      const connection = await connectDaemon(this.paths);
      this.attachBackend(connection);
      this.backendNote = this.text('noteConnected');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.host.log(message);
      try {
        const local = new LocalBackend(new PtyService(this.paths.storageDir));
        this.attachBackend(local);
        this.backendNote = this.text('noteLocal', { detail: message });
      } catch (inner) {
        const detail = inner instanceof Error ? inner.message : String(inner);
        throw new UserError(this.text('noteBackendFailed', { detail }));
      }
    }
  }

  private attachBackend(backend: Backend): void {
    this.backend = backend;
    backend.onOutput((sessionId, data) => this.remember(sessionId, data));
    backend.onExit((sessionId, exitCode, userStop) => this.onProcessExit(sessionId, exitCode, userStop));
    backend.onClose?.(() => {
      if (this.closed || this.backend !== backend) {
        return;
      }
      this.backend = null;
      this.attached.clear();
      void this.recoverDaemon();
    });
  }

  private recovering = false;

  private async recoverDaemon(): Promise<void> {
    if (this.recovering || this.closed) return;
    this.recovering = true;
    try {
      const existing = await connectExisting(this.paths.storageDir);
      if (!existing || this.closed || this.backend) {
        existing?.dispose();
        if (!this.backend && !this.closed) {
          this.backendNote = this.text('noteClosed');
          this.pushState();
        }
        return;
      }
      this.attachBackend(existing);
      await this.reconcile();
      this.backendNote = this.text('noteRecovered');
      this.pushState();
      const active = this.store.data.activeSessionId;
      if (active) this.broadcast(this.scrollbackMessage(active));
    } finally {
      this.recovering = false;
    }
  }

  private async reconcile(): Promise<void> {
    if (!this.backend) {
      return;
    }
    const live = await this.backend.list();
    const running = new Set(live.filter((item) => item.running).map((item) => item.id));
    this.attached = running;
    // Reload only reattaches tasks already in the store. Daemon entries that
    // were closed or never saved must not come back as a new "복구된 작업".
    const ended: string[] = [];
    this.store.update((data) => {
      const now = Date.now();
      for (const session of data.sessions) {
        if (session.status === 'running' && !running.has(session.id)) {
          ended.push(session.name);
          session.status = 'exited';
          session.exitReason = 'interrupted';
          session.endedAt = now;
          session.updatedAt = now;
        } else if (running.has(session.id)) {
          session.status = 'running';
          session.exitReason = null;
        }
      }
    });
    this.announceEnded(ended);
    for (const session of this.store.data.sessions) {
      const replay = await this.backend.replay(session.id);
      if (replay && replay.data) {
        this.cache.set(session.id, replay.data);
      }
    }
  }

  private markInterrupted(): void {
    this.store.update((data) => {
      const now = Date.now();
      for (const session of data.sessions) {
        if (session.status !== 'running') {
          continue;
        }
        session.status = 'exited';
        session.exitReason = 'interrupted';
        session.endedAt = now;
        session.updatedAt = now;
      }
    });
    this.attached.clear();
    this.backendNote = this.text('noteNone');
  }

  private onProcessExit(sessionId: string, exitCode: number, userStop: boolean): void {
    const stopped = userStop || this.stopping.has(sessionId);
    this.stopping.delete(sessionId);
    this.attached.delete(sessionId);
    this.store.update((data) => {
      const session = data.sessions.find((item) => item.id === sessionId);
      if (!session || session.status !== 'running') {
        return;
      }
      session.status = 'exited';
      session.exitCode = exitCode;
      session.exitReason = stopped ? 'user-stop' : 'process-exit';
      session.endedAt = Date.now();
      session.updatedAt = Date.now();
    });
    if (!stopped) {
      const session = this.store.data.sessions.find((item) => item.id === sessionId);
      this.announceExit(session?.name ?? sessionId, exitCode, sessionId);
    }
    this.pushState();
  }

  private announceEnded(names: string[]): void {
    if (names.length === 0) return;
    this.syncLanguage();
    if (names.length === 1) {
      this.host.notify?.(t('taskEndedAway', { name: names[0] }), '', '');
      return;
    }
    this.host.notify?.(t('tasksEndedAway', { count: names.length }), names.join(', '), '');
  }

  private announceExit(name: string, code: number, sessionId: string): void {
    this.syncLanguage();
    this.host.notify?.(t('taskFinished', { name }), t('taskFinishedBody', { code }), sessionId);
  }

  private syncLanguage(): void {
    setLanguage(resolveLanguage(this.store.data.uiLanguage, this.host.locale?.() ?? 'en'));
  }

  private text(key: MessageKey, vars?: Record<string, string | number>): string {
    this.syncLanguage();
    return t(key, vars);
  }

  private async openLinkedPath(record: Record<string, unknown>): Promise<void> {
    const raw = typeof record.path === 'string' ? record.path.trim() : '';
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : '';
    const session = this.store.data.sessions.find((item) => item.id === sessionId);
    const base = session?.cwd || this.host.defaultCwd();
    const resolved = !raw ? '' : path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(base, raw);
    if (!resolved || !fs.existsSync(resolved) || !this.host.openPath) {
      throw new UserError(this.text('pathMissing', { path: resolved || raw }));
    }
    const line = typeof record.line === 'number' ? record.line : undefined;
    const column = typeof record.column === 'number' ? record.column : undefined;
    await this.host.openPath(resolved, line, column);
  }

  private remember(sessionId: string, data: string): void {
    let next = (this.cache.get(sessionId) ?? '') + data;
    if (next.length > SCROLLBACK_LIMIT) {
      next = next.slice(next.length - SCROLLBACK_LIMIT);
    }
    this.cache.set(sessionId, next);
    this.broadcast({ type: 'output', sessionId, data });
  }

  private loadCacheFromDisk(): void {
    for (const session of this.store.data.sessions) {
      const file = path.join(this.paths.storageDir, 'logs', `${session.id}.txt`);
      if (!fs.existsSync(file)) {
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      this.cache.set(session.id, text.length > SCROLLBACK_LIMIT ? text.slice(text.length - SCROLLBACK_LIMIT) : text);
    }
  }

  private stateMessage(): unknown {
    return {
      type: 'state',
      profiles: this.store.data.profiles,
      sessions: this.store.data.sessions.map((session) => ({
        ...session,
        attached: this.attached.has(session.id),
      })),
      activeSessionId: this.store.data.activeSessionId,
      backend: this.backend?.kind ?? 'offline',
      backendNote: this.backendNote,
      loadError: this.store.loadError,
      defaultCwd: this.host.defaultCwd(),
      platform: process.platform,
      hiddenTemplateIds: this.store.data.hiddenTemplateIds,
      removedTemplateIds: this.store.data.removedTemplateIds,
      uiLanguage: this.store.data.uiLanguage,
      installedTemplateIds: this.installedTemplateIds,
    };
  }

  private installedTemplateIds: string[] | null = null;
  private installScan: Promise<void> | null = null;

  private refreshInstalledTemplates(): Promise<void> {
    if (this.installScan) return this.installScan;
    this.installScan = this.scanInstalledTemplates().finally(() => {
      this.installScan = null;
    });
    return this.installScan;
  }

  private async scanInstalledTemplates(): Promise<void> {
    const found = new Set<string>();
    await Promise.all(templatesFor(process.platform).map(async (template) => {
      if (template.id === 'git-bash') {
        if (gitBashPath()) found.add(template.id);
        return;
      }
      if ((await findProgram(template.program)).length > 0) found.add(template.id);
    }));
    const ids = templatesFor(process.platform).filter((template) => found.has(template.id)).map((template) => template.id);
    const previous = this.installedTemplateIds;
    if (previous && previous.length === ids.length && previous.every((id, index) => id === ids[index])) return;
    this.installedTemplateIds = ids;
    this.pushState();
  }

  private scrollbackMessage(sessionId: string): unknown {
    return {
      type: 'scrollback',
      sessionId,
      data: this.cache.get(sessionId) ?? '',
    };
  }

  private pushState(): void {
    this.broadcast(this.stateMessage());
  }

  private broadcast(message: unknown): void {
    for (const reply of this.subscribers) {
      reply(message);
    }
  }

  private profile(id: string): Profile {
    const profile = this.store.data.profiles.find((item) => item.id === id);
    if (!profile) {
      throw new UserError(this.text('errNoProfile'));
    }
    return profile;
  }

  private session(id: string): Session {
    if (!isUuid(id)) {
      throw new UserError(this.text('errBadSessionId'));
    }
    const session = this.store.data.sessions.find((item) => item.id === id);
    if (!session) {
      throw new UserError(this.text('errNoSession'));
    }
    return session;
  }

  private resolveCwd(profileCwd: string, sessionCwd: string): string {
    const raw = sessionCwd.trim() || profileCwd.trim() || this.host.defaultCwd();
    return path.resolve(raw);
  }
}

function normalizeProfile(draft: Record<string, unknown>, id: string, createdAt: number, updatedAt: number): Profile {
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  const program = typeof draft.program === 'string' ? draft.program.trim() : '';
  if (!name) {
    throw new UserError(this.text('errNeedName'));
  }
  if (!program) {
    throw new UserError(this.text('errNeedProgram'));
  }
  const shell = draft.shell === 'powershell' || draft.shell === 'cmd' || draft.shell === 'direct' ? draft.shell : undefined;
  if (!shell) {
    throw new UserError(this.text('errBadShell'));
  }
  const env = Array.isArray(draft.env)
    ? draft.env.map((entry) => {
      const record = asRecord(entry);
      return {
        key: typeof record.key === 'string' ? record.key : '',
        value: typeof record.value === 'string' ? record.value : '',
      };
    }).filter((entry) => entry.key.trim())
    : [];
  return {
    id,
    name,
    program,
    args: typeof draft.args === 'string' ? draft.args : '',
    shell: shell as ShellKind,
    cwd: typeof draft.cwd === 'string' ? draft.cwd.trim() : '',
    env,
    resumeRecent: typeof draft.resumeRecent === 'string' ? draft.resumeRecent : '',
    resumeSpecific: typeof draft.resumeSpecific === 'string' ? draft.resumeSpecific : '',
    ...websiteField(draft.website),
    ...iconOverrides({
      name,
      kind: typeof draft.templateId === 'string' ? draft.templateId : undefined,
      iconText: typeof draft.iconText === 'string' ? draft.iconText : '',
      iconColor: typeof draft.iconColor === 'string' ? draft.iconColor : '',
      iconImage: typeof draft.iconImage === 'string' ? draft.iconImage : '',
    }),
    templateId: typeof draft.templateId === 'string' ? draft.templateId : undefined,
    origin: draft.origin === 'template' ? 'template' : undefined,
    ...(draft.customized === true ? { customized: true } : {}),
    createdAt,
    updatedAt,
  };
}

function blankSession(id: string, name: string, profileId: string, cwd: string, cliHint: string): Session {
  const now = Date.now();
  return {
    id,
    name,
    profileId,
    cwd,
    status: 'exited',
    runMode: null,
    exitReason: null,
    exitCode: null,
    startedAt: null,
    endedAt: null,
    cliHint,
    lastCommand: '',
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

function fillSession(session: Session, launched: boolean, errorText: string, mode: RunMode): Session {
  const now = Date.now();
  const runMode: SessionRunMode = launched ? (mode === 'run' ? 'fresh' : 'resumed') : null;
  const exitReason: ExitReason = launched ? null : 'start-failed';
  return {
    ...session,
    status: launched ? 'running' : 'exited',
    runMode,
    exitReason,
    exitCode: null,
    startedAt: launched ? now : null,
    endedAt: launched ? null : now,
    lastError: launched ? null : errorText,
    lastCommand: launched ? session.lastCommand : session.lastCommand,
    updatedAt: now,
  };
}

function missingProgram(profile: Profile, program: string): string {
  const hint = installHint(profile.templateId, program, process.platform);
  const command = hint?.command ? `\n${hint.command}` : '';
  const note = hint?.note ? `\n${hint.note}` : '';
  return `${t('errProgramMissing', { program })}${note}${command}`;
}

function websiteField(value: unknown): { website: string } | Record<string, never> {
  if (typeof value !== 'string' || !value.trim()) return {};
  const website = normalizeWebsite(value);
  if (!website) throw new UserError(t('errBadWebsite'));
  return { website };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new UserError(t('errMissingValue', { key }));
  }
  return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
