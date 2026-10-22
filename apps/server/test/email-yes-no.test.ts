// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A YES/NO IN AN E-MAIL reads as its reader says it — "Yes", "Ja", "Oui",
 * "نعم" — in each of the eight languages Adminium ships, never `true`,
 * `false`, `1` or `0` (what Postgres, SQLite and MySQL each hand back):
 *
 *  - the value forms, in each language;
 *  - an app's message, in its text and in an `email.rows` list, in English
 *    and in German, on every engine (outbox sender);
 *  - a rule's e-mail to a person, on every engine (automations).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { documentSequencesRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import { decryptSecret } from '../src/config/secrets.js';
import { createWriteService } from '../src/crud/write-service.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, valueForms, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import { eventsManifest, SMTP } from './outbox-rows-fixture.js';
import { LEGS as WHOLE_LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

type Doc = Record<string, unknown>;

describe('a yes/no as each language says it', () => {
  it('reads yes and no in the eight languages, from every spelling a database hands back', () => {
    const words = (locale: string) => {
      const forms = valueForms({ locale, zone: 'UTC', currency: null, now: 0 });
      return [forms.yesNo(true), forms.yesNo(1), forms.yesNo('1'), forms.yesNo(false), forms.yesNo(0), forms.yesNo('0')];
    };
    expect(words('en-US')).toEqual(['Yes', 'Yes', 'Yes', 'No', 'No', 'No']);
    expect(words('de-DE')).toEqual(['Ja', 'Ja', 'Ja', 'Nein', 'Nein', 'Nein']);
    expect(words('fr-FR')).toEqual(['Oui', 'Oui', 'Oui', 'Non', 'Non', 'Non']);
    expect(words('da-DK')).toEqual(['Ja', 'Ja', 'Ja', 'Nej', 'Nej', 'Nej']);
    expect(words('cs-CZ')).toEqual(['Ano', 'Ano', 'Ano', 'Ne', 'Ne', 'Ne']);
    expect(words('ar-EG')).toEqual(['نعم', 'نعم', 'نعم', 'لا', 'لا', 'لا']);
    expect(words('zh-CN')).toEqual(['是', '是', '是', '否', '否', '否']);
    expect(words('zh-TW')).toEqual(['是', '是', '是', '否', '否', '否']);
    // A language Adminium does not ship reads English, as its template does; a value that is no answer reads as it is.
    const other = valueForms({ locale: 'pt-BR', zone: 'UTC', currency: null, now: 0 });
    expect([other.yesNo(true), other.yesNo('maybe')]).toEqual(['Yes', 'maybe']);
  });
});

/** The box office with a stay that says whether breakfast is in, and extras that say whether they are paid. */
function manifest(): Doc {
  const m = eventsManifest();
  const tables = (m['requiredSchema'] as Doc)['tables'] as Doc[];
  const columnsOf = (ref: string) => tables.find((table) => table['ref'] === ref)!['columns'] as Doc[];
  columnsOf('stays').push({ ref: 'breakfast', type: 'bool', default: false });
  columnsOf('stay_extras').push({ ref: 'paid', type: 'bool', default: false });
  const stay = (m['emailTemplates'] as Doc[]).find((template) => template['key'] === 'events-stay')!;
  const blocks = (nights: string, rowMeta: string) => [
    { block: 'email.text', data: { text: nights } },
    { block: 'email.rows', data: { from: { link: 'stay', table: 'stay_extras', via: 'stay_id' }, row: { title: '{{row.label}}', meta: rowMeta, amount: '{{row.amount}}' } } },
  ];
  stay['locales'] = {
    'en-US': { subject: 'Your stay', blocks: blocks('{{stay.nights}} nights, breakfast: {{stay.breakfast}}', 'Paid: {{row.paid}}') },
    'de-DE': { subject: 'Ihr Aufenthalt', blocks: blocks('{{stay.nights}} Nächte, Frühstück: {{stay.breakfast}}', 'Bezahlt: {{row.paid}}') },
  };
  return m;
}

interface Sent {
  subject: string;
  text: string;
  html: string;
}

describe.each(LEGS)("an app's message with a yes/no in its text and its list — %s", (dialect, available) => {
  let h: InvoicingHarness;
  let meta: MetaDb;
  let sender: OutboxSender;
  const now = Date.parse('2026-10-20T12:00:00Z');
  const mail = async (): Promise<Sent[]> =>
    ((await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()) as { payload: unknown }[]).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Sent;
    });
  const send = async (language: string): Promise<Sent | undefined> => {
    await h.rows(`INSERT INTO ${h.real('messages')} (kind, status, to_address, customer_id, stay_id, language) VALUES ('stay', 'queued', 'mia@waveform.dev', 1, 1, '${language}')`);
    const before = (await mail()).length;
    await sender.sendApp('events', now);
    return (await mail()).slice(before)[0];
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    meta = h.meta;
    await settingsRepo(meta).set('email.smtp', SMTP as never);
    await meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'EUR' }).where('id', '=', h.connectionId).execute();
    const views = createPublicViews(meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(meta) });
    const producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET });
    const yes = dialect === 'postgres' ? 'true' : '1';
    const no = dialect === 'postgres' ? 'false' : '0';
    await h.rows(`INSERT INTO ${h.real('customers')} (email, name, language) VALUES ('mia@waveform.dev', 'Mia Okada', 'en-US')`);
    await h.rows(`INSERT INTO ${h.real('stays')} (customer_id, nights, breakfast) VALUES (1, 2, ${yes})`);
    await h.rows(`INSERT INTO ${h.real('stay_extras')} (stay_id, label, amount, paid) VALUES (1, 'Late checkout', 20, ${no}), (1, 'Parking', 12, ${yes})`);
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('prints Yes and No in English, in its text and in each listed row', async () => {
    const sent = await send('en-US');
    expect(sent?.text).toContain('2 nights, breakfast: Yes');
    expect(sent?.text).toContain('Late checkout — Paid: No');
    expect(sent?.text).toContain('Parking — Paid: Yes');
    expect(sent?.html).toContain('breakfast: Yes');
    expect(sent?.html).toContain('Paid: No');
    expect(`${sent?.text ?? ''}${sent?.html ?? ''}`).not.toMatch(/breakfast: (true|1)\b|Paid: (true|false|0|1)\b/);
  });

  it.skipIf(!available)('prints Ja and Nein in German', async () => {
    const sent = await send('de-DE');
    expect(sent?.subject).toBe('Ihr Aufenthalt');
    expect(sent?.text).toContain('2 Nächte, Frühstück: Ja');
    expect(sent?.text).toContain('Late checkout — Bezahlt: Nein');
    expect(sent?.text).toContain('Parking — Bezahlt: Ja');
  });
});

