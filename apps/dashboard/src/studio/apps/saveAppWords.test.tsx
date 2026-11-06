// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Check list's words: a code the server sends is said in the person's
 * language from the item's parts, never in the server's English; a code this
 * dashboard does not know yet shows the server's own sentence.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { setI18nInstance, type I18nInstance } from '../../i18n/t.js';
import type { CheckItem } from './saveAppApi.js';
import { checkSentence } from './saveAppWords.js';

const instanceLeft: CheckItem = {
  group: 'info',
  code: 'INSTANCE_LEFT',
  kind: 'instance',
  item: 'common.nav.home (en-US)',
  field: 'wording',
  message: 'A saved app cannot carry this word as it is, so it stays out.',
};

const rowsFirst: CheckItem = {
  group: 'info',
  code: 'ROWS_FIRST',
  kind: 'rows',
  item: 'orders',
  message: '"orders" has 250 rows: its first 200 in key order travel as starting rows. Pick a saved view to choose others.',
};

function textOf(item: CheckItem): string {
  return render(<p>{checkSentence(item)}</p>).container.textContent ?? '';
}

/** A stand-in that answers from the German catalogue, interpolating `{name}`. */
function installGerman(): void {
  const studio = JSON.parse(readFileSync(join(process.cwd(), '../../packages/i18n/locales/de-DE/studio.json'), 'utf8')) as Record<string, unknown>;
  const lookup = (key: string): string | null => {
    let node: unknown = studio;
    for (const part of key.replace(/^studio:/, '').split('.')) node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
    return typeof node === 'string' ? node : null;
  };
  setI18nInstance({
    language: 'de-DE',
    t: (key: string, options?: Record<string, unknown>) => {
      const { defaultValue, ...args } = options ?? {};
      const message = lookup(key) ?? (typeof defaultValue === 'string' ? defaultValue : key);
      return message.replace(/\{(\w+)\}/g, (_, name: string) => String(args[name] ?? `{${name}}`));
    },
  } as unknown as I18nInstance);
}

afterEach(() => {
  setI18nInstance(null);
});

describe('checkSentence', () => {
  it('words a code by its parts, not the server’s sentence', () => {
    installTestI18n();
    const text = textOf(instanceLeft);
    expect(text).toContain('Look and words ‘common.nav.home (en-US)’');
    expect(text).toContain('A saved app cannot carry this as it is, so it stays out.');
    expect(text).not.toContain(instanceLeft.message);
  });

  it('says it in the person’s language', () => {
    installGerman();
    const text = textOf(instanceLeft);
    expect(text).toContain('Aussehen und Texte „common.nav.home (en-US)“');
    expect(text).toContain('Eine gespeicherte App kann das so nicht übernehmen');
    expect(text).not.toContain('stays out');
  });

  it('never says a number the item does not carry', () => {
    installTestI18n();
    const text = textOf(rowsFirst);
    expect(text).toBe('Only the first rows of orders travel. Pick a saved view to choose others.');
  });

  it('shows the server’s sentence for a code it does not know yet', () => {
    installTestI18n();
    const text = textOf({ group: 'info', code: 'SOMETHING_NEWER', kind: 'table', item: 'orders', field: 'total', message: 'A newer server says this.' });
    expect(text).toBe('Table ‘orders’ · total · A newer server says this.');
  });
});
