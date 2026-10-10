// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  blocksShownFor,
  fillPlaceholders,
  placeholderNames,
  placeholdersIn,
  requiredNamesOfEmail,
  requiredPlaceholderNames,
  showWhenNames,
  showWhenOf,
  writePlaceholder,
} from '../src/placeholders.js';

describe('a placeholder, and its backup', () => {
  it('reads the name, and the words after a bar', () => {
    expect(placeholdersIn('Thanks, {{first_name|there}}! {{ order.total }} {{ city | your town }} {{gone|}}')).toMatchObject([
      { name: 'first_name', backup: 'there', whole: '{{first_name|there}}' },
      { name: 'order.total', backup: undefined },
      { name: 'city', backup: 'your town' },
      { name: 'gone', backup: '' },
    ]);
  });

  it('writes the value; the backup when the value is not there or is empty', () => {
    const text = 'Thanks, {{first_name|there}}!';
    expect(fillPlaceholders(text, { first_name: 'Lena' })).toBe('Thanks, Lena!');
    expect(fillPlaceholders(text, { first_name: '' })).toBe('Thanks, there!');
    expect(fillPlaceholders(text, { first_name: '   ' })).toBe('Thanks, there!');
    expect(fillPlaceholders(text, {})).toBe('Thanks, there!');
    expect(fillPlaceholders('Hello{{title|}}.', {})).toBe('Hello.');
  });

  it('with no bar reads as it always did: an empty value writes nothing, an unknown name is left as written', () => {
    expect(fillPlaceholders('a {{x}} b {{y}} c', { x: '' })).toBe('a  b {{y}} c');
    expect(fillPlaceholders('{{ x }}', { x: '1' })).toBe('1');
  });

  it('escapes each piece once: the text, the value and the backup', () => {
    const escape = (piece: string) => piece.replaceAll('<', '&lt;');
    expect(fillPlaceholders('<b>{{a|<i>}} {{b}}', { b: '<u>' }, escape)).toBe('&lt;b>&lt;i> &lt;u>');
  });

  it('is not a placeholder with braces in the backup, a bar in the name, or nothing named', () => {
    expect(placeholdersIn('{{a|{{b}}}} {{|x}} {{a b|c}}').map((one) => one.name)).toEqual(['b']);
    expect(fillPlaceholders('{{x|a|b}}', {})).toBe('a|b');
  });

  it('names every placeholder a value reads, and apart from them the ones that must be given', () => {
    const doc = { subject: 'For {{name|you}}', blocks: [{ data: { text: '{{name}} {{city|}}', rows: [{ a: '{{total}}' }] } }] };
    expect(placeholderNames(doc)).toEqual(['name', 'city', 'total']);
    expect(requiredPlaceholderNames(doc)).toEqual(['name', 'total']);
    expect(requiredPlaceholderNames('{{name|you}} {{city|}}')).toEqual([]);
  });

  it('writes one back, and a backup loses the braces it cannot hold', () => {
    expect(writePlaceholder('first_name')).toBe('{{first_name}}');
    expect(writePlaceholder('first_name', ' there ')).toBe('{{first_name|there}}');
    expect(writePlaceholder('first_name', 'a}}b')).toBe('{{first_name|ab}}');
    expect(placeholdersIn(writePlaceholder('n', ''))[0]).toMatchObject({ name: 'n', backup: '' });
  });
});

describe('a block tied to a value', () => {
  const blocks = [
    { block: 'email.text', id: 'a', showWhen: { var: 'first_name' }, otherwise: 'Thanks for ordering!', data: { paras: ['Thanks, {{first_name}}!'] } },
    { block: 'email.button', id: 'b', showWhen: { var: 'track_url' }, otherwise: 'never shown', data: { label: 'Track', url: '{{track_url}}' } },
    { block: 'email.text', id: 'c', data: { text: 'Always.' } },
    { block: 'email.heading', id: 'd', showWhen: { var: 'city' }, data: { text: 'In {{city}}' } },
  ];

  it('is shown as written when the value is there', () => {
    expect(blocksShownFor(blocks, { first_name: 'Lena', track_url: 'https://x.example', city: 'Kyiv' })).toEqual(blocks);
  });

  it('is left out when it is not, or says its other words in its own place when it is a text', () => {
    const shown = blocksShownFor(blocks, { first_name: ' ', city: '' });
    expect(shown.map((block) => block.id)).toEqual(['a', 'c']);
    expect(shown[0]).toMatchObject({ block: 'email.text', data: { text: 'Thanks for ordering!' } });
    expect((shown[0] as { data: Record<string, unknown> }).data['paras']).toBeUndefined();
  });

  it('an email must be given the names with no backup, but not one read only inside the block tied to it', () => {
    expect(requiredNamesOfEmail({ subject: 'For {{first_name|you}} {{order_no}}', blocks, footer: '{{shop}}' })).toEqual(['order_no', 'shop']);
    expect(requiredNamesOfEmail({ blocks: [{ block: 'email.text', showWhen: { var: 'a' }, data: { text: '{{a}} {{b}}' } }, { block: 'email.text', data: { text: '{{a|x}}' } }] })).toEqual(['b']);
    expect(requiredNamesOfEmail({ blocks: [{ block: 'email.text', showWhen: { var: 'a' }, data: { text: '{{a}}' } }, { block: 'email.text', data: { text: '{{a}}' } }] })).toEqual(['a']);
  });

  it('reads the condition only when it is one', () => {
    expect(showWhenOf({ showWhen: { var: 'a.b' } })).toEqual({ var: 'a.b' });
    expect(showWhenOf({ showWhen: { var: 'a b' } })).toBeNull();
    expect(showWhenOf({ showWhen: 'a' })).toBeNull();
    expect(showWhenOf(null)).toBeNull();
    expect(showWhenNames([...blocks, { showWhen: { var: 'city' } }])).toEqual(['first_name', 'track_url', 'city']);
  });
});
