// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A copy through a link another copy fills is valid (a ticket's show, copied
 * from its type, then the show's doors through it); a loop of copies is not.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function boxOffice(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shows',
    name: 'Shows',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A box office' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'events', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'doors_at', type: 'timestamptz' }] },
        { ref: 'ticket_types', columns: [id, { ref: 'event_id', type: 'fk', references: 'events' }, { ref: 'label', type: 'text', maxLength: 40 }] },
        {
          ref: 'tickets',
          columns: [
            id,
            { ref: 'doors_at', type: 'timestamptz', nullable: true, rules: { copy: { via: 'event_id', from: 'doors_at', mode: 'always', follow: true } } },
            { ref: 'show_name', type: 'text', maxLength: 40, nullable: true, rules: { copy: { via: 'event_id', from: 'name' } } },
            { ref: 'event_id', type: 'fk', references: 'events', nullable: true, rules: { copy: { via: 'ticket_type_id', from: 'event_id', mode: 'always' } } },
            { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types' },
          ],
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'shows', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

type Doc = Record<string, unknown>;
const tickets = (m: Doc) => ((m['requiredSchema'] as Doc)['tables'] as Doc[]).find((t) => t['ref'] === 'tickets')!['columns'] as Doc[];
const issues = (m: Doc) => {
  const r = validateManifest(m);
  return r.ok ? '' : r.issues.map((i) => i.message).join('\n');
};

describe('copies through copied links', () => {
  it('takes a chain, in any column order', () => {
    expect(issues(boxOffice())).toBe('');
  });

  it('refuses two links copied through each other', () => {
    const m = boxOffice();
    tickets(m).push(
      { ref: 'a_event', type: 'fk', references: 'events', nullable: true, rules: { copy: { via: 'b_event', from: 'id' } } },
      { ref: 'b_event', type: 'fk', references: 'events', nullable: true, rules: { copy: { via: 'a_event', from: 'id' } } },
    );
    expect(issues(m)).toContain('is copied through a loop of copies');
  });
});
