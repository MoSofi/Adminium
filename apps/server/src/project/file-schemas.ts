// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The JSON Schemas a project's files point at with `$schema`, so an editor can
 * complete and check them: `schemas/page.json`, `schemas/schema.json`,
 * `schemas/list.json` and `schemas/config.json` in the published package.
 *
 * They are generated from the Zod schemas the server validates with
 * (`scripts/project-schemas.mjs`, with a `--check` mode), so they cannot drift
 * from the code. They describe the file shape for editors; the real check is
 * `readPageFile` / `readSchemaFile` / `readListFile`, which also validates each
 * widget's settings and every value a schema override holds.
 */

import {
  CONFIG_VERSION,
  configKindSchema,
  navConfigSchema,
  pagePaddingSchema,
  pageWidthSchema,
} from '@adminium/engine/config';
import { LLM_OVERRIDE_FIELDS, overridePatchSchema } from '@adminium/meta';
import { z } from 'zod';

import { projectConfigSchema } from './config.js';
import { FILE_PAGE_ORIGINS } from './page-files.js';

export const pageFileSchema = z
  .looseObject({
    $schema: z.string().optional(),
    v: z.literal(CONFIG_VERSION).describe('Page document version.'),
    kind: configKindSchema,
    template: z.string().describe('The page template, e.g. page-crud or page-dashboard.'),
    origin: z
      .enum(FILE_PAGE_ORIGINS)
      .optional()
      .describe('Who made the page. Absent means user: regeneration never replaces it.'),
    enabled: z.boolean().optional().describe('false hides the page everywhere. Absent means true.'),
    title: z.object({ key: z.string().min(1), fallback: z.string().min(1) }),
    source: z.object({
      database: z
        .string()
        .nullable()
        .describe('The database key from adminium.config.ts, or null for a page with no data source.'),
      table: z.string().nullable().describe('The table the page shows, e.g. public.orders.'),
    }),
    nav: navConfigSchema.describe('Where the page sits in the sidebar. `slug` must equal the file name.'),
    access: z.object({ minRole: z.string().min(1), permissions: z.array(z.string()) }),
    padding: pagePaddingSchema.optional(),
    width: pageWidthSchema.optional(),
    config: z
      .record(z.string(), z.unknown())
      .describe('The template\'s settings. Widgets name their database with "database", never an id.'),
    generated: z
      .object({
        hash: z
          .string()
          .optional()
          .describe('Set by Adminium. While it matches the page, regeneration may update the page.'),
        key: z.string().optional().describe('Set by Adminium for a generated page that was renamed.'),
      })
      .strict()
      .optional(),
  })
  .describe('An Adminium page. The file name is the page slug.');

const REMAP_OPS = overridePatchSchema.options.map((option) => option.shape.op.value);
const LLM_OPS = LLM_OVERRIDE_FIELDS.map((field) => `llm.${field}`);

export const schemaFileSchema = z
  .object({
    $schema: z.string().optional(),
    overrides: z.array(
      z
        .object({
          table: z.string().min(1).describe('The table, e.g. public.customers.'),
          column: z.string().min(1).optional().describe('The column, for column-level ops.'),
          op: z.enum([...REMAP_OPS, ...LLM_OPS] as [string, ...string[]]),
          value: z.unknown().describe('What the op sets; its shape depends on the op.'),
          origin: z
            .enum(['user', 'llm'])
            .optional()
            .describe('Who set it. Absent means user. llm.* ops are always llm.'),
          status: z.enum(['active', 'disabled']).optional().describe('Absent means active.'),
          confidence: z.number().min(0).max(1).optional().describe('How sure AI assist was.'),
        })
        .strict(),
    ),
  })
  .strict()
  .describe("One database's schema customizations: labels, hidden columns, masks and relations.");

export const listFileSchema = z
  .object({
    $schema: z.string().optional(),
    name: z.string().min(1).max(200).describe('What this list is called in Studio.'),
    origin: z
      .string()
      .max(140)
      .optional()
      .describe('Where the list came from: "custom", or "copy:<built-in key>". Absent means custom.'),
    items: z
      .array(
        z
          .object({
            value: z.string().min(1).max(256).describe('What is stored in the column, e.g. "DE".'),
            label: z.string().max(256).optional().describe('What the form shows. Absent shows the value.'),
            tone: z.string().max(40).optional().describe('A colour name for the badge that shows this value.'),
            description: z.string().max(512).optional().describe('The detail line of a choice card.'),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .describe('One option list. The file name is the list key that rules name.');

/** File name → schema document, as the package ships them. */
export function projectJsonSchemaDocuments(): Record<string, string> {
  const documents: Record<string, z.ZodType> = {
    'page.json': pageFileSchema,
    'schema.json': schemaFileSchema,
    'list.json': listFileSchema,
    'config.json': projectConfigSchema,
  };
  const out: Record<string, string> = {};
  for (const [name, schema] of Object.entries(documents)) {
    out[name] = `${JSON.stringify(z.toJSONSchema(schema, { io: 'input' }), null, 2)}\n`;
  }
  return out;
}
