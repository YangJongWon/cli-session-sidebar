import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import { currentLanguage, resolveLanguage, setLanguage, t, type UiLanguage } from '../shared/i18n';
import { findPathLinks } from '../shared/pathLinks';
import { automaticIcon, commandIcon, iconOverrides, normalizeIconColor, normalizeIconImage, type IconChoice } from '../shared/icon';
import { TEMPLATES, installHint, localizedMissingProgram, templatesFor, type Template } from '../shared/templates';
import type { EnvEntry, Profile, Session, ShellKind } from '../shared/types';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
setLanguage(resolveLanguage('auto', navigator.language));

interface ViewSession extends Session {
  attached: boolean;
}

interface AppState {
  profiles: Profile[];
  sessions: ViewSession[];
  activeSessionId: string | null;
  backend: 'daemon' | 'inprocess' | 'offline';
  backendNote: string;
  loadError: string | null;
  defaultCwd: string;
  hiddenTemplateIds: string[];
  removedTemplateIds: string[];
  uiLanguage: UiLanguage;
  installedTemplateIds: string[] | null;
}

interface Draft {
  id: string;
  templateId?: string;
  origin?: 'template';
  name: string;
  program: string;
  args: string;
  shell: ShellKind;
  cwd: string;
  env: EnvEntry[];
  resumeRecent: string;
  resumeSpecific: string;
  website: string;
  iconText: string;
  iconColor: string;
  iconImage: string;
}

const state: AppState = {
  profiles: [],
  sessions: [],
  activeSessionId: null,
  backend: 'offline',
  backendNote: '',
  loadError: null,
  defaultCwd: '',
  hiddenTemplateIds: [],
  removedTemplateIds: [],
  uiLanguage: 'auto',
  installedTemplateIds: null,
};

let keepEditor = false;
let renderedSessionId = '';
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let dragId = '';
let dragTarget = '';
let editingSessionId: string | null = null;
let formCounter = 0;
let homeProfilesKey = '';
let initialStateReceived = false;
let newTabOpen = true;
let newTabSelected = true;
let lastRevealedTab = '';
let commandSettingsOpen = false;
let preferencesOpen = false;
let term: Terminal | undefined;
let fit: FitAddon | undefined;
let searchAddon: SearchAddon | undefined;
let ctrlLatched = false;

const app = document.querySelector('#app');
if (!app) {
  throw new Error('앱 영역을 찾지 못했습니다.');
}

const main = el('div', 'screen');
const editor = el('div', 'screen editor');
editor.hidden = true;
const tabs = el('div', 'session-tabs');
tabs.setAttribute('role', 'tablist');
tabs.setAttribute('aria-label', t('tabs'));
const tabPrev = button('‹', 'tab-scroll', () => scrollTabs(-1));
const tabNext = button('›', 'tab-scroll', () => scrollTabs(1));
tabPrev.setAttribute('aria-label', t('tabPrevious'));
tabNext.setAttribute('aria-label', t('tabNext'));
tabPrev.hidden = true;
tabNext.hidden = true;
const addButton = button('+', 'icon-button');
addButton.title = t('newTask');
addButton.setAttribute('aria-label', t('addTask'));
const commandSettings = button('⚙︎', 'command-settings', () => openCommandSettings());
commandSettings.setAttribute('aria-label', t('commandSettings'));
commandSettings.title = t('commandSettings');
const location = document.createElement('details');
location.className = 'location';
const summary = document.createElement('summary');
summary.textContent = '…';
summary.setAttribute('aria-label', t('menu'));
const locationBody = el('div', 'card');
const manageCurrent = button(t('currentTaskSettings'), '', () => {
  location.open = false;
  if (!newTabSelected && state.activeSessionId) openSessionEditor(state.activeSessionId);
});
const menuTaskList = button(t('taskList'), '', () => { location.open = false; showMain(); toggleList(true); });
const menuEditor = button(t('editorTab'), '', () => changeLocation('editor'));
const menuPreferences = button(t('preferences'), '', () => { location.open = false; openPreferences(); });
const menuExtension = button(t('extensionSettings'), '', () => post({ type: 'openSettings' }));
locationBody.append(
  menuTaskList,
  manageCurrent,
  el('hr', 'menu-separator'),
  button('Primary Sidebar', '', () => changeLocation('primary')),
  button('Secondary Sidebar', '', () => changeLocation('secondary')),
  menuEditor,
  menuPreferences,
  menuExtension,
);
location.append(summary, locationBody);
const top = el('div', 'top');
const tabGroup = el('div', 'tab-group');
tabGroup.append(tabPrev, tabs, tabNext, addButton);
tabs.addEventListener('scroll', updateTabNav);
new ResizeObserver(updateTabNav).observe(tabs);
top.append(tabGroup, location);
const note = el('p', 'note');
const toast = el('p', 'toast');
toast.hidden = true;
toast.setAttribute('role', 'status');
toast.setAttribute('aria-live', 'polite');
const picker = el('section', 'session-picker');
picker.hidden = true;
picker.setAttribute('aria-label', t('savedTasks'));
const list = el('div', 'list');
const pickerHeader = el('div', 'picker-header');
const pickerTitle = el('h2', '', t('taskList'));
const taskSearch = document.createElement('input');
taskSearch.type = 'search';
taskSearch.className = 'task-search';
taskSearch.placeholder = t('searchTasks');
taskSearch.setAttribute('aria-label', t('searchTasks'));
taskSearch.addEventListener('input', () => renderList());
pickerHeader.append(pickerTitle);
picker.append(pickerHeader, taskSearch, list);
const status = el('div', 'status');
const termHost = el('div', 'term');
const closedPane = el('div', 'term-closed');
const closedText = el('p', '', '');
const closedCommand = el('code', 'install-command', '');
const closedActions = el('div', 'banner-actions');
const closedRun = button(t('install'), 'primary', () => runInstallActive());
const closedCopy = button(t('copyInstall'), '', () => copyInstallCommand());
const closedButton = button(t('rerun'), '', () => rerunActive());
closedActions.append(closedRun, closedCopy, closedButton);
closedPane.append(closedText, closedCommand, closedActions);
closedPane.hidden = true;
const findBar = el('div', 'find-bar');
const findInput = document.createElement('input');
findInput.type = 'search';
findInput.placeholder = t('searchTerminal');
findInput.setAttribute('aria-label', t('searchTerminal'));
const findPrevious = button(t('searchPrevious'), '', () => runFind(false));
const findNext = button(t('searchNext'), '', () => runFind(true));
const findClose = button('×', 'tab-close', () => closeFind());
findClose.setAttribute('aria-label', t('searchClose'));
findBar.append(findInput, findPrevious, findNext, findClose);
findBar.hidden = true;
findInput.addEventListener('input', () => runFind(true));
findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    runFind(!event.shiftKey);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeFind();
  }
});
termHost.append(closedPane, findBar);
const home = el('div', 'agent-home');
const registerCli = button(t('registerCli'), 'register-cli', () => openForm(emptyDraft()));
registerCli.setAttribute('aria-label', t('addCli'));
const keys = el('div', 'keys');
const composer = el('div', 'composer');
const input = document.createElement('textarea');
input.rows = 2;
input.setAttribute('aria-label', t('composerLabel'));
input.placeholder = t('composerPlaceholder');
input.autocomplete = 'off';
input.autocapitalize = 'off';
const sendButton = button(t('send'), 'primary', () => sendComposer());
composer.append(input, sendButton);
const findButton = button(t('searchTerminal'), '', () => openFind());
const pasteButton = button(t('paste'), '', () => paste());
const directButton = button(t('directInput'), '', () => {
  ensureTerminal();
  term?.focus();
});
directButton.addEventListener('mousedown', (event) => event.preventDefault());
keys.append(
  keyButton('Esc', '\x1b'),
  keyButton('Tab', '\t'),
  keyButton('Ctrl+C', '\x03'),
  keyButton('↑', '\x1b[A'),
  keyButton('↓', '\x1b[B'),
  keyButton('←', '\x1b[D'),
  keyButton('→', '\x1b[C'),
  button('Ctrl', '', () => {
    ctrlLatched = !ctrlLatched;
    renderCtrl();
  }, 'ctrl-toggle'),
  pasteButton,
  directButton,
  findButton,
);
main.append(picker, note, registerCli, home, termHost, status, composer, keys);
app.append(top, main, editor, toast);

addButton.addEventListener('click', () => openAgents());
document.addEventListener('pointerdown', (event) => {
  if (!picker.hidden && !picker.contains(event.target as Node)) toggleList(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !picker.hidden) { toggleList(false); tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !event.altKey) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.composer, .task-search, .editor')) return;
    event.preventDefault();
    openFind();
  }
});
input.addEventListener('keydown', (event) => {
  if (event.isComposing || event.key === 'Process') {
    return;
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendComposer();
  }
});

