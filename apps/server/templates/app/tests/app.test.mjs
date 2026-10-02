// Checks that need nothing but Node:  node --test apps/__KEY__/tests
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(readFileSync(join(app, file), 'utf8'));
const entries = (dir) =>
  existsSync(join(app, 'manifest', dir))
    ? readdirSync(join(app, 'manifest', dir)).filter((name) => name.endsWith('.json')).map((name) => read(join('manifest', dir, name)))
    : [];

test('every page shows a table the app has', () => {
  const tables = new Set(entries('tables').map((table) => table.ref));
  for (const page of entries('pages')) {
    for (const table of Object.values(page.bindings ?? {})) {
      assert.ok(tables.has(table), `pages/${page.ref}.json binds "${table}", and there is no tables/${table}.json`);
    }
  }
});

test('the customer side is granted only tables the app has', () => {
  if (!existsSync(join(app, 'manifest', 'access.json'))) return;
  const tables = new Set(entries('tables').map((table) => table.ref));
  for (const entry of read('manifest/access.json').publicAccess ?? []) {
    assert.ok(tables.has(entry.table), `access.json grants "${entry.table}", and there is no tables/${entry.table}.json`);
  }
});

test('adminium app check passes', { skip: process.env.ADMINIUM_SKIP_CLI === '1' }, () => {
  execFileSync('npx', ['--no-install', 'adminium', 'app', 'check', '__KEY__'], { cwd: join(app, '..', '..'), stdio: 'pipe' });
});
