// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Format auto-detection — ordered heuristics over the raw content
 * (05-introspection-engine.md §5.1). Cheap by design: regex probes plus one
 * speculative JSON.parse. `detectFormat` returns the best guess (first match
 * in priority order); `detectCandidates` returns every matching format so the
 * caller can warn about ambiguity.
 */
import type { Format } from './types.js';

function looksLikeJsonIr(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const value: unknown = JSON.parse(trimmed);
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      ('irVersion' in value || 'tables' in value)
    );
  } catch {
    return false;
  }
}

/**
 * `CREATE [OR REPLACE] [GLOBAL|LOCAL] [TEMPORARY|TEMP|UNLOGGED] TABLE` — the
 * same qualifier vocabulary `parsers/sql.ts` already skips before it reads
 * `TABLE`. A bare `/CREATE\s+TABLE/` made a file of `CREATE UNLOGGED TABLE`
 * (a pg_dump of an unlogged table) or `CREATE TEMPORARY TABLE` undetectable,
 * so it could only be imported by naming the format by hand — while the parser
 * behind it would have read it perfectly.
 *
 * The repetition is BOUNDED on purpose. This package has a CodeQL ReDoS
 * history (`exportFilename` in @adminium/widgets carries the same scar), and
 * `(?:\w+\s+)*` in front of a literal is the classic polynomial shape; three
 * is one more qualifier than any dialect stacks (`GLOBAL TEMPORARY` is two).
 */
const CREATE_TABLE_RE =
  /\bCREATE\s+(?:(?:OR\s+REPLACE|GLOBAL|LOCAL|TEMPORARY|TEMP|UNLOGGED)\s+){0,3}TABLE\b/i;

const PROBES: readonly [Format, (content: string) => boolean][] = [
  ['json', looksLikeJsonIr],
  [
    'prisma',
    (c) =>
      /(^|\n)\s*datasource\s+\w+\s*\{/.test(c) ||
      /(^|\n)\s*generator\s+client\s*\{/.test(c) ||
      /(^|\n)model\s+\w+\s*\{/.test(c),
  ],
  ['rails', (c) => /ActiveRecord::Schema/.test(c) || /(^|\n)\s*create_table\s+["':]/.test(c)],
  ['django', (c) => /models\.Model\b/.test(c) || /models\.\w+Field\s*\(/.test(c)],
  ['drizzle', (c) => /\b(pgTable|mysqlTable|sqliteTable)\s*\(/.test(c)],
  [
    'typeorm',
    (c) => /@Entity\s*\(/.test(c) || (/@Column\s*\(/.test(c) && /\bclass\s+\w+/.test(c)),
  ],
  [
    'sequelize',
    (c) =>
      /\bsequelize\.define\s*\(/.test(c) ||
      /\bDataTypes\.\w+/.test(c) ||
      (/\bextends\s+Model\b/.test(c) && /\.init\s*\(/.test(c)),
  ],
  ['sql', (c) => CREATE_TABLE_RE.test(c)],
];

/** All formats whose heuristic fires, in priority order. */
export function detectCandidates(content: string): Format[] {
  return PROBES.filter(([, probe]) => probe(content)).map(([format]) => format);
}

/** Best guess (highest-priority candidate), or null when nothing matches. */
export function detectFormat(content: string): Format | null {
  return detectCandidates(content)[0] ?? null;
}