window.addEventListener('message', (event) => {
  const message = event.data as Record<string, unknown>;
  if (message.type === 'state') {
    applyState(message);
    return;
  }
  if (message.type === 'scrollback' && typeof message.sessionId === 'string' && typeof message.data === 'string') {
    if (message.sessionId === state.activeSessionId) {
      resetTerminal(message.data);
    }
    return;
  }
  if (message.type === 'output' && typeof message.sessionId === 'string' && typeof message.data === 'string') {
    if (message.sessionId === state.activeSessionId) {
      term?.write(message.data);
    }
    return;
  }
  if (message.type === 'saved') {
    if (typeof message.profileId === 'string' && message.formToken === editor.dataset.formToken) editor.dataset.profileId = message.profileId;
    showToast(t('saved'));
    return;
  }
  if (message.type === 'started') {
    newTabOpen = false;
    newTabSelected = false;
    showMain();
    showToast(t('taskStarted'));
    return;
  }
  if (message.type === 'sessionSaved') {
    showToast(t('taskInfoSaved'));
    return;
  }
  if (message.type === 'error' && typeof message.message === 'string') {
    const visible = state.sessions.find((item) => item.id === state.activeSessionId);
    if (visible?.lastError !== message.message) showToast(message.message.split('\n')[0]);
    if (!keepEditor) {
      showMain();
    }
    return;
  }
  if (message.type === 'picked' && typeof message.field === 'string' && typeof message.value === 'string') {
    const target = editor.querySelector<HTMLInputElement>(`[data-field="${message.field}"]`);
    if (target) {
      target.value = message.value;
    }
    return;
  }
  if (message.type === 'programCheck') {
    renderCheck(message);
  }
});

function applyState(message: Record<string, unknown>): void {
  state.profiles = Array.isArray(message.profiles) ? message.profiles as Profile[] : [];
  state.sessions = Array.isArray(message.sessions) ? message.sessions as ViewSession[] : [];
  state.activeSessionId = typeof message.activeSessionId === 'string' ? message.activeSessionId : null;
  if (!initialStateReceived) {
    newTabSelected = !state.activeSessionId;
    newTabOpen = newTabSelected;
    initialStateReceived = true;
  }
  state.backend = message.backend === 'daemon' || message.backend === 'inprocess' ? message.backend : 'offline';
  state.backendNote = typeof message.backendNote === 'string' ? message.backendNote : '';
  state.loadError = typeof message.loadError === 'string' ? message.loadError : null;
  state.defaultCwd = typeof message.defaultCwd === 'string' ? message.defaultCwd : '';
  state.hiddenTemplateIds = stringIds(message.hiddenTemplateIds);
  state.removedTemplateIds = stringIds(message.removedTemplateIds);
  state.uiLanguage = message.uiLanguage === 'ko' || message.uiLanguage === 'ja' || message.uiLanguage === 'zh' || message.uiLanguage === 'en' || message.uiLanguage === 'auto'
    ? message.uiLanguage : 'auto';
  state.installedTemplateIds = Array.isArray(message.installedTemplateIds) ? stringIds(message.installedTemplateIds) : null;
  const resolved = resolveLanguage(state.uiLanguage, navigator.language);
  if (resolved !== currentLanguage()) {
    setLanguage(resolved);
    applyChromeLanguage();
    homeProfilesKey = '';
  }
  note.textContent = state.loadError ?? '';
  note.hidden = !state.loadError;
  if (!dragId) renderList();
  renderDetail();
  if (preferencesOpen) renderPreferences();
  else if (commandSettingsOpen) renderCommandSettings();
  if (editingSessionId) {
    const editing = state.sessions.find((session) => session.id === editingSessionId);
    if (!editing) { showMain(); }
    else {
      const profile = state.profiles.find((item) => item.id === editing.profileId);
      const disabled = {
        'resume-recent': editing.attached || !profile?.resumeRecent,
        'resume-specific': editing.attached || !profile?.resumeSpecific,
        rerun: editing.attached,
        stop: !editing.attached,
      };
      for (const [kind, value] of Object.entries(disabled)) {
        const control = editor.querySelector<HTMLButtonElement>(`.${kind}`);
        if (control) control.disabled = value;
      }
    }
  }
  ensureTerminal();
}

function renderList(): void {
  list.replaceChildren();
  const visible = sessionsByDay().filter(taskMatches);
  if (visible.length === 0) {
    list.append(text(state.sessions.length === 0 ? t('noTasks') : t('noMatches')));
    return;
  }
  let lastDay = '';
  for (const session of visible) {
    const day = dayLabel(sessionDay(session));
    if (day !== lastDay) {
      lastDay = day;
      list.append(dayHeader(day, sessionsByDay().filter((item) => dayLabel(sessionDay(item)) === day)));
    }
    const row = el('div', 'session');
    row.className = session.id === state.activeSessionId ? 'session active' : 'session';
    row.dataset.session = session.id;
    const handle = button('⠿', 'drag-handle');
    handle.setAttribute('aria-label', t('reorder', { name: session.name }));
    handle.title = t('reorderHint');
    wireReorder(handle, row, session.id);
    const select = button('', 'session-select', () => {
      newTabSelected = false;
      post({ type: 'selectSession', sessionId: session.id });
      toggleList(false);
    });
    const dot = el('span', `dot ${dotClass(session)}`);
    const meta = el('span', 'meta');
    const name = el('span', 'name', session.name);
    fitLabel(name, 17);
    const profile = state.profiles.find((item) => item.id === session.profileId);
    const sub = el('span', 'sub', `${profile?.name ?? t('noProfile')} · ${session.cwd} · ${statusLabel(session)}`);
    meta.append(name, sub);
    select.append(dot, meta);
    const settings = button('⚙', 'icon-button', () => { toggleList(false); openSessionEditor(session.id); });
    settings.setAttribute('aria-label', t('sessionSettings', { name: session.name }));
    const reload = button('↻', 'icon-button', () => {
      toggleList(false);
      post({ type: 'reconnect', sessionId: session.id });
    });
    reload.setAttribute('aria-label', t('reconnectSession', { name: session.name }));
    row.append(handle, select, settings, reload);
    list.append(row);
  }
}

function renderDetail(): void {
  let session = newTabSelected ? undefined : state.sessions.find((item) => item.id === state.activeSessionId);
  if (!session && !newTabSelected) { newTabOpen = true; newTabSelected = true; }
  manageCurrent.disabled = !session;
  registerCli.hidden = Boolean(session);
  renderTabs();
  status.textContent = session ? statusLabel(session) : '';
  status.hidden = !session;
  home.hidden = Boolean(session);
  const profilesKey = JSON.stringify([state.profiles, state.hiddenTemplateIds, state.removedTemplateIds, state.installedTemplateIds]);
  if (!home.childElementCount || profilesKey !== homeProfilesKey) {
    const existingName = home.querySelector<HTMLInputElement>('[data-role="new-task-name"]')?.value ?? '';
    const wasOpen = home.querySelector('details')?.open ?? true;
    homeProfilesKey = profilesKey;
    const drawer = createAgentDrawer();
    drawer.open = wasOpen;
    home.replaceChildren(drawer, commandSettings);
    const nameField = home.querySelector<HTMLInputElement>('[data-role="new-task-name"]');
    if (nameField) nameField.value = existingName;
  }
  termHost.hidden = !session;
  composer.hidden = !session;
  keys.hidden = !session;
  const live = Boolean(session?.attached);
  const wasClosed = input.disabled;
  input.disabled = !live;
  sendButton.disabled = !live;
  const installId = installTarget(session);
  sendButton.textContent = t('send');
  for (const key of keys.querySelectorAll('button')) key.disabled = !live;
  const missing = session?.exitReason === 'start-failed' ? failureText(session) : '';
  const notice = missing || (session && !live ? t('inputClosed') : '');
  input.placeholder = session && !live ? t('inputClosed') : t('composerPlaceholder');
  closedPane.hidden = !session || live;
  closedText.textContent = notice.split('\n')[0] ?? '';
  closedText.title = notice;
  const command = installCommand(missing);
  closedCommand.hidden = !command;
  closedCommand.textContent = command;
  closedCommand.title = command;
  closedRun.hidden = !installId;
  closedRun.dataset.template = installId;
  closedRun.textContent = t('install');
  closedCopy.hidden = !command;
  closedCopy.dataset.command = command;
  closedCopy.textContent = t('copyInstall');
  closedCopy.classList.toggle('primary', !installId && Boolean(command));
  closedButton.textContent = t('rerun');
  closedButton.classList.toggle('primary', !installId && !command);
  if (!live) term?.blur();
  if (live && wasClosed) input.focus();
  if (renderedSessionId !== (session?.id ?? '')) term?.reset();
  renderedSessionId = session?.id ?? '';
  requestAnimationFrame(resizeTerminal);
}

