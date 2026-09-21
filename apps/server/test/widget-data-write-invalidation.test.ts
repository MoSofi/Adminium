// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record write drops the written table from the widget-data result cache.
 *
 * Before compose shared one `WidgetDataCache` with the write paths, the
 * widget-data routes built a private one nothing could reach: a calendar's
 * "Add event" returned 201, the dashboard refetched `['widget-data']`, and the
 * refetch was answered from the 30 s cache without the new event. Real sqlite
 * source, so this runs on every machine.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

interface QueryReply {
  result: { shape: string; rows?: Array<Record<string, unknown>>; value?: unknown };
  cached: boolean;
}

describe('widget-data cache: record writes invalidate', () => {
  let dir: string;
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'adminium-wd-inval-'));
    const file = join(dir, 'planning.db');
    const db = new BetterSqlite3(file);
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        starts_at TEXT
      );
      INSERT INTO events (title, starts_at) VALUES ('Kickoff', '2026-09-21T09:00:00Z');
    `);
    db.close();
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, `sqlite:${file}`, 'planning', 'sqlite');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true, create: true, update: true, delete: true });
  }, 60_000);

  afterAll(async () => {
    await t.app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function query(descriptor: Record<string, unknown>): Promise<QueryReply> {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/widget-data/query',
      headers: asUser(t.users.admin),
      payload: { descriptor },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as QueryReply;
  }

  it('a create through /data serves the next query fresh, with the new row', async () => {
    const list = {
      connectionId: connId,
      source: { name: 'events' },
      shape: 'record-list',
      columns: ['id', 'title'],
    };
    const count = {
      connectionId: connId,
      source: { name: 'events' },
      shape: 'single-metric',
      aggregations: [{ fn: 'count', alias: 'n' }],
    };

    // Warm both entries and prove they are served from the cache.
    await query(list);
    await query(count);
    const warmList = await query(list);
    const warmCount = await query(count);
    expect(warmList.cached).toBe(true);
    expect(warmCount.cached).toBe(true);
    expect(warmList.result.rows?.map((r) => r.title)).toEqual(['Kickoff']);
    expect(Number(warmCount.result.value)).toBe(1);

    const created = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/events`,
      headers: asUser(t.users.admin),
      payload: { values: { title: 'Design review', starts_at: '2026-09-22T14:00:00Z' } },
    });
    expect(created.statusCode, created.body).toBe(201);

    const freshList = await query(list);
    expect(freshList.cached).toBe(false);
    expect(freshList.result.rows?.map((r) => r.title)).toEqual(
      expect.arrayContaining(['Kickoff', 'Design review']),
    );
    const freshCount = await query(count);
    expect(freshCount.cached).toBe(false);
    expect(Number(freshCount.result.value)).toBe(2);
  });
});
