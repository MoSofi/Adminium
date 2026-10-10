// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT THE ASSISTANT IS TOLD, READS AND IS HELD TO ON THE AUTOMATIONS PAGE.
 *
 * The rule format is said short and made from the schema: a field the schema
 * gains is in it, a kind of step with no word on what it is for fails here.
 * What a rule can name (templates, add-on steps, address columns) is the read
 * tool `rule_parts`, for one table, as the person asking. And the draft check
 * decides what a prompt can only ask for: a step no installed add-on gives, an
 * input a step needs, a template placeholder nothing fills. On each database.
 */
import { automationsRepo, emailTemplatesRepo, usersRepo, type AutomationGraph } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTION_NOTES, NOT_FOR_A_DRAFT, actionKinds, ruleFormat, schemaFieldNames } from '../src/assistant/contexts/automation-format.js';
import { runAssistantAction } from '../src/assistant/actions.js';
import { automationContext } from '../src/assistant/contexts/automation.js';
import { ASSISTANT_TOOLS } from '../src/assistant/tools/catalogue.js';
import type { TurnSetup } from '../src/assistant/turn-setup.js';
import type { AddOnInstalls } from '../src/apps/table-ref.js';
import { legs, MANIFEST, stack, turnAs, type Stack } from './assistant-lodge.helpers.js';

describe('the rule format the assistant is told', () => {
  const format = ruleFormat();

  it('holds every field of the two schemas, but the ones a draft never writes', () => {
    const missing = schemaFieldNames().filter((name) => !(name in NOT_FOR_A_DRAFT) && !new RegExp(`\\b${name}\\??:`).test(format));
    // A name here is a field the schema has and the format does not say: the walker met a shape it cannot print.
    expect(missing).toEqual([]);
    // And what is hidden is hidden by name, with a reason, and is really a field of the schema.
    for (const name of Object.keys(NOT_FOR_A_DRAFT)) {
      expect(schemaFieldNames(), name).toContain(name);
      expect(new RegExp(`\\b${name}\\??:`).test(format), name).toBe(false);
    }
  });

  it('says what each kind of step is for: a kind the schema gains needs its line', () => {
    expect(actionKinds().sort()).toEqual(Object.keys(ACTION_NOTES).sort());
    for (const kind of actionKinds()) expect(format, kind).toContain(`{ kind: ${JSON.stringify(kind)}`);
  });

  it('says a condition once, and each bound the save holds a draft to', () => {
    expect(format.match(/A Condition is/g)).toHaveLength(1);
    expect(format).toContain('when?: [Condition] ≤8');
    expect(format).toContain('nodes: [Node] 1..40');
    expect(format).toContain('amount: int 1..3650, unit: "minutes"|"hours"|"days"');
    expect(format).toContain('branches: [{ id: text≤40, label: text≤60, nodes: [Node(action|condition|stop|wait)] ≤20 }, ');
    expect(format).toContain('event: "created"|"updated"|"deleted"');
  });

  it('is a quarter of what it was: the whole of this page\'s format under 2,500 tokens', () => {
    const whole = automationContext.document!.formatSpec();
    // About four characters a token for this notation; the JSON Schema it replaced was 25,000 characters.
    expect(whole.length).toBeLessThan(2_500 * 4);
    expect(whole.length).toBeLessThan(7_000);
  });
});

