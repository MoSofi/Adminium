/**
 * Connection-config → database file path normalization — 05 §4.3: the SQLite
 * connection config is a FILE PATH, not a DSN, but the engine accepts the
 * common DSN spellings and normalizes them here:
 *
 *   { file: '/abs/path/app.db' }     → '/abs/path/app.db'
 *   { file: ':memory:' }             → ':memory:'   (demo/test)
 *   'sqlite:///abs/path.db'          → '/abs/path.db'
 *   'sqlite::memory:'                → ':memory:'
 *   'file:abs/path.db' / 'file:///…' → 'abs/path.db' / '/…'
 *   plain path                       → unchanged
 *
 * Pure module so the spellings are unit-testable offline.
 */

export interface SqliteFileConfig {
  readonly file?: string;
  readonly dsn?: string;
}

/** Resolve the database file path from a role-branded config. */
export function normalizeSqliteFile(config: SqliteFileConfig): string | null {
  const raw = config.file ?? config.dsn;
  if (raw === undefined || raw.length === 0) return null;
  let text = raw.trim();

  if (text === ':memory:') return ':memory:';

  if (text.toLowerCase().startsWith('sqlite:')) {
    text = text.slice('sqlite:'.length);
    if (text === ':memory:' || text === '') return ':memory:';
    // sqlite:///abs/path.db → ///abs/path.db → /abs/path.db
    if (text.startsWith('///')) return text.slice(2);
    if (text.startsWith('//')) return text.slice(2);
    return text;
  }

  if (text.toLowerCase().startsWith('file:')) {
    text = text.slice('file:'.length);
    // file:///abs/path.db → /abs/path.db; strip query params (?mode=…)
    const query = text.indexOf('?');
    if (query !== -1) text = text.slice(0, query);
    if (text.startsWith('///')) return text.slice(2);
    if (text.startsWith('//')) return text.slice(2);
    return text;
  }

  return text;
}
