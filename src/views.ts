import * as vscode from 'vscode';
import type { Controller } from './controller';
import { t } from './shared/i18n';
import { webviewHtml } from './webviewHtml';

export function registerViews(context: vscode.ExtensionContext, controller: Controller): {
  openInEditor: () => void;
  focusSidebar: () => Promise<void>;
  setLocation: (location: string) => Promise<void>;
} {
  const options: vscode.WebviewOptions & vscode.WebviewPanelOptions = {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [context.extensionUri],
  };
  let editorPanel: vscode.WebviewPanel | undefined;

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(view) {
      view.webview.options = options;
      view.webview.html = webviewHtml(view.webview, context.extensionUri);
      const unsubscribe = controller.subscribe((message) => view.webview.postMessage(message));
      const messages = view.webview.onDidReceiveMessage((message) => {
        void controller.handle(message, (reply) => view.webview.postMessage(reply));
      });
      view.onDidDispose(() => {
        unsubscribe();
        messages.dispose();
      });
    },
  };

  context.subscriptions.push(vscode.window.registerWebviewViewProvider('cliSessionSidebar.main', provider, {
    webviewOptions: { retainContextWhenHidden: true },
  }));

  const wirePanel = (panel: vscode.WebviewPanel) => {
    panel.webview.options = options;
    panel.webview.html = webviewHtml(panel.webview, context.extensionUri);
    const unsubscribe = controller.subscribe((message) => panel.webview.postMessage(message));
    const messages = panel.webview.onDidReceiveMessage((message) => {
      void controller.handle(message, (reply) => panel.webview.postMessage(reply));
    });
    panel.onDidDispose(() => {
      unsubscribe();
      messages.dispose();
      if (editorPanel === panel) {
        editorPanel = undefined;
      }
    });
  };

  context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('cliSessionSidebar.editor', {
    async deserializeWebviewPanel(panel) {
      editorPanel = panel;
      wirePanel(panel);
    },
  }));

  const openInEditor = () => {
    if (editorPanel) {
      editorPanel.reveal(vscode.ViewColumn.Active);
      return;
    }
    editorPanel = vscode.window.createWebviewPanel(
      'cliSessionSidebar.editor',
      'CLI Sessions',
      vscode.ViewColumn.Active,
      options,
    );
    wirePanel(editorPanel);
  };

  const focusSidebar = async () => {
    await vscode.commands.executeCommand('cliSessionSidebar.main.focus');
    editorPanel?.dispose();
  };

  // Only an explicit change moves the view. Reapplying the setting on every
  // activation would undo the user's native drag-and-drop layout.
  const applyLocation = async (location: string) => {
    if (location === 'auto') return;
    if (location === 'editor') { openInEditor(); return; }
    if (location !== 'primary' && location !== 'secondary') throw new Error(t('errBadLocation'));
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('vscode.moveViews')) throw new Error(t('errNoMove'));
    const destinationId = `workbench.view.extension.cli-session-sidebar${location === 'secondary' ? '-secondary' : ''}`;
    const reset = `${destinationId}.resetViewContainerLocation`;
    if (!commands.includes(reset)) throw new Error(t('errNoReset'));
    // Our container may itself have been dragged to the other side. Restore only
    // this destination before moving the view, never reset the workbench layout.
    await vscode.commands.executeCommand(reset);
    await vscode.commands.executeCommand('vscode.moveViews', {
      viewIds: ['cliSessionSidebar.main'],
      destinationId,
    });
    await focusSidebar();
  };
  let applyingSetting = false;
  const setLocation = async (location: string) => {
    if (!['auto', 'primary', 'secondary', 'editor'].includes(location)) throw new Error(t('errBadLocation'));
    await applyLocation(location);
    applyingSetting = true;
    try {
      const config = vscode.workspace.getConfiguration('cliSessionSidebar');
      // Use workspace state for applied-value tracking, and respect the existing
      // settings scope so a workspace override cannot mask a GUI selection.
      const scope = config.inspect<string>('location');
      const target = scope?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await config.update('location', location, target);
      await context.workspaceState.update('appliedLocation', location);
    } finally { applyingSetting = false; }
  };
  const report = (error: unknown) => {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  };
  let pendingLocation = Promise.resolve();
  const queueSetting = () => {
    pendingLocation = pendingLocation.then(async () => {
      const location = vscode.workspace.getConfiguration('cliSessionSidebar').get<string>('location', 'auto');
      if (context.workspaceState.get('appliedLocation') === location) return;
      await applyLocation(location);
      await context.workspaceState.update('appliedLocation', location);
    }).catch(report);
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (!applyingSetting && event.affectsConfiguration('cliSessionSidebar.location')) queueSetting();
  }));
  // Skip auto on first activation; normal view placement remains VS Code-owned.
  queueSetting();

  context.subscriptions.push(
    vscode.commands.registerCommand('cliSessionSidebar.openInEditor', openInEditor),
    vscode.commands.registerCommand('cliSessionSidebar.focusSidebar', focusSidebar),
    vscode.commands.registerCommand('cliSessionSidebar.setLocation', async (location?: string) => {
      const selected = location ?? (await vscode.window.showQuickPick([
        { label: 'Primary Sidebar', value: 'primary' },
        { label: 'Secondary Sidebar', value: 'secondary' },
        { label: t('editorTab'), value: 'editor' },
        { label: t('keepLayout'), value: 'auto' },
      ], { title: 'CLI Sessions 표시 위치' }))?.value;
      if (selected) await setLocation(selected);
    }),
    vscode.commands.registerCommand('cliSessionSidebar.stopBackend', async () => {
      const answer = await vscode.window.showWarningMessage(
        t('stopBackendConfirm'),
        { modal: true },
        t('stopBackend'),
      );
      if (answer === t('stopBackend')) {
        await controller.shutdownBackend();
      }
    }),
  );

  return { openInEditor, focusSidebar, setLocation };
}