const base = MANIFEST.requiredSchema.tables;
/** The guest house, with its guests: a stay links to the guest it is for. */
const INN = {
  ...MANIFEST,
  requiredSchema: {
    ...MANIFEST.requiredSchema,
    tables: [
      base[0],
      { ref: 'guests', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 200, nullable: true }, { ref: 'tier', type: 'text', maxLength: 20, nullable: true }] },
      { ...base[1], columns: [...(base[1] as { columns: unknown[] }).columns, { ref: 'guest_id', type: 'fk', references: 'guests', nullable: true }] },
    ],
  },
};
const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];
const words = (text: string): Record<string, string> => Object.fromEntries(LOCALES.map((locale) => [locale, text]));

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`what a rule can name, and what a draft is held to — ${dialect}`, () => {
    let s: Stack;
    let setup: TurnSetup;
    let guests: string;
    let installed: AddOnInstalls | null = null;

    /** An add-on "Welcome kit" giving one step: add a guest. */
    const kit = (): AddOnInstalls => {
      const manifest = {
        kind: 'add-on',
        key: 'welcome-kit',
        name: 'Welcome kit',
        addOn: {
          steps: [
            {
              key: 'add-guest',
              name: words('Add a guest'),
              does: words('Adds a person to the guest list'),
              inputs: [{ key: 'to', label: words('Send to'), kind: 'email', required: true }, { key: 'name', label: words('Name'), kind: 'text', required: true }, { key: 'tier', label: words('Tier'), kind: 'choice', options: [{ value: 'gold', label: words('Gold') }, { value: 'plain', label: words('Plain') }] }],
              writes: { table: 'people', values: { email: { input: 'to' }, name: { input: 'name' }, tier: { input: 'tier' } } },
            },
          ],
        },
      };
      const here = (id: string): boolean => id === s.connectionId;
      return {
        installed: (id, key) => (here(id) && key === 'welcome-kit' ? { manifest: manifest as never, version: '1.0.0', status: 'installed', hosts: new Map() } : null),
        tableOf: (id, key, ref) => (here(id) && key === 'welcome-kit' && ref === 'people' ? guests : null),
        refOf: (_id, tableId) => tableId,
        keys: (id) => (here(id) ? ['welcome-kit'] : []),
        tableOfRef: () => null,
        featureOn: () => false,
      };
    };

    beforeAll(async () => {
      s = await stack(dialect, INN);
      guests = s.tableId('lodge_guests');
      const templates = emailTemplatesRepo(s.meta);
      const doc = (name: string, text: string) => ({ name, subject: name, enabled: true, blocks: [{ id: 'b', block: 'email.text', data: { text } }] }) as never;
      await templates.upsert('p64-thanks', 'en_US', doc('Thank you for staying', 'Dear {{first_name}}, thanks for {{note}} in {{city|our town}}. {{record.guest_id.name}}'));
      await templates.upsert('p64-plain', 'en_US', doc('See you again', 'See you again, {{guest_name}}.'));
      const owner = (await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!;
      setup = await turnAs(s, owner.id, 'automation');
      setup.deps.installs = async () => {
        if (installed === null) throw new Error('nothing is installed');
        return installed;
      };
    }, 120_000);
    afterAll(async () => {
      await s?.close();
    });

    const parts = async (args: Record<string, unknown> = {}) => (await ASSISTANT_TOOLS['rule_parts']!.run({ connectionId: s.connectionId, table: s.table.stays, ...args }, setup.deps)) as { result?: Record<string, unknown>; error?: { code: string; message: string } };
    const trigger = () => ({ kind: 'record' as const, connectionId: s.connectionId, table: s.table.stays, event: 'updated' as const, watch: false, when: [] });
    const graphOf = (action: Record<string, unknown>): AutomationGraph => ({ version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'A stay changes' }, { id: 'n2', kind: 'action', title: 'Do it', onError: false, action }] }) as unknown as AutomationGraph;
    const accept = (action: Record<string, unknown>) => automationContext.document!.acceptArtefact({ name: 'After a stay', trigger: trigger(), graph: graphOf(action) } as never, setup.deps);
    const mail = (templateKey: string, vars: Record<string, string> = {}) => ({ kind: 'email', templateKey, to: { kind: 'field', column: 'guest_id.email' }, vars });
    const step = (inputs: Record<string, string>, key = 'add-guest', addOn = 'welcome-kit') => ({ kind: 'add-on.step', addOn, step: key, inputs });

    it('this page offers the tool, and its prompt no longer lists every template', () => {
      expect(automationContext.toolNames).toEqual(expect.arrayContaining(['rule_parts', 'list_add_ons', 'describe_schema']));
      expect(setup.system).toContain('`rule_parts` lists them for a table');
      expect(setup.system).not.toContain('p64-thanks');
    });

    it('with a rule open in the builder, the model is told which, and how a change to it differs from a new rule', async () => {
      const owner = (await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!;
      const rule = await automationsRepo(s.meta).create({ connectionId: s.connectionId, name: 'Thank the guest', enabled: true, trigger: trigger(), graph: graphOf(mail('p64-plain')) }, Date.now());
      const open = await turnAs(s, owner.id, 'automation', { documentId: rule.id });
      expect(open.system).toContain(`The rule open in the builder right now is "Thank the guest" (id ${rule.id})`);
      expect(open.system).toContain(`"basedOn": "${rule.id}"`);
      expect(open.system).toContain('nothing is saved until the person saves');
      expect(open.system).toContain('Never "doc.save" with a change');
      // With none open, or one that is not there, nothing is said of it.
      expect(setup.system).not.toContain('The rule open in the builder');
      expect((await turnAs(s, owner.id, 'automation', { documentId: 'auto_gone' })).system).not.toContain('The rule open in the builder');
      await automationsRepo(s.meta).remove(rule.id);
    });

    it('rule_parts names the address columns one link away, the templates with what each must be given, and the steps add-ons give', async () => {
      installed = kit();
      const { result } = await parts();
      expect(result).toMatchObject({ table: s.table.stays, events: ['created', 'updated', 'deleted'], addressColumns: ['guest_id.email'] });
      const templates = result!['templates'] as { key: string; reads: string[]; mustFill: string[] }[];
      // `note` is a column of the stay, `city` says its own backup, the guest's name is one link away: only the first name is the step's to fill.
      expect(templates.find((one) => one.key === 'p64-thanks')).toMatchObject({ name: 'Thank you for staying', reads: ['first_name', 'note', 'city', 'record.guest_id.name'], mustFill: ['first_name'] });
      expect(templates.find((one) => one.key === 'p64-plain')).toMatchObject({ mustFill: [] });
      expect(result!['steps']).toEqual([
        {
          addOn: 'welcome-kit',
          addOnName: 'Welcome kit',
          step: 'add-guest',
          name: 'Add a guest',
          does: 'Adds a person to the guest list',
          youMayUseIt: true,
          inputs: [
            // The guests' address is a personal column of the add-on's table: only that input may be given a personal column.
            { key: 'to', label: 'Send to', kind: 'email', required: true, mayReadPersonalColumns: true },
            { key: 'name', label: 'Name', kind: 'text', required: true },
            { key: 'tier', label: 'Tier', kind: 'choice', required: false, oneOf: ['gold', 'plain'] },
          ],
        },
      ]);
      // Who a notification can go to, by id.
      expect((result!['roles'] as { id: string; name: string }[]).length).toBeGreaterThan(0);
      // Narrowed by a word; a word nothing matches says so.
      expect(((await parts({ find: 'thank' })).result!['templates'] as unknown[]).length).toBe(1);
      const none = (await parts({ find: 'refund' })).result!;
      expect(none['templates']).toEqual([]);
      expect((none['notes'] as string[]).join(' ')).toContain('No live template matches those words.');
    });

    it('rule_parts with no add-on installed lists no step and says what to do then; a table that is not there is said so', async () => {
      installed = null;
      const { result } = await parts();
      expect(result!['steps']).toEqual([]);
      expect((result!['notes'] as string[]).join(' ')).toContain('No installed add-on gives a step.');
      expect((await parts({ table: 'main.no_such' })).error).toMatchObject({ code: 'TABLE_NOT_FOUND' });
      expect((await parts({ table: '' })).error).toMatchObject({ code: 'BAD_ARGS' });
    });

    it('a draft may not name a step that is not there: told which there are, or that there are none', async () => {
      installed = kit();
      const wrong = await accept(step({ to: 'a@b.example' }, 'send-coupon', 'offers'));
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) {
        expect(wrong.errors[0]).toMatchObject({ code: 'STEP_NOT_AVAILABLE', path: 'graph.nodes[n2].action' });
        expect(wrong.errors[0]!.message).toBe('No add-on with the key "offers" is installed. The steps there are: welcome-kit/add-guest. Use one of them, or take this step out and say so in "leftOut".');
      }
      const gone = await accept(step({ to: 'a@b.example', name: 'x' }, 'remove-guest'));
      expect(!gone.ok && gone.errors[0]!.message).toContain('The add-on Welcome kit no longer has the step “remove-guest”.');
      installed = null;
      const none = await accept(step({ to: 'a@b.example', name: 'x' }));
      expect(!none.ok && none.errors[0]!.message).toBe('No add-on with the key "welcome-kit" is installed. No installed add-on gives a step here: take this step out, and say in "leftOut" what it would have done.');
    });

    it('a draft fills every input a step needs; one that does is accepted, named with its add-on, and saved switched off', async () => {
      installed = kit();
      const half = await accept(step({ to: '{{record.guest_id.email}}' }));
      expect(half.ok).toBe(false);
      if (!half.ok) expect(half.errors[0]).toMatchObject({ code: 'STEP_INPUT_MISSING', message: '"Add a guest" needs "name" (Name, text). Give each a text, or a column of the record as {{record.<column>}}.' });
      const whole = await accept(step({ to: '{{record.guest_id.email}}', name: '{{record.guest_name}}', tier: 'gold' }));
      expect(whole.ok, JSON.stringify(whole)).toBe(true);
      if (whole.ok) {
        expect(whole.artefact).toMatchObject({ enabled: false, incompleteNodeId: null });
        expect((whole.artefact['graph'] as { nodes: { action?: Record<string, unknown> }[] }).nodes[1]!.action).toMatchObject({ kind: 'add-on.step', addOn: 'welcome-kit', step: 'add-guest', addOnName: 'Welcome kit' });
      }
      // What the step does not take is the save's own refusal, handed back.
      const odd = await accept(step({ to: 'a@b.example', name: 'x', tier: 'silver' }));
      expect(!odd.ok && odd.errors[0]).toMatchObject({ code: 'RULE_INVALID' });
    });

    it('the card\'s own Save holds a draft with an add-on\'s step to the same installed steps as the draft\'s check did', async () => {
      installed = kit();
      const owner = (await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!;
      // The guest's address is a personal column: only the step's own personal input may be given it.
      const checked = await accept(step({ to: '{{record.guest_id.email}}', name: '{{record.guest_name}}' }));
      expect(checked.ok, JSON.stringify(checked)).toBe(true);
      if (!checked.ok) return;
      const save = (installs: (() => Promise<AddOnInstalls>) | undefined) =>
        runAssistantAction({ meta: s.meta, action: 'save', context: 'automation', artefact: checked.artefact, sessionId: 'ast_test', turnId: 'atn_test', actor: { kind: 'user', id: owner.id, label: 'Owner' } as never, can: setup.deps.can, ...(installs === undefined ? {} : { installs }) });
      const saved = await save(async () => installed as AddOnInstalls);
      expect(saved.created).toMatchObject({ kind: 'rule' });
      const rule = await automationsRepo(s.meta).findById(saved.created!.id);
      expect(rule).toMatchObject({ enabled: false });
      expect(JSON.stringify(rule!.graph)).toContain('"add-on.step"');
      await automationsRepo(s.meta).remove(saved.created!.id);
      // A save that cannot ask what is installed refuses the address rather than read it for an input it cannot judge.
      await expect(save(undefined)).rejects.toThrow('guest_id.email is a protected column and cannot be a placeholder.');
    });

    it('a rule with no step is no draft: the assistant is told to answer in words instead', async () => {
      const empty = await automationContext.document!.acceptArtefact({ name: 'Nothing', trigger: trigger(), graph: { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'A stay changes' }] } } as never, setup.deps);
      expect(empty.ok).toBe(false);
      if (!empty.ok) expect(empty.errors[0]).toMatchObject({ code: 'RULE_DOES_NOTHING', path: 'graph.nodes' });
    });

    it('a draft fills every placeholder its template needs, or is sent back with which and how', async () => {
      const bare = await accept(mail('p64-thanks'));
      expect(bare.ok).toBe(false);
      if (!bare.ok) {
        expect(bare.errors[0]).toMatchObject({ code: 'PLACEHOLDER_UNFILLED', path: 'graph.nodes[n2].action.vars' });
        // The guest's name is a linked row's column, and so is filled by the record; only the first name is not.
        expect(bare.errors[0]!.message).toContain('The template "p64-thanks" reads {{first_name}}, which nothing fills here.');
        expect(bare.errors[0]!.message).toContain('"vars": { "first_name": "{{record.<a column that holds it>}}" }');
      }
      expect((await accept(mail('p64-thanks', { first_name: '{{record.guest_name}}' }))).ok).toBe(true);
      // A template that reads only the record needs nothing.
      expect((await accept(mail('p64-plain'))).ok).toBe(true);
    });
  });
}