const id = { ref: 'id', type: 'int', role: 'pk' };

/** A rule's e-mail to a deal's owner when the deal is won, saying whether the customer may be e-mailed. */
function sales(): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'sales',
    name: 'Sales',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Sales.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'state', type: 'text', maxLength: 20, default: 'open' },
            { ref: 'may_email', type: 'bool', default: false },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
          ],
        },
      ],
    },
    emailTemplates: [{ key: 'sales-won', name: 'sales-won', locales: { 'en-US': { subject: '{{record.name}} is won', blocks: [{ block: 'email.text', data: { text: 'May be e-mailed: {{record.may_email}}.' } }] } } }],
    automations: [
      {
        key: 'deal-won',
        name: { 'en-US': 'A deal is won: write to its owner' },
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'state', when: [{ left: { field: 'state' }, op: 'is', right: 'won' }] },
        graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, { id: 'mail', kind: 'action', title: 'mail', action: { kind: 'email', templateKey: 'sales-won', to: { kind: 'staff', column: 'owner_id' } } }] },
      },
    ],
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'sales', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

for (const [dialect, reachable] of WHOLE_LEGS) {
  describe.skipIf(!reachable)(`a rule's e-mail with a yes/no [${dialect}]`, () => {
    let s: WholeServer;
    beforeAll(async () => {
      s = await wholeServer(dialect, sales(), { smtp: true });
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('prints Yes and No, never what the database keeps', async () => {
      expect(said(await s.make('owner', 'deals', { id: 1, name: 'Harbour refit', may_email: true, owner_id: s.ids['owner'] }))).toBe('ok');
      expect(said(await s.make('owner', 'deals', { id: 2, name: 'Mill roof', may_email: false, owner_id: s.ids['owner'] }))).toBe('ok');
      expect(said(await s.change('owner', 'deals', 1, { state: 'won' }))).toBe('ok');
      expect(said(await s.change('owner', 'deals', 2, { state: 'won' }))).toBe('ok');
      await s.jobs();
      const mails = await s.emails();
      const of = (name: string) => mails.find((mail) => mail.subject === `${name} is won`);
      expect(of('Harbour refit')?.text).toContain('May be e-mailed: Yes.');
      expect(of('Mill roof')?.text).toContain('May be e-mailed: No.');
      expect(of('Harbour refit')?.html).toContain('May be e-mailed: Yes.');
    });
  });
}
