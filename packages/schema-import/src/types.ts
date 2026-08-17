// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Public types for @adminium/schema-import — 05-introspection-engine.md §5.
 *
 * The short `Format` names are the user-facing vocabulary of the import
 * wizard and the `/api/v1/schema-import/parse` route; they map 1:1 onto the
 * engine's `ImportFormat` enum (which persists inside `model.source`).
 */
import type { DatabaseModel, ImportFormat } from '@adminium/engine';

export const FORMATS = [
  'sql',
  'prisma',
  'drizzle',
  'typeorm',
  'sequelize',
  'rails',
  'django',
  'json',
] as const;
export type Format = (typeof FORMATS)[number];

/** Short public format name → engine `ImportFormat` (stored in `model.source`). */
export const FORMAT_TO_IR: Readonly<Record<Format, ImportFormat>> = {
  sql: 'sql-ddl',
  prisma: 'prisma',
  drizzle: 'drizzle',
  typeorm: 'typeorm',
  sequelize: 'sequelize',
  rails: 'rails',
  django: 'django',
  json: 'json-ir',
};

export interface ParseSchemaFileOptions {
  /** Skip auto-detection and parse as this format. */
  format?: Format;
  /** Model name override (defaults to `<format>-import`). */
  name?: string;
  /** Original file name — recorded on `model.source.fileName` for provenance. */
  fileName?: string;
}

export interface ParseSchemaFileResult {
  model: DatabaseModel;
  /** The format actually used (detected or forced). */
  format: Format;
  /**
   * Human-readable non-fatal issues (skipped statements, unsupported
   * constructs, dropped dangling references). Mirrored into
   * `model.warnings` with stable codes.
   */
  warnings: string[];
}