function openSessionEditor(sessionId: string): void {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  keepEditor = true;
  showEditor();
  editingSessionId = sessionId;
  editor.replaceChildren(button(t('backToList'), '', () => { showMain(); toggleList(true); }), el('h1', '', t('taskSettings')));
  const detail = el('div', 'card');
  const profile = state.profiles.find((item) => item.id === session.profileId);
  const name = document.createElement('input');
  name.value = session.name;
  const hint = document.createElement('input');
  hint.value = session.cliHint;
  hint.placeholder = t('resumeId');
  detail.append(
    fieldWrap(t('taskName'), name),
    fieldWrap(t('resumeIdField'), hint),
    button(t('save'), 'primary', () => {
      post({ type: 'updateSession', sessionId: session.id, name: name.value, cliHint: hint.value });
    }),
    button(t('reconnect'), '', () => post({ type: 'reconnect', sessionId: session.id })),
    button(t('resumeRecent'), 'resume-recent', () => { showMain(); post({ type: 'resumeRecent', sessionId: session.id }); }, '', session.attached || !profile?.resumeRecent),
    button(t('resumeSpecific'), 'resume-specific', () => { showMain(); post({ type: 'resumeSpecific', sessionId: session.id, cliHint: hint.value }); }, '', session.attached || !profile?.resumeSpecific),
    button(t('rerun'), 'rerun', () => { showMain(); post({ type: 'rerun', sessionId: session.id }); }, '', session.attached),
    button(t('stop'), '', () => {
      confirmAction(t('stopConfirm'), () => post({ type: 'stopSession', sessionId: session.id }));
    }, 'stop', !session.attached),
    button(t('delete'), '', () => {
      confirmAction(t('deleteTaskConfirm'), () => {
        post({ type: 'deleteSession', sessionId: session.id });
        showMain();
      });
    }),
    button(t('editProfile'), '', () => profile && openForm(draftFromProfile(profile))),
  );
  if (session.lastCommand) {
    detail.append(text(t('lastCommand', { command: session.lastCommand })));
  }
  if (session.lastError) {
    detail.append(text(session.exitReason === 'start-failed' ? failureText(session) : session.lastError));
  }
  detail.append(text(helpFor(session)));
  editor.append(detail);
}

function openAgents(): void {
  keepEditor = true;
  newTabOpen = true;
  newTabSelected = true;
  showMain();
}

function renderTabs(): void {
  const scrollLeft = tabs.scrollLeft;
  const focused = tabs.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).dataset.tab : undefined;
  tabs.replaceChildren();
  const addTab = (id: string, label: string, selected: boolean, session?: ViewSession) => {
    const tab = el('div', `session-tab${selected ? ' active' : ''}`);
    const selectTab = () => {
      newTabSelected = id === 'new';
      if (newTabSelected) newTabOpen = true;
      else post({ type: 'selectSession', sessionId: id });
      showMain();
    };
    tab.dataset.tab = id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-label', label);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.title = session ? `${label} · ${statusLabel(session)}` : label;
    tab.addEventListener('click', () => {
      if (tab.dataset.dragged === 'true') {
        delete tab.dataset.dragged;
        return;
      }
      selectTab();
    });
    if (session) {
      tab.append(el('span', `dot ${dotClass(session)}`));
      wireTabDrag(tab, session.id);
    }
    tab.append(el('span', 'tab-name', label));
    if (session) {
      const close = button('×', 'tab-close', (event) => {
        event.stopPropagation();
        const remove = () => post({ type: 'deleteSession', sessionId: session.id });
        if (session.attached) confirmAction(t('deleteTaskConfirm'), remove);
        else remove();
      });
      close.setAttribute('aria-label', t('closeNamed', { name: label }));
      close.tabIndex = -1;
      tab.append(close);
    }
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]'));
      const index = buttons.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
      buttons[next].click();
    });
    tabs.append(tab);
  };
  const openSessions = state.sessions.filter((session) => !session.preserved);
  for (const session of openSessions) addTab(session.id, session.name,
    !newTabSelected && session.id === state.activeSessionId, session);
  if (newTabOpen || !openSessions.length) addTab('new', t('newTask'), newTabSelected);
  if (focused) {
    Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]'))
      .find((tab) => tab.dataset.tab === focused)?.focus({ preventScroll: true });
  }
  tabs.scrollLeft = scrollLeft;
  const selected = tabs.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selected && selected.dataset.tab !== lastRevealedTab) {
    lastRevealedTab = selected.dataset.tab ?? '';
    const bounds = tabs.getBoundingClientRect();
    const activeBounds = selected.getBoundingClientRect();
    if (activeBounds.left < bounds.left) tabs.scrollLeft -= bounds.left - activeBounds.left;
    else if (activeBounds.right > bounds.right) tabs.scrollLeft += activeBounds.right - bounds.right;
  }
  updateTabNav();
}

function updateTabNav(): void {
  const max = tabs.scrollWidth - tabs.clientWidth;
  tabPrev.hidden = max <= 1 || tabs.scrollLeft <= 1;
  tabNext.hidden = max <= 1 || tabs.scrollLeft >= max - 1;
}

function scrollTabs(direction: -1 | 1): void {
  const items = Array.from(tabs.querySelectorAll<HTMLElement>('[role="tab"]'));
  const view = tabs.getBoundingClientRect();
  const next = direction > 0
    ? items.find((item) => item.getBoundingClientRect().right > view.right + 1)
    : [...items].reverse().find((item) => item.getBoundingClientRect().left < view.left - 1);
  if (!next) return;
  const item = next.getBoundingClientRect();
  tabs.scrollLeft += direction > 0 ? item.right - view.right : item.left - view.left;
}

function wireTabDrag(tab: HTMLElement, id: string): void {
  let originX = 0;
  let originY = 0;
  let dragging = false;
  let pointer = -1;
  let dropId = '';
  let slots: { id: string; index: number; center: number; el: HTMLElement }[] = [];
  let from = 0;
  let grab = 0;
  let home = 0;
  let width = 0;
  const clearShift = () => {
    for (const item of tabs.querySelectorAll<HTMLElement>('.session-tab')) {
      item.style.transform = '';
      item.classList.remove('dragging');
    }
  };
  tab.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.tab-close')) return;
    originX = event.clientX;
    originY = event.clientY;
    dragging = false;
    pointer = event.pointerId;
    try { tab.setPointerCapture(event.pointerId); } catch { /* the pointer can already be released */ }
  });
  tab.addEventListener('pointermove', (event) => {
    if (pointer !== event.pointerId) return;
    if (!dragging && Math.hypot(event.clientX - originX, event.clientY - originY) < 6) return;
    if (!dragging) {
      dragging = true;
      tab.dataset.dragged = 'true';
      tab.classList.add('dragging');
      const strip = tabs.getBoundingClientRect();
      const tabBox = tab.getBoundingClientRect();
      grab = originX - tabBox.left;
      home = tabBox.left - strip.left + tabs.scrollLeft;
      width = tabBox.width;
      slots = Array.from(tabs.querySelectorAll<HTMLElement>('.session-tab'))
        .filter((item) => item.dataset.tab && item.dataset.tab !== 'new')
        .map((item, index) => {
          const box = item.getBoundingClientRect();
          return { id: item.dataset.tab ?? '', index, center: box.left - strip.left + tabs.scrollLeft + box.width / 2, el: item };
        });
      from = slots.findIndex((slot) => slot.id === id);
    }
    const strip = tabs.getBoundingClientRect();
    const delta = event.clientX - grab - (strip.left + home - tabs.scrollLeft);
    tab.style.transform = `translate(${delta}px, -3px) scale(1.05)`;
    const center = home + delta + width / 2;
    let to = from;
    for (const slot of slots) {
      if (slot.index === from) continue;
      if (center >= slot.center && slot.index > to) to = slot.index;
      if (center <= slot.center && slot.index < to) to = slot.index;
    }
    for (const slot of slots) {
      if (slot.index === from) continue;
      const shift = from < to && slot.index > from && slot.index <= to ? -width
        : to < from && slot.index >= to && slot.index < from ? width : 0;
      const next = shift ? `translateX(${shift}px)` : '';
      if (slot.el.style.transform !== next) slot.el.style.transform = next;
    }
    dropId = to === from ? '' : slots[to]?.id ?? '';
    if (event.clientX < strip.left + 28) tabs.scrollLeft -= 16;
    if (event.clientX > strip.right - 28) tabs.scrollLeft += 16;
  });
  const finish = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    pointer = -1;
    const target = dropId;
    clearShift();
    if (dragging && target) reorder(id, target);
    dropId = '';
    dragging = false;
  };
  tab.addEventListener('pointerup', finish);
  tab.addEventListener('pointercancel', finish);
}

