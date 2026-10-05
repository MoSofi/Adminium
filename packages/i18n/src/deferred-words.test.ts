// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words en-US delivers later. Two namespaces ship in two parts: `ui`
 * without its widget and template groups, `common` without four screens'
 * groups. The part that comes later is merged in on demand, under whatever
 * an owner reworded, and the whole catalogue (the keys list, the
 * Translations editor, parity) still holds every key.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DEFERRED_GROUP_COUNTS } from './resources/deferred-counts.js';
import { EN_US_EAGER, EN_US_RESOURCES } from './resources/index.js';
import { COMMON_DEFERRED_GROUPS, DEFERRED_GROUPS, UI_DEFERRED_GROUPS, type ResourceBundle } from './resources/namespaces.js';

const leaves = (node: unknown): number => (typeof node === 'string' ? 1 : Object.values(node as object).reduce((sum: number, child) => sum + leaves(child), 0));

describe('the groups en-US delivers later', () => {
  it('are the same list in the generator and at run time', () => {
    const script = readFileSync(join(import.meta.dirname, '..', 'scripts', 'gen-resources.mjs'), 'utf8');
    const listed = (name: string): string[] => JSON.parse((new RegExp(`const ${name} = (\\[[^\\]]*\\]);`).exec(script)?.[1] ?? '[]').replaceAll("'", '"')) as string[];
    expect(listed('UI_DEFERRED_GROUPS')).toEqual([...UI_DEFERRED_GROUPS]);
    expect(listed('COMMON_DEFERRED_GROUPS')).toEqual([...COMMON_DEFERRED_GROUPS]);
    expect([...COMMON_DEFERRED_GROUPS]).toEqual(['builder', 'kb', 'about', 'team']);
    expect(Object.keys(DEFERRED_GROUPS).sort()).toEqual(['common', 'ui']);
  });

  it.each(['ui', 'common'] as const)('en-US `%s` ships without them, and the full catalogue has them', (ns) => {
    const eager = EN_US_EAGER[ns] as ResourceBundle;
    const whole = EN_US_RESOURCES[ns];
    for (const group of DEFERRED_GROUPS[ns]) {
      expect(eager[group], `${ns}.${group} in the eager bundle`).toBeUndefined();
      expect(typeof whole[group], `${ns}.${group} in the catalogue`).toBe('object');
      // The count the runtime tells a whole group by is the group's own.
      expect((DEFERRED_GROUP_COUNTS[ns] as Record<string, number>)[group], `${ns}.${group}`).toBe(leaves(whole[group]));
    }
    // Nothing else left the eager bundle.
    expect(Object.keys(whole).sort()).toEqual([...Object.keys(eager), ...DEFERRED_GROUPS[ns]].sort());
  });
});

describe('a new en-US instance', () => {
  it('has neither part, takes each when asked, and the next instance starts with both', async () => {
    vi.resetModules();
    const { createI18n, hasWords, wordsReady } = await import('./index.js');
    const i18n = await createI18n({ locale: 'en_US' });
    expect(i18n.t('common:common.dismiss')).toBe('Dismiss');
    expect(hasWords(i18n, 'common')).toBe(false);
    expect(hasWords(i18n, 'ui')).toBe(false);
    // Before its words are in, a key of a deferred group reads as its call site's own text.
    expect(i18n.t('common:about.title', { defaultValue: 'inline' })).toBe('inline');

    await wordsReady(i18n, 'common');
    expect(hasWords(i18n, 'common')).toBe(true);
    expect(hasWords(i18n, 'ui')).toBe(false);
    expect(i18n.t('common:about.title', { defaultValue: 'inline' })).toBe((EN_US_RESOURCES.common['about'] as ResourceBundle)['title']);
    for (const group of COMMON_DEFERRED_GROUPS) expect(leaves(i18n.getResource('en-US', 'common', group))).toBe(DEFERRED_GROUP_COUNTS.common[group]);
    // What was eager is as it was.
    expect(i18n.t('common:common.dismiss')).toBe('Dismiss');

    const next = await createI18n({ locale: 'en_US' });
    expect(hasWords(next, 'common')).toBe(true);
    expect(hasWords(next, 'ui')).toBe(false);
    await wordsReady(next, 'ui');
    expect(hasWords(next, 'ui')).toBe(true);
  });

  it('keeps an owner\'s rewording of a deferred key, and still takes the rest of its group', async () => {
    vi.resetModules();
    const { createI18n, hasWords, wordsReady } = await import('./index.js');
    const i18n = await createI18n({ locale: 'en_US' });
    // Applied at boot, before the words were read (the dashboard's override refresh).
    i18n.addResources('en-US', 'common', { 'about.title': 'About this desk', 'kb.title': 'Help', 'builder.view': 'Look', 'team.counts': 'People' });
    i18n.addResources('en-US', 'ui', { 'widgets.tables.miniTable.viewAllLabel': 'Everything', 'templates.pageCrud.title': 'Records' });
    // A reworded key started each group; it is not the group.
    expect(hasWords(i18n, 'common')).toBe(false);
    expect(hasWords(i18n, 'ui')).toBe(false);
    await Promise.all([wordsReady(i18n, 'common'), wordsReady(i18n, 'ui')]);
    expect(i18n.t('common:about.title')).toBe('About this desk');
    expect(i18n.t('ui:widgets.tables.miniTable.viewAllLabel')).toBe('Everything');
    const about = EN_US_RESOURCES.common['about'] as ResourceBundle;
    const other = Object.keys(about).find((key) => key !== 'title' && typeof about[key] === 'string') as string;
    expect(i18n.t(`common:about.${other}`, { defaultValue: 'inline' })).toBe(about[other]);
    expect(i18n.t('ui:widgets.tables.capacityLeft.takenOnly', { taken: 3 })).toBe('3 taken');
    expect(hasWords(i18n, 'common')).toBe(true);
  });

  it('never rewrites the catalogue\'s own text when an owner rewords a key after the words are in', async () => {
    vi.resetModules();
    const { createI18n, wordsReady } = await import('./index.js');
    const first = await createI18n({ locale: 'en_US' });
    await wordsReady(first, 'common');
    first.addResources('en-US', 'common', { 'about.title': 'Reworded' });
    const second = await createI18n({ locale: 'en_US' });
    expect(second.t('common:about.title')).toBe((EN_US_RESOURCES.common['about'] as ResourceBundle)['title']);
  });

  it('a stand-in with no store of its own has nothing to wait for', async () => {
    const { hasWords, wordsReady } = await import('./index.js');
    const stand = {} as never;
    expect(hasWords(stand, 'common')).toBe(true);
    await expect(wordsReady(stand, 'common')).resolves.toBeUndefined();
  });
});
