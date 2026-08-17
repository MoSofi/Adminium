// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `pageTemplateSchema` unit tests (04-widget-registry.md §10).
 *
 * The schema is the published contract marketplace manifests are written
 * against, so these tests pin the *shape* — notably the two defaults, which are
 * the only reason `PageTemplate` (output) differs from `PageTemplateInput`.
 */
import { describe, expect, it } from 'vitest';

import {
  InvalidPageTemplateError,
  pageTemplateSchema,
  parsePageTemplate,
  slotCapacity,
} from './template-schema.js';

const MINIMAL = {
  id: 'page-thing',
  version: 1,
  titleKey: 'templates.thing.title',
  slots: [{ slot: 'body', accepts: { shapes: ['record-list'] }, area: { x: 0, y: 0, w: 12, h: 8 } }],
};

describe('pageTemplateSchema', () => {
  it('applies the §10 defaults: required=false, fallback=omit', () => {
    const parsed = parsePageTemplate(MINIMAL);
    expect(parsed.slots[0]?.required).toBe(false);
    expect(parsed.slots[0]?.fallback).toBe('omit');
  });

  it('keeps explicit required/fallback values', () => {
    const parsed = parsePageTemplate({
      ...MINIMAL,
      slots: [{ ...MINIMAL.slots[0], required: true, fallback: 'empty-state' }],
    });
    expect(parsed.slots[0]?.required).toBe(true);
    expect(parsed.slots[0]?.fallback).toBe('empty-state');
  });

  it('enforces the page-<kebab> id pattern', () => {
    for (const id of ['dashboard', 'page_dashboard', 'page-Dashboard', 'page-dash1']) {
      expect(pageTemplateSchema.safeParse({ ...MINIMAL, id }).success).toBe(false);
    }
    expect(pageTemplateSchema.safeParse({ ...MINIMAL, id: 'page-master-detail' }).success).toBe(true);
  });

  it('accepts a slot matching by shape, by widget id, or by both', () => {
    const accepts = [
      { shapes: ['timeseries'] },
      { widgets: ['chart-donut'] },
      { shapes: ['record'], widgets: ['detail-key-value'] },
      {},
    ];
    for (const a of accepts) {
      expect(
        pageTemplateSchema.safeParse({
          ...MINIMAL,
          slots: [{ slot: 's', accepts: a, area: { x: 0, y: 0, w: 1, h: 1 } }],
        }).success,
      ).toBe(true);
    }
  });

  it('rejects an unknown data shape', () => {
    expect(
      pageTemplateSchema.safeParse({
        ...MINIMAL,
        slots: [{ slot: 's', accepts: { shapes: ['not-a-shape'] }, area: { x: 0, y: 0, w: 1, h: 1 } }],
      }).success,
    ).toBe(false);
  });

  it('rejects a non-integer version and an unknown fallback', () => {
    expect(pageTemplateSchema.safeParse({ ...MINIMAL, version: 1.5 }).success).toBe(false);
    expect(
      pageTemplateSchema.safeParse({
        ...MINIMAL,
        slots: [{ ...MINIMAL.slots[0], fallback: 'skeleton' }],
      }).success,
    ).toBe(false);
  });

  it('parses optional chrome', () => {
    const parsed = parsePageTemplate({
      ...MINIMAL,
      chrome: { toolbar: ['filter-chip-bar'], overlays: ['toast-stack'] },
    });
    expect(parsed.chrome).toEqual({ toolbar: ['filter-chip-bar'], overlays: ['toast-stack'] });
    expect(parsePageTemplate(MINIMAL).chrome).toBeUndefined();
  });

  it('throws InvalidPageTemplateError naming the template and the issue path', () => {
    let thrown: unknown;
    try {
      parsePageTemplate({ ...MINIMAL, slots: [{ slot: 'body', accepts: {} }] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidPageTemplateError);
    expect((thrown as InvalidPageTemplateError).templateId).toBe('page-thing');
    expect((thrown as InvalidPageTemplateError).message).toContain('slots.0.area');
  });
});

describe('slotCapacity', () => {
  it('is 1 without repeat and repeat.max with it', () => {
    const base = { slot: 's', accepts: {}, area: { x: 0, y: 0, w: 1, h: 1 } };
    expect(slotCapacity(parsePageTemplate({ ...MINIMAL, slots: [base] }).slots[0]!)).toBe(1);
    expect(
      slotCapacity(
        parsePageTemplate({ ...MINIMAL, slots: [{ ...base, repeat: { max: 4, flow: 'row' } }] })
          .slots[0]!,
      ),
    ).toBe(4);
  });
});
