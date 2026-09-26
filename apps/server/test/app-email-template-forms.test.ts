// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN EMAIL TEMPLATE THAT READS A FORM ITS COLUMN DOES NOT HAVE IS REFUSED
 * WHEN THE APP IS CHECKED, not when the first message fails to send.
 *
 * A calendar day (`date`) has no clock: a template reads it as `{{x}}`,
 * `{{x.day_month}}` or `{{x.days_since}}`, never `{{x.date}}` or
 * `{{x.time}}`, which only a time (`timestamptz`) has. Such a variable is
 * one nothing fills, so every message the template makes would fail with
 * "nothing fills {{…}}". The plan says so, naming the template and the
 * variable (`EMAIL_TEMPLATE_INVALID`), and the install and the update stop
 * before anything is written. A name the manifest cannot place is left to
 * the sender, as before.
 */
import { manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { templateProblems } from '../src/apps/manifest-outbox.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });

function manifest(version: string, texts: string[]): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'bills',
    name: 'Bills',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Bills.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, { ref: 'opened_on', type: 'date', nullable: true }] },
        { ref: 'clients', columns: [id, { ref: 'email', type: 'text', maxLength: 254 }, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'since', type: 'date', nullable: true }] },
        {
          ref: 'invoices',
          columns: [
            id,
            fk('client_id', 'clients'),
            { ref: 'number', type: 'text', maxLength: 20, nullable: true },
            { ref: 'due_on', type: 'date', nullable: true },
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['sent'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
            fk('client_id', 'clients'),
            fk('invoice_id', 'invoices'),
            { ref: 'error', type: 'text', maxLength: 200, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'bills-invoices', template: 'page-crud', title: { key: 'i', fallback: 'Invoices' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'invoices' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error' },
      links: { client: 'client_id', invoice: 'invoice_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email', name: 'name' },
      settings: { table: 'settings' },
      kinds: { sent: 'bills-sent' },
    },
    emailTemplates: [
      {
        key: 'bills-sent',
        name: 'Invoice sent',
        locales: {
          'en-US': { subject: 'Invoice {{invoice.number}}', blocks: texts.map((text) => ({ block: 'email.text', data: { text } })) },
          'de-DE': { subject: 'Rechnung {{invoice.number}}', blocks: [{ block: 'email.text', data: { text: 'Fällig am {{invoice.due_on}}.' } }] },
        },
      },
    ],
  };
}

const GOOD = [
  'Due {{invoice.due_on}}, on {{invoice.due_on.day_month}}; {{invoice.due_on.days_since}} days ago.',
  'Sent {{invoice.sent_at}}: {{invoice.sent_at.date}} at {{invoice.sent_at.time}}, {{invoice.sent_at.relative_day}}, {{invoice.sent_at.day_month}}.',
  'A client since {{invoice.client.since}} ({{client.since.day_month}}); open since {{practice.opened_on}}.',
  // Names the manifest cannot place are the sender's to judge.
  '{{invoice.nope.date}} {{recipient.first_name}} {{elsewhere.due_on.date}} {{invoice.due_on.date.more}}',
];

describe('which variable forms a template may read', () => {
  it('takes every form a column has, and names the ones it has not', () => {
    expect(templateProblems(manifest('1.0.0', GOOD) as never)).toEqual([]);
    const refused = templateProblems(
      manifest('1.0.0', ['Due {{ invoice.due_on.date }}.', 'At {{invoice.due_on.time}}.', 'Since {{invoice.client.since.date}} and {{client.since.relative_day}}.', '{{practice.opened_on.time}}', '{{invoice.number.days_since}}', '{{invoice.sent_at.days_since}}']) as never,
    );
    expect(refused).toEqual([
      'The email "bills-sent" (en-US) reads {{invoice.due_on.date}}, which nothing fills: invoices.due_on is a date column, read as {{invoice.due_on}}, {{invoice.due_on.day_month}} or {{invoice.due_on.days_since}}.',
      'The email "bills-sent" (en-US) reads {{invoice.due_on.time}}, which nothing fills: invoices.due_on is a date column, read as {{invoice.due_on}}, {{invoice.due_on.day_month}} or {{invoice.due_on.days_since}}.',
      'The email "bills-sent" (en-US) reads {{invoice.client.since.date}}, which nothing fills: clients.since is a date column, read as {{invoice.client.since}}, {{invoice.client.since.day_month}} or {{invoice.client.since.days_since}}.',
      'The email "bills-sent" (en-US) reads {{client.since.relative_day}}, which nothing fills: clients.since is a date column, read as {{client.since}}, {{client.since.day_month}} or {{client.since.days_since}}.',
      'The email "bills-sent" (en-US) reads {{practice.opened_on.time}}, which nothing fills: settings.opened_on is a date column, read as {{practice.opened_on}}, {{practice.opened_on.day_month}} or {{practice.opened_on.days_since}}.',
      'The email "bills-sent" (en-US) reads {{invoice.number.days_since}}, which nothing fills: invoices.number is a text column, read as {{invoice.number}}.',
      'The email "bills-sent" (en-US) reads {{invoice.sent_at.days_since}}, which nothing fills: invoices.sent_at is a timestamptz column, read as {{invoice.sent_at}}, {{invoice.sent_at.date}}, {{invoice.sent_at.time}}, {{invoice.sent_at.day_month}} or {{invoice.sent_at.relative_day}}.',
    ]);
  });
});

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`an email reading a form its column lacks — ${dialect}`, () => {
    it('is refused by the plan, the install and the update, before anything is written', async () => {
      const h = (open = await installHarness(dialect));
      const bad = ['Pay by {{invoice.due_on.date}}.'];
      await h.stage(manifest('1.0.0', bad));
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'bills', version: '1.0.0', connectionId: h.connectionId } });
      const plan = (JSON.parse(planned.body) as { plan: { installable: boolean; problems: { code: string; message: string }[] } }).plan;
      expect(plan.installable).toBe(false);
      expect(plan.problems).toContainEqual({ code: 'EMAIL_TEMPLATE_INVALID', table: 'bills', message: expect.stringContaining('"bills-sent" (en-US) reads {{invoice.due_on.date}}') });
      const refused = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'bills', version: '1.0.0', connectionId: h.connectionId } });
      expect(refused.statusCode, refused.body).toBe(422);
      const apps = () => manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app');
      expect(await apps()).toEqual([]);

      // The same app with the day read as a day installs; an update bringing the form back is refused.
      await h.stage(manifest('1.0.1', ['Pay by {{invoice.due_on}}.']));
      const installed = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'bills', version: '1.0.1', connectionId: h.connectionId } });
      expect(installed.statusCode, installed.body).toBe(200);
      await h.stage(manifest('1.0.2', bad));
      const update = await h.inject({ method: 'POST', url: '/apps/bills/update', payload: {} });
      expect(update.statusCode, update.body).toBe(422);
      expect(JSON.parse(update.body)).toMatchObject({
        error: { code: 'VALIDATION_FAILED', details: { reason: 'PLAN_REFUSED', problems: [expect.objectContaining({ code: 'EMAIL_TEMPLATE_INVALID', message: expect.stringContaining('{{invoice.due_on.date}}') })] } },
      });
      expect((await apps()).map((m) => m.row.version)).toEqual(['1.0.1']);
    });
  });
}
