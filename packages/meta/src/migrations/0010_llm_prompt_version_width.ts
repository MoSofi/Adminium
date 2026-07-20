/**
 * Wave 0010 — widen `adminium_llm_runs.prompt_version` (str(10) → str(40)).
 *
 * 0006 sized the column for a bare version tag, but the shipped prompt version
 * is `adminium.prompt/v1` (@adminium/llm `PROMPT_VERSION`, 18 chars). SQLite
 * masked the mismatch — `str(n)` maps to `text` there, lengths unenforced —
 * while PostgreSQL and strict-mode MySQL reject every run insert with
 * "value too long for type character varying(10)". 40 leaves headroom for
 * future `adminium.prompt/vNN`-style tags.
 *
 * Up-only rule (index.ts): 0006 is applied and checksummed, so the fix ships
 * as a compensating migration. Raw dialect-branched ALTERs because MySQL's
 * MODIFY restates the whole column definition (NOT NULL must be repeated) and
 * Kysely's `setDataType` would silently drop it; SQLite needs no ALTER at all.
 */

import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const table = metaTable('llm_runs');
  if (c.dialect === 'postgres') {
    await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN prompt_version TYPE varchar(40)`.execute(
      db,
    );
  } else if (c.dialect === 'mysql') {
    await sql`ALTER TABLE ${sql.table(table)} MODIFY COLUMN prompt_version varchar(40) NOT NULL`.execute(
      db,
    );
  }
  // sqlite: the column is `text`; nothing to widen.
}
