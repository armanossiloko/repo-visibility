// Runs inside the extension host (see ../runIntegration.ts). It drives the real built-in Git
// extension against a temporary workspace with the repositories alpha, beta, beta/inner and gamma.

import { strict as assert } from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitExtension, API } from '../../git';
import type { ExtensionApi } from '../../extension';
import { pathKey } from '../../paths';

/** Opened by Git itself. */
const GIT_OPENS = ['alpha', 'beta', 'core', 'gamma', 'inner'];
/** Found only by the extension: too deep for Git's scan, or listed in git.ignoredRepositories. */
const GIT_SKIPS = ['deep', 'skipped', 'skippedUser'];
/** Everything in the workspace that can be opened. */
const NAMES = [...GIT_OPENS, ...GIT_SKIPS];

let describeState: () => string = () => '';

async function waitFor(what: string, condition: () => boolean, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for: ${what}
${describeState()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<ExtensionApi>('armanossiloko.repo-visibility');
  assert.ok(ext, 'extension is installed');
  const api = await ext.activate();
  const git: API = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports.getAPI(1);

  const openNames = (): string[] => git.repositories.map((r) => path.basename(r.rootUri.fsPath)).sort();
  const listed = (): Record<string, boolean> =>
    Object.fromEntries(api.getRepositories().map((r) => [path.basename(r.root), r.visible]));
  describeState = () => `open: ${openNames().join(', ')}
listed: ${JSON.stringify(listed())}`;
  const node = (name: string) => {
    const repo = api.getRepositories().find((r) => path.basename(r.root) === name);
    assert.ok(repo, `${name} is listed`);
    return { item: { key: pathKey(repo.root) } };
  };
  const step = async (label: string, run: () => Thenable<unknown>, expectOpen: string[], expectListed: Record<string, boolean>) => {
    await run();
    await waitFor(`${label}: open repositories ${expectOpen.join(', ')}`, () => openNames().join() === [...expectOpen].sort().join());
    await waitFor(`${label}: listed ${JSON.stringify(expectListed)}`, () => JSON.stringify(sortKeys(listed())) === JSON.stringify(sortKeys(expectListed)));
    console.log(`ok - ${label}`);
  };

  // `broken` is always listed and never opens.
  const all = (visible: boolean) => ({ ...Object.fromEntries(NAMES.map((n) => [n, visible])), broken: false });

  await waitFor('Git opens its repositories', () => openNames().join() === [...GIT_OPENS].sort().join());
  await step('the disk scan lists the repositories Git did not open', () => vscode.commands.executeCommand('repoVisibility.refresh'),
    GIT_OPENS, { ...all(true), ...Object.fromEntries(GIT_SKIPS.map((n) => [n, false])) });

  const kinds = Object.fromEntries(api.getRepositories().map((r) => [path.basename(r.root), r.kind]));
  assert.deepEqual(
    sortKeys(kinds),
    sortKeys({ ...Object.fromEntries(NAMES.map((n) => [n, 'repository'])), core: 'submodule', broken: 'repository' }),
  );
  console.log('ok - submodules are recognized');

  await vscode.commands.executeCommand('repoVisibility.show', node('broken'));
  const broken = api.getRepositories().find((r) => path.basename(r.root) === 'broken')!;
  assert.equal(broken.visible, false);
  assert.match(broken.problem ?? '', /rev-parse failed: fatal: /, `problem was: ${broken.problem}`);
  console.log(`ok - a repository Git cannot open says why: ${broken.problem}`);

  await step('show the repositories Git did not open', () =>
    vscode.commands.executeCommand('repoVisibility.show', node('deep'), GIT_SKIPS.map(node)),
    NAMES, all(true));
  const ignored = vscode.workspace.getConfiguration('git').inspect<string[]>('ignoredRepositories');
  assert.equal(ignored?.globalValue, undefined, 'both entries were removed from the user settings');
  console.log('ok - showing a repository removes it from git.ignoredRepositories');

  await step('hide one', () => vscode.commands.executeCommand('repoVisibility.hide', node('beta')),
    NAMES.filter((n) => n !== 'beta'), { ...all(true), beta: false });

  await step('show only one', () => vscode.commands.executeCommand('repoVisibility.showOnly', node('gamma')),
    ['gamma'], { ...all(false), gamma: true });

  await step('show all', () => vscode.commands.executeCommand('repoVisibility.showAll'), NAMES, all(true));

  const gammaUri = git.repositories.find((r) => path.basename(r.rootUri.fsPath) === 'gamma')!.rootUri;
  await step('closing through Git keeps it listed as hidden', () => vscode.commands.executeCommand('git.close', gammaUri),
    NAMES.filter((n) => n !== 'gamma'), { ...all(true), gamma: false });

  await step('show the one Git closed', () => vscode.commands.executeCommand('repoVisibility.show', node('gamma')),
    NAMES, all(true));

  await step('hide all', () => vscode.commands.executeCommand('repoVisibility.hideAll'), [], all(false));

  await step('show several at once', () =>
    vscode.commands.executeCommand('repoVisibility.show', node('gamma'), [node('gamma'), node('inner')]),
    ['gamma', 'inner'], { ...all(false), gamma: true, inner: true });

  await step('show all again', () => vscode.commands.executeCommand('repoVisibility.showAll'), NAMES, all(true));
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
