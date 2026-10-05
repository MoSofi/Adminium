// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { layoutItemSchema, pageLayoutSchema } from '../src/page-config/index.js';

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    i: 'w_01HZY0000000000000000000',
    widget: 'kpi-stat-card',
    x: 0,
    y: 0,
    w: 3,
    h: 3,
    config: { title: 'MRR' },
    ...overrides,
  };
}

describe('layoutItemSchema', () => {
  it('accepts a valid grid item', () => {
    const parsed = layoutItemSchema.parse(item());
    expect(parsed.widget).toBe('kpi-stat-card');
    expect(parsed.config).toEqual({ title: 'MRR' });
  });

  it('accepts boundary coordinates (x=11, w=12, h=24, y large)', () => {
    expect(layoutItemSchema.safeParse(item({ x: 11, w: 1 })).success).toBe(true);
    expect(layoutItemSchema.safeParse(item({ w: 12, x: 0 })).success).toBe(true);
    expect(layoutItemSchema.safeParse(item({ h: 24 })).success).toBe(true);
    expect(layoutItemSchema.safeParse(item({ y: 999 })).success).toBe(true);
  });

  it.each([
    ['x above 11', { x: 12 }],
    ['negative x', { x: -1 }],
    ['negative y', { y: -1 }],
    ['w below 1', { w: 0 }],
    ['w above 12', { w: 13 }],
    ['h below 1', { h: 0 }],
    ['h above 24', { h: 25 }],
    ['non-integer x', { x: 1.5 }],
    ['non-integer h', { h: 2.5 }],
    ['missing config', { config: undefined }],
    ['non-record config', { config: 'nope' }],
  ])('rejects %s', (_label, overrides) => {
    expect(layoutItemSchema.safeParse(item(overrides)).success).toBe(false);
  });
});

describe('pageLayoutSchema', () => {
  it('accepts version 1 with items', () => {
    const parsed = pageLayoutSchema.parse({ version: 1, items: [item(), item({ i: 'w_2', x: 3 })] });
    expect(parsed.items).toHaveLength(2);
  });

  it('accepts an empty items array', () => {
    expect(pageLayoutSchema.safeParse({ version: 1, items: [] }).success).toBe(true);
  });

  it('rejects any version other than the literal 1', () => {
    expect(pageLayoutSchema.safeParse({ version: 2, items: [] }).success).toBe(false);
    expect(pageLayoutSchema.safeParse({ version: '1', items: [] }).success).toBe(false);
  });

  it('caps items at 60', () => {
    const sixty = Array.from({ length: 60 }, (_, n) => item({ i: `w_${n}` }));
    expect(pageLayoutSchema.safeParse({ version: 1, items: sixty }).success).toBe(true);
    const sixtyOne = [...sixty, item({ i: 'w_61' })];
    expect(pageLayoutSchema.safeParse({ version: 1, items: sixtyOne }).success).toBe(false);
  });

  it('rejects an invalid nested item', () => {
    const result = pageLayoutSchema.safeParse({ version: 1, items: [item({ x: 42 })] });
    expect(result.success).toBe(false);
  });
});

describe('a page toolbar\'s links', () => {
  const link = { label: 'Receive', href: '/p/receipts', icon: 'package-plus' };
  const toolbar = (value: unknown) => pageLayoutSchema.safeParse({ version: 1, items: [], toolbar: value });

  it('takes one link or two, with the wider icon list and one primary', () => {
    const parsed = toolbar({ links: [{ ...link, tone: 'primary' }, { label: 'Count', labels: { 'de-DE': 'Zählen' }, href: '/p/counts', icon: 'clipboard-check' }] });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.toolbar?.links).toEqual([{ ...link, tone: 'primary' }, { label: 'Count', labels: { 'de-DE': 'Zählen' }, href: '/p/counts', icon: 'clipboard-check' }]);
    expect(toolbar({ links: [link] }).success).toBe(true);
  });

  it('refuses none, three, two primaries, an unknown key or icon, and a link beside links', () => {
    expect(toolbar({ links: [] }).success).toBe(false);
    expect(toolbar({ links: [link, link, link] }).success).toBe(false);
    expect(toolbar({ links: [{ ...link, tone: 'primary' }, { ...link, tone: 'primary' }] }).success).toBe(false);
    expect(toolbar({ links: [{ ...link, colour: 'red' }] }).success).toBe(false);
    expect(toolbar({ links: [{ ...link, icon: 'rocket' }] }).success).toBe(false);
    expect(toolbar({ links: [{ ...link, tone: 'danger' }] }).success).toBe(false);
    expect(toolbar({ link: { label: 'Receive', href: '/p/receipts' }, links: [link] }).success).toBe(false);
  });

  it('the one link a toolbar always took still parses, with its three icons', () => {
    expect(toolbar({ link: { label: 'Receive', href: '/p/receipts', icon: 'clipboard-list' } }).success).toBe(true);
    expect(toolbar({ link: { label: 'Receive', href: '/p/receipts', icon: 'gift' } }).success).toBe(false);
  });
});
