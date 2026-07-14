/**
 * Zod request/response schemas for `routes/schema-import/`
 * (09-generated-app.md §8.2 source mode c, M5-T01).
 *
 * The request mirrors the `@adminium/schema-import` contract
 * `parseSchemaFile(content, { format? }) → { model, format, warnings }`;
 * `format` additionally accepts the wizard-friendly aliases `sql`/`json`.
 */

import { z } from 'zod';
import { importFormatSchema } from '@adminium/engine';

/** Wizard aliases → canonical engine `ImportFormat` values. */
export const FORMAT_ALIASES: Record<string, z.infer<typeof importFormatSchema>> = {
  sql: 'sql-ddl',
  json: 'json-ir',
};

export const parseRequestFormat = z
  .union([importFormatSchema, z.enum(['sql', 'json'])])
  .transform((value) => FORMAT_ALIASES[value] ?? (value as z.infer<typeof importFormatSchema>));

export const schemaImportParseBody = z.object({
  /** Omit to sniff from the content / file name. */
  format: parseRequestFormat.optional(),
  /** Raw schema file text (2 MB body cap comes from the server default). */
  content: z.string().min(1),
  /** Original file name — improves sniffing and the model name. */
  fileName: z.string().min(1).max(255).optional(),
});
export type SchemaImportParseBody = z.infer<typeof schemaImportParseBody>;

export const schemaImportParseReply = z.object({
  /** Engine `DatabaseModel` (validated by `parseDatabaseModel` before reply). */
  model: z.unknown(),
  format: importFormatSchema,
  warnings: z.array(z.string()),
  /** Preview counts for the wizard's schema-file card. */
  summary: z.object({
    tables: z.number().int().nonnegative(),
    columns: z.number().int().nonnegative(),
    relations: z.number().int().nonnegative(),
    enums: z.number().int().nonnegative(),
  }),
});
export type SchemaImportParseReply = z.infer<typeof schemaImportParseReply>;
