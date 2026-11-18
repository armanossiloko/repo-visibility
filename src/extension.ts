import * as vscode from 'vscode';
import { RepoInfo, VisibilityController } from './controller';
import { RepoNode, RepoTreeProvider, ViewMode } from './tree';
import { tildify } from './paths';
import * as os from 'os';
import * as path from 'path';

const VIEW_ID = 'repoVisibility.repositories';

/** What the extension exports to other extensions (used by the integration tests). */
export interface ExtensionApi {
  /** Every repository the view lists, with whether it is shown in Source Control. */
  getRepositories(): { root: string; visible: boolean }[];
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  const log = vscode.window.createOutputChannel('Repo Visibility', { log: true });
  const controller = new VisibilityController(context.workspaceState, log);
  const provider = new RepoTreeProvider(controller, readViewMode());
  const view = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    manageCheckboxStateManually: true,
    canSelectMany: true,
  });
  context.subscriptions.push(log, controller, provider, view);

  void vscode.commands.executeCommand('setContext', 'repoVisibility.viewMode', readViewMode());

  const updateDescription = (): void => {
    const all = provider.all;
    const shown = all.filter((r) => r.visible).length;
    view.description = all.length > 0 && shown < all.length ? `${shown} of ${all.length} shown` : undefined;
  };

  context.subscriptions.push(
    controller.onDidChange(() => provider.refresh()),
    provider.onDidChangeTreeData(updateDescription),

    view.onDidChangeCheckboxState((event) => {
      const show: string[] = [];
      const hide: string[] = [];
      for (const [node, state] of event.items) {
        (state === vscode.TreeItemCheckboxState.Checked ? show : hide).push(node.item.key);
      }
      void withProgress(controller.setVisibility(show, hide));
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('repoVisibility.viewMode')) {
        const mode = readViewMode();
        void vscode.commands.executeCommand('setContext', 'repoVisibility.viewMode', mode);
        provider.setViewMode(mode);
      }
    }),

    vscode.commands.registerCommand('repoVisibility.showAll', () =>
      withProgress(controller.setVisibility(controller.getRepositories().map((r) => r.key), [])),
    ),
    vscode.commands.registerCommand('repoVisibility.hideAll', () =>
      withProgress(controller.setVisibility([], controller.getRepositories().map((r) => r.key))),
    ),
    vscode.commands.registerCommand('repoVisibility.show', (node?: RepoNode, nodes?: RepoNode[]) =>
      withProgress(controller.setVisibility(keysOf(view, node, nodes), [])),
    ),
    vscode.commands.registerCommand('repoVisibility.hide', (node?: RepoNode, nodes?: RepoNode[]) =>
      withProgress(controller.setVisibility([], keysOf(view, node, nodes))),
    ),
    vscode.commands.registerCommand('repoVisibility.showOnly', (node?: RepoNode, nodes?: RepoNode[]) => {
      const keys = keysOf(view, node, nodes);
      return keys.length > 0 ? withProgress(controller.showOnly(keys)) : undefined;
    }),
    vscode.commands.registerCommand('repoVisibility.forget', async (node?: RepoNode, nodes?: RepoNode[]) => {
      for (const key of keysOf(view, node, nodes)) {
        await controller.forget(key);
      }
    }),
    vscode.commands.registerCommand('repoVisibility.revealInOS', (node?: RepoNode) => {
      const target = node ?? view.selection[0];
      if (target) {
        return vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target.item.root));
      }
      return undefined;
    }),
    vscode.commands.registerCommand('repoVisibility.viewAsList', () => setViewMode('list')),
    vscode.commands.registerCommand('repoVisibility.viewAsTree', () => setViewMode('tree')),
    vscode.commands.registerCommand('repoVisibility.refresh', () => withProgress(controller.refresh())),
    vscode.commands.registerCommand('repoVisibility.pick', () => pickVisible(controller)),
  );

  await controller.initialize();

  return {
    getRepositories: () => controller.getRepositories().map(({ root, visible }) => ({ root, visible })),
  };
}

export function deactivate(): void {
  // Everything is disposed through the extension context.
}

function readViewMode(): ViewMode {
  return vscode.workspace.getConfiguration('repoVisibility').get<ViewMode>('viewMode') === 'list' ? 'list' : 'tree';
}

function setViewMode(mode: ViewMode): Thenable<void> {
  return vscode.workspace.getConfiguration('repoVisibility').update('viewMode', mode, vscode.ConfigurationTarget.Global);
}

/** The repositories a context menu command applies to: the whole selection when the clicked item is part of it. */
function keysOf(view: vscode.TreeView<RepoNode>, node?: RepoNode, nodes?: RepoNode[]): string[] {
  const targets = nodes && nodes.length > 0 ? nodes : node ? [node] : [...view.selection];
  return targets.map((n) => n.item.key);
}

function withProgress<T>(task: Promise<T>): Thenable<T> {
  return vscode.window.withProgress({ location: { viewId: VIEW_ID } }, () => task);
}

async function pickVisible(controller: VisibilityController): Promise<void> {
  const repos = controller.getRepositories().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (repos.length === 0) {
    void vscode.window.showInformationMessage('Repo Visibility: no Git repositories found in this workspace.');
    return;
  }

  type Item = vscode.QuickPickItem & { repo: RepoInfo };
  const items: Item[] = repos.map((repo) => ({
    label: repo.name,
    description: tildify(path.dirname(repo.root), os.homedir()),
    picked: repo.visible,
    repo,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Repositories shown in Source Control',
    placeHolder: 'Check the repositories to show; unchecked ones are hidden',
    matchOnDescription: true,
  });
  if (!picked) {
    return;
  }
  await withProgress(controller.showOnly(picked.map((item) => item.repo.key)));
}
