// Regenerates media/screenshot-view.png on Windows:
//   npm run compile && node scripts/screenshot/run.js "<path to Code.exe or VSCodium.exe>"
// It builds a demo workspace, opens it with the extension, hides a few repositories and captures the window.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..', '..');
const executable = process.argv[2] || process.env.VSCODE_EXECUTABLE;
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'ignore' });

const services = ['api-gateway', 'billing-service', 'catalog-service', 'design-system', 'mobile-app', 'notification-service', 'web-app'];
const withCoreLib = ['billing-service', 'catalog-service', 'notification-service'];
const hide = ['design-system', 'mobile-app', 'notification-service'];

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-visibility-shot-'));
  const workspace = path.join(temp, 'acme-platform');
  const coreLibSource = path.join(temp, 'core-lib');
  fs.mkdirSync(coreLibSource, { recursive: true });
  git(coreLibSource, 'init', '-q');
  fs.writeFileSync(path.join(coreLibSource, 'index.ts'), 'export {};\n');
  git(coreLibSource, 'add', '.');
  git(coreLibSource, 'commit', '-q', '-m', 'init');

  for (const name of services) {
    const dir = path.join(workspace, name);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'init');
    if (withCoreLib.includes(name)) {
      git(dir, 'submodule', 'add', '-q', coreLibSource, 'libs/core-lib');
      git(dir, 'commit', '-q', '-m', 'add core-lib');
    }
    fs.writeFileSync(path.join(dir, 'CHANGES.md'), 'work in progress\n');
  }

  const userData = path.join(temp, 'user-data');
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'User', 'settings.json'),
    JSON.stringify({
      'workbench.startupEditor': 'none',
      'workbench.tips.enabled': false,
      'window.restoreWindows': 'none',
      'window.commandCenter': false,
      'workbench.layoutControl.enabled': false,
      'chat.commandCenter.enabled': false,
      'git.repositoryScanMaxDepth': 2,
      'scm.repositories.visible': 20,
    }),
  );

  const capture = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'capture.ps1'),
    '-TitleLike', '*acme-platform*', '-Out', path.join(root, 'media', 'screenshot-view.png'), '-DelaySeconds', '14', '-Width', '1100', '-Height', '900'],
    { stdio: 'inherit' });

  try {
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'driver.js'),
      extensionTestsEnv: {
        SCREENSHOT_REPO_COUNT: String(services.length + withCoreLib.length),
        SCREENSHOT_HIDE: hide.join(','),
        SCREENSHOT_HOLD_MS: '14000',
      },
      launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--user-data-dir', userData],
    });
  } finally {
    await new Promise((resolve) => (capture.exitCode !== null ? resolve() : capture.on('exit', resolve)));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