function createAgentDrawer(): HTMLDetailsElement {
  const drawer = document.createElement('details');
  drawer.className = 'agent-drawer';
  drawer.open = true;
  const heading = document.createElement('summary');
  heading.append(el('span', '', t('commands')), el('span', 'count', String(customProfiles().length + visibleTemplates().length)));
  drawer.append(heading);
  const saved = el('div', 'agent-section');
  saved.append(el('h2', 'section-label', t('customCommands')));
  const sessionName = document.createElement('input');
  sessionName.placeholder = t('newTaskNamePlaceholder');
  sessionName.setAttribute('aria-label', t('newTaskName'));
  sessionName.dataset.role = 'new-task-name';
  saved.append(sessionName);
  for (const profile of customProfiles()) {
    const row = el('div', 'profile-row');
    const select = agentOption(profile.name, profile.program, profile.templateId, () => {
      keepEditor = false;
      post({ type: 'startFromProfile', profileId: profile.id, name: sessionName.value });
    }, null, undefined, profile.website ?? '', profile);
    select.classList.add('profile-select');
    const edit = button('⚙', 'agent-edit', () => openForm(draftFromProfile(profile)));
    edit.setAttribute('aria-label', t('editNamed', { name: profile.name }));
    row.append(select, edit);
    saved.append(row);
  }
  const templates = el('div', 'agent-section');
  const shown = visibleTemplates();
  if (shown.length) templates.append(el('h2', 'section-label', t('builtinCommands')));
  for (const template of shown) {
    const name = builtinLabel(template);
    const status = installStatus(template.id);
    templates.append(agentOption(name, builtinCommand(template), template.id, () => {
      keepEditor = false;
      post({ type: 'startFromTemplate', id: template.id });
    }, status, () => {
      if (status === 'installed') {
        confirmAction(t('deleteBuiltinConfirm', { name }), () => post({ type: 'removeTemplate', id: template.id }));
        return;
      }
      requestInstall(template.id, installHint(template.id, template.program, hostPlatform())?.command ?? '');
    }, builtinWebsite(template), builtinProfile(template.id)));
  }
  if (customProfiles().length) drawer.append(saved);
  if (shown.length) drawer.append(templates);
  return drawer;
}

function openCommandSettings(): void {
  keepEditor = true;
  showEditor();
  commandSettingsOpen = true;
  renderCommandSettings();
}

function renderCommandSettings(): void {
  editor.classList.add('manages-commands');
  editor.replaceChildren(pageHeader(t('commandManagement'), () => openAgents(),
    button(t('registerCli'), 'quiet-button', () => openForm(emptyDraft()))));
  const commands = el('section', 'command-management');
  commands.append(el('h2', 'section-label', t('customCommands')));
  if (!customProfiles().length) commands.append(text(t('noCustom')));
  for (const profile of customProfiles()) {
    const row = el('div', 'profile-row management-row');
    const edit = agentOption(profile.name, profile.program, profile.templateId, () => openForm(draftFromProfile(profile)), null, undefined, profile.website ?? '', profile);
    edit.classList.add('profile-select');
    const blocked = state.sessions.some((session) => session.profileId === profile.id);
    const remove = iconButton(t('deleteNamed', { name: profile.name }), 'command-delete', deleteIcon(), () => {
      confirmAction(t('deleteCommandConfirm', { name: profile.name }), () => post({ type: 'deleteProfile', id: profile.id }));
    }, blocked);
    if (blocked) remove.dataset.tip = t('deleteBlocked');
    row.append(edit, remove);
    commands.append(row);
  }
  editor.append(commands, builtinManagement());
}

function builtinManagement(): HTMLElement {
  const section = el('section', 'command-management builtin-commands');
  section.append(el('h2', 'section-label', t('builtinCommands')));
  const scroll = el('div', 'builtin-scroll');
  const listed = orderedTemplates().filter((template) => !state.removedTemplateIds.includes(template.id));
  if (!listed.length) scroll.append(text(t('noVisibleBuiltins')));
  for (const template of listed) {
    const hidden = state.hiddenTemplateIds.includes(template.id);
    const label = builtinLabel(template);
    const row = el('div', `profile-row management-row${hidden ? ' is-hidden' : ''}`);
    const open = agentOption(label, builtinCommand(template), template.id, () => openForm(draftForBuiltin(template)), installStatus(template.id), undefined, builtinWebsite(template), builtinProfile(template.id));
    open.classList.add('profile-select');
    const changed = builtinProfile(template.id)?.customized === true;
    const reset = iconButton(t('resetNamed', { name: label }), 'command-reset', resetIcon(), () => {
      confirmAction(t('resetBuiltinConfirm', { name: label }), () => post({ type: 'resetTemplate', id: template.id }));
    }, !changed);
    if (!changed) reset.dataset.tip = t('resetBuiltinIdle');
    const visibility = iconButton(hidden ? t('showNamed', { name: label }) : t('hideNamed', { name: label }), 'command-visibility', hidden ? showIcon() : hideIcon(), () => {
      post({ type: 'setTemplateHidden', id: template.id, hidden: !hidden });
    });
    const remove = iconButton(t('deleteNamed', { name: label }), 'command-delete', deleteIcon(), () => {
      confirmAction(t('deleteBuiltinConfirm', { name: label }), () => {
        post({ type: 'removeTemplate', id: template.id });
      });
    });
    row.append(open, reset, remove, visibility);
    scroll.append(row);
  }
  const removed = orderedTemplates().filter((template) => state.removedTemplateIds.includes(template.id));
  if (removed.length) {
    scroll.append(el('h2', 'section-label', t('removedBuiltins')));
    for (const template of removed) {
      const row = el('div', 'profile-row management-row');
      const label = el('span', 'agent-name', templateLabel(template));
      const restore = iconButton(t('restoreNamed', { name: templateLabel(template) }), 'command-visibility', resetIcon(), () => post({ type: 'restoreTemplate', id: template.id }));
      row.append(label, restore);
      scroll.append(row);
    }
  }
  section.append(scroll);
  return section;
}

function orderedTemplates(): Template[] {
  const shells = new Set(['powershell', 'pwsh', 'git-bash', 'cmd', 'zsh', 'brew']);
  const available = templatesFor(hostPlatform());
  return [...available.filter((item) => !shells.has(item.id)), ...available.filter((item) => shells.has(item.id))];
}

function customProfiles(): Profile[] {
  return state.profiles.filter((profile) => profile.origin !== 'template');
}

function builtinProfile(templateId: string): Profile | undefined {
  return state.profiles.find((profile) => profile.origin === 'template' && profile.templateId === templateId);
}

function builtinLabel(template: Template): string {
  const profile = builtinProfile(template.id);
  return profile?.customized ? profile.name : templateLabel(template);
}

function builtinCommand(template: Template): string {
  const profile = builtinProfile(template.id);
  if (!profile?.customized) return template.program;
  return [profile.program, profile.args].filter(Boolean).join(' ');
}

function builtinWebsite(template: Template): string {
  const profile = builtinProfile(template.id);
  if (profile?.customized) return profile.website ?? '';
  return template.website;
}

function visibleTemplates(): Template[] {
  return orderedTemplates().filter((template) => !state.removedTemplateIds.includes(template.id) && !state.hiddenTemplateIds.includes(template.id));
}

function draftForBuiltin(template: Template): Draft {
  const profile = builtinProfile(template.id);
  if (profile) {
    const draft = { ...draftFromProfile(profile), origin: 'template' as const };
    if (!profile.customized) draft.website = profile.website || template.website;
    return draft;
  }
  return {
    id: '',
    templateId: template.id,
    origin: 'template',
    name: templateLabel(template),
    program: template.program,
    args: template.args,
    shell: template.shell,
    cwd: '',
    env: [],
    resumeRecent: template.resumeRecent,
    resumeSpecific: template.resumeSpecific,
    website: template.website,
    iconText: '',
    iconColor: '',
    iconImage: '',
  };
}

function templateLabel(template: Template): string {
  return template.id === 'cmd' ? t('templateCmd') : template.label;
}

function openPreferences(): void {
  keepEditor = true;
  showEditor();
  preferencesOpen = true;
  renderPreferences();
}

