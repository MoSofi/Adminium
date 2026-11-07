// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A new row that moves the earlier rows sharing its link (`states.supersedes`),
 * as the manifest check reads it: a proof sent again moves the line's earlier
 * proof still out to "superseded", by the proofs' own listed move. What it may
 * name, what it is refused for, and the release that runs it.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, statesSchema, supersedesSchema, validateManifest, WORD_FLOORS } from '../src/index.js';

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };

type Doc = Record<string, unknown>;

/** Order lines and their proofs; a new proof moves the line's earlier one still out to superseded. */
function shop(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.shop.desc', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.50', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'work', label: en('Work'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'order_lines', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'proofs',
          columns: [
            id,
            { ref: 'line_id', type: 'fk', references: 'order_lines', nullable: true },
            { ref: 'note', type: 'text', maxLength: 80, nullable: true },
            { ref: 'state', type: 'enum', enum: ['sent', 'approved', 'change_asked', 'superseded'], default: 'sent' },
          ],
          states: {
            column: 'state',
            initial: 'sent',
            moves: { sent: ['approved', 'change_asked', 'superseded'], change_asked: ['superseded'] },
            supersedes: { by: 'line_id', from: ['sent', 'change_asked'], to: 'superseded' },
          },
        },
      ],
    },
    roles: [{ key: 'maker', name: 'Maker', permissions: ['table:@proofs:read', 'table:@proofs:create', 'page:@shop-proofs:view'] }],
    pages: [{ ref: 'shop-proofs', template: 'page-crud', title: { key: 't.p', fallback: 'Proofs' }, nav: { group: 'work', icon: 'list', order: 1 }, bindings: { rows: 'proofs' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const tables = (doc: Doc) => (doc['requiredSchema'] as { tables: Doc[] }).tables;
const proofs = (doc: Doc) => tables(doc)[1]!;
const states = (doc: Doc) => proofs(doc)['states'] as Doc;
const rule = (doc: Doc) => states(doc)['supersedes'] as Doc;
const moves = (doc: Doc) => states(doc)['moves'] as Record<string, unknown[]>;
const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
};
const said = (edit: (doc: Doc) => void): string => {
  const doc = shop();
  edit(doc);
  return issuesOf(doc).join('\n');
};
const AT = 'requiredSchema.tables.1.states.supersedes';

describe('states.supersedes', () => {
  it('validates, is kept as written, and asks for 0.3.50', () => {
    expect(issuesOf(shop())).toEqual([]);
    const result = validateManifest(shop());
    if (!result.ok) throw new Error('expected a manifest');
    expect(result.manifest.requiredSchema.tables[1]!.states!.supersedes).toEqual({ by: 'line_id', from: ['sent', 'change_asked'], to: 'superseded' });
    expect(installFloorWords(shop())).toContainEqual({ word: 'states.supersedes', path: 'requiredSchema.tables.1.states.supersedes' });
    expect(WORD_FLOORS['states.supersedes']).toBe('0.3.50');
    // At 0.3.49 the release that reads it is named.
    expect(said((doc) => ((doc['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.49'))).toMatch(/states\.supersedes/);
  });

  it('is a link, one or more states, and the state they move to: nothing else', () => {
    expect(supersedesSchema.safeParse({ by: 'line_id', from: ['sent'], to: 'superseded' }).success).toBe(true);
    expect(supersedesSchema.safeParse({ by: 'line_id', from: [], to: 'superseded' }).success).toBe(false);
    expect(supersedesSchema.safeParse({ by: 'line_id', from: 'sent', to: 'superseded' }).success).toBe(false);
    expect(supersedesSchema.safeParse({ by: 'line_id', from: ['sent'] }).success).toBe(false);
    expect(supersedesSchema.safeParse({ from: ['sent'], to: 'superseded' }).success).toBe(false);
    expect(supersedesSchema.safeParse({ by: 'line_id', from: ['sent'], to: 'superseded', also: true }).success).toBe(false);
    expect(statesSchema.safeParse({ ...states(shop()), supersedes: { by: 'line_id', from: ['sent'], to: '' } }).success).toBe(false);
  });

  it('names a link of the table: not a plain column, not the key, not a column it lacks', () => {
    expect(said((doc) => (rule(doc)['by'] = 'note'))).toContain(`${AT}.by: "proofs.note" does not point at a table of this manifest`);
    expect(said((doc) => (rule(doc)['by'] = 'id'))).toContain(`${AT}.by: "proofs.id" is the key, and points at no other row`);
    expect(said((doc) => (rule(doc)['by'] = 'order_id'))).toContain(`${AT}.by: "proofs" has no column "order_id"`);
  });

  it('names states of the table, each once, and moves them to another', () => {
    expect(said((doc) => (rule(doc)['to'] = 'binned'))).toContain(`${AT}.to: "binned" is not a value of "proofs.state"`);
    expect(said((doc) => (rule(doc)['from'] = ['sent', 'waiting']))).toContain(`${AT}.from.1: "waiting" is not a value of "proofs.state"`);
    expect(said((doc) => (rule(doc)['from'] = ['sent', 'sent']))).toContain(`${AT}.from.1: "sent" is named twice`);
    expect(said((doc) => (rule(doc)['from'] = ['sent', 'superseded']))).toContain(`${AT}.from.1: a row already in "superseded" has nothing to move to`);
  });

  it('moves each state by a listed move: one missing, an undo, a ledger\'s own, or one waiting for another row is refused', () => {
    expect(said((doc) => (rule(doc)['from'] = ['sent', 'approved']))).toContain(
      `${AT}.from.1: no listed move goes from "approved" to "superseded", so a new row cannot move a row in "approved"`,
    );
    expect(said((doc) => (moves(doc)['change_asked'] = [{ to: 'superseded', planned: true }]))).toContain(
      `${AT}.from.1: the move from "change_asked" to "superseded" is planned, which only a ledger's own update makes`,
    );
    expect(
      said((doc) => {
        moves(doc)['superseded'] = ['change_asked'];
        moves(doc)['change_asked'] = [{ to: 'superseded', undo: true }];
      }),
    ).toContain(`${AT}.from.1: the move from "change_asked" to "superseded" is an undo, which only a person makes`);
    expect(
      said((doc) => {
        (tables(doc)[0]!['columns'] as unknown[]).push({ ref: 'open', type: 'bool', default: true });
        moves(doc)['sent'] = ['approved', 'change_asked', { to: 'superseded', requires: { linked: [{ via: 'line_id', where: [{ column: 'open', eq: true }] }] } }];
      }),
    ).toContain(`${AT}.from.0: the move from "sent" to "superseded" waits for another row, so a new row cannot make it`);
    // A move that asks something of the row itself is judged on it: allowed.
    expect(said((doc) => (moves(doc)['sent'] = ['approved', 'change_asked', { to: 'superseded', requires: { where: [{ column: 'note', isNull: false }] } }]))).toBe('');
  });

  it('refuses a move that would set off effects of its own, a line of another table, or a table that keeps a limit', () => {
    const chain = shop();
    (tables(chain)[0]!['columns'] as unknown[]).push({ ref: 'state', type: 'enum', enum: ['open', 'redo'], default: 'open' });
    tables(chain)[0]!['states'] = { column: 'state', initial: 'open', moves: { open: ['redo'] } };
    states(chain)['effects'] = [{ on: { to: 'superseded' }, via: 'line_id', set: { state: 'redo' } }];
    expect(issuesOf(chain).join('\n')).toContain(`${AT}.to: "proofs" sets off effects of its own; an effect moves one row, never a chain`);

    const line = shop();
    (tables(line)[0]!['columns'] as unknown[]).push({ ref: 'state', type: 'enum', enum: ['open', 'done'], default: 'open' });
    tables(line)[0]!['states'] = { column: 'state', initial: 'open', moves: { open: ['done'] }, children: { proofs: { via: 'line_id', lock: true } }, lock: { when: ['done'] } };
    expect(issuesOf(line).join('\n')).toContain(`${AT}.to: "proofs" rows are lines of "order_lines", which would be held after this write's own rows`);

    const limited = shop();
    (tables(limited)[0]!['columns'] as unknown[]).push({ ref: 'slots', type: 'int', default: 3 });
    proofs(limited)['capacity'] = { kind: 'parent', via: 'line_id', size: { column: 'slots' } };
    expect(issuesOf(limited).join('\n')).toContain(`${AT}: "proofs" keeps a limit, whose lock a new row's write cannot take for the rows it moves`);
  });

  it('is refused on a private table: a new row does not move another person\'s rows', () => {
    expect(
      said((doc) => {
        proofs(doc)['private'] = true;
        proofs(doc)['belongs'] = [{ column: 'owner_id' }];
        (proofs(doc)['columns'] as unknown[]).push({ ref: 'owner_id', type: 'text', maxLength: 36, rules: { staff: true } });
      }),
    ).toContain(`${AT}: "proofs" is private: only the people its rows belong to read it, so a new row does not move another person's rows`);
  });
});
