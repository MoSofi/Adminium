// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ARCHITECTURE A PAGE IS SENT IS THE ONE THE SERVER DREW.
 *
 * The route's reply is cut to its schema: a field the document gains and the
 * schema does not name never reaches the page, and nothing fails. A table's
 * line to the add-on it posts into went missing that way once. A document
 * with every optional field set must come through whole.
 */
import { describe, expect, it } from 'vitest';

import type { ArchitectureDocument } from '../src/designer/architecture.js';
import { designerArchitectureReply } from '../src/routes/designer/schema.js';

describe('the architecture reply', () => {
  it('carries every field of the document, the optional ones too', () => {
    const doc: ArchitectureDocument = {
      name: 'Clinic Visits',
      applied: true,
      people: [{ id: 'r_staff', kind: 'role', label: 'Clinic staff' }],
      uses: [{ id: 'dashboard', label: 'Dashboard', count: 3 }],
      tables: [
        {
          id: 't_visit_supplies',
          ref: 'visit_supplies',
          name: 'clinic_visits_visit_supplies',
          rows: 0,
          columns: [{ name: 'id', type: 'int' }],
          relations: [{ to: 'visits', column: 'visit_id' }],
          posts: [{ addOn: 'inventory', ledger: 'stock', action: 'use-item' }],
        },
      ],
      addOns: [{ id: 'a_inventory', key: 'inventory', name: 'Inventory', need: 'required', state: 'installed', version: '1.0.8', reason: 'Inventory keeps the stock.' }],
      builtIn: ['sign-in'],
      emails: [{ id: 'e_ready', key: 'clinic-ready', name: 'Ready', when: 'When visits.status becomes seen' }],
      edges: [
        { id: 't_visit_supplies>a_inventory>add-on', from: 't_visit_supplies', to: 'a_inventory', kind: 'add-on', does: 'posts' },
        { id: 't_orders>a_offers>add-on', from: 't_orders', to: 'a_offers', kind: 'add-on', does: 'prices' },
        { id: 'customer>t_visits>customer-key', from: 'customer', to: 't_visits', kind: 'customer-key', reads: 1, writes: 0 },
      ],
      lists: {
        pages: [{ ref: 'clinic-visits-visits', name: 'Visits', kind: 'page-crud', shows: 'visits' }],
        roles: { tables: ['visits'], rows: [{ id: 'r_staff', role: 'Clinic staff', cells: ['write'], notes: [null] }] },
        access: ['visits: read'],
        screens: [{ id: 'customer:find', name: 'Find my visit', side: 'customer' }],
      },
      pending: [{ part: 'Table visits', node: 't_visits' }],
    };
    expect(designerArchitectureReply.parse(doc)).toEqual(doc);
  });
});