function renderPreferences(): void {
  editor.replaceChildren(pageHeader(t('preferences'), () => openAgents()));
  const card = el('div', 'card');
  const select = document.createElement('select');
  select.dataset.field = 'language';
  select.setAttribute('aria-label', t('language'));
  for (const option of [
    ['auto', t('languageAuto')],
    ['ko', '한국어'],
    ['ja', '日本語'],
    ['zh', '中文'],
    ['en', 'English'],
  ] as const) {
    const item = document.createElement('option');
    item.value = option[0];
    item.textContent = option[1];
    item.selected = state.uiLanguage === option[0];
    select.append(item);
  }
  select.addEventListener('change', () => post({ type: 'setUiLanguage', language: select.value }));
  card.append(fieldWrap(t('language'), select), text(t('languageHelp')));
  editor.append(card);
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function openForm(draft: Draft): void {
  keepEditor = true;
  showEditor();
  editor.classList.add('edits-command');
  editor.replaceChildren();
  editor.dataset.profileId = draft.id;
  editor.dataset.formToken = String(++formCounter);
  editor.append(pageHeader(draft.origin === 'template' || draft.id ? t('editCli') : t('registerCli'), () => openAgents()));
  const form = el('div', 'profile-form');
  const name = labeled(t('displayName'), draft.name, 'name');
  name.placeholder = t('displayNamePlaceholder');
  const website = labeled(t('website'), draft.website, 'website');
  website.placeholder = t('websitePlaceholder');
  website.inputMode = 'url';
  website.title = t('websiteHint');
  const iconText = labeled(t('iconText'), draft.iconText, 'iconText');
  iconText.maxLength = 2;
  iconText.placeholder = automaticIcon(draft.name, draft.templateId).text;
  iconText.title = t('iconHint');
  const iconColor = document.createElement('input');
  iconColor.type = 'color';
  iconColor.dataset.field = 'iconColor';
  iconColor.setAttribute('aria-label', t('iconColor'));
  let autoColor = automaticIcon(draft.name, draft.templateId).color;
  iconColor.value = normalizeIconColor(draft.iconColor) || autoColor;
  let iconImage = draft.iconImage;
  const iconPreview = el('span', 'agent-avatar');
  iconPreview.setAttribute('aria-hidden', 'true');
  const iconFile = document.createElement('input');
  iconFile.type = 'file';
  iconFile.accept = 'image/png,image/jpeg,image/webp,image/gif';
  iconFile.hidden = true;
  const pickIcon = button(t('iconPick'), 'text-button', () => iconFile.click());
  const clearIcon = button(t('iconClear'), 'text-button', () => {
    iconImage = '';
    iconFile.value = '';
    paintIcon();
  });
  const paintIcon = () => {
    paintAvatar(iconPreview, commandIcon({ name: name.value, kind: draft.templateId, iconText: iconText.value, iconColor: iconColor.value, iconImage }));
    clearIcon.hidden = !iconImage;
  };
  name.addEventListener('input', () => {
    const next = automaticIcon(name.value, draft.templateId);
    iconText.placeholder = next.text;
    if (iconColor.value.toLowerCase() === autoColor) iconColor.value = next.color;
    autoColor = next.color;
    paintIcon();
  });
  iconText.addEventListener('input', paintIcon);
  iconColor.addEventListener('input', paintIcon);
  iconFile.addEventListener('change', () => {
    const chosen = iconFile.files?.[0];
    iconFile.value = '';
    if (chosen) void applyIconFile(chosen);
  });
  const applyIconFile = async (file: File) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 1_500_000) {
      showToast(t('errBadIcon'));
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      const scale = Math.max(size / bitmap.width, size / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
      bitmap.close();
      const data = canvas.toDataURL('image/png');
      if (!normalizeIconImage(data)) throw new Error('image');
      iconImage = data;
      paintIcon();
    } catch {
      showToast(t('errBadIcon'));
    }
  };
  const iconLetters = document.createElement('label');
  iconLetters.className = 'icon-field';
  iconLetters.append(el('span', '', t('iconText')), iconText);
  const iconSwatch = document.createElement('label');
  iconSwatch.className = 'icon-field';
  iconSwatch.append(el('span', '', t('iconColor')), iconColor);
  const iconRow = el('div', 'icon-editor');
  iconRow.append(iconPreview, iconLetters, iconSwatch, pickIcon, clearIcon, iconFile);
  paintIcon();
  const program = labeledArea(t('program'), draft.program, 'program');
  program.placeholder = t('programPlaceholder');
  program.title = t('commandLineHint');
  const args = labeledArea(t('args'), draft.args, 'args');
  args.placeholder = t('argsPlaceholder');
  args.title = t('commandLineHint');
  const shell = document.createElement('select');
  shell.dataset.field = 'shell';
  const shellOptions: [string, string][] = [['direct', t('shellDirect')]];
  if (hostPlatform() === 'win32' || draft.shell === 'powershell') shellOptions.push(['powershell', t('shellPowershell')]);
  if (hostPlatform() === 'win32' || draft.shell === 'cmd') shellOptions.push(['cmd', t('shellCmd')]);
  for (const option of shellOptions) {
    const item = document.createElement('option');
    item.value = option[0];
    item.textContent = option[1];
    item.selected = draft.shell === option[0];
    shell.append(item);
  }
  const cwd = labeled(t('cwd'), draft.cwd, 'cwd');
  cwd.placeholder = state.defaultCwd ? t('cwdPlaceholder', { cwd: state.defaultCwd }) : t('cwdPlaceholderDefault');
  const recent = labeledArea(t('resumeRecentCommand'), draft.resumeRecent, 'resumeRecent');
  recent.title = t('commandLineHint');
  const specific = labeledArea(t('resumeSpecificCommand'), draft.resumeSpecific, 'resumeSpecific');
  specific.placeholder = t('resumeSpecificPlaceholder');
  specific.title = t('commandLineHint');
  const envBox = el('div', 'environment-fields');
  const envRows: { key: HTMLInputElement; value: HTMLInputElement }[] = [];
  const drawEnv = () => {
    envBox.replaceChildren(el('h3', 'section-label', t('env')));
    for (const entry of envRows) {
      const row = el('div', 'env-row');
      entry.key.setAttribute('aria-label', t('envName'));
      entry.value.setAttribute('aria-label', t('envValue'));
      const remove = button('×', 'remove-variable', () => {
        const index = envRows.indexOf(entry);
        if (index >= 0) {
          envRows.splice(index, 1);
        }
        drawEnv();
      });
      remove.setAttribute('aria-label', t('envDelete'));
      row.append(entry.key, entry.value, remove);
      envBox.append(row);
    }
    envBox.append(button(t('addEnv'), 'text-button', () => {
      envRows.push({ key: miniInput(t('envKey')), value: miniInput(t('envVal')) });
      drawEnv();
    }));
  };
  for (const entry of draft.env) {
    const key = miniInput(t('envKey'));
    const value = miniInput(t('envVal'));
    key.value = entry.key;
    value.value = entry.value;
    envRows.push({ key, value });
  }
  drawEnv();
  const check = el('div', 'check');
  check.hidden = true;
  const readDraft = (): Draft => ({
    id: editor.dataset.profileId || draft.id,
    templateId: draft.templateId,
    origin: draft.origin,
    name: name.value,
    program: program.value,
    args: args.value,
    shell: (shell.value === 'powershell' || shell.value === 'cmd' ? shell.value : 'direct'),
    cwd: cwd.value,
    env: envRows.map((entry) => ({ key: entry.key.value, value: entry.value.value })),
    resumeRecent: recent.value,
    resumeSpecific: specific.value,
    website: website.value,
    iconText: iconText.value,
    iconColor: iconColor.value,
    iconImage,
  });
  const startName = document.createElement('input');
  startName.dataset.field = 'startName';
  startName.placeholder = t('autoName');
  const identity = el('section', 'form-section');
  identity.append(fieldWrap(t('displayName'), name), fieldWrap(t('icon'), iconRow), fieldWrap(t('website'), website));
  const execution = el('section', 'form-section');
  execution.append(el('h2', 'section-label', t('execution')));
  const programControl = el('div', 'input-with-action');
  const pickProgram = button('…', 'browse-button', () => post({ type: 'pickProgram' }));
  pickProgram.setAttribute('aria-label', t('pickProgram'));
  pickProgram.title = t('pickProgram');
  browseIcon(pickProgram, 'file');
  programControl.append(program, pickProgram);
  program.id = `program-${formCounter}`;
  const programField = fieldWrap(t('program'), programControl);
  const checkButton = button(t('checkPath'), 'text-button', () => post({
      type: 'checkProgram',
      program: program.value,
      templateId: draft.templateId,
    }));
  checkButton.title = t('checkPathTitle');
  const cwdControl = el('div', 'input-with-action');
  const pickFolder = button('…', 'browse-button', () => post({ type: 'pickFolder' }));
  pickFolder.setAttribute('aria-label', t('pickFolder'));
  pickFolder.title = t('pickFolder');
  browseIcon(pickFolder, 'folder');
  cwdControl.append(cwd, pickFolder);
  cwd.id = `cwd-${formCounter}`;
  const cwdField = fieldWrap(t('cwd'), cwdControl);
  execution.append(programField, checkButton, check, fieldWrap(t('args'), args), cwdField);

  const advanced = document.createElement('details');
  advanced.className = 'advanced-settings';
  const advancedHeading = document.createElement('summary');
  advancedHeading.append(el('span', '', t('advanced')), el('small', '', t('advancedHint')));
  const advancedFields = el('div', 'advanced-fields');
  advancedFields.append(fieldWrap(t('shell'), shell),
    fieldWrap(t('resumeRecentCommand'), recent),
    fieldWrap(t('resumeSpecificCommand'), specific),
    text(t('idHint')), envBox, fieldWrap(t('newTaskName'), startName),
  );
  advanced.append(advancedHeading, advancedFields);
  form.append(identity, execution, advanced);
  if (draft.id && draft.origin !== 'template') {
    advancedFields.append(button(t('deleteProfile'), 'danger-button', () => {
      confirmAction(t('deleteProfileConfirm'), () => {
        post({ type: 'deleteProfile', id: draft.id });
        showMain();
      });
    }));
  }
  const footer = el('div', 'form-footer');
  if (draft.origin === 'template' && draft.templateId) {
    const templateId = draft.templateId;
    const reset = button(t('resetBuiltin'), 'save-button', () => {
      confirmAction(t('resetBuiltinConfirm', { name: name.value || draft.name }), () => {
        post({ type: 'resetTemplate', id: templateId });
        openCommandSettings();
      });
    });
    reset.setAttribute('aria-label', t('resetNamed', { name: name.value || draft.name }));
    footer.append(reset);
  }
  footer.append(button(t('save'), 'save-button', () => saveDraft(readDraft(), undefined)),
    button(t('saveAndStart'), 'primary', () => saveDraft(readDraft(), startName.value)));
  const scroller = el('div', 'form-scroll');
  scroller.append(form);
  editor.append(scroller, footer);
  const syncGutter = () => editor.style.setProperty('--scrollbar', `${scroller.offsetWidth - scroller.clientWidth}px`);
  syncGutter();
  new ResizeObserver(syncGutter).observe(scroller);
  form.dataset.checkHost = '1';
  check.dataset.role = 'check';
}

