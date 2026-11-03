// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "SEND A SURVEY": A STEP ABOUT A PERSON, on SQLite, Postgres and MySQL, run
 * as a rule runs it.
 *
 * The forms add-on gives a step that writes one invitation: the survey named
 * by its slug (only a live one), the person one link of the rule's record
 * names (the job's main contact), read as the system through the app's
 * people declaration — their address, name, language, company, and their
 * row as the consent log names it — and the job itself as other rows name
 * it (its table's stored name and its key). A record that names nobody
 * fails by name and writes nothing; a person's address goes only into a
 * column kept personal and never into the run's log; the save holds a
 * person to one hop and to a table of people; and the add-on's record tab
 * then shows on the table the rule is about.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { automationsRepo, overridesRepo, settingsRepo, snapshotsRepo, type Automation, type AutomationGraph, type AutomationTriggerEvent } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { formsWithInvitations } from '../../../packages/manifest/test/forms-invitations-fixture.js';
import { recordTabsFor, type RecordTabsAsker } from '../src/add-ons/record-tabs.js';
import { findStep, type StepLookup } from '../src/automations/add-on-steps.js';
import { walkRule } from '../src/automations/runner.js';
import { resolveRule, type RuleSteps } from '../src/automations/validate.js';
import { loadAddOnInstalls, type AddOnInstalls } from '../src/apps/table-ref.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { peopleTablesOf } from '../src/people/tables-of.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { shopManifest } from './fixtures/cards-kit/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];
const words = (text: string): Doc => Object.fromEntries(LOCALES.map((locale) => [locale, text]));
const NOW = Date.parse('2026-11-03T09:00:00Z');

/** The forms add-on, giving "Send a survey" and a tab of the invitations a record has. */
function formsWithStep(): Doc {
  const doc = formsWithInvitations();
  doc['compatibility'] = { minAdminiumVersion: '0.3.41', engines: ['postgres', 'mysql', 'sqlite'] };
  const invitations = (doc['requiredSchema'] as { tables: (Doc & { columns: Doc[] })[] }).tables.find((table) => table['ref'] === 'invitations')!;
  // The invitee's address and name are kept personal; the job is named by its table's stored name, which a record tab reads.
  invitations.columns = invitations.columns.map((column) =>
    column['ref'] === 'name' || column['ref'] === 'email' ? { ...column, rules: { personal: true } } : column['ref'] === 'record_table' ? { ...column, rules: { tableRef: true } } : column,
  );
  invitations.columns.push({ ref: 'company', type: 'text', maxLength: 200, nullable: true });
  const addOn = doc['addOn'] as Doc;
  addOn['steps'] = [
    {
      key: 'send-survey',
      name: words('Send a survey'),
      does: words('Invites a person to answer one of your surveys'),
      inputs: [
        { key: 'survey', label: words('Survey'), kind: 'record', table: 'forms', by: 'slug', where: [{ column: 'state', eq: 'live' }, { column: 'kind', eq: 'survey' }], required: true, help: words('Only live surveys are listed.') },
        { key: 'to', label: words('To'), kind: 'person', required: true },
        { key: 'class', label: words('Kind of mail'), kind: 'choice', required: true, options: [{ value: 'marketing', label: words('Marketing mail'), help: words('Only to people who agreed.') }, { value: 'service', label: words('Service mail'), help: words('About work you did for them.') }] },
      ],
      writes: {
        table: 'invitations',
        values: {
          form_id: { input: 'survey' },
          email: { person: 'to', field: 'email' },
          name: { person: 'to', field: 'name' },
          language: { person: 'to', field: 'language' },
          company: { person: 'to', field: 'company' },
          person_table: { person: 'to', field: 'table' },
          person_key: { person: 'to', field: 'key' },
          record_table: { token: 'recordTable' },
          record_key: { token: 'recordKey' },
          class: { input: 'class' },
          invited_at: { token: 'now' },
        },
      },
    },
  ];
  addOn['recordTabs'] = [{ id: 'survey', label: { key: 'forms.tab.survey', fallback: 'Survey sent' }, table: 'invitations', match: { table: 'record_table', row: 'record_key' }, on: 'linked', columns: ['class', 'invited_at'] }];
  return doc;
}

/** A shop that keeps contacts, the companies they work for, and the jobs done for them: the contacts are its people. */
const crm = (): Doc =>
  shopManifest({
    compatibility: { minAdminiumVersion: '0.3.38', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'products', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
        { ref: 'hours', columns: [pk, { ref: 'day', type: 'text', maxLength: 16, nullable: true }] },
        { ref: 'companies', columns: [pk, { ref: 'name', type: 'text', maxLength: 80 }] },
        { ref: 'contacts', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true } }, { ref: 'company_id', type: 'fk', references: 'companies', nullable: true }] },
        { ref: 'jobs', columns: [pk, { ref: 'title', type: 'text', maxLength: 80 }, { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true }, { ref: 'company_id', type: 'fk', references: 'companies', nullable: true }] },
      ],
    },
    people: [{ table: 'contacts', kind: 'people', email: 'email', name: 'name', company: 'company_id' }],
  });

