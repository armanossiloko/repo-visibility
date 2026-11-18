// Handles git.ignoredRepositories: the Git extension never opens a repository listed there (some
// other "hide repository" tools work by adding repositories to it). Checking a repository in Repo
// Visibility removes it from the list so Git can open it.

import * as path from 'path';
import * as vscode from 'vscode';
import { pathKey } from './paths';

const SECTION = 'git';
const SETTING = 'ignoredRepositories';

/** Absolute paths of the repositories in git.ignoredRepositories (relative entries resolve against each workspace folder). */
export function ignoredRepositoryPaths(): string[] {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const entries = vscode.workspace.getConfiguration(SECTION).get<string[]>(SETTING, []);
  return entries.flatMap((entry) => (path.isAbsolute(entry) ? [entry] : folders.map((folder) => path.join(folder, entry))));
}

/**
 * Removes every git.ignoredRepositories entry that points at `root` from the user and workspace settings
 * (the scopes the Git extension reads). Returns the setting scopes that were changed.
 */
export async function unignoreRepository(root: string): Promise<string[]> {
  const key = pathKey(root);
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const matches = (entry: string): boolean =>
    path.isAbsolute(entry) ? pathKey(entry) === key : folders.some((folder) => pathKey(path.join(folder, entry)) === key);

  const config = vscode.workspace.getConfiguration(SECTION);
  const inspected = config.inspect<string[]>(SETTING);
  const changed: string[] = [];
  const scopes: [string[] | undefined, vscode.ConfigurationTarget, string][] = [
    [inspected?.globalValue, vscode.ConfigurationTarget.Global, 'User settings'],
    [inspected?.workspaceValue, vscode.ConfigurationTarget.Workspace, 'Workspace settings'],
  ];
  for (const [value, target, label] of scopes) {
    if (value?.some(matches)) {
      const remaining = value.filter((entry) => !matches(entry));
      await config.update(SETTING, remaining.length > 0 ? remaining : undefined, target);
      changed.push(label);
    }
  }
  return changed;
}
