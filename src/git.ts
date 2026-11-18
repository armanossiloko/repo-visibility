// Minimal typings for the parts of the built-in Git extension API (vscode.git, API version 1)
// that this extension uses. The full definition lives in the VS Code repository at
// extensions/git/src/api/git.d.ts.

import type { Event, Uri } from 'vscode';

export interface Branch {
  readonly name?: string;
}

export interface Submodule {
  readonly name: string;
  readonly path: string;
  readonly url: string;
}

export interface Change {
  readonly uri: Uri;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly submodules: Submodule[];
  readonly mergeChanges: Change[];
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
  readonly untrackedChanges?: Change[];
  readonly onDidChange: Event<void>;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
}

export type APIState = 'uninitialized' | 'initialized';

export interface Git {
  readonly path: string;
}

export interface API {
  readonly git: Git;
  readonly state: APIState;
  readonly onDidChangeState: Event<APIState>;
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  openRepository(root: Uri): Promise<Repository | null>;
}

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;
}
