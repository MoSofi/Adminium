// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a table keeps of its removed rows (`removal`), and a column whose
 * earlier values only the audit log keeps (`rules.history: "audit"`), as the
 * manifest check reads them: what each takes, what each is refused for, and
 * the release that runs them. A pure validator item: no database.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, removalSchema, validateManifest, WORD_FLOORS } from '../src/index.js';

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };

type Doc = Record<string, unknown>;

/** Deals, the people on them, and messages; members and visits opt in, messages keep their text for the audit log. */
function firm(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'firm',
    name: 'Firm',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.firm.desc', fallback: 'A firm.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.33', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'work', label: en('Work'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'deals', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'deal_members',
          columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'user_id', type: 'text', maxLength: 36, rules: { staff: true } }],
          removal: { reason: 'required', history: true },
        },
        {
          ref: 'messages',
          columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'text', type: 'text', maxLength: 1000, nullable: true, rules: { history: 'audit' } }],
          removal: { reason: true },
        },
      ],
    },
    roles: [{ key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'table:@deal_members:read', 'table:@messages:read', 'page:@firm-deals:view'] }],
    pages: [{ ref: 'firm-deals', template: 'page-crud', title: { key: 't.d', fallback: 'Deals' }, nav: { group: 'work', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const tables = (doc: Doc) => (doc['requiredSchema'] as { tables: Doc[] }).tables;
const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
};
const said = (edit: (doc: Doc) => void): string => {
  const doc = firm();
  edit(doc);
  return issuesOf(doc).join('\n');
};

describe('table.removal', () => {
  it('validates, is kept as written, and asks for 0.3.33', () => {
    expect(issuesOf(firm())).toEqual([]);
    const result = validateManifest(firm());
    if (!result.ok) throw new Error('expected a manifest');
    expect(result.manifest.requiredSchema.tables[1]!.removal).toEqual({ reason: 'required', history: true });
    expect(result.manifest.requiredSchema.tables[2]!.removal).toEqual({ reason: true });
    expect(installFloorWords(firm())).toContainEqual({ word: 'table.removal', path: 'requiredSchema.tables.1.removal' });
    expect(WORD_FLOORS['table.removal']).toBe('0.3.33');
    expect(said((doc) => ((doc['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.32'))).toMatch(/table\.removal/);
  });

  it('takes a reason that is asked or required, and a history that is kept: nothing else', () => {
    expect(removalSchema.safeParse({ reason: true }).success).toBe(true);
    expect(removalSchema.safeParse({ reason: 'required', history: true }).success).toBe(true);
    expect(removalSchema.safeParse({ history: true }).success).toBe(true);
    expect(removalSchema.safeParse({}).success).toBe(false);
    expect(removalSchema.safeParse({ reason: false }).success).toBe(false);
    expect(removalSchema.safeParse({ reason: 'optional' }).success).toBe(false);
    expect(removalSchema.safeParse({ history: false }).success).toBe(false);
    expect(removalSchema.safeParse({ history: true, keep: 30 }).success).toBe(false);
    expect(said((doc) => (tables(doc)[1]!['removal'] = {}))).toContain('a removal rule says "reason", "history", or both');
  });

  it('keeps no history of a private table\'s rows', () => {
    const text = said((doc) => {
      const members = tables(doc)[1]!;
      members['private'] = true;
      members['belongs'] = [{ column: 'user_id' }];
    });
    expect(text).toContain("requiredSchema.tables.1.removal.history: a private table's rows are read by their own people only: its removed rows are kept for nobody");
    // A reason alone is fine on a private table: it is written into the audit entry, nothing more.
    expect(
      said((doc) => {
        const members = tables(doc)[1]!;
        members['private'] = true;
        members['belongs'] = [{ column: 'user_id' }];
        members['removal'] = { reason: true };
      }),
    ).not.toContain('removal');
  });

  it('keeps a removed row\'s history only on a table that links to a row it is read through', () => {
    expect(said((doc) => (tables(doc)[0]!['removal'] = { history: true }))).toContain('requiredSchema.tables.0.removal.history: a removed row is read through a row it linked to, and "deals" links to none');
    expect(said((doc) => (tables(doc)[0]!['removal'] = { reason: true }))).toBe('');
  });
});

describe('column rule history: "audit"', () => {
  it('validates, and asks for 0.3.33', () => {
    expect(installFloorWords(firm())).toContainEqual({ word: 'column.history', path: 'requiredSchema.tables.2.columns.2.rules.history' });
    expect(WORD_FLOORS['column.history']).toBe('0.3.33');
    const result = validateManifest(firm());
    if (!result.ok) throw new Error('expected a manifest');
    expect(result.manifest.requiredSchema.tables[2]!.columns[2]!.rules?.history).toBe('audit');
  });

  it('takes "audit" only, and never on the key', () => {
    const rules = (doc: Doc) => (tables(doc)[2]!['columns'] as Doc[])[2]!['rules'] as Doc;
    expect(said((doc) => (rules(doc)['history'] = 'none'))).toMatch(/history/);
    expect(said((doc) => (rules(doc)['history'] = true))).toMatch(/history/);
    expect(said((doc) => ((tables(doc)[2]!['columns'] as Doc[])[0] = { ...id, rules: { history: 'audit' } }))).toContain("requiredSchema.tables.2.columns.0.rules.history: a row's key is how its history is found: it is never kept for the audit log only");
  });

  it('is never read back as it was by a rule', () => {
    const rule = (text: string): Doc => ({
      key: 'told',
      name: en('Told'),
      enabled: true,
      trigger: { kind: 'record', event: 'updated', table: 'messages' },
      graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 't' }, { id: 'n', kind: 'action', title: 'n', action: { kind: 'notification', to: { roles: ['rep'] }, title: text } }] },
    });
    const ok = said((doc) => (doc['automations'] = [rule('Was {{was.deal_id}}')]));
    expect(ok).not.toMatch(/was\.deal_id/);
    expect(said((doc) => (doc['automations'] = [rule('Was {{was.text}}')]))).toContain('{{was.text}}: "messages.text" keeps its earlier values for the audit log only');
  });
});
