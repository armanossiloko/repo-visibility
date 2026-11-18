# Contributing and releasing

## Requirements

- Node.js 22 or later (required by `@vscode/vsce` and `ovsx`)
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

The extension is published to both stores under the publisher / namespace `armanossiloko`:

- **Visual Studio Marketplace** (VS Code): https://marketplace.visualstudio.com/manage
- **Open VSX** (VSCodium, Cursor, Gitpod and others): https://open-vsx.org

### One-time setup

1. **Marketplace publisher.** Sign in at https://marketplace.visualstudio.com/manage and create a publisher with the ID
   `armanossiloko` (it must match `publisher` in `package.json`).
2. **Marketplace Trusted Publishing.** On the publisher page open **Trusted Publishing**, expand **Create** and enter:

   | Field | Value |
   | --- | --- |
   | Policy name | `Release workflow` |
   | Repository owner | `armanossiloko` |
   | Repository | `repo-visibility` |
   | Workflow | `release.yml` |
   | Environment | *(leave empty)* |

   GitHub Actions then publishes with `vsce publish --oidc`; no Marketplace token is stored anywhere.
3. **Open VSX namespace.** Sign in at https://open-vsx.org with GitHub, sign the Eclipse Foundation publisher
   agreement (your profile page prompts for it), and create the namespace `armanossiloko` under
   *Settings > Namespaces* (or with `npx ovsx create-namespace armanossiloko -p <token>`).
4. **Open VSX trusted publisher.** Under *Settings > Trusted Publishers*
   (https://open-vsx.org/user-settings/trusted-publishers) register GitHub Actions for the namespace `armanossiloko`
   with owner `armanossiloko`, repository `repo-visibility`, workflow `release.yml` and no environment. The workflow
   then publishes with `ovsx publish --trusted-publishing`; no Open VSX token is stored anywhere.

### Publish from your machine

Trusted Publishing only works inside GitHub Actions. To publish locally instead, use an Azure DevOps personal access
token with the scope *Marketplace > Manage* (organization: *All accessible organizations*):

```sh
# PowerShell: $env:VSCE_PAT = "..."; $env:OVSX_PAT = "..."
export VSCE_PAT=...   # Marketplace token
export OVSX_PAT=...   # Open VSX token
npm run publish       # both stores; or publish:vscode / publish:openvsx
```

### Publish from GitHub (recommended)

With both trusted publishers in place, bump the version, update `CHANGELOG.md`, and push a tag:

```sh
npm version patch     # or minor / major: updates package.json and creates the v* tag
git push --follow-tags
```

The **Release** workflow builds and tests the extension, publishes it to the Marketplace and Open VSX, and attaches the `.vsix` to a GitHub release.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, for example
`fix(tree): keep submodules under their parent`.

## Images

- `media/icon.png` is drawn by `scripts/make-icon.ps1` (Windows PowerShell).
- `media/screenshot-view.png` is captured by `scripts/screenshot/run.js` on Windows: it builds a demo workspace, opens
  it in the given editor with the extension, hides a few repositories and saves the window:
  `npm run compile && node scripts/screenshot/run.js "<path to Code.exe or VSCodium.exe>"`.
