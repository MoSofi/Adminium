// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A venue-local time sent through the data routes lands on the instant it
 * names, whatever zone this server runs in.
 *
 * The data routes re-spell a zoned instant bound for a zone-less column as
 * this server's wall clock (`normalizeWriteValue`). For a venue-local column
 * that was the wrong order: the write service then read that server wall
 * time as the VENUE's, and a booking made in the dashboard moved by the
 * difference between the two zones. The column is now left to the write
 * service, which reads a zone-less value on the venue's clock and spells a
 * zoned one for the column itself.
 *
 * Tokyo is the venue so it differs from any zone a developer or CI runs in.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { slotInstant } from '../src/crud/capacity-guard.js';
import { asUser, buildDataTestApp, createConnectionViaApi, introspectViaApi, type DataTestContext } from './connections-helpers.js';

describe('a venue-local time through the data routes', () => {
  let t: DataTestContext;
  let dir: string;
  let file: string;
  let connId: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'venue-local-'));
    file = join(dir, 'clinic.db');
    const db = new BetterSqlite3(file);
    db.exec('CREATE TABLE visits (id INTEGER PRIMARY KEY, starts_at TIMESTAMP NOT NULL)');
    db.close();
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, `sqlite:${file}`, 'clinic', 'sqlite');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, 'main.visits', { read: true, create: true, update: true });
    const zone = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/connections/${connId}`,
      headers: asUser(t.users.admin),
      payload: { timezone: 'Asia/Tokyo' },
    });
    expect(zone.statusCode, zone.body).toBe(200);
    const rule = await t.app.inject({
      method: 'PUT',
      url: `/api/v1/connections/${connId}/overrides`,
      headers: asUser(t.users.admin),
      payload: { overrides: [{ op: 'column.venueLocal', tableName: 'main.visits', columnName: 'starts_at', value: { venueLocal: true } }] },
    });
    expect(rule.statusCode, rule.body).toBe(200);
  });
  afterAll(async () => {
    await t.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const stored = (id: unknown) => {
    const db = new BetterSqlite3(file, { readonly: true });
    try {
      return (db.prepare('SELECT starts_at FROM visits WHERE id = ?').get(id) as { starts_at: unknown }).starts_at;
    } finally {
      db.close();
    }
  };
  const create = (values: Record<string, unknown>) =>
    t.app.inject({ method: 'POST', url: `/api/v1/data/${connId}/main.visits`, headers: asUser(t.users.admin), payload: { values } });

  it('keeps a zoned instant on its instant', async () => {
    const res = await create({ starts_at: '2026-07-28T00:00:00.000Z' });
    expect(res.statusCode, res.body).toBe(201);
    // 09:00 in Tokyo is midnight UTC, and it stays that instant.
    expect(slotInstant(stored(res.json().data.id))?.toISOString()).toBe('2026-07-28T00:00:00.000Z');
  });

  it('reads a wall time with no zone on the venue\'s clock', async () => {
    const res = await create({ starts_at: '2026-07-28 09:00' });
    expect(res.statusCode, res.body).toBe(201);
    expect(slotInstant(stored(res.json().data.id))?.toISOString()).toBe('2026-07-28T00:00:00.000Z');
  });
});
