// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The JSON Schemas shipped in `schemas/` are the ones the file schemas
 * generate. `project-schemas:check` runs the same comparison against the
 * build in CI; this one reads the source, so it fails in the test run too.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectJsonSchemaDocuments } from '../src/project/file-schemas.js';
import { PAGE_FILE_SCHEMA_REF } from '../src/project/page-files.js';
import { LIST_FILE_SCHEMA_REF } from '../src/project/list-files.js';
import { SCHEMA_FILE_SCHEMA_REF } from '../src/project/schema-files.js';

const schemasDir = join(import.meta.dirname, '..', 'schemas');

describe('the published project file schemas', () => {
  const documents = projectJsonSchemaDocuments();

  it('are current', () => {
    expect(Object.keys(documents).sort()).toEqual(['config.json', 'list.json', 'page.json', 'schema.json']);
    for (const [name, text] of Object.entries(documents)) {
      expect(readFileSync(join(schemasDir, name), 'utf8'), `schemas/${name} is stale: run pnpm --filter @adminium/server run project-schemas`).toBe(text);
    }
  });

  it('describe the files as written', () => {
    const page = JSON.parse(documents['page.json'] ?? '{}') as { required: string[]; properties: Record<string, unknown> };
    expect(page.required).toEqual(expect.arrayContaining(['v', 'kind', 'template', 'title', 'source', 'nav', 'access', 'config']));
    expect(page.required).not.toContain('origin');
    expect(page.properties).not.toHaveProperty('id');
    const schema = JSON.parse(documents['schema.json'] ?? '{}') as { required: string[] };
    expect(schema.required).toEqual(['overrides']);
    // A list file's name IS its key, so the key is not a property of the file.
    const list = JSON.parse(documents['list.json'] ?? '{}') as { required: string[]; properties: Record<string, unknown> };
    expect(list.required).toEqual(['name', 'items']);
    expect(list.properties).not.toHaveProperty('key');
  });

  it('are where the files\' $schema points, inside the package', () => {
    const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { files: string[] };
    expect(packageJson.files).toContain('schemas');
    expect(PAGE_FILE_SCHEMA_REF).toBe('../node_modules/@adminiumjs/adminium/schemas/page.json');
    expect(SCHEMA_FILE_SCHEMA_REF).toBe('../node_modules/@adminiumjs/adminium/schemas/schema.json');
    expect(LIST_FILE_SCHEMA_REF).toBe('../node_modules/@adminiumjs/adminium/schemas/list.json');
  });
});
