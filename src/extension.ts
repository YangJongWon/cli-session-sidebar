import fs from 'fs';
import os from 'os';
import * as vscode from 'vscode';
import { Controller } from './controller';
import { t } from './shared/i18n';
import { registerViews } from './views';

let controller: Controller | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('CLI Session Sidebar');
  const storageDir = context.globalStorageUri.fsPath;
  fs.mkdirSync(storageDir, { recursive: true });
  let openInEditor: () => void = () => undefined;
  let focusSidebar: () => void = () => undefined;
  let setLocation: (location: string) => Promise<void> = async () => undefined;
  controller = new Controller({
    storageDir,
    extensionPath: context.extensionPath,
    execPath: process.execPath,
  }, {
    defaultCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(),
    pickFolder: async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: '작업 폴더 선택',
      });
      return picked?.[0]?.fsPath;
    },
    pickProgram: async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: '실행 파일 선택',
        filters: {
          '모든 파일': ['*'],
          '실행 파일': ['exe', 'cmd', 'bat'],
        },
      });
      return picked?.[0]?.fsPath;
    },
    openInEditor: () => openInEditor(),
    focusSidebar: () => {
      void focusSidebar();
    },
    setLocation: (location) => setLocation(location),
    openSettings: () => { void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:yangjongwon.cli-session-sidebar'); },
    locale: () => vscode.env.language,
    setDirectInput: (focused) => {
      void vscode.commands.executeCommand('setContext', 'cliSessionSidebar.directInput', focused);
    },
    openExternal: async (url) => {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    },
    openPath: async (filePath, line, column) => {
      const uri = vscode.Uri.file(filePath);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        await vscode.commands.executeCommand('revealInExplorer', uri);
        return;
      }
      const document = await vscode.workspace.openTextDocument(uri);
      const position = new vscode.Position(Math.max(0, (line ?? 1) - 1), Math.max(0, (column ?? 1) - 1));
      await vscode.window.showTextDocument(document, { preview: true, selection: new vscode.Range(position, position) });
    },
    notify: (title, body, sessionId) => {
      const message = body ? `${title} ${body}` : title;
      void vscode.window.showInformationMessage(message, t('showTask')).then((choice) => {
        if (choice !== t('showTask') || !sessionId) return;
        void focusSidebar();
        void controller?.handle({ type: 'selectSession', sessionId }, () => undefined);
      });
    },
    log: (line) => channel.appendLine(line),
  });
  const views = registerViews(context, controller);
  openInEditor = views.openInEditor;
  setLocation = views.setLocation;
  focusSidebar = () => {
    void views.focusSidebar();
  };
  context.subscriptions.push(
    channel,
    vscode.commands.registerCommand('cliSessionSidebar.sendKey', (data?: string) => {
      if (typeof data === 'string') void controller?.sendToActive(data);
    }),
  );
  void controller.init().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    channel.appendLine(message);
    void vscode.window.showErrorMessage(message);
  });
}

export function deactivate(): void {
  controller?.release();
}
