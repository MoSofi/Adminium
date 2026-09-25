// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `requiredWhen`: a column required only while another column of its row
 * holds one of some values — an away event names the person who is away, an
 * event in the office names nobody. On every engine, through every door.
 *
 * What each case holds:
 *  - the rule is stored at install, whole, against the real table;
 *  - a create leaving the column empty while the other column's value is a
 *    listed one is refused `422` `VALIDATION_FAILED`, the field's code
 *    `required`; any other value of the other column asks for nothing;
 *  - an update is judged on the row as it will stand: emptying the column of
 *    an away event is refused, and so is moving an event with nobody named to
 *    away; an update touching neither column is not judged;
 *  - the same on a bulk edit, an import, an automation, and the public API;
 *  - the record form is told when the column is asked for;
 *  - a yes in any spelling is a yes, stored as one; a create that leaves the
 *    other column out is judged on its database default; on MySQL a text
 *    value is compared as MySQL compares it;
 *  - a whole-row edit that changes neither column is not judged;
 *  - two writers that each saw the row before the other changed it cannot
 *    together leave it breaking the rule (Postgres and MySQL, over real
 *    parallel connections).
 */
import { parseDatabaseModel } from '@adminium/engine';
import { connectionTenantConfig, overridesRepo, snapshotsRepo } from '@adminium/meta';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import type { WriteContext } from '../src/crud/write-service.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { columnFactsFor } from '../src/routes/pages/column-facts.js';
import { pageReply } from '../src/routes/pages/schema.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

/** People, and the events that place them: an away event names who is away. */
function manifest(): Record<string, unknown> {
  return invoicingManifest([
    { ref: 'people', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }] },
    {
      ref: 'events',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: ['office', 'away', 'sick'], default: 'office' },
        { ref: 'person_id', type: 'fk', references: 'people', nullable: true, rules: { requiredWhen: { column: 'kind', in: ['away', 'sick'] } } },
        { ref: 'note', type: 'text', maxLength: 200, nullable: true },
      ],
    },
    {
      // An urgent flag names who answers it: a yes in any spelling asks for a person.
      ref: 'flags',
      columns: [
        id,
        { ref: 'urgent', type: 'bool', default: false },
        { ref: 'person_id', type: 'fk', references: 'people', nullable: true, rules: { requiredWhen: { column: 'urgent', in: [true] } } },
      ],
    },
    {
      // A trip is away unless it says otherwise: the database's default is what a create leaves.
      ref: 'trips',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: ['office', 'away'], default: 'away' },
        { ref: 'person_id', type: 'fk', references: 'people', nullable: true, rules: { requiredWhen: { column: 'kind', in: ['away'] } } },
      ],
    },
    {
      // A phase kept as plain text, which MySQL compares without case.
      ref: 'tasks',
      columns: [
        id,
        { ref: 'phase', type: 'text', maxLength: 20, nullable: true },
        { ref: 'owner', type: 'text', maxLength: 40, nullable: true, rules: { requiredWhen: { column: 'phase', in: ['away'] } } },
      ],
    },
  ]);
}

let open: InvoicingHarness | null = null;
let routes: DataRoutes | null = null;
let served: Served | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
  await routes?.close();
  routes = null;
  await open?.close();
  open = null;
});

