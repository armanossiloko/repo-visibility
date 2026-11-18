// Integration test launcher: creates a throwaway workspace with several Git repositories and runs
// src/test/integration/index.ts inside VS Code with only this extension and the built-in ones.
//
//   npm run test:integration                     downloads VS Code stable into .vscode-test/
//   VSCODE_EXECUTABLE=<path to Code/VSCodium exe> npm run test:integration    uses an installed build

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

async function main(): Promise<void> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-visibility-test-'));
  const workspace = path.join(temp, 'workspace');
  for (const repo of ['alpha', 'beta', 'gamma', path.join('beta', 'inner')]) {
    const dir = path.join(workspace, repo);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${path.basename(repo)}\n`);
  }
  fs.mkdirSync(path.join(workspace, '.vscode'));
  fs.writeFileSync(
    path.join(workspace, '.vscode', 'settings.json'),
    JSON.stringify({ 'git.repositoryScanMaxDepth': 2, 'git.autoRepositoryDetection': true }, null, 2),
  );

  const root = path.resolve(__dirname, '..', '..');
  try {
    // Note: VS Code keeps storage in memory while running extension tests, so persistence across
    // reloads cannot be covered here.
    const exitCode = await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'integration', 'index.js'),
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--user-data-dir',
        path.join(temp, 'user-data'),
      ],
    });
    if (exitCode !== 0) {
      throw new Error(`Integration tests failed with exit code ${exitCode}`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
