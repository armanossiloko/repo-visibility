// Runs inside the extension host while scripts/screenshot/run.js captures the window.
const path = require('path');
const vscode = require('vscode');
const { pathKey } = require('../../out/paths');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async () => {
  const git = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
  const api = await vscode.extensions.getExtension('armanossiloko.repo-visibility').activate();
  const expected = Number(process.env.SCREENSHOT_REPO_COUNT);
  for (let i = 0; i < 300 && api.getRepositories().length < expected; i++) {
    await sleep(100);
  }
  await sleep(1500);

  const node = (name) => {
    const repo = api.getRepositories().find((r) => path.basename(r.root) === name && !r.root.includes('libs'));
    return { item: { key: pathKey(repo.root) } };
  };
  const hide = (process.env.SCREENSHOT_HIDE || '').split(',').filter(Boolean).map(node);
  await vscode.commands.executeCommand('repoVisibility.hide', hide[0], hide);

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await vscode.commands.executeCommand('workbench.view.scm');
  await vscode.commands.executeCommand('workbench.scm.history.removeView').then(undefined, () => undefined);
  await vscode.commands.executeCommand('notifications.clearAll');
  await sleep(500);
  await vscode.commands.executeCommand('workbench.scm.action.collapseAllRepositories').then(undefined, () => undefined);
  await vscode.commands.executeCommand('repoVisibility.repositories.focus');
  // Give the panel room: remove the Changes view and add it back, which lays the panes out evenly.
  const quiet = (p) => Promise.resolve(p).then(undefined, () => undefined);
  await quiet(vscode.commands.executeCommand('workbench.scm.removeView'));
  await sleep(800);
  await quiet(vscode.commands.executeCommand('workbench.scm.focus'));
  await sleep(800);
  await quiet(vscode.commands.executeCommand('workbench.scm.action.collapseAllRepositories'));
  await quiet(vscode.commands.executeCommand('repoVisibility.repositories.focus'));
  // Hover-free, settled UI for the capture.
  await sleep(Number(process.env.SCREENSHOT_HOLD_MS || 12000));
};