const refused = { code: 'VALIDATION_FAILED', details: { fields: { person_id: { code: 'required' } } } };
const importer: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_imp', label: 'Importer' }, request: null };
const automation: WriteContext = { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'aut_1', label: 'Rule' }, request: null };

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a column required only for some values of another, on ${dialect}`, () => {
    async function harness() {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      expect((h.reply['rules'] as { skipped: unknown[] }).skipped).toEqual([]);
      const w = await writerFor(h);
      const ann = await w.create('people', { name: 'Ann' });
      const row = async (ref: string, key: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(key)}`))[0];
      return { h, w, ann, row };
    }

    it('is stored at install against the real table, and an operator\'s rule is checked against the columns', async () => {
      const { h } = await harness();
      const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
      const events = model.tables.find((t) => t.name === h.real('events'))!;
      const column = (name: string) => events.columns.find((c) => c.name === name)!;
      const issue = (value: unknown, on = 'person_id') => columnRuleIssue('column.requiredWhen', value, column(on), model);
      expect(issue({ column: 'kind', in: ['away', 'sick'] })).toBeNull();
      expect(issue({ column: 'nope', in: ['away'] })).toContain('has no column "nope"');
      expect(issue({ column: 'kind', in: ['holiday'] })).toBe('"holiday" is not a value kind can hold.');
      expect(issue({ column: 'person_id', in: [1] })).toBe('"person_id" is required by another column, not by itself.');
      expect(issue({ column: 'note', in: ['x'] }, 'kind')).toBe('"kind" is never empty already, so it needs no condition to be required.');
      expect(issue({ column: 'note', in: ['x'] }, 'note')).toBe('"note" is required by another column, not by itself.');
      // What the manifest refuses, the live check refuses too, against the rules saved beside it.
      const beside = (op: string, columnName: string, value: unknown, lists?: Map<string, string[]>) => ({ rules: [{ op, columnName, value }], lists });
      const withRules = (related: ReturnType<typeof beside>, value: unknown = { column: 'kind', in: ['away'] }) =>
        columnRuleIssue('column.requiredWhen', value, column('person_id'), model, undefined, related);
      expect(withRules(beside('column.required', 'person_id', { required: true }))).toBe('"person_id" is required always, or only when another column says so, not both.');
      expect(columnRuleIssue('column.required', { required: true }, column('person_id'), model, undefined, beside('column.requiredWhen', 'person_id', { column: 'kind', in: ['away'] }))).toBe(
        '"person_id" is required always, or only when another column says so, not both.',
      );
      expect(withRules(beside('column.copy', 'person_id', { via: 'x', from: 'y' }))).toBe('Adminium fills "person_id", so nobody is asked for it.');
      expect(withRules(beside('column.default', 'person_id', { kind: 'literal', text: '1' }))).toBe('Adminium fills "person_id", so nobody is asked for it.');
      expect(withRules(beside('column.default', 'person_id', { kind: 'none' }))).toBeNull();
      // A value the other column's own list does not have, inline or by key.
      expect(withRules(beside('column.options', 'note', { values: [{ value: 'late' }] }), { column: 'note', in: ['early'] })).toBe('"early" is not a value note can hold.');
      expect(withRules(beside('column.options', 'note', { values: [{ value: 'late' }] }), { column: 'note', in: ['late'] })).toBeNull();
      expect(withRules(beside('column.options', 'note', { list: 'tones' }, new Map([['tones', ['calm']]])), { column: 'note', in: ['loud'] })).toBe('"loud" is not a value note can hold.');
      const stored = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.op === 'column.requiredWhen' && o.tableName.endsWith(h.real('events')));
      expect(stored).toHaveLength(1);
      expect(stored[0]!.tableName.endsWith(h.real('events'))).toBe(true);
      expect(stored[0]!.columnName).toBe('person_id');
      expect(stored[0]!.value).toEqual({ column: 'kind', in: ['away', 'sick'] });
    });

    it('refuses a create or an update that leaves the column empty while the other holds a listed value', async () => {
      const { w, ann, row } = await harness();
      await expect(w.create('events', { kind: 'away' })).rejects.toMatchObject(refused);
      await expect(w.create('events', { kind: 'sick', person_id: null })).rejects.toMatchObject(refused);
      // Any other value asks for nobody, and neither does the column's own default.
      const office = await w.create('events', { kind: 'office' });
      const plain = await w.create('events', { note: 'Fire drill' });
      expect((await row('events', plain['id']))!['kind']).toBe('office');
      const away = await w.create('events', { kind: 'away', person_id: ann['id'] });

      // Emptying the column of an away event: refused.
      await expect(w.update('events', away['id'], { person_id: null })).rejects.toMatchObject(refused);
      // Moving an event with nobody named to away: refused, and to away with a person: fine.
      await expect(w.update('events', office['id'], { kind: 'away' })).rejects.toMatchObject(refused);
      await w.update('events', office['id'], { kind: 'away', person_id: ann['id'] });
      // Back to the office, the person may go.
      await w.update('events', office['id'], { kind: 'office', person_id: null });
      expect((await row('events', office['id']))!['person_id']).toBeNull();
      // A change to neither column is not judged.
      await w.update('events', away['id'], { note: 'Conference' });
      expect((await row('events', away['id']))!['note']).toBe('Conference');
    });

    it('holds on an import and an automation, as required does', async () => {
      const { w, ann } = await harness();
      const target = w.targetOf('events');
      const checked = await w.writes.check('create', target, importer, [{ kind: 'away' }, { kind: 'away', person_id: ann['id'] }]);
      expect(checked.issues).toEqual([{ person_id: { code: 'required' } }, null]);
      const office = await w.create('events', { kind: 'office' });
      await expect(w.update('events', office['id'], { kind: 'sick' }, automation)).rejects.toMatchObject(refused);
      // An import updating a row it matched is judged on the row as it will stand.
      const [prepared] = await w.writes.beforeEach('update', target, importer, [{ match: { id: office['id'] }, values: { kind: 'away' } }]);
      expect(prepared!.issues).toEqual({ person_id: { code: 'required' } });
    });

    it('refuses a bulk edit moving events to away with nobody named', async () => {
      const { h, w, ann, row } = await harness();
      const office = await w.create('events', { kind: 'office' });
      const named = await w.create('events', { kind: 'office', person_id: ann['id'] });
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const bulk = (ids: unknown[], values: Record<string, unknown>) =>
        r.t.app.inject({
          method: 'POST',
          url: `/api/v1/data/${r.connectionId}/${r.table('events')}/bulk`,
          headers: { 'x-test-user-id': r.t.users.admin.id },
          payload: { action: 'update', ids: ids.map(String), values },
        });
      const both = await bulk([named['id'], office['id']], { kind: 'away' });
      expect(both.statusCode, both.body).toBe(422);
      expect(both.json<{ error: { code: string; details: { fields: unknown } } }>().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { person_id: { code: 'required' } } } });
      expect((await row('events', named['id']))!['kind']).toBe('office');
      const one = await bulk([named['id']], { kind: 'away' });
      expect(one.statusCode, one.body).toBe(200);
      expect((await row('events', named['id']))!['kind']).toBe('away');
      // The dashboard's own form: the same refusal, naming the field.
      const form = await r.post('events', { values: { kind: 'sick' } });
      expect(form.statusCode, form.body).toBe(422);
      expect(form.json<{ error: { details: { fields: unknown } } }>().error.details.fields).toEqual({ person_id: { code: 'required' } });
      // An operator's own rule, through Studio's door: kept when it fits, refused by name when it does not.
      const put = (value: unknown) =>
        r.t.app.inject({
          method: 'PUT',
          url: `/api/v1/connections/${r.connectionId}/overrides`,
          headers: { 'x-test-user-id': r.t.users.admin.id },
          payload: { overrides: [{ op: 'column.requiredWhen', tableName: r.table('events'), columnName: 'person_id', value }] },
        });
      const wrong = await put({ column: 'kind', in: ['holiday'] });
      expect(wrong.statusCode, wrong.body).toBe(422);
      expect(wrong.json<{ error: { message: string } }>().error.message).toBe('"holiday" is not a value kind can hold.');
      const kept = await put({ column: 'kind', in: ['sick'] });
      expect(kept.statusCode, kept.body).toBe(200);
    });

    it('refuses a public create leaving the column empty, and writes nothing', async () => {
      const { h, ann } = await harness();
      const views = createPublicViews(h.meta);
      const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
      const events = (await views.viewFor(h.connectionId))!.table(h.real('events')).id;
      await service.saveEndpoint({
        connectionId: h.connectionId,
        ref: 'events_door',
        origin: 'custom',
        definition: {
          path: '/events_door',
          source: events,
          methods: ['POST'],
          select: ['id', 'kind'],
          filters: [],
          pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
          auth: { role: 'anon' },
          rate_limit: { requests: 60, window: '1m' },
          response: { shape: 'object', envelope: 'data' },
          writable: ['kind', 'person_id', 'note'],
        },
      });
      const secret = generatePublishableKey('browser');
      const { key } = await service.createKey({
        connectionId: h.connectionId,
        name: 'events door',
        access: [{ ref: 'events_door', methods: ['POST'] }],
        secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
        origins: [],
        kind: 'browser',
      });
      served = await servePublic(h, key.id);
      const count = async () => Number((await h.rows(`select count(*) as n from ${h.real('events')}`))[0]!['n']);
      const post = (values: Record<string, unknown>) =>
        served!.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/events_door', headers: served!.headers(), payload: { values } });
      const away = await post({ kind: 'away', note: 'From the kiosk' });
      // The public surface's one opaque refusal, as for a plain required column: a stranger learns no column.
      expect(away.statusCode, away.body).toBe(400);
      expect(away.json()).toEqual({ error: { code: 'PUBLIC_WRITE_REFUSED', message: 'That write was refused.' } });
      expect(await count()).toBe(0);
      const named = await post({ kind: 'away', person_id: ann['id'] });
      expect(named.statusCode, named.body).toBe(201);
      const office = await post({ kind: 'office' });
      expect(office.statusCode, office.body).toBe(201);
      expect(await count()).toBe(2);
    });

    it('tells the record form when the column is asked for', async () => {
      const { h, w } = await harness();
      const events = w.targetOf('events').table.id;
      const facts = await columnFactsFor(h.meta, h.connectionId, events);
      const person = facts!.columns.find((c) => c.spec['name'] === 'person_id')!;
      expect(person.required).toBe(false);
      expect(person.requiredWhen).toEqual({ column: 'kind', in: ['away', 'sick'] });
      // The page's reply keeps it on the way out.
      const reply = pageReply.parse({ data: null, canEditLayout: true, columnFacts: { ...facts, columns: [person] } });
      expect(reply.columnFacts?.columns[0]).toMatchObject({ requiredWhen: { column: 'kind', in: ['away', 'sick'] } });
      // A column with no such rule says nothing.
      expect(facts!.columns.find((c) => c.spec['name'] === 'note')!.requiredWhen).toBeUndefined();
    });

    it('reads a yes in any spelling as a yes, and stores it as one', async () => {
      const { w, ann, row } = await harness();
      for (const spelling of [true, 'true', 'TRUE', ' true', 'on', 'yes', 'y', 1, '1']) {
        await expect(w.create('flags', { urgent: spelling }), JSON.stringify(spelling)).rejects.toMatchObject(refused);
      }
      for (const spelling of ['on', ' true', 'y']) {
        const made = await w.create('flags', { urgent: spelling, person_id: ann['id'] });
        // Stored as the answer it names on every engine: SQLite used to keep the text.
        expect([true, 1]).toContain((await row('flags', made['id']))!['urgent']);
      }
      const calm = await w.create('flags', { urgent: 'off' });
      expect([false, 0]).toContain((await row('flags', calm['id']))!['urgent']);
      // A word that is no yes and no no is refused, on SQLite too.
      await expect(w.create('flags', { urgent: 'maybe' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { urgent: { code: 'invalid' } } } });
    });

    it('judges a create that leaves the other column out by its database default', async () => {
      const { w, ann, row } = await harness();
      // A trip is away unless it says otherwise: one with nobody is refused.
      await expect(w.create('trips', {})).rejects.toMatchObject(refused);
      const named = await w.create('trips', { person_id: ann['id'] });
      expect((await row('trips', named['id']))!['kind']).toBe('away');
      await w.create('trips', { kind: 'office' });
    });

    it('compares a text value as the database does', async () => {
      const { w, row } = await harness();
      const owner = { code: 'VALIDATION_FAILED', details: { fields: { owner: { code: 'required' } } } };
      await expect(w.create('tasks', { phase: 'away' })).rejects.toMatchObject(owner);
      if (dialect === 'mysql') {
        // `AWAY ` is `away` to every MySQL query: to the rule too.
        await expect(w.create('tasks', { phase: 'AWAY ' })).rejects.toMatchObject(owner);
        await expect(w.create('tasks', { phase: 'Away' })).rejects.toMatchObject(owner);
      } else {
        // Postgres and SQLite hold `Away` apart from `away`, and so does the rule.
        const other = await w.create('tasks', { phase: 'Away' });
        expect((await row('tasks', other['id']))!['phase']).toBe('Away');
      }
    });

    it('does not judge a whole-row edit that changes neither column, as the record form sends it', async () => {
      const { h, w, ann, row } = await harness();
      // A row kept from before the rule: away, with nobody named.
      await h.rows(`insert into ${h.real('events')} (kind, note) values ('away', 'Before the rule')`);
      const [old] = await h.rows(`select id from ${h.real('events')} where note = 'Before the rule'`);
      await w.update('events', old!['id'], { kind: 'away', person_id: null, note: 'Edited' });
      expect((await row('events', old!['id']))!['note']).toBe('Edited');
      // Changing either column is judged.
      await expect(w.update('events', old!['id'], { kind: 'sick', person_id: null })).rejects.toMatchObject(refused);
      await w.update('events', old!['id'], { kind: 'away', person_id: ann['id'] });
    });

    it.skipIf(dialect === 'sqlite')('holds two writers that each saw the row before the other changed it', async () => {
      const { h, w, ann, row } = await harness();
      const { db } = await h.manager.data(h.connectionId);
      const table = h.real('events');
      /** The writers at their UPDATE, waiting on the held row — read on a connection of its own. */
      const waiting = async (): Promise<number> => {
        const query =
          dialect === 'postgres'
            ? sql<{ n: number }>`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
            : sql<{ n: number }>`select count(*) as n from information_schema.processlist where db = database() and command = 'Query' and info like 'update %'`;
        return Number((await query.execute(db)).rows[0]?.n ?? 0);
      };
      /** Both writes read the row as it is, then wait at their UPDATE while a third connection holds it. */
      const race = async (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const made = await w.create('events', { kind: 'office', person_id: ann['id'] });
        let settled: Promise<PromiseSettledResult<unknown>[]> | undefined;
        await db.transaction().execute(async (tx) => {
          await sql`select id from ${sql.table(table)} where id = ${made['id']} for update`.execute(tx);
          settled = Promise.allSettled([w.update('events', made['id'], a), w.update('events', made['id'], b)]);
          const deadline = Date.now() + 10_000;
          while ((await waiting()) < 2) {
            if (Date.now() > deadline) throw new Error('the two writers never reached their UPDATE');
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        });
        const outcomes = await settled!;
        return { outcomes, stored: (await row('events', made['id']))! };
      };
      // One moves the event away, having seen a person on it; the other empties the person, having seen it in the office.
      const { outcomes, stored } = await race({ kind: 'away' }, { person_id: null });
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const [lost] = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(lost!.reason).toMatchObject(refused);
      expect(stored['kind'] === 'away' && stored['person_id'] === null).toBe(false);
    }, 30_000);
  });
}
