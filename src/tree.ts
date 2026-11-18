import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RepoInfo, VisibilityController } from './controller';
import { buildForest, ForestNode, pathKey, tildify } from './paths';

export type ViewMode = 'tree' | 'list';

export type RepoNode = ForestNode<RepoInfo>;

const compareRepos = (a: RepoInfo, b: RepoInfo): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.key.localeCompare(b.key);

export class RepoTreeProvider implements vscode.TreeDataProvider<RepoNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<RepoNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private roots: RepoNode[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly controller: VisibilityController,
    private viewMode: ViewMode,
  ) {
    this.rebuild();
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.refresh();
  }

  /** Rebuilds the tree. Bursts of calls (Git opening many repositories at once) are coalesced. */
  refresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.rebuild();
      this.changeEmitter.fire(undefined);
    }, 50);
  }

  get all(): RepoInfo[] {
    const result: RepoInfo[] = [];
    const walk = (nodes: RepoNode[]): void =>
      nodes.forEach((n) => {
        result.push(n.item);
        walk(n.children);
      });
    walk(this.roots);
    return result;
  }

  getChildren(node?: RepoNode): RepoNode[] {
    return node ? node.children : this.roots;
  }

  getParent(node: RepoNode): RepoNode | undefined {
    return node.parent;
  }

  getTreeItem(node: RepoNode): vscode.TreeItem {
    const repo = node.item;
    const item = new vscode.TreeItem(
      repo.name,
      node.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    item.id = repo.key;
    item.description = this.describe(node);
    item.checkboxState = {
      state: repo.visible ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked,
      tooltip: repo.visible ? 'Shown in Source Control. Uncheck to hide.' : 'Hidden from Source Control. Check to show.',
    };
    item.contextValue = repo.visible ? 'repoVisibility.visible' : 'repoVisibility.hidden';
    item.iconPath = new vscode.ThemeIcon(this.isSubmodule(node) ? 'file-submodule' : 'repo');
    item.tooltip = this.tooltip(repo);
    return item;
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.changeEmitter.dispose();
  }

  private rebuild(): void {
    const repos = this.controller.getRepositories();
    this.roots =
      this.viewMode === 'tree'
        ? buildForest(repos, (r) => r.key, compareRepos)
        : [...repos].sort(compareRepos).map((item) => ({ item, parent: undefined, children: [] }));
  }

  private describe(node: RepoNode): string {
    const repo = node.item;
    if (node.parent) {
      return path.relative(node.parent.item.root, repo.root);
    }
    // Top level: where the repository sits, without repeating its name.
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(repo.root));
    if (folder && pathKey(folder.uri.fsPath) !== repo.key) {
      const parentDir = path.dirname(path.relative(folder.uri.fsPath, repo.root));
      const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
      if (multiRoot) {
        return parentDir === '.' ? folder.name : `${folder.name}${path.sep}${parentDir}`;
      }
      return parentDir === '.' ? '' : parentDir;
    }
    return tildify(path.dirname(repo.root), os.homedir());
  }

  private isSubmodule(node: RepoNode): boolean {
    if (!node.parent) {
      return false;
    }
    const parent = node.parent.item.repository;
    if (parent) {
      return parent.state.submodules.some((s) => pathKey(path.join(parent.rootUri.fsPath, s.path)) === node.item.key);
    }
    // The parent is hidden, so Git can't tell us. A nested `.git` file (not folder) means a submodule.
    try {
      return fs.statSync(path.join(node.item.root, '.git')).isFile();
    } catch {
      return false;
    }
  }

  private tooltip(repo: RepoInfo): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${escapeMarkdown(repo.name)}**\n\n`);
    md.appendMarkdown(`${escapeMarkdown(repo.root)}\n\n`);
    if (repo.repository) {
      const state = repo.repository.state;
      const branch = state.HEAD?.name;
      const changes =
        state.mergeChanges.length +
        state.indexChanges.length +
        state.workingTreeChanges.length +
        (state.untrackedChanges?.length ?? 0);
      if (branch) {
        md.appendMarkdown(`$(git-branch) ${escapeMarkdown(branch)}  \n`);
      }
      md.appendMarkdown(`${changes} ${changes === 1 ? 'change' : 'changes'}  \n`);
      md.appendMarkdown('$(eye) Shown in Source Control');
    } else {
      md.appendMarkdown('$(eye-closed) Hidden from Source Control');
    }
    return md;
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
