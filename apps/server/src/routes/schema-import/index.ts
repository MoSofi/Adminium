/**
 * Schema-file import route (09-generated-app.md §8.2 source mode c, M5-T01):
 *
 *   POST /api/v1/schema-import/parse   { format?, content, fileName? }
 *     → { model, format, warnings, summary }
 *
 * "No database connection required" — the wizard uploads the file text and
 * gets back a validated engine `DatabaseModel` plus preview counts.
 *
 * Parser resolution: `@adminium/schema-import`'s documented contract
 * `parseSchemaFile(content, { format?, fileName? }) → { model, format,
 * warnings }` is used when the package (built concurrently, M9 full matrix)
 * is installed and exposes it; otherwise the built-in minimal parser covers
 * `sql-ddl` and `json-ir` only. Either way the model is re-validated with
 * `parseDatabaseModel` — the server stays the write-boundary authority.
 *
 * Guarded by `system:connections:manage` like the sibling connect-flow routes.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { parseDatabaseModel, type DatabaseModel, type ImportFormat } from '@adminium/engine';

import { ValidationFailedError } from '../../errors.js';
import { CONNECTIONS_MANAGE } from '../connections/index.js';
import {
  fallbackParseSchemaFile,
  SchemaParseError,
  type FallbackParseResult,
} from './fallback-parser.js';
import { schemaImportParseBody, schemaImportParseReply } from './schema.js';

/** The `@adminium/schema-import` surface this route codes against. */
interface SchemaImportModule {
  parseSchemaFile(
    content: string,
    opts?: { format?: string | undefined; name?: string | undefined; fileName?: string | undefined },
  ):
    | { model: unknown; format: string; warnings: string[] }
    | Promise<{ model: unknown; format: string; warnings: string[] }>;
}

/**
 * Vocabulary bridge: the wire/reply contract speaks the engine's
 * `ImportFormat` ('sql-ddl', 'json-ir', 'prisma', …) while the package speaks
 * its own `Format` ('sql', 'json', 'prisma', …). Only the two aliased pairs
 * differ; the rest are identical.
 */
const ENGINE_TO_PACKAGE_FORMAT: Record<string, string> = {
  'sql-ddl': 'sql',
  'json-ir': 'json',
};
const PACKAGE_TO_ENGINE_FORMAT: Record<string, string> = {
  sql: 'sql-ddl',
  json: 'json-ir',
};

/** Runtime module id — kept out of static imports: the workspace package is optional this wave. */
const SCHEMA_IMPORT_PACKAGE = '@adminium/schema-import';

let packageParser: SchemaImportModule['parseSchemaFile'] | null | undefined;

/** Resolve `parseSchemaFile` once; `null` = package absent or still a stub. */
async function loadPackageParser(): Promise<SchemaImportModule['parseSchemaFile'] | null> {
  if (packageParser !== undefined) return packageParser;
  try {
    const mod = (await import(SCHEMA_IMPORT_PACKAGE)) as Partial<SchemaImportModule>;
    packageParser = typeof mod.parseSchemaFile === 'function' ? mod.parseSchemaFile : null;
  } catch {
    packageParser = null;
  }
  return packageParser;
}

/** Test seam: force the next request to re-resolve the package parser. */
export function resetSchemaImportParserCache(): void {
  packageParser = undefined;
}

function summarize(model: DatabaseModel) {
  return {
    tables: model.tables.length,
    columns: model.tables.reduce((sum, table) => sum + table.columns.length, 0),
    relations: model.relations.length,
    enums: model.enums.length,
  };
}

/**
 * Wizard leniency for explicit-JSON uploads: the package (and the engine IR)
 * are strict — `irVersion`/`dialect`/`name` required — but a hand-written
 * fragment from the wizard's schema-file path gets sensible defaults, with the
 * model name derived from the uploaded file name.
 */
function normalizeJsonFragment(content: string, fileName: string | undefined): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content; // let the parser produce the canonical PARSE_FAILED error
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return content;
  const fragment = parsed as Record<string, unknown>;
  const baseName = fileName?.replace(/\.[^.]+$/, '');
  return JSON.stringify({
    irVersion: fragment['irVersion'] ?? 1,
    dialect: fragment['dialect'] ?? 'postgres',
    name: fragment['name'] ?? baseName ?? 'imported-schema',
    ...fragment,
  });
}

/**
 * The parser behind `POST /schema-import/parse`, as a plain function.
 *
 * Exported for `routes/desktop-local-db` (11-electron.md §6 step 2 card 1),
 * which applies an uploaded schema to a new SQLite file and must agree with this
 * route about what the eight formats mean. Two resolvers would be two answers to
 * "is this a valid Prisma schema": the wizard would preview a schema the creation
 * step then rejects, or — worse — the reverse.
 *
 * It is the FUNCTION and not the route that is shared, because the two callers
 * differ in everything else: this one replies with a preview and writes nothing;
 * that one writes a database and is registered only under the desktop runtime.
 */
export async function parseSchemaFileContent(input: {
  content: string;
  format: ImportFormat | undefined;
  fileName: string | undefined;
}): Promise<FallbackParseResult> {
  return parseContent(input.content, input.format, input.fileName);
}

async function parseContent(
  content: string,
  format: ImportFormat | undefined,
  fileName: string | undefined,
): Promise<FallbackParseResult> {
  const parse = await loadPackageParser();
  if (parse !== null) {
    const body = format === 'json-ir' ? normalizeJsonFragment(content, fileName) : content;
    const result = await parse(body, {
      format: format === undefined ? undefined : (ENGINE_TO_PACKAGE_FORMAT[format] ?? format),
      name: fileName?.replace(/\.[^.]+$/, ''),
      fileName,
    });
    // Re-validate: the reply's `model` must be a real engine DatabaseModel.
    return {
      model: parseDatabaseModel(result.model),
      format: (PACKAGE_TO_ENGINE_FORMAT[result.format] ?? result.format) as ImportFormat,
      warnings: result.warnings,
    };
  }
  return fallbackParseSchemaFile(content, { format, fileName });
}

export function schemaImportRoutes(): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/schema-import/parse',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: { body: schemaImportParseBody, response: { 200: schemaImportParseReply } },
      },
      async (request) => {
        const { content, format, fileName } = request.body;
        let result: FallbackParseResult;
        try {
          result = await parseContent(content, format, fileName);
        } catch (error) {
          if (error instanceof SchemaParseError) {
            throw new ValidationFailedError(error.message, {
              reason: error.reason,
              ...(error.details === undefined ? {} : { info: error.details }),
            });
          }
          // Zod or package parser failure — a client-input problem either way.
          throw new ValidationFailedError('The schema file could not be parsed.', {
            reason: 'PARSE_FAILED',
            cause: error instanceof Error ? error.message : String(error),
          });
        }
        // The M9 package never throws on unsupported constructs — but a parse
        // that yields ZERO tables is useless to the wizard: surface it as a
        // client-input failure with the collected warnings as the diagnosis.
        if (result.model.tables.length === 0) {
          throw new ValidationFailedError('The schema file contained no parseable tables.', {
            reason: 'PARSE_FAILED',
            info: { warnings: result.warnings },
          });
        }
        return {
          model: result.model,
          format: result.format,
          warnings: result.warnings,
          summary: summarize(result.model),
        };
      },
    );
  };
}
