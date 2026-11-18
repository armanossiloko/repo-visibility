// Pure path helpers. Nothing in here imports vscode, so it can be unit tested with plain Node.

import * as path from 'path';

export interface PathOptions {
  /** Path implementation to use. Defaults to the platform's `path`. */
  readonly pathApi?: path.PlatformPath;
  /** Whether paths compare case-insensitively. Defaults to true on Windows. */
  readonly caseInsensitive?: boolean;
}

function resolveOptions(options?: PathOptions): Required<PathOptions> {
  const pathApi = options?.pathApi ?? path;
  return {
    pathApi,
    caseInsensitive: options?.caseInsensitive ?? pathApi === path.win32,
  };
}

/** Returns a stable key for a file system path: normalized, without a trailing separator, and lower-cased where paths are case-insensitive. */
export function pathKey(fsPath: string, options?: PathOptions): string {
  const { pathApi, caseInsensitive } = resolveOptions(options);
  let normalized = pathApi.normalize(fsPath);
  const root = pathApi.parse(normalized).root;
  while (normalized.length > root.length && /[\\/]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/** True when `child` is strictly inside `parent`. Both arguments must be keys from {@link pathKey}. */
export function isStrictlyInside(childKey: string, parentKey: string, options?: PathOptions): boolean {
  const { pathApi } = resolveOptions(options);
  if (childKey === parentKey) {
    return false;
  }
  const prefix = parentKey.endsWith(pathApi.sep) ? parentKey : parentKey + pathApi.sep;
  return childKey.startsWith(prefix);
}

/** True when `a` equals `b` or either one contains the other. Both arguments must be keys from {@link pathKey}. */
export function isRelated(aKey: string, bKey: string, options?: PathOptions): boolean {
  return aKey === bKey || isStrictlyInside(aKey, bKey, options) || isStrictlyInside(bKey, aKey, options);
}

export interface ForestNode<T> {
  readonly item: T;
  readonly parent: ForestNode<T> | undefined;
  readonly children: ForestNode<T>[];
}

/**
 * Arranges items into a forest by path containment: each item becomes a child of the closest
 * other item whose path contains it. Siblings are sorted with `compare`.
 */
export function buildForest<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  compare: (a: T, b: T) => number,
  options?: PathOptions,
): ForestNode<T>[] {
  // Shorter paths first, so every possible ancestor is placed before its descendants.
  const ordered = [...items].sort((a, b) => keyOf(a).length - keyOf(b).length);
  const placed: { key: string; node: ForestNode<T> }[] = [];
  const roots: ForestNode<T>[] = [];

  for (const item of ordered) {
    const key = keyOf(item);
    let parent: { key: string; node: ForestNode<T> } | undefined;
    for (const candidate of placed) {
      if (isStrictlyInside(key, candidate.key, options) && (!parent || candidate.key.length > parent.key.length)) {
        parent = candidate;
      }
    }
    const node: ForestNode<T> = { item, parent: parent?.node, children: [] };
    (parent ? parent.node.children : roots).push(node);
    placed.push({ key, node });
  }

  const sortLevel = (nodes: ForestNode<T>[]): void => {
    nodes.sort((a, b) => compare(a.item, b.item));
    nodes.forEach((n) => sortLevel(n.children));
  };
  sortLevel(roots);
  return roots;
}

/** Replaces the home directory prefix with `~` for display. */
export function tildify(fsPath: string, homeDir: string, options?: PathOptions): string {
  const { pathApi } = resolveOptions(options);
  if (!homeDir) {
    return fsPath;
  }
  const key = pathKey(fsPath, options);
  const homeKey = pathKey(homeDir, options);
  if (key === homeKey) {
    return '~';
  }
  if (isStrictlyInside(key, homeKey, options)) {
    return '~' + pathApi.sep + pathApi.relative(homeDir, fsPath);
  }
  return fsPath;
}
