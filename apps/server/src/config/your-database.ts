// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ADMINIUM_YOUR_DATABASE`: the user's own database, which an operator project
 * connects as `yours` beside the operator's `main` (`project/operator-project.ts`).
 *
 * One JSON object, set by the operator from what adminium.app checked and the
 * visitor chose:
 *
 *   { "url": "postgres://…", "intent": "full-admin", "tables": ["public.orders"],
 *     "readOnly": false, "label": "Harbor books" }
 *
 *  - `url`       a postgres or mysql URL; never SQLite (a path on the operator's disk);
 *  - `intent`    one of the engine's four dashboard types (default `full-admin`);
 *  - `tables`    the tables to build pages for, as `schema.table` ids (MySQL: the
 *                database's name as the schema); empty means all of them;
 *  - `readOnly`  open it read-only; forced on for `read-only-analytics`;
 *  - `label`     the connection's name in Studio (default: the database's name);
 *  - `notes`     what the visitor said about the database, for the schema assistant's
 *                one run on `yours` (W4). Cleaned again here ({@link cleanNotes}): no
 *                database address or password, no control character, 2,000 characters.
 *
 * The URL carries a password, so a problem with this variable never prints the
 * value, and the variable is taken out of `process.env` at boot like every
 * operator secret (`config/operator-secrets.ts`).
 */
import { GENERATE_INTENTS, type GenerateIntent } from '@adminium/engine';

import { parseDsn } from '../connections/dsn.js';

/** The most tables a choice may name: what `check-source` lists at most. */
export const YOUR_DATABASE_MAX_TABLES = 500;

export interface YourDatabase {
  url: string;
  intent: GenerateIntent;
  /** `schema.table` ids, as chosen; empty = all tables. */
  tables: string[];
  /** Forced true for read-only analytics. */
  readOnly: boolean;
  label: string;
  /** Cleaned, or null when none is left. */
  notes: string | null;
  engine: 'postgres' | 'mysql';
  /** The URL's host (lower case) and port, for comparing with what is stored. */
  host: string;
  port: number;
  database: string;
}

/** The notes' limit: the start prompt's. */
export const YOUR_DATABASE_NOTES_MAX_CHARS = 2000;

/**
 * Notes as the schema assistant may read them: connection strings (`postgres://…`,
 * `mysql://…`, any `scheme://user:pass@host`), `password=…` / `pwd: …` pairs and
 * host:port addresses taken out, control characters other than a line break or a
 * tab dropped, cut at {@link YOUR_DATABASE_NOTES_MAX_CHARS} characters. Null when
 * nothing is left.
 */
export function cleanNotes(raw: string): string | null {
  const text = raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[address removed]')
    .replace(/\b(?:jdbc:)?[a-z0-9+.-]*:\/\/\S*/gi, '[address removed]')
    .replace(/\b[\w.%+-]+:[^\s@/]+@[\w.-]+(?::\d+)?/g, '[address removed]')
    .replace(/\b(pass(?:word)?|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, '$1: [removed]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, '[address removed]')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}:\d{2,5}\b/gi, '[address removed]')
    .trim();
  if (text === '') return null;
  const chars = [...text];
  return chars.length > YOUR_DATABASE_NOTES_MAX_CHARS ? chars.slice(0, YOUR_DATABASE_NOTES_MAX_CHARS).join('').trimEnd() : text;
}

const TABLE_ID = /^[^.\s]{1,128}\.[^\s]{1,128}$/;

/** Parse the variable's JSON, or say what is wrong with it without repeating the URL. */
export function parseYourDatabase(raw: string): { ok: true; value: YourDatabase } | { ok: false; problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, problem: 'must be one JSON object, e.g. {"url":"postgres://…","intent":"full-admin","tables":[],"readOnly":false,"label":"My shop"}' };
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return { ok: false, problem: 'must be one JSON object' };
  const object = json as Record<string, unknown>;
  const unknownKeys = Object.keys(object).filter((key) => !['url', 'intent', 'tables', 'readOnly', 'label', 'notes'].includes(key));
  if (unknownKeys.length > 0) return { ok: false, problem: `has keys it does not know: ${unknownKeys.join(', ')}` };
  if (typeof object['url'] !== 'string' || object['url'].trim() === '') return { ok: false, problem: 'needs "url": the database\'s connection string' };
  const url = object['url'].trim();
  let parsed;
  try {
    parsed = parseDsn(url);
  } catch (error) {
    return { ok: false, problem: `has a "url" that is not usable: ${error instanceof Error ? error.message : 'it does not parse'}` };
  }
  if (parsed.scheme === 'sqlite') return { ok: false, problem: 'has a SQLite "url": only a Postgres or MySQL database on the internet can be yours here' };
  if (parsed.host === null || parsed.port === null || parsed.database === null || parsed.user === null) {
    return { ok: false, problem: 'has a "url" without a host, user or database' };
  }
  const intentRaw = object['intent'] ?? 'full-admin';
  if (typeof intentRaw !== 'string' || !(GENERATE_INTENTS as readonly string[]).includes(intentRaw)) {
    return { ok: false, problem: `has an "intent" that is not one of ${GENERATE_INTENTS.join(', ')}` };
  }
  const intent = intentRaw as GenerateIntent;
  const tablesRaw = object['tables'] ?? [];
  if (!Array.isArray(tablesRaw) || !tablesRaw.every((id): id is string => typeof id === 'string' && TABLE_ID.test(id))) {
    return { ok: false, problem: 'has "tables" that are not a list of schema.table ids' };
  }
  if (tablesRaw.length > YOUR_DATABASE_MAX_TABLES) return { ok: false, problem: `names more than ${String(YOUR_DATABASE_MAX_TABLES)} tables` };
  const readOnlyRaw = object['readOnly'] ?? false;
  if (typeof readOnlyRaw !== 'boolean') return { ok: false, problem: 'has a "readOnly" that is not true or false' };
  const labelRaw = object['label'];
  if (labelRaw !== undefined && (typeof labelRaw !== 'string' || labelRaw.trim().length === 0 || labelRaw.length > 80)) {
    return { ok: false, problem: 'has a "label" that is not 1 to 80 characters' };
  }
  const notesRaw = object['notes'];
  if (notesRaw !== undefined && notesRaw !== null && typeof notesRaw !== 'string') return { ok: false, problem: 'has "notes" that are not text' };
  // 4 bytes a character, and room for what cleaning takes out: a longer value is the wrong value.
  if (typeof notesRaw === 'string' && notesRaw.length > YOUR_DATABASE_NOTES_MAX_CHARS * 4) return { ok: false, problem: 'has "notes" far longer than 2,000 characters' };
  let database = parsed.database;
  try {
    database = decodeURIComponent(parsed.database);
  } catch {
    // kept as written
  }
  return {
    ok: true,
    value: {
      url,
      intent,
      tables: [...new Set(tablesRaw)],
      readOnly: readOnlyRaw || intent === 'read-only-analytics',
      label: typeof labelRaw === 'string' ? labelRaw.trim() : database,
      notes: typeof notesRaw === 'string' ? cleanNotes(notesRaw) : null,
      engine: parsed.scheme,
      host: parsed.host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, ''),
      port: parsed.port,
      database,
    },
  };
}
