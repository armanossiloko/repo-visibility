// Works out why the Git extension refused to open a repository. Git's own reasons are only logged at
// trace level, so this repeats its checks (see openRepository in extensions/git/src/model.ts).

import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { pathKey } from './paths';

export interface OpenProblem {
  /** One sentence for the tooltip and the notification. */
  readonly reason: string;
  /** Git reported "dubious ownership"; `git.manageUnsafeRepositories` can fix it. */
  readonly unsafe: boolean;
}

export async function diagnoseOpenFailure(root: string, gitPath: string | undefined): Promise<OpenProblem> {
  const uri = vscode.Uri.file(root);
  const key = pathKey(root);
  const config = vscode.workspace.getConfiguration('git', uri);
  const problem = (reason: string, unsafe = false): OpenProblem => ({ reason, unsafe });

  if (config.get<boolean>('enabled') !== true) {
    return problem('Git is turned off for this folder (git.enabled).');
  }
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  for (const entry of config.get<string[]>('ignoredRepositories', [])) {
    const candidates = path.isAbsolute(entry) ? [entry] : folders.map((folder) => path.join(folder, entry));
    if (candidates.some((candidate) => pathKey(candidate) === key)) {
      return problem(`It is listed in git.ignoredRepositories ("${entry}").`);
    }
  }
  if (!vscode.workspace.isTrusted) {
    return problem('The workspace is not trusted, and Git only opens repositories in trusted folders.');
  }

  const result = await run(gitPath ?? 'git', ['rev-parse', '--show-toplevel'], root);
  if (result.error) {
    if (/dubious ownership/i.test(result.stderr)) {
      return problem(
        'Git refuses it because the folder is owned by another user ("dubious ownership"). Mark it as safe to open it.',
        true,
      );
    }
    const message = result.stderr.split(/\r?\n/).find((line) => line.trim()) ?? result.error.message;
    return problem(`git rev-parse failed: ${message.trim()}`);
  }
  const topLevel = result.stdout.trim();
  if (topLevel && pathKey(vscode.Uri.file(topLevel).fsPath) !== key) {
    return problem(`Git treats this folder as part of ${vscode.Uri.file(topLevel).fsPath}, not as a repository of its own.`);
  }
  return problem(
    'Git did not say why. Run "Developer: Set Log Level...", set Git to Trace, try again and check the Git output.',
  );
}

function run(file: string, args: string[], cwd: string): Promise<{ error: Error | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: 15000, windowsHide: true }, (error, stdout, stderr) =>
      resolve({ error, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}
