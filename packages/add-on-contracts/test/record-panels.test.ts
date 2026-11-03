// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record panel's shape, and what an add-on's own manifest can check of it:
 * its table its own, its id under its key and apart from its pages, its code
 * a file of its own.
 */
import { describe, expect, it } from 'vitest';

import { addOnBlockSchema, recordPanelIssues, recordPanelsSchema, slotDefinition, type RecordPanel } from '../src/index.js';

const PANEL: RecordPanel = { id: 'design-kit-editor', on: 'designs', client: 'dist/panel.js', title: { key: 'design-kit.panel.title', fallback: 'Design' } };
const issues = (panels: RecordPanel[], more: { pages?: { ref: string; client: string }[]; slots?: { client: string }[] } = {}) =>
  recordPanelIssues({ key: 'design-kit', panels, tables: [{ ref: 'designs' }], pages: more.pages ?? [], slots: more.slots ?? [] }).map((issue) => issue.message);

describe('a record panel', () => {
  it('is declared beside the add-on\'s pages, and two may not share an id', () => {
    expect(addOnBlockSchema.safeParse({ attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, panels: [PANEL] }).success).toBe(true);
    expect(recordPanelsSchema.safeParse([PANEL, PANEL]).success).toBe(false);
    expect(recordPanelsSchema.safeParse([{ ...PANEL, writes: 'host' }]).success).toBe(false);
  });

  it('stands on one of the add-on\'s own tables, under its key, in a file of its own', () => {
    expect(issues([PANEL])).toEqual([]);
    expect(issues([{ ...PANEL, on: 'orders' }])).toEqual(['"orders" is not one of this add-on\'s own tables']);
    expect(issues([{ ...PANEL, id: 'editor' }])).toEqual(['a panel of "design-kit" is addressed under its key: name it "design-kit-…", not "editor"']);
    expect(issues([PANEL], { pages: [{ ref: 'design-kit-editor', client: 'dist/page.js' }] })).toEqual(['"design-kit-editor" is one of this add-on\'s pages: a panel\'s id is its own']);
    expect(issues([PANEL], { slots: [{ client: 'dist/panel.js' }] })).toEqual(['"dist/panel.js" is a page\'s or a slot fill\'s file: a panel\'s code is a file of its own']);
  });

  it('is what the record editor slot now points at: it writes only the add-on\'s own tables', () => {
    const slot = slotDefinition('record.editor.panel');
    expect(slot.payload).toContain('it writes only those');
    expect(slot.payload).not.toContain('write handles');
    expect(slot.renders).toContain('addOn.panels');
  });
});
