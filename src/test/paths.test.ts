import { strict as assert } from 'assert';
import * as path from 'path';
import { test } from 'node:test';
import { buildForest, isRelated, isStrictlyInside, pathKey, tildify } from '../paths';

const win = { pathApi: path.win32 };
const posix = { pathApi: path.posix };

test('pathKey normalizes, trims trailing separators and folds case on Windows', () => {
  assert.equal(pathKey('C:\\Repos\\Catalog\\', win), 'c:\\repos\\catalog');
  assert.equal(pathKey('c:/Repos//Catalog', win), 'c:\\repos\\catalog');
  assert.equal(pathKey('C:\\', win), 'c:\\');
  assert.equal(pathKey('/home/me/Repo/', posix), '/home/me/Repo');
  assert.equal(pathKey('/', posix), '/');
});

test('isStrictlyInside only matches whole path segments', () => {
  const k = (p: string) => pathKey(p, win);
  assert.ok(isStrictlyInside(k('C:\\Repos\\Catalog\\Submodules\\Core.Lib'), k('C:\\Repos\\Catalog'), win));
  assert.ok(!isStrictlyInside(k('C:\\Repos\\CatalogService'), k('C:\\Repos\\Catalog'), win));
  assert.ok(!isStrictlyInside(k('C:\\Repos\\Catalog'), k('C:\\Repos\\Catalog'), win));
  assert.ok(isStrictlyInside(k('C:\\Repos'), k('C:\\'), win));
  assert.ok(isStrictlyInside('/a/b', '/', posix));
});

test('isRelated covers equal, ancestor and descendant paths', () => {
  assert.ok(isRelated('/a/b', '/a/b', posix));
  assert.ok(isRelated('/a/b/c', '/a/b', posix));
  assert.ok(isRelated('/a', '/a/b', posix));
  assert.ok(!isRelated('/a/bc', '/a/b', posix));
});

test('buildForest nests repositories under their closest containing repository', () => {
  const roots = [
    '/w/Catalog',
    '/w/Catalog/Submodules/Core.Lib',
    '/w/CatalogService',
    '/w/CatalogService/Submodules/Core.Lib',
    '/w/CatalogService/Submodules/Core.Lib/deep/Nested',
    '/w/azure',
  ];
  const forest = buildForest(roots, (r) => r, (a, b) => a.localeCompare(b), posix);
  assert.deepEqual(
    forest.map((n) => n.item),
    ['/w/azure', '/w/Catalog', '/w/CatalogService'].sort((a, b) => a.localeCompare(b)),
  );
  const service = forest.find((n) => n.item === '/w/CatalogService')!;
  assert.equal(service.children.length, 1);
  assert.equal(service.children[0].item, '/w/CatalogService/Submodules/Core.Lib');
  assert.equal(service.children[0].parent, service);
  assert.equal(service.children[0].children[0].item, '/w/CatalogService/Submodules/Core.Lib/deep/Nested');
});

test('tildify shortens paths inside the home directory', () => {
  assert.equal(tildify('/home/me/dev', '/home/me', posix), '~/dev');
  assert.equal(tildify('/home/me', '/home/me', posix), '~');
  assert.equal(tildify('/srv/dev', '/home/me', posix), '/srv/dev');
  assert.equal(tildify('C:\\Users\\Me\\dev', 'c:\\users\\me', win), '~\\dev');
});
