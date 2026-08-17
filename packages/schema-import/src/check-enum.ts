// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CHECK-constraint → enum synthesis shared by the SQL and Rails parsers.
 * Recognizes `col IN ('a','b')` (any dialect, quoted or bare identifiers) and
 * the pg_dump spelling `((col)::text = ANY ((ARRAY['a'::character varying,
 * …])::text[]))`.
 */
import { collectStrings, findBalanced } from './text.js';

const SQL_SCAN = { dollarQuotes: true, lineComments: ['--'], blockComments: true } as const;

export function extractCheckEnum(expression: string): { column: string; values: string[] } | null {
  let expr = expression.trim();
  while (expr.startsWith('(') && findBalanced(expr, 0, SQL_SCAN) === expr.length - 1) {
    expr = expr.slice(1, -1).trim();
  }
  const colMatch =
    /^\(*\s*(?:"((?:[^"]|"")+)"|`((?:[^`]|``)+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))\s*\)*\s*(?:::[A-Za-z_][A-Za-z0-9_ ]*(\[\])?)?\s*(.*)$/s.exec(
      expr,
    );
  if (!colMatch) return null;
  const column = (colMatch[1] ?? colMatch[2] ?? colMatch[3] ?? colMatch[4]) as string;
  const tail = (colMatch[6] ?? '').trim();

  if (/^IN\s*\(/i.test(tail)) {
    const open = tail.indexOf('(');
    const close = findBalanced(tail, open, SQL_SCAN);
    if (close === -1) return null;
    const values = collectStrings(tail.slice(open + 1, close));
    return values.length > 0 ? { column, values } : null;
  }
  if (/^=\s*ANY\s*\(/i.test(tail)) {
    const arrayStart = tail.search(/ARRAY\s*\[/i);
    if (arrayStart === -1) return null;
    const open = tail.indexOf('[', arrayStart);
    const close = findBalanced(tail, open, SQL_SCAN);
    if (close === -1) return null;
    const values = collectStrings(tail.slice(open + 1, close));
    return values.length > 0 ? { column, values } : null;
  }
  return null;
}
