// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A copy through a link another copy fills, on every engine: a ticket sent
 * with only its type gets its show from the type, and the show's doors and
 * name through that show — in the one create. The doors column is declared
 * BEFORE the show it reads through, so the order the copies run in is the
 * rules', not the manifest's. Before, the doors were copied only when the
 * writer sent the show itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

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

describe.each(LEGS)('a copy through a link another copy fills — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, boxOffice());
    w = await writerFor(h, 'UTC');
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  /** A stored moment, comparable on every engine: a Date (pg, mysql) or the text SQLite keeps. */
  const instant = (value: unknown) => (value instanceof Date ? value.getTime() : String(value));
  const show = async (showId: unknown) => (await h.rows(`SELECT * FROM ${h.real('events')} WHERE id = ${String(showId)}`))[0]!;
  const ticket = async (ticketId: unknown) => (await h.rows(`SELECT * FROM ${h.real('tickets')} WHERE id = ${String(ticketId)}`))[0]!;

  it.runIf(available)('fills the show from the type, then its doors and name through the show', async () => {
    const velvet = await w.create('events', { name: 'Velvet Hour', doors_at: '2026-10-02T19:00:00Z' });
    const standing = await w.create('ticket_types', { event_id: velvet['id'], label: 'Standing' });
    const made = await w.create('tickets', { ticket_type_id: standing['id'] });
    const row = await ticket(made['id']);
    expect(Number(row['event_id'])).toBe(Number(velvet['id']));
    expect(row['show_name']).toBe('Velvet Hour');
    expect(instant(row['doors_at'])).toBe(instant((await show(velvet['id']))['doors_at']));
  });

  it.runIf(available)('moves the chain again when the type changes to another show', async () => {
    const velvet = await w.create('events', { name: 'Velvet Hour', doors_at: '2026-10-02T19:00:00Z' });
    const weekender = await w.create('events', { name: 'Weekender', doors_at: '2026-10-09T18:00:00Z' });
    const early = await w.create('ticket_types', { event_id: velvet['id'], label: 'Early' });
    const late = await w.create('ticket_types', { event_id: weekender['id'], label: 'Late' });
    const made = await w.create('tickets', { ticket_type_id: early['id'] });
    await w.update('tickets', made['id'], { ticket_type_id: late['id'] });
    const row = await ticket(made['id']);
    expect(Number(row['event_id'])).toBe(Number(weekender['id']));
    expect(row['show_name']).toBe('Weekender');
    expect(instant(row['doors_at'])).toBe(instant((await show(weekender['id']))['doors_at']));
  });
});
