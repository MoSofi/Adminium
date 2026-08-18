// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The published IR JSON Schema is derived, and this is its drift guard.
 *
 * THE BUG THIS PINS. `guides/schema-import/json-ir.md` published a `$schema`
 * URL from the day it was written and no document was ever generated for it —
 * a contract advertised to every third-party emitter, 404ing. Generating it is
 * only half a fix: a generated artifact nobody re-generates is a stale contract
 * published as a current one, which is the failure this repo has hit before
 * (the same reason `openapi.json --check` exists).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { IR_SCHEMA_URL, irJsonSchemaDocument } from '../src/ir-json-schema.js';
import { IR_VERSION } from '../src/schema-model.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '..', '..');
const ARTIFACT = join(packageRoot, 'ir-v1.schema.json');

describe('ir-v1.schema.json', () => {
  it('matches the model it is generated from', () => {
    expect(
      readFileSync(ARTIFACT, 'utf8'),
      'ir-v1.schema.json is stale — run `pnpm --filter @adminium/engine run ir-schema`',
    ).toBe(irJsonSchemaDocument());
  });

  it('accepts `$schema` at the root, so an editor-validated document is importable', () => {
    // Every IR object is a strictObject, so `additionalProperties: false` is
    // generated throughout. Without the explicit allowance the pointer that
    // makes the editor validate would be the editor's first complaint.
    const schema = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as {
      $id: string;
      additionalProperties: boolean;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.$schema).toBeDefined();
    expect(schema.required).not.toContain('$schema');
    expect(schema.$id).toBe(IR_SCHEMA_URL);
  });

  it('carries no generation timestamp, so `--check` passes on a clean tree', () => {
    // `introspectedAt` defaults to `new Date().toISOString()`. Emitted raw, the
    // artifact differed from itself on every run and the drift gate would have
    // failed on an untouched checkout.
    const schema = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as {
      properties: { introspectedAt: Record<string, unknown> };
    };
    expect(schema.properties.introspectedAt.default).toBeUndefined();
    expect(readFileSync(ARTIFACT, 'utf8')).toBe(irJsonSchemaDocument());
  });

  it('leaves optional what the model defaults, so the minimal IR validates', () => {
    const schema = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { required: string[] };
    // `io: 'input'`: only the three fields with no default are required.
    expect([...schema.required].sort()).toEqual(['dialect', 'name', 'tables']);
    expect(schema.required).not.toContain('irVersion');
    expect(IR_VERSION).toBe(1);
  });

  it('is served at the URL it claims, and the guide points at that URL', () => {
    // A generated schema nobody can fetch is the same defect in a new place.
    const endpoint = join(repoRoot, 'apps', 'docs', 'src', 'pages', 'schemas', 'ir-v1.json.ts');
    expect(readFileSync(endpoint, 'utf8')).toContain('packages/engine/ir-v1.schema.json');

    const guide = readFileSync(
      join(repoRoot, 'apps', 'docs', 'src', 'content', 'docs', 'guides', 'schema-import', 'json-ir.md'),
      'utf8',
    );
    expect(guide).toContain(IR_SCHEMA_URL);
    // The URL the page used to publish, on a host this repo does not build.
    expect(guide).not.toMatch(/https:\/\/adminium\.dev\/schemas/);
  });
});
