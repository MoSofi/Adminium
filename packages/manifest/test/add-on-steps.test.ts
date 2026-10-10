// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A step an add-on gives to Automations: a named write of one row of one of
 * its own tables. The manifest says what a person fills in and which column
 * each answer goes to; what it cannot say is a table that is not its own, a
 * column Adminium decides, an input nobody reads, or a row that could never
 * be saved. A rule that uses a step, and the two words, need their floor.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, installsLikeAnApp, validateManifest } from '../src/index.js';
import { KIT } from './add-on-kit-fixture.js';

type Doc = Record<string, unknown>;
const LOCALES = ['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW'];
const words = (text: string): Doc => Object.fromEntries(LOCALES.map((locale) => [locale, text]));

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

const input = (key: string, kind = 'text', more: Doc = {}): Doc => ({ key, label: words(key), kind, ...more });
const step = (over: Doc = {}): Doc => ({
  key: 'add-item',
  name: words('Add an item'),
  does: words('Adds an item to the stock list'),
  inputs: [input('name', 'text', { required: true }), input('sku')],
  writes: { table: 'items', values: { name: { input: 'name' }, sku: { input: 'sku' } } },
  ...over,
});
const kit = (steps: Doc[], floor = '0.3.22', more: Doc = {}): Doc => {
  const base = structuredClone(KIT) as unknown as Doc & { addOn: Doc };
  return { ...base, compatibility: { minAdminiumVersion: floor }, addOn: { ...base.addOn, steps }, ...more };
};

describe('a step an add-on gives to Automations', () => {
  it('is a named write of one row of the add-on\'s own: it validates, and the add-on installs like an app', () => {
    const doc = kit([step()]);
    expect(issuesOf(doc)).toEqual([]);
    const result = validateManifest(doc);
    expect(result.ok && installsLikeAnApp(result.manifest)).toBe(true);
    expect(installFloorWords(doc).map((word) => word.word)).toContain('addOn.steps');
  });

  it('takes a fixed text, one of the run\'s own words, a choice and a row of another of its tables', () => {
    const doc = kit([
      step({
        inputs: [input('name', 'text', { required: true }), input('size', 'choice', { options: [{ value: 's', label: words('Small') }, { value: 'l', label: words('Large') }] }), input('like', 'record', { table: 'items' })],
        writes: { table: 'items', values: { name: { input: 'name' }, sku: { text: 'NEW' }, on_hand: { input: 'size' }, note: { input: 'like' }, made_at: { token: 'now' } } },
      }),
    ]) as Doc & { requiredSchema: { tables: { columns: Doc[] }[] } };
    doc.requiredSchema.tables[0]!.columns.push({ ref: 'note', type: 'text', maxLength: 40, nullable: true }, { ref: 'made_at', type: 'timestamptz', nullable: true });
    expect(issuesOf(doc)).toEqual([]);
  });

  it('needs its floor, like every word a newer Adminium reads', () => {
    expect(issuesOf(kit([step()], '0.3.21')).join('\n')).toContain('"addOn.steps" is read by Adminium 0.3.22 and later');
  });

  it('writes only a table of its own, columns that are there, and none Adminium decides', () => {
    expect(issuesOf(kit([step({ writes: { table: 'orders', values: { name: { input: 'name' }, sku: { input: 'sku' } } } })])).join('\n')).toContain('"orders" is not one of this add-on\'s tables: a step writes a row of the add-on\'s own');
    expect(issuesOf(kit([step({ writes: { table: 'items', values: { name: { input: 'name' }, sku: { input: 'sku' }, colour: { text: 'red' } } } })])).join('\n')).toContain('"items" has no column "colour"');
    expect(issuesOf(kit([step({ writes: { table: 'items', values: { name: { input: 'name' }, sku: { input: 'sku' }, id: { text: '7' } } } })])).join('\n')).toContain('"items.id" is decided by Adminium (its key): a step cannot write it');
    const coded = kit([step({ writes: { table: 'items', values: { name: { input: 'name' }, sku: { input: 'sku' }, code: { text: 'X' } } } })]) as Doc & { requiredSchema: { tables: { columns: Doc[] }[] } };
    coded.requiredSchema.tables[0]!.columns.push({ ref: 'code', type: 'text', maxLength: 16, unique: true, rules: { code: { length: 12 } } });
    expect(issuesOf(coded).join('\n')).toContain('"items.code" is decided by Adminium (its code rule): a step cannot write it');
  });

  it('reads every input, and only its own', () => {
    expect(issuesOf(kit([step({ writes: { table: 'items', values: { name: { input: 'name' } } } })])).join('\n')).toContain('no value of the row reads the input "sku"');
    expect(issuesOf(kit([step({ writes: { table: 'items', values: { name: { input: 'title' }, sku: { input: 'sku' } } } })])).join('\n')).toContain('"title" is not one of this step\'s inputs');
    expect(issuesOf(kit([step({ inputs: [input('name', 'text', { required: true }), input('name')] })])).join('\n')).toContain('duplicate input key');
    expect(issuesOf(kit([step(), step()])).join('\n')).toContain('duplicate step key');
  });

  it('leaves no column unfilled that the row cannot be saved without', () => {
    // `name` holds a value and has no default: nothing fills it.
    expect(issuesOf(kit([step({ inputs: [input('sku')], writes: { table: 'items', values: { sku: { input: 'sku' } } } })])).join('\n')).toContain('"items.name" must hold a value and nothing fills it');
    // Filled, but from an input a person may skip.
    expect(issuesOf(kit([step({ inputs: [input('name'), input('sku')] })])).join('\n')).toContain('"items.name" must hold a value: mark the input "name" as required');
  });

  it('says its shape: a choice lists options, a record names a table, a fixed text holds no braces, every language is there', () => {
    expect(issuesOf(kit([step({ inputs: [input('name', 'choice', { required: true }), input('sku')] })])).join('\n')).toContain('a choice input lists its options, and only a choice does');
    expect(issuesOf(kit([step({ inputs: [input('name', 'text', { required: true, table: 'items' }), input('sku')] })])).join('\n')).toContain('a record input names its table, and only a record does');
    expect(issuesOf(kit([step({ writes: { table: 'items', values: { name: { input: 'name' }, sku: { text: '{{record.secret}}' } } }, inputs: [input('name', 'text', { required: true })] })])).join('\n')).toContain('a fixed text holds no braces');
    const { 'zh-TW': _gone, ...seven } = words('Add an item');
    expect(issuesOf(kit([step({ name: seven })])).length).toBeGreaterThan(0);
    expect(issuesOf(kit([step({ inputs: [input('name', 'text', { required: true }), input('sku', 'record', { table: 'orders' })] })])).join('\n')).toContain('"orders" is not one of this add-on\'s tables');
  });
});

