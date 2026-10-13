// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record's history also lists what a rule wrote to it, against the whole
 * server on every engine: under the rule's name, cut to the reader's columns
 * and rows exactly as a person's change is, and nothing else the rules log
 * about the record (a loop stopped) is listed.
 *
 * Dana reaches deals 1, 2, 5 and 9 and does not read `amount`; Lena reads
 * every deal and every column; Omar does not reach deal 1.
 */
import { auditRepo, permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

interface Entry {
  actorKind: string;
  actorLabel: string;
  action: string;
  changes: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a record's history lists what a rule wrote [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName, string>();
    const as = async (who: PersonName): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const history = async (who: PersonName, deal: number, query = '') => w.app.inject({ method: 'GET', url: `/api/v1/data/${w.connectionId}/deals/${String(deal)}/history${query}`, headers: { cookie: await as(who) } });
    const entries = async (who: PersonName, deal: number): Promise<Entry[]> => {
      const res = await history(who, deal);
      expect(res.statusCode, res.body).toBe(200);
      return (JSON.parse(res.body) as { entries: Entry[] }).entries;
    };
    /** A rule's write as `afterRecordWrite` audits it, and what else the rules log about a record. */
    const ruleWrote = (deal: number, action: string, changes: Record<string, unknown>) =>
      auditRepo(w.meta).append({
        actorKind: 'automation',
        actorId: 'aut_stage',
        actorLabel: 'Stamp the stage',
        category: 'automation',
        action,
        connectionId: w.connectionId,
        entity: { connectionId: w.connectionId, table: w.id('deals'), pk: { id: deal }, label: String(deal) },
        changes,
      });

    beforeAll(async () => {
      w = await world(dialect);
      await w.role('rep', { deals: { actions: ['read', 'update'], rows: { read: { reach: 'own' }, update: { reach: 'own' } } } });
      await w.role('reader', { deals: { actions: ['read', 'update'] } });
      for (const person of ['dana', 'omar'] as const) await w.give(person, 'rep');
      await w.give('lena', 'reader');
      // Dana's role shows a deal's title and not its amount.
      const rep = (await rolesRepo(w.meta).findBySlug('rep'))!.id;
      await permissionsRepo(w.meta).grant(rep, 'table', `${w.connectionId}/${w.id('deals')}`, { read: true, create: false, update: true, delete: false, export: false, import: false, rowLimit: { read: { reach: 'own' }, update: { reach: 'own' } }, readLimit: { readable: ['title'] } } as never);
      // A person's change, then a rule's, then a line of the rules' own log about the same record.
      const changed = await w.app.inject({ method: 'PATCH', url: `/api/v1/data/${w.connectionId}/deals/1`, headers: { cookie: await as('lena') }, payload: { values: { title: 'Deal 1, renamed' } } });
      expect(changed.statusCode, changed.body).toBe(200);
      await ruleWrote(1, 'record.update', { before: { id: 1, title: 'Deal 1, renamed', amount: 12000 }, after: { id: 1, title: 'Deal 1, by a rule', amount: 13000 } });
      await ruleWrote(1, 'automation.loop-refused', { after: { hops: 9, max: 8, table: w.id('deals') } });
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    it('lists the rule\'s write under the rule\'s name, with the person\'s, and not the rules\' own log', async () => {
      const seen = await entries('lena', 1);
      expect(seen.map((entry) => [entry.actorKind, entry.action])).toEqual([
        ['automation', 'record.update'],
        ['user', 'record.update'],
      ]);
      expect(seen[0]!.actorLabel).toBe('Stamp the stage');
      expect(seen[0]!.changes?.after).toMatchObject({ title: 'Deal 1, by a rule', amount: 13000 });
    });

    it('cuts the rule\'s write to the reader\'s columns, as a person\'s is', async () => {
      const seen = await entries('dana', 1);
      expect(seen).toHaveLength(2);
      for (const entry of seen) {
        expect(entry.changes?.before ?? {}).not.toHaveProperty('amount');
        expect(entry.changes?.after ?? {}).not.toHaveProperty('amount');
      }
      expect(seen[0]!.changes?.after).toMatchObject({ title: 'Deal 1, by a rule' });
    });

    it('answers nothing of either to somebody who does not reach the record', async () => {
      const res = await history('omar', 1);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('by a rule');
    });

    it('pages across a person\'s change and a rule\'s', async () => {
      const first = JSON.parse((await history('lena', 1, '?limit=1')).body) as { entries: Entry[]; nextCursor: string | null };
      expect(first.entries.map((entry) => entry.actorKind)).toEqual(['automation']);
      expect(first.nextCursor).not.toBeNull();
      const second = await history("lena", 1, `?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(second.statusCode, second.body).toBe(200);
      const next = JSON.parse(second.body) as { entries: Entry[]; nextCursor: string | null };
      expect(next.entries.map((entry) => entry.actorKind)).toEqual(['user']);
      expect(next.nextCursor).toBeNull();
    });
  });
}