function pageHeader(label: string, goBack: () => void, action?: HTMLElement): HTMLElement {
  const header = el('header', 'page-header');
  const back = button('‹', 'back-button', goBack);
  back.setAttribute('aria-label', t('back'));
  header.append(back, el('h1', '', label));
  if (action) header.append(action);
  return header;
}

function browseIcon(control: HTMLButtonElement, kind: 'file' | 'folder'): void {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.6');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  outline.setAttribute('d', kind === 'folder'
    ? 'M3 7V4h6l3 3h9v13H3V7Zm0 0h6l3 3h9'
    : 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 13h8M8 17h6');
  icon.append(outline);
  control.replaceChildren(icon);
}

function fitLabel(node: HTMLElement, max = 15): void {
  const apply = () => {
    if (!node.isConnected) {
      observer.disconnect();
      return;
    }
    node.style.fontSize = `${max}px`;
    let size = max;
    while (size > 12 && node.scrollWidth > node.clientWidth + 1) {
      size -= 0.5;
      node.style.fontSize = `${size}px`;
    }
  };
  const observer = new ResizeObserver(apply);
  observer.observe(node);
}

function dayHeader(day: string, sessions: ViewSession[]): HTMLElement {
  const head = el('div', 'day-head');
  const preserve = button(t('preserve'), 'preserve-task', () => {
    post({ type: 'setSessionsPreserved', sessionIds: sessions.map((item) => item.id), preserved: true });
  }, '', sessions.every((item) => item.preserved));
  preserve.setAttribute('aria-label', t('preserveDay', { day }));
  const restore = button(t('restore'), 'preserve-task', () => {
    post({ type: 'setSessionsPreserved', sessionIds: sessions.map((item) => item.id), preserved: false });
  }, '', sessions.every((item) => !item.preserved));
  restore.setAttribute('aria-label', t('restoreDay', { day }));
  head.append(el('h3', 'day-label', day), preserve, restore);
  return head;
}

function sessionDay(session: ViewSession): number {
  const time = session.createdAt > 0 ? session.createdAt : Date.now();
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(day: number): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = Math.round((start.getTime() - day) / 86_400_000);
  if (diff === 0) return t('today');
  if (diff === 1) return t('yesterday');
  const locale = currentLanguage() === 'zh' ? 'zh-CN' : currentLanguage();
  return new Date(day).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

function sessionsByDay(): ViewSession[] {
  return [...state.sessions].sort((a, b) => sessionDay(b) - sessionDay(a) || state.sessions.indexOf(a) - state.sessions.indexOf(b));
}

function installStatus(templateId: string): 'installed' | 'missing' | null {
  if (!state.installedTemplateIds) return null;
  return state.installedTemplateIds.includes(templateId) ? 'installed' : 'missing';
}

function agentOption(label: string, command: string, kind: string | undefined, select: () => void, status: 'installed' | 'missing' | null = null, action?: () => void, website = '', source?: Profile): HTMLElement {
  const row = el('div', 'agent-option');
  const open = button(label, 'agent-name-hit', (event) => {
    event.stopPropagation();
    select();
  });
  open.title = label;
  fitLabel(open);
  const avatar = el('span', 'agent-avatar');
  avatar.setAttribute('aria-hidden', 'true');
  paintAvatar(avatar, commandIcon({
    name: label,
    kind,
    iconText: source?.customized === false ? '' : source?.iconText,
    iconColor: source?.customized === false ? '' : source?.iconColor,
    iconImage: source?.customized === false ? '' : source?.iconImage,
  }));
  const nameRow = el('span', 'agent-name-row');
  nameRow.append(open);
  if (website) {
    const link = button('', 'agent-link', (event) => {
      event.stopPropagation();
      post({ type: 'openExternal', url: website });
    });
    link.setAttribute('aria-label', t('openWebsite', { name: label }));
    link.title = website;
    link.append(externalIcon());
    nameRow.append(link);
  }
  if (status) {
    const tools = el('span', 'agent-tools');
    if (action) {
      const actionButton = button(status === 'installed' ? t('delete') : t('install'), 'install-action', (event) => {
        event.stopPropagation();
        action();
      });
      actionButton.setAttribute('aria-label', status === 'installed' ? t('deleteNamed', { name: label }) : t('installNamed', { name: label }));
      tools.append(actionButton);
    }
    const badge = el('span', `install-status is-${status} tip`);
    badge.append(status === 'installed' ? checkIcon() : missingIcon());
    badge.dataset.tip = status === 'installed' ? t('installed') : t('notInstalled');
    badge.setAttribute('aria-label', badge.dataset.tip);
    tools.append(badge);
    nameRow.append(tools);
  }
  const arrow = el('span', 'agent-arrow', '›');
  arrow.setAttribute('aria-hidden', 'true');
  nameRow.append(arrow);
  const description = el('span', 'agent-description');
  description.append(nameRow, el('code', 'agent-command', command));
  row.append(avatar, description);
  row.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.agent-tools, .agent-name-hit, .agent-link')) return;
    select();
  });
  return row;
}

function paintAvatar(node: HTMLElement, icon: IconChoice): void {
  node.classList.toggle('has-image', Boolean(icon.image));
  node.style.setProperty('--agent-accent', icon.color);
  node.replaceChildren();
  if (icon.image) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = icon.image;
    node.append(img);
    return;
  }
  node.textContent = icon.text;
}

function saveDraft(draft: Draft, startName: string | undefined): void {
  let icons: ReturnType<typeof iconOverrides>;
  try {
    icons = iconOverrides({ name: draft.name, kind: draft.templateId, iconText: draft.iconText, iconColor: draft.iconColor, iconImage: draft.iconImage });
  } catch (error) {
    showToast(error instanceof Error ? error.message : t('errBadIcon'));
    return;
  }
  keepEditor = startName === undefined;
  post({
    type: 'saveProfile',
    formToken: editor.dataset.formToken,
    profile: {
      id: draft.id || undefined,
      templateId: draft.templateId,
      name: draft.name,
      program: draft.program,
      args: draft.args,
      shell: draft.shell,
      cwd: draft.cwd,
      env: draft.env,
      resumeRecent: draft.resumeRecent,
      resumeSpecific: draft.resumeSpecific,
      website: draft.website,
      ...icons,
      ...(draft.origin === 'template' ? { origin: 'template', customized: true } : {}),
    },
    startName,
  });
}

function renderCheck(message: Record<string, unknown>): void {
  const host = editor.querySelector<HTMLElement>('[data-role="check"]');
  if (!host) {
    return;
  }
  host.hidden = false;
  host.replaceChildren();
  if (message.found) {
    host.append(text(t('resolved', { path: String(message.resolved ?? '') })));
    host.append(text(t('loginHint')));
    return;
  }
  const hint = message.hint && typeof message.hint === 'object' ? message.hint as Record<string, unknown> : undefined;
  host.append(text(typeof hint?.title === 'string' ? hint.title : t('programMissing')));
  if (typeof hint?.note === 'string') {
    host.append(text(hint.note));
  }
  if (typeof hint?.command === 'string' && hint.command) {
    const command = hint.command;
    host.append(text(command));
    host.append(button(t('copyInstall'), '', async () => {
      try {
        await navigator.clipboard.writeText(command);
        showToast(t('installCopied'));
      } catch {
        showToast(command);
      }
    }));
  }
}

function ensureTerminal(): void {
  if (term) {
    return;
  }
  term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", monospace',
    fontSize: 13,
    scrollback: 5000,
    theme: terminalTheme(),
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);
  term.open(termHost);
  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const content = term?.buffer.active.getLine(bufferLineNumber - 1)?.translateToString(true) ?? '';
      const sessionId = state.activeSessionId;
      callback(findPathLinks(content).map((link) => ({
        range: {
          start: { x: link.start + 1, y: bufferLineNumber },
          end: { x: link.end, y: bufferLineNumber },
        },
        text: link.file,
        activate() {
          if (sessionId) post({ type: 'openPath', sessionId, path: link.file, line: link.line, column: link.column });
        },
      })));
    },
  });
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const sequence = arrowSequence(event);
    if (!sequence) return true;
    event.preventDefault();
    if (state.activeSessionId) post({ type: 'input', sessionId: state.activeSessionId, data: sequence });
    return false;
  });
  term.textarea?.addEventListener('focus', () => post({ type: 'directFocus', focused: true }));
  term.textarea?.addEventListener('blur', () => post({ type: 'directFocus', focused: false }));
  term.onData((data) => {
    if (state.activeSessionId) {
      post({ type: 'input', sessionId: state.activeSessionId, data });
    }
  });
  term.onResize(({ cols, rows }) => {
    if (state.activeSessionId) {
      post({ type: 'resize', sessionId: state.activeSessionId, cols, rows });
    }
  });
  const observer = new ResizeObserver(() => resizeTerminal());
  observer.observe(termHost);
  resizeTerminal();
}

