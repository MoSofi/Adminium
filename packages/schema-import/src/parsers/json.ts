/**
 * JSON IR parser — the public ingestion contract (05 §2.3/§5.2). The "format"
 * is simply the DatabaseModel schema itself; this wraps `parseDatabaseModel`
 * with pretty error mapping so external emitters get actionable messages.
 */
import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { ZodError } from 'zod';

import { SchemaImportError } from '../errors.js';

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
    return parseDatabaseModel(value);
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
