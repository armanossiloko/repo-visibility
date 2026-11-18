import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { after, before, test } from 'node:test';
import { findRepositories, kindFromGitFile, parseGitmodules } from '../discovery';

let root: string;

// Builds a fake tree: .git folders and files are enough for discovery, no git needed.
function repo(relative: string, gitFile?: string): void {
  const dir = path.join(root, relative);
  fs.mkdirSync(dir, { recursive: true });
  if (gitFile === undefined) {
    fs.mkdirSync(path.join(dir, '.git'));
  } else {
    fs.writeFileSync(path.join(dir, '.git'), gitFile);
  }
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-visibility-discovery-'));
  repo('Catalog');
  fs.writeFileSync(path.join(root, 'Catalog', '.gitmodules'), '[submodule "Core.Lib"]\n\tpath = Submodules/Core.Lib\n\turl = ../Core.Lib\n');
  repo('Catalog/Submodules/Core.Lib', 'gitdir: ../../.git/modules/Core.Lib\n');
  repo('CatalogService');
  repo('CatalogService/deep/a/b/c/Nested'); // depth 6 and not a declared submodule: beyond maxDepth
  fs.writeFileSync(path.join(root, 'CatalogService', '.gitmodules'), '[submodule "x"]\n  path = "very/deep/down/below/Lib"\n');
  repo('CatalogService/very/deep/down/below/Lib', 'gitdir: C:/x/CatalogService/.git/modules/Lib');
  repo('Catalog-feature', 'gitdir: ../Catalog/.git/worktrees/Catalog-feature\n');
  repo('group/DataHub');
  repo('node_modules/ignored');
  repo('.hidden/ignored');
  fs.mkdirSync(path.join(root, 'plain-folder', 'src'), { recursive: true });
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('parseGitmodules reads submodule paths', () => {
  assert.deepEqual(
    parseGitmodules('[submodule "a"]\n\tpath = libs/a\n\turl = x\n[submodule "b"]\r\n  path=libs/b c\r\n'),
    ['libs/a', 'libs/b c'],
  );
});

test('kindFromGitFile tells submodules from worktrees', () => {
  assert.equal(kindFromGitFile('gitdir: ../.git/modules/Core.Lib'), 'submodule');
  assert.equal(kindFromGitFile('gitdir: C:\\repos\\app\\.git\\modules\\lib\n'), 'submodule');
  assert.equal(kindFromGitFile('gitdir: /repos/app/.git/worktrees/feature'), 'worktree');
  assert.equal(kindFromGitFile('gitdir: /elsewhere/app.git'), 'repository');
});

test('findRepositories finds repositories, submodules and worktrees within the depth', async () => {
  const { repositories, truncated } = await findRepositories([root], {
    maxDepth: 4,
    ignoredFolders: ['node_modules'],
  });
  assert.equal(truncated, false);
  const byPath = Object.fromEntries(repositories.map((r) => [path.relative(root, r.root).replace(/\\/g, '/'), r.kind]));
  assert.deepEqual(byPath, {
    Catalog: 'repository',
    'Catalog/Submodules/Core.Lib': 'submodule',
    CatalogService: 'repository',
    // Declared in .gitmodules, so found although it is deeper than maxDepth.
    'CatalogService/very/deep/down/below/Lib': 'submodule',
    'Catalog-feature': 'worktree',
    'group/DataHub': 'repository',
  });
});

test('findRepositories respects maxDepth and maxFolders', async () => {
  const shallow = await findRepositories([root], { maxDepth: 1, ignoredFolders: ['node_modules'] });
  const names = shallow.repositories.map((r) => path.relative(root, r.root).replace(/\\/g, '/')).sort();
  assert.ok(names.includes('Catalog'));
  assert.ok(!names.includes('group/DataHub'));
  assert.ok(names.includes('Catalog/Submodules/Core.Lib'), 'declared submodules ignore maxDepth');

  const capped = await findRepositories([root], { maxDepth: 4, ignoredFolders: [], maxFolders: 3 });
  assert.equal(capped.truncated, true);
});