function resetTerminal(data: string): void {
  ensureTerminal();
  term?.reset();
  if (data) {
    term?.write(data);
  }
  resizeTerminal();
}

function arrowSequence(event: KeyboardEvent): string | undefined {
  const code = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D' }[event.key];
  if (!code || event.altKey || event.metaKey) return undefined;
  const mods = 1 + (event.shiftKey ? 1 : 0) + (event.ctrlKey ? 4 : 0);
  return mods === 1 ? `\x1b[${code}` : `\x1b[1;${mods}${code}`;
}

function openFind(): void {
  ensureTerminal();
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
}

function closeFind(): void {
  findBar.hidden = true;
  findBar.classList.remove('miss');
  searchAddon?.clearDecorations();
}

function runFind(forward: boolean): void {
  const query = findInput.value;
  if (!query || !searchAddon) {
    findBar.classList.remove('miss');
    searchAddon?.clearDecorations();
    return;
  }
  const found = forward ? searchAddon.findNext(query) : searchAddon.findPrevious(query);
  findBar.classList.toggle('miss', !found);
}

function taskMatches(session: ViewSession): boolean {
  const query = taskSearch.value.trim().toLowerCase();
  if (!query) return true;
  const profile = state.profiles.find((item) => item.id === session.profileId);
  return [session.name, session.cwd, session.lastCommand, profile?.name ?? '', statusLabel(session)].join('\n').toLowerCase().includes(query);
}

function resizeTerminal(): void {
  if (!fit || termHost.clientWidth < 20 || termHost.clientHeight < 20) {
    return;
  }
  fit.fit();
}

function hostPlatform(): string {
  const agent = navigator.userAgent;
  if (agent.includes('Windows')) return 'win32';
  if (agent.includes('Mac')) return 'darwin';
  return 'linux';
}

function failureText(session: ViewSession): string {
  const profile = state.profiles.find((item) => item.id === session.profileId);
  return localizedMissingProgram(session.lastError ?? '', profile?.templateId, profile?.program ?? '', hostPlatform());
}

function installTarget(session: ViewSession | undefined): string {
  if (!session || session.exitReason !== 'start-failed') return '';
  const profile = state.profiles.find((item) => item.id === session.profileId);
  const id = profile?.templateId ?? '';
  if (id && !id.startsWith('install:') && TEMPLATES.some((item) => item.id === id && item.windowsInstall)) return id;
  const command = installCommand(session.lastError);
  return TEMPLATES.find((item) => item.windowsInstall?.command === command)?.id ?? '';
}

function runInstallActive(): void {
  const session = newTabSelected ? undefined : state.sessions.find((item) => item.id === state.activeSessionId);
  const id = closedRun.dataset.template || installTarget(session);
  if (id) requestInstall(id, closedCopy.dataset.command ?? '');
}

function requestInstall(id: string, command: string): void {
  if (!command) {
    post({ type: 'installTemplate', id });
    return;
  }
  confirmAction(t('installConfirm'), () => post({ type: 'installTemplate', id }), command);
}

function installCommand(error: string | null | undefined): string {
  const lines = (error ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  return [...lines].reverse().find((line) => /^(powershell|npm|irm|brew|curl|winget)\b/i.test(line) || line.includes(' | iex')) ?? '';
}

async function copyInstallCommand(): Promise<void> {
  const command = closedCopy.dataset.command ?? '';
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    showToast(t('installCopied'));
  } catch {
    showToast(command);
  }
}

function rerunActive(): void {
  if (!state.activeSessionId || newTabSelected) return;
  post({ type: 'rerun', sessionId: state.activeSessionId });
}

function sendComposer(): void {
  const session = newTabSelected ? undefined : state.sessions.find((item) => item.id === state.activeSessionId);
  if (session && !session.attached) {
    if (installTarget(session)) runInstallActive();
    else rerunActive();
    return;
  }
  let value = input.value;
  if (!value) {
    return;
  }
  if (ctrlLatched && value.length === 1) {
    const code = value.toLowerCase().charCodeAt(0);
    if (code >= 97 && code <= 122) {
      sendRaw(String.fromCharCode(code - 96));
      input.value = '';
      ctrlLatched = false;
      renderCtrl();
      return;
    }
  }
  if (ctrlLatched) {
    ctrlLatched = false;
    renderCtrl();
  }
  value = value.replace(/\r\n?/g, '\n');
  sendRaw(value.includes('\n') ? `\x1b[200~${value}\x1b[201~\r` : `${value}\r`);
  input.value = '';
}

function sendRaw(data: string): void {
  if (!state.activeSessionId) {
    showToast(t('selectTaskFirst'));
    return;
  }
  post({ type: 'input', sessionId: state.activeSessionId, data });
}

async function paste(): Promise<void> {
  try {
    sendRaw(await navigator.clipboard.readText());
  } catch {
    showToast(t('clipboardFailed'));
  }
}

function renderCtrl(): void {
  const toggle = keys.querySelector<HTMLButtonElement>('.ctrl-toggle');
  if (toggle) {
    toggle.textContent = ctrlLatched ? t('ctrlOn') : t('ctrl');
  }
}

function showMain(): void {
  commandSettingsOpen = false;
  preferencesOpen = false;
  editingSessionId = null;
  editor.hidden = true;
  main.hidden = false;
  location.open = false;
  renderDetail();
  requestAnimationFrame(() => resizeTerminal());
}

function showEditor(): void {
  commandSettingsOpen = false;
  preferencesOpen = false;
  editingSessionId = null;
  editor.classList.remove('manages-commands', 'edits-command');
  toggleList(false);
  location.open = false;
  main.hidden = true;
  editor.hidden = false;
}

function showToast(message: string): void {
  clearTimeout(toastTimer);
  toast.hidden = false;
  toast.textContent = message;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

function toggleList(open = picker.hidden): void {
  picker.hidden = !open;
  if (open) location.open = false;
}

function changeLocation(value: string): void {
  location.open = false;
  post({ type: 'setLocation', location: value });
}

function confirmAction(message: string, action: () => void, command = ''): void {
  const previousFocus = document.activeElement as HTMLElement | null;
  const overlay = el('div', 'confirm-overlay');
  const dialog = el('section', 'card confirm-dialog');
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  const title = command ? t('installConfirmTitle') : t('confirmTitle');
  dialog.setAttribute('aria-label', title);
  main.inert = true;
  editor.inert = true;
  const close = () => {
    overlay.remove();
    main.inert = false;
    editor.inert = false;
    previousFocus?.focus();
  };
  const cancel = button(t('cancel'), '', close);
  const accept = button(t('ok'), 'primary', () => { close(); action(); });
  const commandLine = el('code', 'install-command', command);
  commandLine.hidden = !command;
  commandLine.title = command;
  dialog.append(el('h2', '', title), text(message), commandLine, cancel, accept);
  overlay.append(dialog);
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      event.preventDefault();
      (document.activeElement === cancel ? accept : cancel).focus();
    }
  });
  app!.append(overlay);
  cancel.focus();
}

function reorder(source: string, target: string): void {
  const from = state.sessions.findIndex((session) => session.id === source);
  const to = state.sessions.findIndex((session) => session.id === target);
  if (from < 0 || to < 0 || from === to) return;
  state.sessions.splice(to, 0, state.sessions.splice(from, 1)[0]);
  renderList();
  renderTabs();
  post({ type: 'reorderSessions', ids: state.sessions.map((session) => session.id) });
}

function wireReorder(handle: HTMLButtonElement, row: HTMLElement, id: string): void {
  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const index = state.sessions.findIndex((session) => session.id === id);
    const target = state.sessions[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (target) reorder(id, target.id);
    list.querySelector<HTMLButtonElement>(`[data-session="${id}"] .drag-handle`)?.focus();
  });
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragId = id;
    dragTarget = id;
    handle.setPointerCapture(event.pointerId);
    row.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (dragId !== id) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-session]');
    for (const child of Array.from(list.children)) child.classList.remove('drag-over');
    if (target?.dataset.session) { dragTarget = target.dataset.session; target.classList.add('drag-over'); }
    const bounds = list.getBoundingClientRect();
    if (event.clientY < bounds.top + 32) list.scrollTop -= 16;
    if (event.clientY > bounds.bottom - 32) list.scrollTop += 16;
  });
  const finish = (event: PointerEvent) => {
    if (dragId !== id) return;
    const target = dragTarget;
    dragId = '';
    dragTarget = '';
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (event.type === 'pointerup' && target !== id) reorder(id, target);
    else renderList();
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
}

