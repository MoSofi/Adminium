// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Contract test between the JSON IR GUIDE and the parser it documents.
 *
 * THE BUG THIS PINS. Every JSON block on `guides/schema-import/json-ir.md` was
 * rejected by `parseSchemaFile`, in full and for six independent reasons:
 * `dialect` and `name` missing, `type`/`primaryKey`/`unique`/`description`
 * instead of `dbType`+`logicalType`/`isPrimaryKey`/`isUnique`/`comment`, a bare
 * string `default`, an `enumValues` array, and a `foreignKeys` array no version
 * of the model has ever had. Nothing checked, because the examples were prose to
 * everything in CI. The page even told readers to add a `$schema` pointer, which
 * was itself an unrecognized key that made the document unimportable.
 *
 * So the page's examples are now RUN. A JSON block on that page that the parser
 * rejects fails here, which is the only way a worked example stays worked.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseSchemaFile } from '../src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAGE = join(
  repoRoot,
  'apps',
  'docs',
  'src',
  'content',
  'docs',
  'guides',
  'schema-import',
  'json-ir.md',
);

/** Every ```json fence on the page, with the title Expressive Code shows. */
function jsonBlocks(): { title: string; body: string }[] {
  const page = readFileSync(PAGE, 'utf8');
  const blocks: { title: string; body: string }[] = [];
  const fence = /```json([^\n]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = fence.exec(page)) !== null) {
    const title = /title="([^"]+)"/.exec(match[1] as string)?.[1] ?? `block ${String(index)}`;
    blocks.push({ title, body: match[2] as string });
    index += 1;
  }
  return blocks;
}

describe('the JSON IR guide imports', () => {
  const blocks = jsonBlocks();

  it('has worked examples to check', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  for (const { title, body } of blocks) {
    it(`${title} parses`, () => {
      const { model, format } = parseSchemaFile(body);
      expect(format).toBe('json');
      expect(model.tables.length).toBeGreaterThan(0);
    });
  }

  it('the page tells you the required keys, and they really are required', () => {
    // The three the model has no default for. If a default is ever added, this
    // fails and the page's "Four things" list needs rewriting with it.
    for (const key of ['dialect', 'name', 'tables']) {
      const doc: Record<string, unknown> = {
        irVersion: 1,
        dialect: 'generic',
        name: 'tiny',
        tables: [{ name: 'users', columns: [{ name: 'id' }] }],
      };
      delete doc[key];
      expect(() => parseSchemaFile(JSON.stringify(doc), { format: 'json' })).toThrowError();
    }
  });

  it('the page does not name a key the model does not have', () => {
    // The four the old example invented. Named here so re-introducing any of
    // them into the guide fails rather than shipping as documentation.
    const page = readFileSync(PAGE, 'utf8');
    const fences = [...page.matchAll(/```json[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1] as string);
    for (const invented of ['"foreignKeys"', '"enumValues"', '"referencesTable"', '"type":']) {
      for (const fence of fences) {
        expect(fence, `a JSON example still uses ${invented}`).not.toContain(invented);
      }
    }
  });
});
