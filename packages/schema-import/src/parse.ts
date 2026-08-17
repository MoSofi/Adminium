// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `parseSchemaFile` — the single public entry point (05 §5). Detects the
 * format (unless forced via `opts.format`), dispatches to the right parser
 * and returns the validated DatabaseModel plus human-readable warnings.
 *
 * Contract: parsers never throw on unsupported constructs inside an
 * otherwise-parseable file — they warn. A `SchemaImportError` is thrown only
 * when the input as a whole is unusable (undetectable format, no parseable
 * content, invalid JSON IR).
 */
import type { DatabaseModel } from '@adminium/engine';

import { detectCandidates } from './detect.js';
import { SchemaImportError } from './errors.js';
import { parseDjango } from './parsers/django.js';
import { parseDrizzle } from './parsers/drizzle.js';
import { parseJsonIr } from './parsers/json.js';
import { parsePrisma } from './parsers/prisma.js';
import { parseRails } from './parsers/rails.js';
import { parseSequelize } from './parsers/sequelize.js';
import { parseSql } from './parsers/sql.js';
import { parseTypeorm } from './parsers/typeorm.js';
import { FORMATS, type Format, type ParseSchemaFileOptions, type ParseSchemaFileResult } from './types.js';
import { WarningList } from './warnings.js';

type ParserFn = (content: string, name: string, warnings: WarningList) => DatabaseModel;

const PARSERS: Readonly<Record<Format, ParserFn>> = {
  sql: parseSql,
  prisma: parsePrisma,
  drizzle: parseDrizzle,
  typeorm: parseTypeorm,
  sequelize: parseSequelize,
  rails: parseRails,
  django: parseDjango,
  json: (content) => parseJsonIr(content),
};

export function parseSchemaFile(
  content: string,
  opts: ParseSchemaFileOptions = {},
): ParseSchemaFileResult {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new SchemaImportError('input is empty');
  }
  const warnings = new WarningList();

  let format = opts.format;
  if (format !== undefined && !FORMATS.includes(format)) {
    throw new SchemaImportError(
      `unknown format "${String(format)}" — expected one of: ${FORMATS.join(', ')}`,
    );
  }
  if (format === undefined) {
    const candidates = detectCandidates(content);
    if (candidates.length === 0) {
      throw new SchemaImportError(
        `could not detect the schema format — supported formats: ${FORMATS.join(', ')}. ` +
          'Pass { format } explicitly if the content is one of these.',
      );
    }
    format = candidates[0] as Format;
    if (candidates.length > 1) {
      warnings.add(
        'ambiguous-format',
        `content matches multiple formats (${candidates.join(', ')}); parsing as ${format}`,
      );
    }
  }

  const started = Date.now();
  const parse = PARSERS[format];
  let model = parse(content, opts.name ?? `${format}-import`, warnings);
  const durationMs = Date.now() - started;
  model = {
    ...model,
    stats: { ...model.stats, durationMs },
    ...(format === 'json' && opts.name !== undefined ? { name: opts.name } : {}),
    // Original file name rides on model.source (engine modelSourceSchema
    // supports it) so downstream UIs can show provenance.
    ...(opts.fileName !== undefined && model.source.kind === 'import'
      ? { source: { ...model.source, fileName: opts.fileName } }
      : {}),
  };

  return { model, format, warnings: warnings.messages() };
}
