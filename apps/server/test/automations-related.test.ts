// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule reaches ONE HOP: the row a link of its record points at.
 *
 * On every engine, against the whole server, with a guest house whose stays
 * link to a guest:
 *
 *  - a mail goes to the stay's GUEST (`guest_id.email`), not to a column of
 *    the stay, and greets them by a value of their own row;
 *  - a link that is empty, or whose row is gone, fills its placeholders with
 *    nothing and gives the mail nobody to go to (the step says so);
 *  - what a rule may name through a link is what its AUTHOR may read: a table
 *    they hold no read on, a column their role is not shown, a column that is
 *    not there, a second hop and a secret are each refused at the save;
 *  - a typed address that is not one is refused at the save; a recipient
 *    column that does not hold addresses is a warning, not a refusal;
 *  - a template key means its family: live while any language of it is on,
 *    and the run sends whichever is.
 */
import { automationsRepo, emailTemplatesRepo, settingsRepo, type Automation, type AutomationGraph, type AutomationTriggerEvent } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recipientsFor } from '../src/automations/actions/email.js';
import { isAddressColumn, loadRelated, parseRelated, relatedTarget, relatedUses } from '../src/automations/related.js';
import { walkRule } from '../src/automations/runner.js';
import { resolveRuleTemplate, templateFamilies } from '../src/automations/templates.js';
import { requiredGrants, ruleWarnings } from '../src/automations/validate.js';
import { encryptSecret } from '../src/config/secrets.js';
import { fetchByPk } from '../src/crud/records.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { emailSecretKey } from '../src/email/config.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { legs, MANIFEST, person, signIn, stack, turnAs, type Stack } from './assistant-lodge.helpers.js';
import { TEST_SECRET } from './helpers.js';

const base = MANIFEST.requiredSchema.tables;
/** The guest house, with its guests: a stay links to the guest it is for. */
const INN = {
  ...MANIFEST,
  requiredSchema: {
    ...MANIFEST.requiredSchema,
    tables: [
      base[0],
      {
        ref: 'guests',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 80 },
          { ref: 'email', type: 'text', maxLength: 200, nullable: true },
          { ref: 'tier', type: 'text', maxLength: 20, nullable: true },
        ],
      },
      { ...base[1], columns: [...(base[1] as { columns: unknown[] }).columns, { ref: 'guest_id', type: 'fk', references: 'guests', nullable: true }] },
    ],
  },
};

