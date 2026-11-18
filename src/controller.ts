import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiscoveredRepo, findRepositories, RepoKind } from './discovery';
import type { API, GitExtension, Repository } from './git';
import { isRelated, pathKey } from './paths';

const HIDDEN_STATE_KEY = 'repoVisibility.hiddenRepositories';
const SHOWN_STATE_KEY = 'repoVisibility.shownRepositories';

export type GitState = 'loading' | 'ready' | 'unavailable';

export interface RepoInfo {
  /** Normalized path used to identify the repository. */
  readonly key: string;
  /** Repository root as a file system path. */
  readonly root: string;
  readonly name: string;
  readonly visible: boolean;
  /** Whether this is a regular repository, a submodule of another repository, or a linked worktree. */
  readonly kind: RepoKind;
  /** Set while the repository is open (visible). */
  readonly repository: Repository | undefined;
}

/**
 * Tracks which repositories are hidden and hides or shows them through the built-in Git extension.
 *
 * Hiding a repository closes it in the Git extension, which removes it from the Source Control view;
 * showing it opens it again. Besides the repositories Git has open, the controller lists the ones it
 * finds on disk in the workspace folders, so repositories Git did not pick up (too deep for Git's scan,
 * or closed earlier) can be shown too. Both the hidden and the shown choices are stored per workspace.
 */
