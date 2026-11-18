# Changelog

All notable changes to Repo Visibility are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-11-18

### Changed

- When Git refuses to open a repository, the list now says why: the repository gets a warning icon and its tooltip
  shows the reason (dubious ownership / `safe.directory`, `git.ignoredRepositories`, `git.enabled` turned off, an
  untrusted workspace, or the error from `git rev-parse`, such as a submodule whose `.git` file points nowhere).
- Failures are reported in one notification instead of one per repository. When ownership is the problem it offers
  *Manage Unsafe Repositories*.

## [0.2.0] - 2026-11-18

### Added

- The workspace folders are scanned on disk for repositories, so the list contains every repository in the
  workspace, including ones the Git extension never opened (deeper than `git.repositoryScanMaxDepth`, or closed in an
  earlier session). Check one to add it to Source Control.
- Submodules are recognized from `.gitmodules` (at any depth) and from the `.git` file, and shown with a submodule
  icon. Linked worktrees are recognized too.
- Repositories you show are reopened after a reload even if Git would not open them by itself.
- Settings `repoVisibility.scanDepth` and `repoVisibility.scanIgnoredFolders`.

### Fixed

- Only the repositories the Git extension happened to have open were listed.

## [0.1.0] - 2026-11-18

### Added

- Repo Visibility panel in the Source Control sidebar with a checkbox per repository to hide or show it.
- Tree view that nests submodules and nested repositories under their parent, and a flat list view.
- Show All, Hide All and Choose Visible Repositories... commands.
- Context menu actions: Show, Hide, Show Only This Repository, Reveal in File Explorer and Forget Repository.
- Hidden repositories are remembered per workspace and stay hidden after a reload.
- Repositories closed with Git's own Close Repository action are listed as hidden.

[0.3.0]: https://github.com/armanossiloko/repo-visibility/releases/tag/v0.3.0
[0.2.0]: https://github.com/armanossiloko/repo-visibility/releases/tag/v0.2.0
[0.1.0]: https://github.com/armanossiloko/repo-visibility/releases/tag/v0.1.0
