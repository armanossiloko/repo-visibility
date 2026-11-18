import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { API, GitExtension, Repository } from './git';
import { isRelated, pathKey } from './paths';

const HIDDEN_STATE_KEY = 'repoVisibility.hiddenRepositories';

export type GitState = 'loading' | 'ready' | 'unavailable';

export interface RepoInfo {
  /** Normalized path used to identify the repository. */
  readonly key: string;
  /** Repository root as a file system path. */
  readonly root: string;
  readonly name: string;
  readonly visible: boolean;
  /** Set while the repository is open (visible). */
  readonly repository: Repository | undefined;
}

/**
 * Tracks which repositories are hidden and hides or shows them through the built-in Git extension.
 *
 * Hiding a repository closes it in the Git extension, which removes it from the Source Control view;
 * showing it opens it again. The hidden list is stored per workspace, so it survives reloads.
 */
export class VisibilityController implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private readonly apiDisposables: vscode.Disposable[] = [];
  /** key -> root path */
  private readonly hidden = new Map<string, string>();
  private api: API | undefined;
  private _state: GitState = 'loading';
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly memento: vscode.Memento,
    private readonly log: vscode.LogOutputChannel,
  ) {
    for (const root of memento.get<string[]>(HIDDEN_STATE_KEY, [])) {
      this.hidden.set(pathKey(root), root);
    }
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.changeEmitter.fire()),
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

  /** All repositories known in this workspace: the open ones plus the hidden ones. */
  getRepositories(): RepoInfo[] {
    const result = new Map<string, RepoInfo>();
    for (const repository of this.api?.repositories ?? []) {
      const root = repository.rootUri.fsPath;
      const key = pathKey(root);
      result.set(key, { key, root, name: path.basename(root) || root, visible: true, repository });
    }
    if (this.api) {
      const folderKeys = (vscode.workspace.workspaceFolders ?? []).map((f) => pathKey(f.uri.fsPath));
      for (const [key, root] of this.hidden) {
        // Hidden repositories of folders that left the workspace stay stored, but are not listed.
        if (!result.has(key) && folderKeys.some((folderKey) => isRelated(key, folderKey))) {
          result.set(key, { key, root, name: path.basename(root) || root, visible: false, repository: undefined });
        }
      }
    }
    return [...result.values()];
  }

  /** Shows and hides repositories. Operations run one after another, in the order they were requested. */
  setVisibility(show: readonly string[], hide: readonly string[]): Promise<void> {
    const run = async (): Promise<void> => {
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
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
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

  /** Removes a hidden repository from the list without opening it. */
  async forget(key: string): Promise<void> {
    if (this.hidden.delete(key)) {
      await this.saveHidden();
      this.changeEmitter.fire();
    }
  }

  /** Drops hidden repositories whose folder no longer exists or is no longer a Git repository. */
  async refresh(): Promise<void> {
    let changed = false;
    for (const [key, root] of [...this.hidden]) {
      if (!(await isGitRepository(root))) {
        this.log.info(`Forgetting ${root}: it is no longer a Git repository.`);
        this.hidden.delete(key);
        changed = true;
      }
    }
    if (changed) {
      await this.saveHidden();
    }
    this.changeEmitter.fire();
  }

  dispose(): void {
    vscode.Disposable.from(...this.apiDisposables, ...this.disposables).dispose();
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
      void this.saveHidden();
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
      await this.saveHidden();
    }
    this.changeEmitter.fire();
  }

  private async hideRepository(repo: RepoInfo): Promise<void> {
    if (!repo.repository) {
      return;
    }
    this.log.info(`Hiding ${repo.root}`);
    this.hidden.set(repo.key, repo.root);
    await this.saveHidden();
    if (!(await this.closeInGit(repo.repository))) {
      this.hidden.delete(repo.key);
      await this.saveHidden();
    }
  }

  private async showRepository(repo: RepoInfo): Promise<void> {
    if (!this.api) {
      return;
    }
    this.log.info(`Showing ${repo.root}`);
    this.hidden.delete(repo.key);
    await this.saveHidden();

    let opened: Repository | null = null;
    try {
      opened = await this.api.openRepository(vscode.Uri.file(repo.root));
    } catch (error) {
      this.log.error(`Could not open ${repo.root}`, error);
    }
    if (opened) {
      return;
    }

    if (await isGitRepository(repo.root)) {
      this.hidden.set(repo.key, repo.root);
      await this.saveHidden();
      void vscode.window.showWarningMessage(
        `Repo Visibility: Git could not open ${repo.name}. Check the Git output for details.`,
      );
    } else {
      void vscode.window.showInformationMessage(
        `Repo Visibility: ${repo.name} is no longer a Git repository, so it was removed from the list.`,
      );
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

  private saveHidden(): Thenable<void> {
    return this.memento.update(HIDDEN_STATE_KEY, [...this.hidden.values()]);
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