function statusLabel(session: ViewSession): string {
  if (session.status === 'running' && session.attached && session.runMode === 'resumed') {
    return t('statusResumeRunning');
  }
  if (session.status === 'running' && session.attached) {
    return t('statusRunning');
  }
  if (session.status === 'running') {
    return t('statusStaleRunning');
  }
  if (session.exitReason === 'start-failed') {
    return t('statusStartFailed');
  }
  if (session.exitReason === 'interrupted') {
    return t('statusInterrupted');
  }
  if (session.exitReason === 'user-stop') {
    return t('statusStopped');
  }
  if (session.exitReason === 'process-exit') {
    return session.exitCode === 0 ? t('statusExitedOk') : t('statusExited', { code: session.exitCode ?? '?' });
  }
  return t('statusIdle');
}

function helpFor(session: ViewSession): string {
  if (session.attached) {
    return t('detailAttached');
  }
  if (session.exitReason === 'interrupted') {
    return t('detailRecord');
  }
  if (session.exitReason === 'start-failed') {
    return t('detailStartFailed');
  }
  return t('detailEnded');
}

function applyChromeLanguage(): void {
  const language = currentLanguage();
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : language;
  tabs.setAttribute('aria-label', t('tabs'));
  tabPrev.setAttribute('aria-label', t('tabPrevious'));
  tabNext.setAttribute('aria-label', t('tabNext'));
  addButton.title = t('newTask');
  addButton.setAttribute('aria-label', t('addTask'));
  commandSettings.setAttribute('aria-label', t('commandSettings'));
  commandSettings.title = t('commandSettings');
  summary.setAttribute('aria-label', t('menu'));
  manageCurrent.textContent = t('currentTaskSettings');
  menuTaskList.textContent = t('taskList');
  menuEditor.textContent = t('editorTab');
  menuPreferences.textContent = t('preferences');
  menuExtension.textContent = t('extensionSettings');
  picker.setAttribute('aria-label', t('savedTasks'));
  pickerTitle.textContent = t('taskList');
  taskSearch.placeholder = t('searchTasks');
  taskSearch.setAttribute('aria-label', t('searchTasks'));
  findInput.placeholder = t('searchTerminal');
  findInput.setAttribute('aria-label', t('searchTerminal'));
  findPrevious.textContent = t('searchPrevious');
  findNext.textContent = t('searchNext');
  findClose.setAttribute('aria-label', t('searchClose'));
  registerCli.textContent = t('registerCli');
  registerCli.setAttribute('aria-label', t('addCli'));
  input.setAttribute('aria-label', t('composerLabel'));
  input.placeholder = t('composerPlaceholder');
  sendButton.textContent = t('send');
  pasteButton.textContent = t('paste');
  directButton.textContent = t('directInput');
  findButton.textContent = t('searchTerminal');
  renderCtrl();
}

function dotClass(session: ViewSession): string {
  if (session.attached || session.status === 'running') {
    return session.attached ? 'running' : 'interrupted';
  }
  if (session.exitReason === 'interrupted' || session.exitReason === 'start-failed') {
    return 'failed';
  }
  if (session.exitReason === 'user-stop') {
    return 'stopped';
  }
  return '';
}

function draftFromProfile(profile: Profile): Draft {
  return {
    id: profile.id,
    templateId: profile.templateId,
    name: profile.name,
    program: profile.program,
    args: profile.args,
    shell: profile.shell,
    cwd: profile.cwd,
    env: profile.env.map((entry) => ({ ...entry })),
    resumeRecent: profile.resumeRecent,
    resumeSpecific: profile.resumeSpecific,
    website: profile.website ?? '',
    iconText: profile.iconText ?? '',
    iconColor: profile.iconColor ?? '',
    iconImage: profile.iconImage ?? '',
    origin: profile.origin,
  };
}

function emptyDraft(): Draft {
  return {
    id: '',
    name: '',
    program: '',
    args: '',
    shell: 'direct',
    cwd: '',
    env: [],
    resumeRecent: '',
    resumeSpecific: '',
    website: '',
    iconText: '',
    iconColor: '',
    iconImage: '',
  };
}

function terminalTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const style = getComputedStyle(document.body);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: read('--vscode-editor-background', '#1e1e1e'),
    foreground: read('--vscode-editor-foreground', '#cccccc'),
    cursor: read('--vscode-editorCursor-foreground', '#cccccc'),
    selectionBackground: read('--vscode-editor-selectionBackground', '#264f78'),
  };
}

function post(message: unknown): void {
  vscode.postMessage(message);
}

function el(tag: string, className: string, textContent?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (textContent !== undefined) {
    node.textContent = textContent;
  }
  return node;
}

function text(value: string): HTMLElement {
  return el('p', 'help', value);
}

function iconButton(label: string, className: string, icon: SVGElement, onClick: (event: Event) => void, inactive = false): HTMLButtonElement {
  const node = button('', `${className} tip`, (event) => {
    if (node.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick(event);
  });
  node.setAttribute('aria-label', label);
  node.dataset.tip = label;
  node.append(icon);
  if (inactive) node.setAttribute('aria-disabled', 'true');
  return node;
}

function button(label: string, className: string, onClick?: (event: Event) => void, extra = '', disabled = false): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.className = `${className} ${extra}`.trim();
  node.disabled = disabled;
  if (onClick) {
    node.addEventListener('click', onClick);
  }
  return node;
}

function keyButton(label: string, data: string): HTMLButtonElement {
  const node = button(label, '', () => sendRaw(data));
  node.addEventListener('pointerdown', (event) => event.preventDefault());
  return node;
}

function externalIcon(): SVGElement {
  return strokeIcon(['M6 3.5H3.5V12.5H12.5V10M8.5 3.5H12.5V7.5M12.5 3.5 7 9']);
}

function resetIcon(): SVGElement {
  return strokeIcon(['M12.6 6.1A4.6 4.6 0 1 0 11.3 11', 'M12.7 2.7V6.1H9.3']);
}

function deleteIcon(): SVGElement {
  return strokeIcon(['M3.5 4.5h9', 'M6.2 4.4V3.2h3.6v1.2', 'M5.2 4.5l.55 8.2h4.5l.55-8.2']);
}

function hideIcon(): SVGElement {
  return strokeIcon(['M2.2 8S4.4 4.8 8 4.8 13.8 8 13.8 8 11.6 11.2 8 11.2 2.2 8 2.2 8', 'M3.2 12.4 12.8 3.6']);
}

function showIcon(): SVGElement {
  return strokeIcon(['M2.2 8S4.4 4.8 8 4.8 13.8 8 13.8 8 11.6 11.2 8 11.2 2.2 8 2.2 8', 'M8 6.3a1.7 1.7 0 1 0 .01 0']);
}

function checkIcon(): SVGElement {
  return strokeIcon(['M3.6 8.3 6.4 11.1 12.4 4.8']);
}

function missingIcon(): SVGElement {
  return strokeIcon(['M4.6 4.6 11.4 11.4', 'M11.4 4.6 4.6 11.4']);
}

function strokeIcon(paths: string[]): SVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.4');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    icon.append(path);
  }
  return icon;
}

function labeled(label: string, value: string, field: string): HTMLInputElement {
  const inputNode = document.createElement('input');
  inputNode.value = value;
  inputNode.dataset.field = field;
  inputNode.dataset.label = label;
  return inputNode;
}

function labeledArea(label: string, value: string, field: string): HTMLTextAreaElement {
  const node = document.createElement('textarea');
  node.value = value;
  node.rows = 1;
  node.dataset.field = field;
  node.dataset.label = label;
  const fit = () => {
    node.style.height = '0px';
    const next = Math.min(Math.max(node.scrollHeight, 44), 160);
    node.style.height = `${next}px`;
    node.style.overflowY = node.scrollHeight > 160 ? 'auto' : 'hidden';
  };
  node.addEventListener('input', fit);
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    const start = node.selectionStart ?? node.value.length;
    const end = node.selectionEnd ?? start;
    node.setRangeText('\n', start, end, 'end');
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  requestAnimationFrame(fit);
  return node;
}

function fieldWrap(label: string, control: HTMLElement): HTMLElement {
  const composite = control.tagName === 'DIV';
  const wrap = document.createElement(composite ? 'div' : 'label');
  wrap.className = 'field';
  const span = document.createElement(composite ? 'label' : 'span');
  span.textContent = label;
  if (composite) {
    const input = control.querySelector('input, textarea');
    if (input?.id) span.setAttribute('for', input.id);
  }
  wrap.append(span, control);
  return wrap;
}

function miniInput(placeholder: string): HTMLInputElement {
  const node = document.createElement('input');
  node.placeholder = placeholder;
  return node;
}

renderDetail();
vscode.postMessage({ type: 'ready' });
