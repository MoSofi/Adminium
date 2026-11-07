// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A NEW ROW MOVES THE EARLIER ONES SHARING ITS LINK ON (`states.supersedes`),
 * against the whole server on SQLite, Postgres and MySQL.
 *
 * A shop's proofs: one row per proof of an order line, answered by the
 * shopper. A proof made for a line — through the data API's single create,
 * its create with a retry key, a save of several rows at once, or a rule's
 * `record.create` — moves the line's earlier proof still waiting (or with a
 * change asked) to superseded, by the proofs' own listed move: stamped,
 * counted in the line's totals, audited as a change by whoever made the new
 * one. An approved proof, another line's, and the new proof itself stay as
 * they are; a proof with no line supersedes nothing; a create refused leaves
 * every row as it was.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { statesRuleIssue } from '../src/connections/column-rules-validation.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.50' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });

function shop(): Record<string, unknown> {
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
        {
          ref: 'order_lines',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            // The proofs of the line still waiting for an answer: one at most, once each new one supersedes the last.
            { ref: 'waiting', type: 'int', nullable: true, rules: { rollup: { from: 'proofs', via: 'line_id', count: true, where: { column: 'state', eq: 'sent' } } } },
          ],
        },
        {
          ref: 'proofs',
          columns: [
            id,
            { ref: 'line_id', type: 'fk', references: 'order_lines', nullable: true },
            { ref: 'note', type: 'text', maxLength: 80, nullable: true },
            // A proof on hold (the shopper's change being talked over) is not sent again until it is let go.
            { ref: 'hold', type: 'bool', default: false },
            { ref: 'state', type: 'enum', enum: ['sent', 'approved', 'change_asked', 'superseded'], default: 'sent' },
            { ref: 'superseded_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'state', values: ['superseded'] } } } },
            { ref: 'retry_key', type: 'text', maxLength: 64, nullable: true, unique: true, rules: { retryKey: true } },
          ],
          states: {
            column: 'state',
            initial: 'sent',
            moves: {
              sent: ['approved', 'change_asked', 'superseded'],
              change_asked: [{ to: 'superseded', requires: { where: [{ column: 'hold', eq: false }] } }],
            },
            supersedes: { by: 'line_id', from: ['sent', 'change_asked'], to: 'superseded' },
          },
        },
        {
          // A sketch of a line: superseded the same way, with no total on the line to hold it (the link alone takes the turns).
          ref: 'sketches',
          columns: [id, { ref: 'line_id', type: 'fk', references: 'order_lines' }, { ref: 'state', type: 'enum', enum: ['sent', 'superseded'], default: 'sent' }],
          states: { column: 'state', initial: 'sent', moves: { sent: ['superseded'] }, supersedes: { by: 'line_id', from: ['sent'], to: 'superseded' } },
        },
        {
          // A mock-up of a line, whose key the database makes itself on MySQL (made so below): a key the insert cannot read back.
          ref: 'mockups',
          columns: [id, { ref: 'line_id', type: 'fk', references: 'order_lines' }, { ref: 'state', type: 'enum', enum: ['sent', 'superseded'], default: 'sent' }],
          states: { column: 'state', initial: 'sent', moves: { sent: ['superseded'] }, supersedes: { by: 'line_id', from: ['sent'], to: 'superseded' } },
        },
        { ref: 'redo_requests', columns: [id, { ref: 'line_id', type: 'fk', references: 'order_lines' }] },
      ],
    },
    roles: [
      {
        key: 'maker',
        name: 'Maker',
        permissions: ['table:@proofs:read', 'table:@proofs:create', 'table:@sketches:read', 'table:@sketches:create', 'table:@mockups:read', 'table:@mockups:create', 'table:@order_lines:read', 'page:@shop-proofs:view'],
      },
    ],
    pages: [{ ref: 'shop-proofs', template: 'page-crud', title: { key: 't.p', fallback: 'Proofs' }, nav: { group: 'work', icon: 'list', order: 1 }, bindings: { rows: 'proofs' } }],
    automations: [
      {
        key: 'redo',
        name: en('A redo asked: a new proof'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'redo_requests' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            { id: 'proof', kind: 'action', title: 'proof', action: { kind: 'record.create', table: 'proofs', values: { line_id: '{{record.line_id}}', note: 'redo' } } },
          ],
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a new proof supersedes the line's earlier one, on ${dialect}`, () => {
    let s: WholeServer;
    const keyOf = (res: Awaited<ReturnType<WholeServer['make']>>): number => (res.json() as { data: { id: number } }).data.id;
    const proof = async (key: number): Promise<{ state: string; stamped: boolean }> => {
      const [row] = await s.rows(`SELECT state, superseded_at FROM shop_proofs WHERE id = ${String(key)}`);
      return { state: String(row!['state']), stamped: row!['superseded_at'] !== null && row!['superseded_at'] !== undefined };
    };
    const states = async (line: number): Promise<string[]> =>
      (await s.rows(`SELECT state FROM shop_proofs WHERE line_id = ${String(line)} ORDER BY id`)).map((row) => String(row['state']));
    const waiting = async (line: number): Promise<number> => Number((await s.rows(`SELECT waiting FROM shop_order_lines WHERE id = ${String(line)}`))[0]!['waiting']);
    const line = async (name: string): Promise<number> => keyOf(await s.make('owner', 'order_lines', { name }));
    const send = async (line: number | null, note = 'v'): Promise<number> => {
      const made = await s.make('maker', 'proofs', { line_id: line, note });
      expect(said(made), made.body).toBe('ok');
      return keyOf(made);
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, shop(), { people: { maker: ['maker'] } });
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('is stored as written, its link resolved, and the live check names what the database lacks', async () => {
      const stored = (await overridesRepo(s.meta).listForConnection(s.connectionId)).filter((o) => o.origin === 'app');
      const rule = stored.find((o) => o.op === 'table.states' && o.tableName.endsWith(s.t('proofs')))!;
      expect((rule.value as { supersedes?: unknown }).supersedes).toEqual({ by: 'line_id', from: ['sent', 'change_asked'], to: 'superseded' });
      const snapshot = await snapshotsRepo(s.meta).latest(s.connectionId);
      const model = applyOverrides(parseDatabaseModel(snapshot!.schema), stored);
      const proofs = model.tables.find((t) => t.id === rule.tableName)!;
      expect(proofs.stateLinks).toEqual([{ via: 'line_id', table: model.tables.find((t) => t.id.endsWith(s.t('order_lines')))!.id, key: 'id' }]);
      const value = rule.value as Record<string, unknown>;
      expect(statesRuleIssue(value, proofs, model)).toBeNull();
      const withRule = (supersedes: unknown) => statesRuleIssue({ ...value, supersedes }, proofs, model);
      expect(withRule({ by: 'nope', from: ['sent'], to: 'superseded' })).toContain('has no column "nope"');
      expect(withRule({ by: 'note', from: ['sent'], to: 'superseded' })).toContain('note does not point at another table');
      expect(withRule({ by: 'line_id', from: ['approved'], to: 'superseded' })).toBe('No listed move goes from "approved" to "superseded", so a new row cannot move a row in "approved".');
      expect(withRule({ by: 'line_id', from: ['superseded'], to: 'superseded' })).toBe('A row already in "superseded" has nothing to move to.');

      // The moves themselves, judged as an app's manifest judges them.
      const name = proofs.name;
      const moves = value['moves'] as Record<string, unknown[]>;
      const judged = (changes: Record<string, unknown>, related?: Parameters<typeof statesRuleIssue>[3]) => statesRuleIssue({ ...value, ...changes }, proofs, model, related);
      expect(judged({ moves: { ...moves, change_asked: [{ to: 'superseded', undo: true }], superseded: ['change_asked'] } })).toBe(
        'The move from "change_asked" to "superseded" is an undo, which only a person makes.',
      );
      expect(judged({ moves: { ...moves, change_asked: [{ to: 'superseded', planned: true }] } })).toBe(
        'The move from "change_asked" to "superseded" is planned, which only a ledger\'s own update makes.',
      );
      expect(judged({ moves: { ...moves, change_asked: [{ to: 'superseded', requires: { linked: [{ via: 'line_id', where: [{ column: 'name', eq: 'x' }] }] } }] } })).toBe(
        'The move from "change_asked" to "superseded" waits for another row, so a new row cannot make it.',
      );
      expect(judged({ late: [{ to: 'superseded', moment: { column: 'name', via: 'line_id' }, within: { hours: 1 }, mode: 'refuse' }] })).toBe(
        'A move to "superseded" is judged late by another row\'s time, so a new row cannot make it.',
      );
      expect(judged({ effects: [{ on: { to: 'superseded' }, via: 'line_id', set: { name: 'x' } }] })).toBe(
        `"${name}" sets off effects of its own on a move to "superseded"; a new row moves the earlier rows, never a chain.`,
      );
      expect(judged({}, { rules: [{ op: 'table.capacity', columnName: null, value: {} }] })).toBe(`"${name}" keeps a limit, whose lock a new row's write cannot take for the rows it moves.`);
      expect(judged({}, { rules: [{ op: 'table.booking', columnName: null, value: {} }] })).toBe(`"${name}" books people by the day, and its lock cannot be taken inside another row's write.`);
      const lines = model.tables.find((t) => t.id.endsWith(s.t('order_lines')))!;
      expect(judged({}, { rules: [], elsewhere: [{ tableName: lines.id, value: { column: 'state', children: { [rule.tableName]: { via: 'line_id', lock: true } } } }] })).toBe(
        `"${name}" rows are lines of "${lines.name}", which would be held after this write's own rows.`,
      );
      // Another table's states that hold no rows of this one say nothing.
      expect(judged({}, { rules: [], elsewhere: [{ tableName: lines.id, value: { column: 'state', children: {} } }] })).toBeNull();
    });

    it('a second proof moves the first to superseded, stamped and counted; the new one waits; another line is left alone', async () => {
      const ring = await line('Ring');
      const other = await line('Pendant');
      const first = await send(ring, 'v1');
      const elsewhere = await send(other, 'v1');
      expect(await waiting(ring)).toBe(1);

      const made = await s.make('maker', 'proofs', { line_id: ring, note: 'v2' });
      expect(said(made), made.body).toBe('ok');
      // A save that moved another row offers no Undo: taking the new proof back would leave the first one superseded.
      expect((made.json() as { undoToken?: unknown }).undoToken ?? null).toBeNull();
      const second = keyOf(made);
      expect(await proof(first)).toEqual({ state: 'superseded', stamped: true });
      expect(await proof(second)).toEqual({ state: 'sent', stamped: false });
      expect(await proof(elsewhere)).toEqual({ state: 'sent', stamped: false });
      expect(await waiting(ring)).toBe(1);
      expect(await waiting(other)).toBe(1);

      // Audited as a change of the first proof by the person who sent the second.
      const audited = await s.meta.db.selectFrom('adminium_audit_log').select(['actorId', 'entityId']).where('action', '=', 'record.update').where('entityTable', '=', s.t('proofs')).execute();
      expect(audited.filter((row) => row.entityId === String(first)).map((row) => row.actorId)).toEqual([s.ids['maker']]);
    });

    it('an approved proof stays approved, a change asked is superseded, and a proof with no line supersedes nothing', async () => {
      const ring = await line('Bangle');
      const approved = await send(ring, 'v1');
      expect(said(await s.change('owner', 'proofs', approved, { state: 'approved' }))).toBe('ok');
      const asked = await send(ring, 'v2');
      expect(await proof(approved)).toEqual({ state: 'approved', stamped: false });
      expect(said(await s.change('owner', 'proofs', asked, { state: 'change_asked' }))).toBe('ok');

      const third = await send(ring, 'v3');
      expect(await states(ring)).toEqual(['approved', 'superseded', 'sent']);
      expect(await proof(third)).toEqual({ state: 'sent', stamped: false });

      // Two proofs with no line: neither moves the other.
      const loose = await send(null, 'loose 1');
      const looser = await send(null, 'loose 2');
      expect((await proof(loose)).state).toBe('sent');
      expect((await proof(looser)).state).toBe('sent');
    });

    it('through the create with a retry key, a save of several rows, and a rule\'s record.create: each supersedes the one before', async () => {
      const ring = await line('Brooch');
      const first = await send(ring, 'v1');
      // A create with a retry key goes the tree's way.
      const keyed = await s.send('maker', 'POST', `/api/v1/data/${s.connectionId}/${s.t('proofs')}`, { values: { line_id: ring, note: 'v2' }, clientKey: 'desk-1-proof-sent-again-for-the-brooch' });
      expect(said(keyed), keyed.body).toBe('ok');
      expect(await states(ring)).toEqual(['superseded', 'sent']);
      expect(await waiting(ring)).toBe(1);

      // Two at once, in one save: each supersedes the ones before it, in order.
      const many = await s.send('maker', 'POST', `/api/v1/data/${s.connectionId}/${s.t('proofs')}`, { values: { line_id: ring }, repeat: { column: 'note', values: ['v3', 'v4'] } });
      expect(said(many), many.body).toBe('ok');
      expect(await states(ring)).toEqual(['superseded', 'superseded', 'superseded', 'sent']);
      expect(await waiting(ring)).toBe(1);

      // A rule's record.create: the same.
      expect(said(await s.make('owner', 'redo_requests', { line_id: ring }))).toBe('ok');
      await s.jobs();
      expect(await states(ring)).toEqual(['superseded', 'superseded', 'superseded', 'superseded', 'sent']);
      expect(await waiting(ring)).toBe(1);
      expect((await proof(first)).stamped).toBe(true);
    });

    it('rows made for one line at the same moment take their turns: one is left waiting', async () => {
      const ring = await line('Cufflinks');
      await send(ring, 'v1');
      const sent = await Promise.all(['v2', 'v3', 'v4'].map((note) => s.make('maker', 'proofs', { line_id: ring, note })));
      for (const res of sent) expect(said(res), res.body).toBe('ok');
      const after = await states(ring);
      expect(after).toHaveLength(4);
      expect(after.filter((state) => state === 'sent')).toHaveLength(1);
      expect(await waiting(ring)).toBe(1);

      // With no total on the line, the line itself is what the writers wait on.
      for (let round = 0; round < 3; round += 1) {
        const made = await Promise.all([1, 2, 3, 4].map(() => s.make('maker', 'sketches', { line_id: ring })));
        for (const res of made) expect(said(res), res.body).toBe('ok');
        const sketches = (await s.rows(`SELECT state FROM shop_sketches WHERE line_id = ${String(ring)}`)).map((row) => String(row['state']));
        expect(sketches.filter((state) => state === 'sent')).toHaveLength(1);
      }
    });

    it.runIf(dialect === 'mysql')('a new row whose key the database makes, and the insert cannot read back, is never moved itself', async () => {
      // MySQL hands back no key it made with an expression (only an auto-increment's): the new row is found by none.
      await s.rows('ALTER TABLE shop_mockups MODIFY id CHAR(36) NOT NULL DEFAULT (UUID())');
      const ring = await line('Tie pin');
      const mockup = () => s.make('maker', 'mockups', { line_id: ring });
      const mockups = async () => (await s.rows(`SELECT state FROM shop_mockups WHERE line_id = ${String(ring)}`)).map((row) => String(row['state'])).sort();
      await mockup();
      expect(await mockups()).toEqual(['sent']);
      await mockup();
      expect(await mockups()).toEqual(['sent', 'superseded']);
    });

    it('a create refused leaves every row as it was: an earlier proof already moved is moved back', async () => {
      const ring = await line('Locket');
      const spare = await line('Spare');
      const first = await send(ring, 'v1');
      // A second proof out on the same line, by a change of its line (only a new proof supersedes): asked to change, and on hold.
      const held = await send(spare, 'v1');
      expect(said(await s.change('owner', 'proofs', held, { state: 'change_asked', hold: true, line_id: ring }))).toBe('ok');
      expect(await states(ring)).toEqual(['sent', 'change_asked']);

      // The first is moved, then the one on hold refuses its move: the whole create is refused.
      const refused = await s.make('maker', 'proofs', { line_id: ring, note: 'v2' });
      expect(said(refused)).toBe('409 STATE_MOVE_REFUSED');
      expect(await states(ring)).toEqual(['sent', 'change_asked']);
      expect(await proof(first)).toEqual({ state: 'sent', stamped: false });
      expect(await waiting(ring)).toBe(1);

      // Let go, the same create goes through and moves both.
      expect(said(await s.change('owner', 'proofs', held, { hold: false }))).toBe('ok');
      await send(ring, 'v2');
      expect(await states(ring)).toEqual(['superseded', 'superseded', 'sent']);
      expect(await waiting(ring)).toBe(1);
    });
  });
}
