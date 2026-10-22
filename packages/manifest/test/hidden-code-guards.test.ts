// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CODE NO STAFF MEMBER READS (`code.hiddenFromStaff`) IS KEPT AS A SHARED
 * LINK'S CODE IS, whether or not an entry claims by it yet: it is the link an
 * order's or a quote's own email carries. The guards that kept a link's code
 * kept only the codes an entry claims by, and four ways led round them for a
 * hidden one — each refused here:
 *
 *  - a kept total: the newest child row's value (`rollup.latest`);
 *  - its last four (`codeLast4`);
 *  - a ledger's copy (a posting's `map`, of the row or of its parent);
 *  - a public entry that shows it.
 *
 * And a copy, as for any link's code. Pure validation: no database.
 */
import { describe, expect, it } from 'vitest';

import { codeSchemaOf, shareCodeColumns, validateManifest } from '../src/index.js';
import { columnOf, issuesText, tableOf, valid, type Doc } from './invoicing-fixture.js';
import { LEDGER_HOST } from './ledger-kit-fixture.js';

const HIDDEN = { code: { length: 16, hiddenFromStaff: true } };

/** The studio's fixture, read by a server that knows a total's newest value and a code's last four. */
function studio(): Doc {
  const m = valid();
  m['compatibility'] = { ...(m['compatibility'] as Doc), minAdminiumVersion: '0.3.28' };
  return m;
}

/** The studio's fixture, with a quote's code on each project that staff never read. */
function withQuoteCode(hidden = true): Doc {
  const m = studio();
  (tableOf(m, 'projects')['columns'] as Doc[]).push({ ref: 'quote_code', type: 'text', maxLength: 16, nullable: true, unique: true, rules: hidden ? HIDDEN : { code: { length: 16 } } });
  return m;
}

describe('a code no staff member reads counts as a shared link\'s code', () => {
  it('is listed with the codes an entry claims by, once the schema is given', () => {
    const m = withQuoteCode();
    const tables = (m['requiredSchema'] as { tables: Doc[] }).tables as unknown as Parameters<typeof codeSchemaOf>[0];
    expect(shareCodeColumns([], 'projects')).toEqual([]);
    expect(shareCodeColumns([], 'projects', codeSchemaOf(tables))).toEqual(['quote_code']);
    expect(issuesText(m)).toBe('');
  });

  it('is never kept as the newest child row\'s value (a kept total)', () => {
    const kept = (hidden: boolean): Doc => {
      const m = studio();
      (tableOf(m, 'messages')['columns'] as Doc[]).push({ ref: 'reply_code', type: 'text', maxLength: 16, nullable: true, rules: hidden ? HIDDEN : { code: { length: 16 } } });
      (tableOf(m, 'projects')['columns'] as Doc[]).push({ ref: 'last_reply_code', type: 'text', maxLength: 16, nullable: true, rules: { rollup: { from: 'messages', via: 'project_id', latest: { of: 'reply_code', by: 'due' } } } });
      return m;
    };
    expect(issuesText(kept(true))).toContain('"messages.reply_code" is the code a shared link opens its row with, so no total keeps it');
    expect(issuesText(kept(false))).toBe('');
  });

  it('keeps no last four', () => {
    const lastFour = (hidden: boolean): Doc => {
      const m = withQuoteCode(hidden);
      (tableOf(m, 'projects')['columns'] as Doc[]).push({ ref: 'quote_last4', type: 'text', maxLength: 4, nullable: true, rules: { codeLast4: { of: 'quote_code' } } });
      return m;
    };
    expect(issuesText(lastFour(true))).toContain('"projects.quote_code" is the code a shared link opens its row with, so no column keeps its last four');
    expect(issuesText(lastFour(false))).toBe('');
  });

  it('is never copied into a ledger, from the row or from its parent', () => {
    type TableDoc = { ref: string; columns: Doc[]; postings?: Doc[] };
    const posting = (note: unknown, hidden = true): Doc => {
      const doc = structuredClone(LEDGER_HOST) as unknown as Doc & { requiredSchema: { tables: TableDoc[] } };
      const code = (ref: string) => ({ ref, type: 'text', maxLength: 16, nullable: true, rules: hidden ? HIDDEN : { code: { length: 16 } } });
      for (const table of doc.requiredSchema.tables) {
        if (table.ref === 'orders') table.columns.push(code('order_code'));
        if (table.ref === 'order_lines') {
          table.columns.push(code('line_code'));
          table.postings = [{ ...table.postings![0], map: { ...(table.postings![0]!['map'] as Doc), note } }];
        }
      }
      return doc;
    };
    const issues = (doc: Doc): string => {
      const result = validateManifest(doc);
      return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
    };
    expect(issues(posting('line_code'))).toContain('"order_lines.line_code" is the code a shared link opens its row with, so no posting copies it into a ledger');
    expect(issues(posting({ parent: 'order_code' }))).toContain('"orders.order_code" is the code a shared link opens its row with, so no posting copies it into a ledger');
    expect(issues(posting('line_code', false))).toBe('');
    expect(issues(posting({ parent: 'order_code' }, false))).toBe('');
  });

  it('is shown by no public entry of its table', () => {
    const shown = (hidden: boolean): Doc => {
      const m = withQuoteCode(hidden);
      (m['publicAccess'] as Doc[]).push({ table: 'projects', methods: ['GET'], select: ['status', 'quote_code'] });
      return m;
    };
    expect(issuesText(shown(true))).toContain('"projects.quote_code" is the code a shared link opens its row with: no entry shows, filters or orders by it');
    expect(issuesText(shown(false))).not.toContain('"projects.quote_code" is the code a shared link opens its row with');
  });

  it('is copied by no column', () => {
    const m = withQuoteCode();
    (tableOf(m, 'messages')['columns'] as Doc[]).push({ ref: 'copied', type: 'text', maxLength: 16, nullable: true, rules: { copy: { via: 'project_id', from: 'quote_code' } } });
    expect(issuesText(m)).toContain('"projects.quote_code" is the code a shared link opens its row with, so no column copies it');
    columnOf(m, 'projects', 'quote_code')['rules'] = { code: { length: 16 } };
    expect(issuesText(m)).toBe('');
  });
});
