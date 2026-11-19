// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Fill in the company" in the builder: offered only on a companies table of
 * a database where a lead source add-on with a free register is installed;
 * ready once it names an add-on and at least one register.
 */
import { describe, expect, it } from 'vitest';

import type { Sources } from '../api.js';
import { companyFillSourceOf, companyFillTiles } from './companyFill.js';
import type { ActionNode } from './graph.js';
import { subLineFor } from './summaries.js';
import { isActionComplete } from './validate.js';
import { iconForNode } from './vocabulary.js';

const sources = {
  connections: [
    {
      id: 'conn_1',
      name: 'CRM',
      dialect: 'sqlite',
      timezone: 'UTC',
      tables: [],
      companyFill: [{ addOn: 'company-finder', addOnName: 'Company finder', registers: ['companies-house', 'france'], tables: ['main.crm_companies'] }],
    },
  ],
  templates: [],
} as unknown as Sources;

describe('fill in the company', () => {
  it('is offered on a companies table only, with the first free register ticked', () => {
    expect(companyFillTiles(sources, 'conn_1', 'main.crm_contacts')).toEqual([]);
    expect(companyFillTiles(sources, 'conn_2', 'main.crm_companies')).toEqual([]);
    const [tile] = companyFillTiles(sources, 'conn_1', 'main.crm_companies');
    expect(tile?.action).toEqual({ kind: 'company.fill', addOn: 'company-finder', sources: ['companies-house'], addOnName: 'Company finder' });
    expect(tile?.addOnName).toBe('Company finder');
  });

  it('is ready with an add-on and a register; says which registers it asks; reads its add-on as installed now', () => {
    const node: ActionNode = { id: 'fill', kind: 'action', title: 'Fill in the company', sub: null, onError: false, action: { kind: 'company.fill', addOn: 'company-finder', sources: [] } };
    expect(isActionComplete(node.action)).toBe(false);
    const ready: ActionNode = { ...node, action: { kind: 'company.fill', addOn: 'company-finder', sources: ['france'] } };
    expect(isActionComplete(ready.action)).toBe(true);
    expect(subLineFor(ready, null)).toBe('Empty details from france');
    expect(iconForNode('action', ready.action)).toBe('puzzle');
    expect(companyFillSourceOf(sources, 'conn_1', { kind: 'company.fill', addOn: 'gone', sources: [] })).toBeNull();
  });
});