describe.each(LEGS)('a step that sends a survey — %s', (dialect, available) => {
  let h: Harness;
  let installs: AddOnInstalls;
  let view: SnapshotView;
  const tables = new Map<string, string>();
  afterEach(async () => {
    if (available) await h.close();
  });

  const read = async (): Promise<void> => {
    await h.introspect();
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    view = new SnapshotView(h.connectionId, applyOverrides(model, await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })), new Map());
    installs = await loadAddOnInstalls(h.meta, async () => model);
    for (const row of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).execute()) tables.set(row.ref, model.tables.find((table) => table.name === row.tableName)!.id);
  };
  const name = (ref: string) => view.table(tables.get(ref)!).name;
  const setUp = async (): Promise<void> => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(crm());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(formsWithStep(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    await read();
    await h.rows(`INSERT INTO ${name('companies')} (id, name) VALUES (1, 'Linden Studio'), (2, 'Harbour & Co')`);
    await h.rows(`INSERT INTO ${name('contacts')} (id, name, email, company_id) VALUES (1, 'Ann Lee', 'ann@linden.example', 1), (2, 'No Address', NULL, 2)`);
    await h.rows(`INSERT INTO ${name('jobs')} (id, title, contact_id, company_id) VALUES (10, 'Kitchen fit-out', 1, 1), (11, 'Office', NULL, 2), (12, 'Shop front', 2, 2)`);
    for (const [id, slug, kind, state] of [['frm_fit', 'fit-out', 'survey', 'live'], ['frm_old', 'old-survey', 'survey', 'closed'], ['frm_news', 'newsletter', 'form', 'live']] as const) {
      await h.rows(`INSERT INTO ${name('forms')} (id, title, slug, kind, state, definition, settings) VALUES ('${id}', '${slug}', '${slug}', '${kind}', '${state}', '{}', '{}')`);
    }
  };
  const jobs = () => tables.get('jobs')!;
  const steps = (): RuleSteps => (addOn, step) => findStep(installs, h.connectionId, addOn, step);
  const lookup = (): StepLookup => (connectionId, addOn, step) => findStep(installs, connectionId, addOn, step);
  const trigger = () => ({ kind: 'record' as const, connectionId: h.connectionId, table: jobs(), event: 'updated' as const, watch: false, when: [] });
  const survey = (inputs: Record<string, string>): AutomationGraph =>
    ({ version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'A job is signed off' }, { id: 'n2', kind: 'action', title: 'Send a survey', sub: '', onError: false, action: { kind: 'add-on.step', addOn: 'forms', step: 'send-survey', addOnName: 'Forms & surveys', inputs } }] }) as unknown as AutomationGraph;
  const ruleOf = (graph: AutomationGraph): Automation =>
    ({ id: 'auto_survey', connectionId: h.connectionId, name: 'Survey after sign-off', description: null, enabled: true, trigger: trigger(), graph, managedBy: null, templateKey: null, timeSavedMinutes: 0, nextRunAt: null, createdAt: 0, updatedAt: 0 }) as unknown as Automation;
  const event = (id: number): AutomationTriggerEvent => ({ event: 'record.updated', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: h.connectionId, table: jobs(), pk: { id }, label: `Job ${String(id)}` }, snapshot: { id }, occurredAt: NOW });
  const walk = (graph: AutomationGraph, id: number, dryRun = false) =>
    walkRule({ meta: h.meta, manager: h.manager, secret: TEST_SECRET, now: () => NOW, steps: async () => lookup() }, { rule: ruleOf(graph), runId: `arun_${String(id)}`, event: event(id), ...(dryRun ? { dryRun: true } : {}) });
  const lineOf = (outcome: Awaited<ReturnType<typeof walk>>): string => JSON.stringify(outcome.trace.steps.at(-1));
  const invitations = async () => h.rows(`SELECT form_id, email, name, language, company, person_table, person_key, record_table, record_key, class FROM ${name('invitations')} ORDER BY invited_at`);
  const peopleTables = async () => new Set((await peopleTablesOf(h.meta).all(h.connectionId, view.model)).filter((table) => table.kind === 'people').map((table) => table.table));
  const check = async (graph: AutomationGraph): Promise<void> => {
    resolveRule(trigger(), graph, { view, templateKeys: new Set(), blockLoopback: false, steps: steps(), peopleTables: await peopleTables() });
  };
  const fitOut = { survey: 'fit-out', to: '@link:contact_id', class: 'service' };

  it.skipIf(!available)('writes the invitation for the job\'s main contact: address, name, language, company, their row, the job, the live survey', async () => {
    await setUp();
    await check(survey(fitOut));
    const outcome = await walk(survey(fitOut), 10);
    expect(outcome.kind === 'finished' && outcome.status, lineOf(outcome)).toBe('succeeded');
    const [invited] = await invitations();
    expect(invited).toMatchObject({
      form_id: 'frm_fit',
      email: 'ann@linden.example',
      name: 'Ann Lee',
      // The contacts keep no language: the install's own.
      language: 'en-US',
      company: 'Linden Studio',
      person_table: tables.get('contacts'),
      person_key: '1',
      record_table: 'shop:jobs',
      record_key: '10',
      class: 'service',
    });
    // The job, as other rows name it, is the job: what a record tab and the survey's answer read back.
    expect(installs.tableOfRef(h.connectionId, String(invited!['record_table']))).toBe(jobs());
    // The person's address and name are in the row, and nowhere in the run's own record.
    expect(JSON.stringify(outcome.trace)).not.toContain('ann@linden.example');
    expect(JSON.stringify(outcome.trace)).not.toContain('Ann Lee');
  });

  it.skipIf(!available)('writes the install\'s own language for a person whose table keeps none', async () => {
    await setUp();
    await settingsRepo(h.meta).set('locale.default', 'de_DE');
    const outcome = await walk(survey(fitOut), 10);
    expect(outcome.kind === 'finished' && outcome.status, lineOf(outcome)).toBe('succeeded');
    expect((await invitations())[0]!['language']).toBe('de-DE');
  });

  it.skipIf(!available)('a test run finds the person and says so, never who', async () => {
    await setUp();
    const outcome = await walk(survey(fitOut), 10, true);
    expect(outcome.kind === 'finished' && outcome.status, lineOf(outcome)).toBe('succeeded');
    expect(lineOf(outcome)).toContain('To = found (kept private)');
    expect(JSON.stringify(outcome.trace)).not.toContain('ann@linden.example');
    expect(await invitations()).toEqual([]);
  });

  it.skipIf(!available)('a job that names nobody, or somebody with no address, fails by name and writes nothing', async () => {
    await setUp();
    const empty = await walk(survey(fitOut), 11);
    expect(empty.kind === 'finished' && empty.status).toBe('failed');
    expect(lineOf(empty)).toContain('Send a survey: “To” has nobody: this record’s contact_id is empty.');
    const silent = await walk(survey(fitOut), 12);
    expect(silent.kind === 'finished' && silent.status).toBe('failed');
    expect(lineOf(silent)).toContain('Send a survey: “To” has no e-mail address for this record.');
    expect(await invitations()).toEqual([]);
  });

  it.skipIf(!available)('names its survey by the slug, and only a live survey: a closed one or a form fails by name', async () => {
    await setUp();
    for (const slug of ['old-survey', 'newsletter', 'no-such-survey']) {
      const outcome = await walk(survey({ ...fitOut, survey: slug }), 10);
      expect(outcome.kind === 'finished' && outcome.status, slug).toBe('failed');
      expect(lineOf(outcome)).toContain(`Send a survey: no “Survey” called “${slug}” (state live, kind survey) is there.`);
    }
    expect(await invitations()).toEqual([]);
  });

  it.skipIf(!available)('writes a person\'s address into no column the owner made plain', async () => {
    await setUp();
    // The owner marks the invitation's address as not personal: the step no longer writes it there.
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.pii', tableName: tables.get('invitations')!, columnName: 'email', value: { masked: false }, origin: 'user' } as never);
    const outcome = await walk(survey(fitOut), 10);
    expect(outcome.kind === 'finished' && outcome.status).toBe('failed');
    expect(lineOf(outcome)).toContain('is not kept personal, so a person\'s email is not written to it.');
    expect(lineOf(outcome)).not.toContain('ann@linden.example');
    expect(await invitations()).toEqual([]);
  });

  it.skipIf(!available)('the save holds a person to the record itself or one link of it, on a table of people', async () => {
    await setUp();
    await expect(check(survey(fitOut))).resolves.toBeUndefined();
    await expect(check(survey({ ...fitOut, to: '@link:title' }))).rejects.toThrow('To reads title, which links');
    // A link to the companies: no app declares them as people.
    await expect(check(survey({ ...fitOut, to: '@link:company_id' }))).rejects.toThrow('which no app declares as a table of people');
    // The job itself is no person.
    await expect(check(survey({ ...fitOut, to: '@record' }))).rejects.toThrow('which no app declares as a table of people');
    // Two hops are not written at all.
    await expect(check(survey({ ...fitOut, to: '@link:contact_id.company_id' }))).rejects.toThrow('is the record itself (@record) or one link of it');
    await expect(check(survey({ ...fitOut, to: 'ann@linden.example' }))).rejects.toThrow('is the record itself (@record) or one link of it');
    // A person a run reaches by `@record` on the contacts themselves.
    const people = await peopleTables();
    expect(() => resolveRule({ ...trigger(), table: tables.get('contacts')! }, survey({ ...fitOut, to: '@record' }), { view, templateKeys: new Set(), blockLoopback: false, steps: steps(), peopleTables: people })).not.toThrow();
  });

  it.skipIf(!available)('its record tab shows on the table a rule sends the survey from, and on no other', async () => {
    await setUp();
    const everything: RecordTabsAsker = { can: async () => true, permissions: { superAdmin: true } };
    const tabsOn = async (ref: string) => (await recordTabsFor(h.meta, installs, everything, view, tables.get(ref)!))?.map((tab) => [tab.addOn, tab.id, tab.match]) ?? [];
    expect(await tabsOn('jobs')).toEqual([]);
    // A rule switched off still counts.
    await automationsRepo(h.meta).create({ connectionId: h.connectionId, name: 'Survey after sign-off', enabled: false, trigger: trigger(), graph: survey(fitOut) });
    expect(await tabsOn('jobs')).toEqual([['forms', 'survey', { table: 'record_table', row: 'record_key', tableRef: 'shop:jobs' }]]);
    expect(await tabsOn('contacts')).toEqual([]);
    // What the tab lists is exactly what the step wrote: the job's own stored name and key.
    await walk(survey(fitOut), 10);
    const [invited] = await invitations();
    expect([invited!['record_table'], invited!['record_key']]).toEqual(['shop:jobs', '10']);
  });
});