describe('a rule that uses a step', () => {
  const rule = (action: Doc): Doc => ({
    key: 'on-new-item',
    name: 'When an item is added',
    enabled: false,
    trigger: { kind: 'record', table: 'items', event: 'created' },
    graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'An item is added' }, { id: 'a', kind: 'action', title: 'Add its twin', action }] },
  });
  const withRule = (action: Doc, floor = '0.3.22'): Doc => kit([step()], floor, { automations: [rule(action)] });

  it('names the add-on, the step and what fills each input; the add-on\'s own is checked whole', () => {
    expect(issuesOf(withRule({ kind: 'add-on.step', addOn: 'kit', step: 'add-item', inputs: { name: 'Twin of {{record.name}}', sku: '{{record.sku|none}}' } }))).toEqual([]);
    expect(installFloorWords(withRule({ kind: 'add-on.step', addOn: 'kit', step: 'add-item', inputs: { name: 'x' } })).map((word) => word.word)).toEqual(expect.arrayContaining(['automations.addOnStep', 'addOn.steps']));
    expect(issuesOf(withRule({ kind: 'add-on.step', addOn: 'kit', step: 'remove-item', inputs: {} })).join('\n')).toContain('"remove-item" is not one of this add-on\'s steps');
    expect(issuesOf(withRule({ kind: 'add-on.step', addOn: 'kit', step: 'add-item', inputs: { name: 'x', colour: 'red' } })).join('\n')).toContain('the step "add-item" has no input "colour"');
    expect(issuesOf(withRule({ kind: 'add-on.step', addOn: 'kit', step: 'add-item', inputs: { sku: 'x' } })).join('\n')).toContain('the step "add-item" needs its input "name"');
    expect(issuesOf(withRule({ kind: 'add-on.step', addOn: 'kit', step: 'add-item', inputs: { name: '{{record.colour}}' } })).join('\n')).toContain('"items" has no column "colour"');
  });

  it('another add-on\'s step is left to where the rule is installed', () => {
    expect(issuesOf(withRule({ kind: 'add-on.step', addOn: 'offers', step: 'issue-voucher', inputs: { to: '{{record.name}}' } }))).toEqual([]);
  });

  it('a backup word and a block tied to a value are words with a floor too', () => {
    const doc = withRule({ kind: 'add-on.step', addOn: 'kit', step: 'add-item', inputs: { name: '{{record.sku|none}}' } });
    expect(installFloorWords(doc).map((word) => word.word)).toContain('placeholder.backup');
    expect(issuesOf({ ...doc, compatibility: { minAdminiumVersion: '0.3.21' } }).join('\n')).toContain('"placeholder.backup" is read by Adminium 0.3.22 and later');
    const mail = { kind: 'app', emailTemplates: [{ key: 'thanks', locales: { 'en-US': { subject: 'Hi {{name|there}}', blocks: [{ block: 'email.text', showWhen: { var: 'name' }, data: { text: 'x' } }] } } }] };
    expect(installFloorWords(mail)).toEqual([
      { word: 'email.showWhen', path: 'emailTemplates.0.locales.en-US.blocks.0.showWhen' },
      { word: 'placeholder.backup', path: 'emailTemplates.0' },
    ]);
    const plain = withRule({ kind: 'add-on.step', addOn: 'kit', step: 'add-item', inputs: { name: '{{record.sku}}' } });
    expect(installFloorWords(plain).map((word) => word.word)).not.toContain('placeholder.backup');
  });
});