export class VisibilityController implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private readonly apiDisposables: vscode.Disposable[] = [];
  /** Repositories the user hid. key -> root path. Persisted. */
  private readonly hidden: Map<string, string>;
  /** Repositories the user showed, reopened on start-up if Git does not open them itself. Persisted. */
  private readonly shown: Map<string, string>;
  /** Repositories found on disk in the workspace folders, by key. */
  private discovered = new Map<string, DiscoveredRepo>();
  private api: API | undefined;
  private _state: GitState = 'loading';
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly memento: vscode.Memento,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.hidden = this.loadPaths(HIDDEN_STATE_KEY);
    this.shown = this.loadPaths(SHOWN_STATE_KEY);
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('repoVisibility.scanDepth') || e.affectsConfiguration('repoVisibility.scanIgnoredFolders')) {
          void this.refresh();
        }
      }),
    );
  }

  get state(): GitState {
    return this._state;
  }

  async initialize(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      this.log.warn('The built-in Git extension (vscode.git) is not installed.');
      this.setState('unavailable');
      return;
    }

    let gitExtension: GitExtension;
    try {
      gitExtension = extension.isActive ? extension.exports : await extension.activate();
    } catch (error) {
      this.log.error('Could not activate the built-in Git extension.', error);
      this.setState('unavailable');
      return;
    }

    this.disposables.push(gitExtension.onDidChangeEnablement(() => void this.attach(gitExtension)));
    await this.attach(gitExtension);
  }

  /** Every repository in the workspace: the open ones, the hidden ones and the ones found on disk. */
  getRepositories(): RepoInfo[] {
    const result = new Map<string, RepoInfo>();
    if (!this.api) {
      return [];
    }
    // Submodules Git reports for the open repositories, for repositories the disk scan did not reach.
    const gitSubmodules = new Set<string>();
    for (const repository of this.api.repositories) {
      for (const submodule of repository.state.submodules) {
        gitSubmodules.add(pathKey(path.join(repository.rootUri.fsPath, submodule.path)));
      }
    }
    const kindOf = (key: string): RepoKind =>
      this.discovered.get(key)?.kind ?? (gitSubmodules.has(key) ? 'submodule' : 'repository');

    for (const repository of this.api.repositories) {
      const root = repository.rootUri.fsPath;
      const key = pathKey(root);
      result.set(key, { key, root, name: path.basename(root) || root, visible: true, kind: kindOf(key), repository });
    }
    const folderKeys = (vscode.workspace.workspaceFolders ?? []).map((f) => pathKey(f.uri.fsPath));
    const addClosed = (key: string, root: string): void => {
      if (!result.has(key)) {
        result.set(key, { key, root, name: path.basename(root) || root, visible: false, kind: kindOf(key), repository: undefined });
      }
    };
    for (const [key, repo] of this.discovered) {
      addClosed(key, repo.root);
    }
    for (const [key, root] of this.hidden) {
      // Hidden repositories of folders that left the workspace stay stored, but are not listed.
      if (folderKeys.some((folderKey) => isRelated(key, folderKey))) {
        addClosed(key, root);
      }
    }
    return [...result.values()];
  }

  /** Shows and hides repositories. Operations run one after another, in the order they were requested. */
  setVisibility(show: readonly string[], hide: readonly string[]): Promise<void> {
    return this.enqueue(async () => {
      const repos = new Map(this.getRepositories().map((r) => [r.key, r]));
      for (const key of hide) {
        const repo = repos.get(key);
        if (repo?.visible) {
          await this.hideRepository(repo);
        }
      }
      for (const key of show) {
        const repo = repos.get(key);
        if (repo && !repo.visible) {
          await this.showRepository(repo);
        }
      }
      this.changeEmitter.fire();
    });
  }

  /** Shows the given repositories and hides every other one. */
  showOnly(keys: readonly string[]): Promise<void> {
    const keep = new Set(keys);
    const all = this.getRepositories();
    return this.setVisibility(
      all.filter((r) => keep.has(r.key)).map((r) => r.key),
      all.filter((r) => !keep.has(r.key)).map((r) => r.key),
    );
  }

  /** Removes a hidden repository from the stored list without opening it. */
  async forget(key: string): Promise<void> {
    if (this.hidden.delete(key)) {
      await this.save();
      this.changeEmitter.fire();
    }
  }

  /** Searches the workspace folders for repositories again and drops stored ones that no longer exist. */
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      let changed = false;
      for (const map of [this.hidden, this.shown]) {
        for (const [key, root] of [...map]) {
          if (!(await isGitRepository(root))) {
            this.log.info(`Forgetting ${root}: it is no longer a Git repository.`);
            map.delete(key);
            changed = true;
          }
        }
      }
      if (changed) {
        await this.save();
      }
      await this.discover();
      this.changeEmitter.fire();
    });
  }

  dispose(): void {
    vscode.Disposable.from(...this.apiDisposables, ...this.disposables).dispose();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch((error) => this.log.error('Repo Visibility operation failed.', error));
    return next;
  }

  private async discover(): Promise<void> {
    const config = vscode.workspace.getConfiguration('repoVisibility');
    const maxDepth = Math.max(0, Math.min(20, config.get<number>('scanDepth', 4)));
    const ignoredFolders = config.get<string[]>('scanIgnoredFolders', []);
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);

    const started = Date.now();
    const { repositories, truncated } = await findRepositories(folders, { maxDepth, ignoredFolders });
    this.discovered = new Map(repositories.map((repo) => [pathKey(repo.root), repo]));
    const count = (kind: RepoKind): number => repositories.filter((r) => r.kind === kind).length;
    this.log.info(
      `Found ${repositories.length} repositories on disk in ${folders.length} workspace folder(s) ` +
        `(${count('repository')} repositories, ${count('submodule')} submodules, ${count('worktree')} worktrees; ` +
        `depth ${maxDepth}, ${Date.now() - started} ms). Git has ${this.api?.repositories.length ?? 0} open.`,
    );
    if (truncated) {
      this.log.warn('Stopped searching after 20000 folders. Lower repoVisibility.scanDepth or add folders to repoVisibility.scanIgnoredFolders.');
    }
  }

  private async attach(gitExtension: GitExtension): Promise<void> {
    vscode.Disposable.from(...this.apiDisposables.splice(0)).dispose();
    this.api = undefined;

    if (!gitExtension.enabled) {
      this.log.info('Git is disabled (git.enabled is false).');
      this.setState('unavailable');
      return;
    }

    const api = gitExtension.getAPI(1);
    this.setState('loading');
    if (api.state !== 'initialized') {
      await new Promise<void>((resolve) => {
        const listener = api.onDidChangeState((state) => {
          if (state === 'initialized') {
            listener.dispose();
            resolve();
          }
        });
      });
    }
    this.api = api;

    // Older Git extensions do not remember closed repositories across reloads, so close the
    // hidden ones again in case they came back.
    for (const repository of [...api.repositories]) {
      const root = repository.rootUri.fsPath;
      if (this.hidden.has(pathKey(root))) {
        this.log.info(`Hiding ${root} again after start-up.`);
        await this.closeInGit(repository);
      }
    }

    // Reopen repositories the user showed that Git does not open by itself (for example ones
    // deeper than git.repositoryScanMaxDepth).
    const openKeys = new Set(api.repositories.map((r) => pathKey(r.rootUri.fsPath)));
    for (const [key, root] of [...this.shown]) {
      if (!openKeys.has(key) && !this.hidden.has(key) && (await isGitRepository(root))) {
        this.log.info(`Showing ${root} again after start-up.`);
        await this.openInGit(root);
      }
    }

    this.apiDisposables.push(
      api.onDidOpenRepository((repository) => this.onDidOpenRepository(repository)),
      api.onDidCloseRepository((repository) => void this.onDidCloseRepository(repository)),
    );
    this.setState('ready');
    await this.refresh();
  }

  private onDidOpenRepository(repository: Repository): void {
    // Opened by someone else (for example Git: Reopen Closed Repositories): it is visible now.
    const key = pathKey(repository.rootUri.fsPath);
    if (this.hidden.delete(key)) {
      void this.save();
    }
    this.changeEmitter.fire();
  }

  private async onDidCloseRepository(repository: Repository): Promise<void> {
    const root = repository.rootUri.fsPath;
    const key = pathKey(root);
    // Closed by someone else (for example the Close Repository action in Source Control).
    // Keep it in the list as hidden, unless it went away because its folder left the
    // workspace or is no longer a repository.
    if (!this.hidden.has(key) && this.isInWorkspace(key) && (await isGitRepository(root))) {
      this.hidden.set(key, root);
      this.shown.delete(key);
      await this.save();
    }
    this.changeEmitter.fire();
  }

  private async hideRepository(repo: RepoInfo): Promise<void> {
    if (!repo.repository) {
      return;
    }
    this.log.info(`Hiding ${repo.root}`);
    this.hidden.set(repo.key, repo.root);
    const wasShown = this.shown.delete(repo.key);
    await this.save();
    if (!(await this.closeInGit(repo.repository))) {
      this.hidden.delete(repo.key);
      if (wasShown) {
        this.shown.set(repo.key, repo.root);
      }
      await this.save();
    }
  }

  private async showRepository(repo: RepoInfo): Promise<void> {
    if (!this.api) {
      return;
    }
    this.log.info(`Showing ${repo.root}`);
    this.hidden.delete(repo.key);
    this.shown.set(repo.key, repo.root);
    await this.save();

    if (await this.openInGit(repo.root)) {
      return;
    }

    this.shown.delete(repo.key);
    if (await isGitRepository(repo.root)) {
      this.hidden.set(repo.key, repo.root);
      void vscode.window.showWarningMessage(
        `Repo Visibility: Git could not open ${repo.name}. Check the Git output for details.`,
      );
    } else {
      this.discovered.delete(repo.key);
      void vscode.window.showInformationMessage(
        `Repo Visibility: ${repo.name} is no longer a Git repository, so it was removed from the list.`,
      );
    }
    await this.save();
  }

  private async openInGit(root: string): Promise<boolean> {
    try {
      return !!(await this.api?.openRepository(vscode.Uri.file(root)));
    } catch (error) {
      this.log.error(`Could not open ${root}`, error);
      return false;
    }
  }

  private async closeInGit(repository: Repository): Promise<boolean> {
    try {
      // Pass the root URI rather than the repository object: every Git extension version resolves it.
      await vscode.commands.executeCommand('git.close', repository.rootUri);
      return true;
    } catch (error) {
      this.log.error(`Could not close ${repository.rootUri.fsPath}`, error);
      void vscode.window.showErrorMessage(`Repo Visibility: could not hide ${path.basename(repository.rootUri.fsPath)}.`);
      return false;
    }
  }

  private isInWorkspace(key: string): boolean {
    return (vscode.workspace.workspaceFolders ?? []).some((f) => isRelated(key, pathKey(f.uri.fsPath)));
  }

  private loadPaths(stateKey: string): Map<string, string> {
    return new Map(this.memento.get<string[]>(stateKey, []).map((root) => [pathKey(root), root]));
  }

  private async save(): Promise<void> {
    await this.memento.update(HIDDEN_STATE_KEY, [...this.hidden.values()]);
    await this.memento.update(SHOWN_STATE_KEY, [...this.shown.values()]);
  }

  private setState(state: GitState): void {
    this._state = state;
    void vscode.commands.executeCommand('setContext', 'repoVisibility.gitState', state);
    this.changeEmitter.fire();
  }
}

async function isGitRepository(root: string): Promise<boolean> {
  try {
    // `.git` is a directory in normal repositories and a file in submodules and worktrees.
    await fs.promises.stat(path.join(root, '.git'));
    return true;
  } catch {
    return false;
  }
}
