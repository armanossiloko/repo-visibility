// Finds Git repositories on disk and tells repositories, submodules and worktrees apart.
// Plain Node, no vscode import, so it can be unit tested.

import * as fs from 'fs';
import * as path from 'path';

export type RepoKind = 'repository' | 'submodule' | 'worktree';

export interface DiscoveredRepo {
  readonly root: string;
  readonly kind: RepoKind;
}

export interface DiscoveryOptions {
  /** How many folder levels below each start folder to search. 0 checks only the start folders themselves. */
  readonly maxDepth: number;
  /** Folder names (case-insensitive) that are never searched. Folders whose name starts with `.` are always skipped. */
  readonly ignoredFolders: readonly string[];
  /** Stops after reading this many folders, so a huge tree can't stall the editor. */
  readonly maxFolders?: number;
  /** How many folders are read at the same time. */
  readonly concurrency?: number;
}

export interface DiscoveryResult {
  readonly repositories: DiscoveredRepo[];
  /** True when the search stopped at `maxFolders` before finishing. */
  readonly truncated: boolean;
}

/** Paths of the submodules declared in a repository's `.gitmodules`, relative to the repository root. */
export function parseGitmodules(content: string): string[] {
  const paths: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*path\s*=\s*(.+?)\s*$/.exec(line);
    if (match) {
      paths.push(match[1].replace(/^"(.*)"$/, '$1'));
    }
  }
  return paths;
}

/** Classifies a `.git` file by where its `gitdir:` points: `.../modules/...` is a submodule, `.../worktrees/...` a worktree. */
export function kindFromGitFile(content: string): RepoKind {
  const gitdir = /^\s*gitdir:\s*(.+?)\s*$/m.exec(content)?.[1].replace(/\\/g, '/') ?? '';
  if (/\/worktrees\/[^/]+$/.test(gitdir)) {
    return 'worktree';
  }
  if (/\/modules\//.test(gitdir)) {
    return 'submodule';
  }
  return 'repository';
}

/**
 * Breadth-first search for Git repositories below the given folders. Nested repositories, submodules and
 * worktrees are all included. Submodules declared in `.gitmodules` are found at any depth.
 */
export async function findRepositories(startFolders: readonly string[], options: DiscoveryOptions): Promise<DiscoveryResult> {
  const ignored = new Set(options.ignoredFolders.map((name) => name.toLowerCase()));
  const maxFolders = options.maxFolders ?? 20000;
  const concurrency = options.concurrency ?? 32;
  const found = new Map<string, DiscoveredRepo>();
  const declaredSubmodules = new Set<string>();
  const seen = new Set<string>();
  const id = (p: string): string => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));
  let read = 0;
  let truncated = false;

  type Item = { dir: string; depth: number };

  /** Reads one folder and returns the folders to search next. */
  const visit = async ({ dir, depth }: Item): Promise<Item[]> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return []; // unreadable or gone
    }
    const next: Item[] = [];
    const dotGit = entries.find((e) => e.name === '.git' && (e.isDirectory() || e.isFile()));
    if (dotGit) {
      found.set(id(dir), { root: dir, kind: dotGit.isFile() ? await readGitFileKind(dir) : 'repository' });
      // Declared submodules are searched even when they are deeper than maxDepth.
      if (entries.some((e) => e.name === '.gitmodules' && e.isFile())) {
        for (const relative of await readGitmodules(dir)) {
          const submodule = path.join(dir, relative);
          declaredSubmodules.add(id(submodule));
          next.push({ dir: submodule, depth: Math.max(depth + 1, options.maxDepth) });
        }
      }
    }
    if (depth < options.maxDepth) {
      for (const entry of entries) {
        // Dirent.isDirectory() is false for symbolic links, so links are not followed.
        if (entry.isDirectory() && !entry.name.startsWith('.') && !ignored.has(entry.name.toLowerCase())) {
          next.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
      }
    }
    return next;
  };

  // Breadth-first, one level at a time, reading up to `concurrency` folders in parallel.
  let level: Item[] = startFolders.map((dir) => ({ dir, depth: 0 }));
  while (level.length > 0 && !truncated) {
    const pending = level.filter((item) => {
      const key = id(item.dir);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    if (read + pending.length > maxFolders) {
      pending.length = Math.max(0, maxFolders - read);
      truncated = true;
    }
    read += pending.length;

    const nextLevel: Item[] = [];
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < pending.length) {
        nextLevel.push(...(await visit(pending[index++])));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    level = nextLevel;
  }

  const repositories = [...found.entries()].map(([key, repo]) =>
    declaredSubmodules.has(key) ? { root: repo.root, kind: 'submodule' as const } : repo,
  );
  return { repositories, truncated };
}

async function readGitmodules(dir: string): Promise<string[]> {
  try {
    return parseGitmodules(await fs.promises.readFile(path.join(dir, '.gitmodules'), 'utf8'));
  } catch {
    return [];
  }
}

async function readGitFileKind(dir: string): Promise<RepoKind> {
  try {
    return kindFromGitFile(await fs.promises.readFile(path.join(dir, '.git'), 'utf8'));
  } catch {
    return 'repository';
  }
}
