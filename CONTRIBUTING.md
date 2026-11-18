# Contributing and releasing

## Requirements

- Node.js 22 or later (required by `@vscode/vsce`)
- Git

## Develop

```sh
npm install
npm run compile        # or: npm run watch
```

Press `F5` in VS Code to start an Extension Development Host with the extension loaded.

## Test

```sh
npm test                    # unit tests (no editor needed)
npm run test:integration    # runs the extension in a real editor against a temporary workspace
```

`test:integration` downloads VS Code stable into `.vscode-test/` the first time. To use an editor you already have,
point `VSCODE_EXECUTABLE` at its executable, for example:

```powershell
$env:VSCODE_EXECUTABLE = "$env:LOCALAPPDATA\Programs\VSCodium\VSCodium.exe"; npm run test:integration
```

## Build a package

```sh
npm run package
```

This compiles the extension and writes `repo-visibility-<version>.vsix`. Install it with
`code --install-extension repo-visibility-<version>.vsix` (or `codium --install-extension ...`).

## Publish

The extension is published to the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=armanossiloko.repo-visibility)
under the publisher `armanossiloko`.

### Publish from GitHub (the normal way)

The **Release** workflow publishes with Marketplace Trusted Publishing (`vsce publish --oidc`), so no token is stored
anywhere. Bump the version, update `CHANGELOG.md`, and push a tag:

```sh
npm version patch     # or minor / major: updates package.json and creates the v* tag
git push --follow-tags
```

The workflow builds and tests the extension, publishes it to the Marketplace, and attaches the `.vsix` to a GitHub
release. Re-running it is safe: a version that is already published is skipped.

The Trusted Publishing policy lives on the publisher page (https://marketplace.visualstudio.com/manage, publisher
`armanossiloko` > **Trusted Publishing**): owner `armanossiloko`, repository `repo-visibility`, workflow `release.yml`,
no environment. If the workflow file is renamed, update the policy too.

### Publish from your machine

Trusted Publishing only works inside GitHub Actions. To publish locally, create an Azure DevOps personal access token
with the scope *Marketplace > Manage* (organization: *All accessible organizations*) and run:

```sh
# PowerShell: $env:VSCE_PAT = "..."
export VSCE_PAT=...
npm run publish
```

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, for example
`fix(tree): keep submodules under their parent`.

## Images

- `media/icon.png` is drawn by `scripts/make-icon.ps1` (Windows PowerShell).
- `media/screenshot-view.png` is captured by `scripts/screenshot/run.js` on Windows: it builds a demo workspace, opens
  it in the given editor with the extension, hides a few repositories and saves the window:
  `npm run compile && node scripts/screenshot/run.js "<path to Code.exe or VSCodium.exe>"`.
