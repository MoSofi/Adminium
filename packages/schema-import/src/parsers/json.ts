// SPDX-License-Identifier: AGPL-3.0-only
/**
 * JSON IR parser — the public ingestion contract (05 §2.3/§5.2). The "format"
 * is simply the DatabaseModel schema itself; this wraps `parseDatabaseModel`
 * with pretty error mapping so external emitters get actionable messages.
 *
 * `$schema` IS STRIPPED, and that is the one place this parser is deliberately
 * laxer than the model. Every object in the IR is a Zod `strictObject`, so an
 * unknown key is an error — which meant the workflow the docs recommend, adding
 * `"$schema": ".../ir-v1.json"` so an editor validates the file while you write
 * it, produced a document Adminium then REFUSED to import. Stripping it here
 * (and only here — snapshots and LLM responses keep the strict path) makes the
 * documented workflow real. The key is a JSON Schema pointer, not IR data, so
 * nothing downstream can want it.
 */
import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { ZodError } from 'zod';

import { SchemaImportError } from '../errors.js';

/** Drop a top-level `$schema` pointer; leave anything else for the schema to judge. */
function withoutSchemaPointer(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  if (!('$schema' in value)) return value;
  const { $schema, ...rest } = value as Record<string, unknown>;
  // Only a string pointer is editor metadata. An object under `$schema` is
  // someone's data and should still fail loudly rather than vanish.
  return typeof $schema === 'string' ? rest : value;
}

export function parseJsonIr(content: string): DatabaseModel {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new SchemaImportError(
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return parseDatabaseModel(withoutSchemaPointer(value));
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => {
        const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
        return `${path}: ${issue.message}`;
      });
      throw new SchemaImportError(
        `document does not match the Adminium IR v1 schema:\n  - ${details.join('\n  - ')}`,
        details,
      );
    }
    throw error;
  }
}