describe('a related name, spelled', () => {
  it('is one dot and two halves, and nothing else', () => {
    expect(parseRelated('guest_id.email')).toEqual({ link: 'guest_id', column: 'email' });
    for (const plain of ['email', '.email', 'guest_id.', 'a.b.c', '']) expect(parseRelated(plain), plain).toBeNull();
  });

  it('is found as a recipient and inside placeholders, with or without `record.`', () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 'n1', kind: 'trigger', title: 'T' },
        { id: 'n2', kind: 'action', title: 'Mail', onError: false, action: { kind: 'email', templateKey: 'k', to: { kind: 'field', column: 'guest_id.email' }, vars: { first: 'Dear {{record.guest_id.name}}', tier: '{{guest_id.tier}} {{now}} {{record.status}}' } } },
      ],
    } as unknown as AutomationGraph;
    expect(relatedUses(graph).map((use) => `${use.as}:${use.link}.${use.column}`).sort()).toEqual(['recipient:guest_id.email', 'token:guest_id.name', 'token:guest_id.tier']);
  });
});

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`a rule that reaches the row a link points at — ${dialect}`, () => {
    let s: Stack;
    let owner: string;
    let guests: string;
    const sent: OutboundEmail[] = [];
    const transport: EmailTransport = {
      async send(message) {
        sent.push(message);
        return { response: '250 2.0.0 Ok' };
      },
    };
    const trigger = () => ({ kind: 'record' as const, connectionId: s.connectionId, table: s.table.stays, event: 'updated' as const, watch: false, when: [] });
    const mail = (to: unknown, vars: Record<string, string> = {}, templateKey = 'p64-welcome') =>
      ({ version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Write to the guest', onError: false, action: { kind: 'email', templateKey, to, vars } }] }) as unknown as AutomationGraph;
    const save = (who: string, graph: AutomationGraph, name = 'Thank the guest') =>
      s.app.inject({ method: 'POST', url: '/api/v1/automations', headers: { cookie: who }, payload: { name, connectionId: s.connectionId, trigger: trigger(), graph, enabled: false } });
    const event = (id: number): AutomationTriggerEvent => ({
      event: 'record.updated',
      origin: 'dashboard',
      ruleId: null,
      hops: 0,
      record: { connectionId: s.connectionId, table: s.table.stays, pk: { id }, label: String(id) },
      snapshot: { id },
      occurredAt: Date.now(),
    });
    const walk = async (rule: Automation, id: number) =>
      walkRule({ meta: s.meta, manager: s.manager, app: s.app as never, secret: TEST_SECRET, now: () => Date.now(), createTransport: () => transport }, { rule, runId: `arun_${String(id)}_${String(sent.length)}`, event: event(id) });
    const ruleOf = (graph: AutomationGraph) => automationsRepo(s.meta).create({ connectionId: s.connectionId, name: 'Thank the guest', enabled: true, trigger: trigger(), graph }, Date.now());

    beforeAll(async () => {
      s = await stack(dialect, INN);
      guests = s.tableId('lodge_guests');
      owner = await signIn(s.app, 'owner@lodge.dev');
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('101')`);
      await s.run(`INSERT INTO lodge_guests (name, email, tier) VALUES ('Ana Ribeiro', 'ana@example.test', 'gold')`);
      await s.run(`INSERT INTO lodge_guests (name, email, tier) VALUES ('Ben Okafor', NULL, NULL)`);
      const stay = (guest: string, name: string) =>
        s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, total, status, guest_id) VALUES (1, '2026-11-01', '2026-11-03', '${name}', 100, 'booked', ${guest})`);
      await stay('1', 'Ana'); // 1: a guest with an address
      await stay('2', 'Ben'); // 2: a guest with none
      await stay('NULL', 'Walk-in'); // 3: no guest at all
      await settingsRepo(s.meta).set('email.smtp', { host: 'smtp.example.test', port: 587, secure: false, user: 'mailer', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Lodge <no-reply@example.test>' } as never);
      await emailTemplatesRepo(s.meta).upsert('p64-welcome', 'en_US', { name: 'Welcome', subject: 'Thank you, {{first}}', enabled: true, blocks: [{ id: 'b1', block: 'email.text', data: { text: 'A {{tier}} guest. {{guest_id.name}} / {{record.guest_id.tier}}.' } }] } as never);
    }, 180_000);
    afterAll(async () => s?.close());

    it('knows where a link leads and which columns hold addresses, from the schema itself', async () => {
      const view = await loadSnapshotView(s.meta, s.connectionId);
      const stays = view.table(s.table.stays);
      expect(relatedTarget(view, stays, 'guest_id')).toMatchObject({ table: { id: guests }, key: 'id' });
      expect(relatedTarget(view, stays, 'room_id')?.table.id).toBe(s.table.rooms);
      expect(relatedTarget(view, stays, 'guest_name')).toBeNull();
      expect(relatedTarget(view, stays, 'no_such')).toBeNull();
      expect(isAddressColumn(view.table(guests), 'email')).toBe(true);
      expect(isAddressColumn(view.table(guests), 'name')).toBe(false);
      expect(isAddressColumn(stays, 'guest_name')).toBe(false);
    });

    it('reads the related row once, by key, and addresses the mail to it', async () => {
      const view = await loadSnapshotView(s.meta, s.connectionId);
      const table = view.table(s.table.stays);
      const { db } = await s.manager.data(s.connectionId);
      const sourceOf = async (id: number) => {
        const row = (await fetchByPk(db, table, { id }))!;
        return { db: db as never, view, table, row, connectionId: s.connectionId, dialect, record: { connectionId: s.connectionId, table: table.id, pk: { id }, label: String(id) } };
      };
      const action = { kind: 'email', templateKey: 'p64-welcome', to: { kind: 'field', column: 'guest_id.email' }, vars: {} } as never;
      const to = async (id: number) => {
        const source = await sourceOf(id);
        const related = await loadRelated(source, ['guest_id', 'guest_id', 'room_id']);
        return { related, addresses: recipientsFor(action, { source: { ...source, related } } as never) };
      };
      const ana = await to(1);
      expect([...ana.related.keys()].sort()).toEqual(['guest_id', 'room_id']);
      expect(ana.related.get('guest_id')?.row).toMatchObject({ name: 'Ana Ribeiro', email: 'ana@example.test' });
      expect(ana.addresses).toEqual(['ana@example.test']);
      // A guest with no address, and a stay with no guest: nobody to write to, and no error in finding that out.
      expect((await to(2)).addresses).toEqual([]);
      const none = await to(3);
      expect(none.related.get('guest_id')).toMatchObject({ row: null });
      expect(none.addresses).toEqual([]);
      // A link the schema no longer holds is said by name.
      const source = await sourceOf(1);
      expect(() => recipientsFor(action, { source: { ...source, related: new Map() } } as never)).toThrow(/no longer links guest_id/);
    });

    it('sends to the stay`s guest and fills placeholders from the guest`s own row', async () => {
      sent.length = 0;
      const rule = await ruleOf(mail({ kind: 'field', column: 'guest_id.email' }, { first: '{{guest_id.name}}', tier: '{{record.guest_id.tier}}' }));
      const outcome = await walk(rule, 1);
      expect(outcome.kind === 'finished' ? outcome.status : outcome.kind, JSON.stringify(outcome.trace.steps.at(-1))).toBe('succeeded');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: 'ana@example.test', subject: 'Thank you, Ana Ribeiro' });
      expect(sent[0]!.text).toContain('A gold guest. Ana Ribeiro / gold.');
    });

    it('fails the step with "no address" when the guest has none or the stay has no guest, and leaves the placeholders empty', async () => {
      sent.length = 0;
      const rule = await ruleOf(mail({ kind: 'field', column: 'guest_id.email' }, { first: '{{guest_id.name}}' }));
      for (const id of [2, 3]) {
        const outcome = await walk(rule, id);
        expect(outcome.kind === 'finished' ? outcome.status : outcome.kind).toBe('failed');
        expect(JSON.stringify(outcome.trace.steps.at(-1))).toMatch(/guest_id\.email|address/i);
      }
      expect(sent).toHaveLength(0);
      // A missing guest's values are nothing, not the placeholder as written: sent to a typed address, the mail reads cleanly.
      const typed = await ruleOf(mail({ kind: 'fixed', addresses: ['desk@example.test'] }, { first: '{{guest_id.name}}', tier: '{{guest_id.tier}}' }));
      const outcome = await walk(typed, 3);
      expect(outcome.kind === 'finished' ? outcome.status : outcome.kind).toBe('succeeded');
      // (The mail's subject is trimmed, as any subject is.)
      expect(sent[0]).toMatchObject({ to: 'desk@example.test', subject: 'Thank you,' });
      expect(sent[0]!.text).not.toContain('{{');
    });

    it('asks the author for a read on the related table, and for nothing else it does not use', async () => {
      const view = await loadSnapshotView(s.meta, s.connectionId);
      const graph = mail({ kind: 'field', column: 'guest_id.email' }, { first: '{{guest_id.name}}' });
      const read = (table: string) => `table:${s.connectionId}:${table}:read`;
      expect(requiredGrants(trigger(), graph, s.connectionId, view).map((row) => row.permission).sort()).toEqual([read(guests), read(s.table.stays)].sort());
      // Without the schema nothing can be said of a link, as before.
      expect(requiredGrants(trigger(), graph, s.connectionId).map((row) => row.permission)).toEqual([read(s.table.stays)]);

      // Someone who manages rules and reads stays, and not guests.
      const stays = await person(s, `stays-${dialect}@lodge.dev`, [], [read(s.table.stays), 'system:automations:manage']);
      const refused = await save(stays.cookie, graph);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: 'TABLE_FORBIDDEN', details: { table: guests } } });
      // With the read, it saves.
      const both = await person(s, `both-${dialect}@lodge.dev`, [], [read(s.table.stays), read(guests), 'system:automations:manage']);
      expect((await save(both.cookie, graph)).statusCode).toBe(201);
      // And the same author's own column of the stay still needs nothing more.
      expect((await save(stays.cookie, mail({ kind: 'field', column: 'guest_name' }))).statusCode).toBe(201);
    });

    it('refuses at the save what the run could not do: no such link, no such column, a second hop, a secret, a typed address that is not one', async () => {
      const cases: [unknown, Record<string, string>, RegExp][] = [
        [{ kind: 'field', column: 'guest_name.email' }, {}, /not a link/],
        [{ kind: 'field', column: 'guest_id.no_such' }, {}, /has no column no_such/],
        [{ kind: 'field', column: 'no_such.email' }, {}, /has no column no_such/],
        [{ kind: 'field', column: 'guest_id.email.domain' }, {}, /has no column guest_id\.email\.domain/],
        [{ kind: 'fixed', addresses: ['desk@example.test'] }, { first: '{{guest_id.no_such}}' }, /has no column no_such/],
        [{ kind: 'fixed', addresses: ['desk@example.test', 'not an address'] }, {}, /not an email address/],
        [{ kind: 'fixed', addresses: ['desk@example'] }, {}, /not an email address/],
      ];
      for (const [to, vars, message] of cases) {
        const res = await save(owner, mail(to, vars));
        expect(res.statusCode, `${JSON.stringify(to)} ${JSON.stringify(vars)} → ${res.body}`).toBe(422);
        expect(res.body).toMatch(message);
      }
      // A placeholder nobody recognises is still left as written: `{{order.total}}` is not a link here.
      expect((await save(owner, mail({ kind: 'fixed', addresses: ['desk@example.test'] }, { first: '{{order.total}} {{anything}}' }))).statusCode).toBe(201);
    });

    it('holds a limited author to the columns their role is shown, one hop away too', async () => {
      // The planner reads four columns of a stay; give them guests in part: the name and not the tier.
      const guestsRead = `table:${s.connectionId}:${guests}:read`;
      const limited = await person(s, `limited-${dialect}@lodge.dev`, ['planner'], ['system:automations:manage']);
      const { rolesRepo, permissionsRepo } = await import('@adminium/meta');
      const role = await rolesRepo(s.meta).create({ slug: `guests-part-${dialect}`, name: 'Guests in part' });
      await permissionsRepo(s.meta).grant(role.id, 'table', `${s.connectionId}/${guests}`, { read: true, create: false, update: false, delete: false, export: false, import: false, readLimit: { readable: ['name', 'email'] } } as never);
      await rolesRepo(s.meta).assignToUser(limited.id, role.id);
      expect(guestsRead).toContain(guests);
      expect((await save(limited.cookie, mail({ kind: 'field', column: 'guest_id.email' }, { first: '{{guest_id.name}}' }))).statusCode).toBe(201);
      const hidden = await save(limited.cookie, mail({ kind: 'field', column: 'guest_id.email' }, { tier: '{{guest_id.tier}}' }));
      expect(hidden.statusCode, hidden.body).toBe(422);
      expect(hidden.body).toContain('not a column your role is shown');
      // Their own record's hidden column, by hand, is held the same way now.
      const own = await save(limited.cookie, mail({ kind: 'field', column: 'guest_name' }));
      expect(own.statusCode, own.body).toBe(422);
    });

    it('warns of a recipient column that holds no addresses, and still saves and serves the rule', async () => {
      const view = await loadSnapshotView(s.meta, s.connectionId);
      expect(ruleWarnings(trigger(), mail({ kind: 'field', column: 'guest_id.email' }), view)).toEqual([]);
      expect(ruleWarnings(trigger(), mail({ kind: 'field', column: 'guest_id' }), view)).toEqual([{ nodeId: 'n2', code: 'recipient-not-address', column: 'guest_id' }]);
      expect(ruleWarnings(trigger(), mail({ kind: 'field', column: 'guest_id.name' }), view)).toEqual([{ nodeId: 'n2', code: 'recipient-not-address', column: 'guest_id.name' }]);
      const saved = await save(owner, mail({ kind: 'field', column: 'guest_name' }), 'Odd recipient');
      expect(saved.statusCode, saved.body).toBe(201);
      expect((saved.json() as { warnings: unknown[] }).warnings).toEqual([{ nodeId: 'n2', code: 'recipient-not-address', column: 'guest_name' }]);
      const good = await save(owner, mail({ kind: 'field', column: 'guest_id.email' }), 'Good recipient');
      expect((good.json() as { warnings: unknown[] }).warnings).toEqual([]);
      const listed = await s.app.inject({ method: 'GET', url: '/api/v1/automations', headers: { cookie: owner } });
      expect((listed.json() as { rules: { name: string; warnings: unknown[] }[] }).rules.find((rule) => rule.name === 'Odd recipient')?.warnings).toHaveLength(1);
    });

    it('tells the builder where each link leads, with the far table`s address columns, only for tables the asker reads', async () => {
      const sources = async (cookie: string) => {
        const res = await s.app.inject({ method: 'GET', url: '/api/v1/automations/sources', headers: { cookie } });
        expect(res.statusCode, res.body).toBe(200);
        const body = res.json() as { connections: { tables: { id: string; links: { column: string; table: string; columns: { name: string; emailLike: boolean }[] }[] }[] }[]; templatesOff: number; templates: { key: string }[] };
        return { body, stays: body.connections[0]!.tables.find((table) => table.id === s.table.stays)! };
      };
      const mine = await sources(owner);
      expect(mine.stays.links.map((link) => link.column).sort()).toEqual(['guest_id', 'room_id']);
      const guest = mine.stays.links.find((link) => link.column === 'guest_id')!;
      expect(guest.table).toBe(guests);
      expect(guest.columns.filter((column) => column.emailLike).map((column) => column.name)).toEqual(['email']);
      const stays = await person(s, `sources-${dialect}@lodge.dev`, [], [`table:${s.connectionId}:${s.table.stays}:read`, `table:${s.connectionId}:${s.table.rooms}:read`, 'system:automations:manage']);
      expect((await sources(stays.cookie)).stays.links.map((link) => link.column)).toEqual(['room_id']);
    });

    it('means one thing by a template key: its family, live while any language of it is on', async () => {
      const templates = emailTemplatesRepo(s.meta);
      const doc = (subject: string, enabled: boolean) => ({ name: subject, subject, enabled, blocks: [] }) as never;
      // English off, German on: still a live key, shown once, and the run sends the German.
      await templates.upsert('p64-de-only', 'en_US', doc('English, off', false));
      await templates.upsert('p64-de-only', 'de_DE', doc('Deutsch, an', true));
      // Every language off: not live, counted as switched off.
      await templates.upsert('p64-all-off', 'en_US', doc('Off', false));
      const families = await templateFamilies(s.meta);
      expect(families.live.filter((family) => family.key === 'p64-de-only')).toEqual([{ key: 'p64-de-only', name: 'English, off', placeholders: [], ownedByApp: false }]);
      expect(families.live.some((family) => family.key === 'p64-all-off')).toBe(false);
      expect(families.off).toBeGreaterThanOrEqual(1);
      expect((await resolveRuleTemplate(s.meta, 'p64-de-only', 'en_US'))?.subject).toBe('Deutsch, an');
      expect(await resolveRuleTemplate(s.meta, 'p64-all-off', 'en_US')).toBeNull();
      // The save agrees with the list…
      expect((await save(owner, mail({ kind: 'fixed', addresses: ['desk@example.test'] }, {}, 'p64-de-only'))).statusCode).toBe(201);
      const off = await save(owner, mail({ kind: 'fixed', addresses: ['desk@example.test'] }, {}, 'p64-all-off'));
      expect(off.statusCode, off.body).toBe(422);
      // …and the run agrees with the save.
      sent.length = 0;
      const outcome = await walk(await ruleOf(mail({ kind: 'fixed', addresses: ['desk@example.test'] }, {}, 'p64-de-only')), 1);
      expect(outcome.kind === 'finished' ? outcome.status : outcome.kind, JSON.stringify(outcome.trace.steps.at(-1))).toBe('succeeded');
      expect(sent[0]?.subject).toBe('Deutsch, an');
      const listed = await s.app.inject({ method: 'GET', url: '/api/v1/automations/sources', headers: { cookie: owner } });
      const body = listed.json() as { templates: { key: string }[]; templatesOff: number };
      expect(body.templates.filter((row) => row.key === 'p64-de-only')).toHaveLength(1);
      expect(body.templatesOff).toBe(families.off);
    });
    it('refuses a rule the assistant drafted whose mail goes to a column that holds no address, and says which columns do', async () => {
      const { usersRepo } = await import('@adminium/meta');
      const ownerId = (await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!.id;
      const setup = await turnAs(s, ownerId, 'automation');
      const accept = (graph: AutomationGraph) => setup.adapter.document!.acceptArtefact({ name: 'Thank the guest', trigger: trigger(), graph } as never, setup.deps);
      const wrong = await accept(mail({ kind: 'field', column: 'guest_id' }));
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) {
        expect(wrong.errors[0]).toMatchObject({ code: 'RECIPIENT_NOT_ADDRESS' });
        expect(wrong.errors[0]!.message).toContain('"guest_id" does not hold email addresses. The columns that do: guest_id.email.');
      }
      const right = await accept(mail({ kind: 'field', column: 'guest_id.email' }, { first: '{{guest_id.name}}' }));
      expect(right.ok, JSON.stringify(right)).toBe(true);
    });

    it('writes a value read through a link into the record itself', async () => {
      const graph = { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Note the guest', onError: false, action: { kind: 'record.update', values: { note: 'For {{guest_id.name}} ({{record.guest_id.tier}})' } } }] } as unknown as AutomationGraph;
      expect((await save(owner, graph, 'Note the guest')).statusCode).toBe(201);
      const outcome = await walk(await ruleOf(graph), 1);
      expect(outcome.kind === 'finished' ? outcome.status : outcome.kind, JSON.stringify(outcome.trace.steps.at(-1))).toBe('succeeded');
      const view = await loadSnapshotView(s.meta, s.connectionId);
      const { db } = await s.manager.data(s.connectionId);
      expect((await fetchByPk(db, view.table(s.table.stays), { id: 1 }))?.note).toBe('For Ana Ribeiro (gold)');
    });
  });
}
