// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's settings switches, as the public gate reads them: off unless a
 * row says on, and trusted for fifteen seconds.
 */
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { describe, expect, it } from 'vitest';

import type { SourceDatabase } from '../src/connections/manager.js';
import { SWITCH_TTL_MS, createSwitches } from '../src/public-api/switches.js';

function source() {
  const db = new Kysely<SourceDatabase>({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) });
  return db;
}

describe('settings switches', () => {
  it('read off with no row, no column or no table, and on only when the row says so', async () => {
    const db = source();
    await db.schema.createTable('settings').addColumn('online_on', 'integer').execute();
    const switches = createSwitches(async () => db);
    expect(await switches.isOn('c1', 'settings', 'online_on')).toBe(false);
    expect(await switches.isOn('c1', 'settings', 'missing')).toBe(false);
    expect(await switches.isOn('c1', 'nowhere', 'online_on')).toBe(false);
    await db.insertInto('settings' as never).values({ online_on: 1 } as never).execute();
    expect(await createSwitches(async () => db).isOn('c1', 'settings', 'online_on')).toBe(true);
    // A second row that is off switches it off, whichever row a database hands back first.
    await db.insertInto('settings' as never).values({ online_on: 0 } as never).execute();
    expect(await createSwitches(async () => db).isOn('c1', 'settings', 'online_on')).toBe(false);
    await db.destroy();
  });

  it('trust an answer for fifteen seconds, per connection, table and column', async () => {
    const db = source();
    await db.schema.createTable('settings').addColumn('online_on', 'integer').addColumn('kiosk_on', 'integer').execute();
    await db.insertInto('settings' as never).values({ online_on: 1, kiosk_on: 1 } as never).execute();
    let now = 1_000_000;
    const switches = createSwitches(async () => db, () => now);
    expect(await switches.isOn('c1', 'settings', 'online_on')).toBe(true);
    await db.updateTable('settings' as never).set({ online_on: 0, kiosk_on: 0 } as never).execute();
    now += SWITCH_TTL_MS - 1;
    expect(await switches.isOn('c1', 'settings', 'online_on')).toBe(true);
    // Another column, or another connection, is read afresh.
    expect(await switches.isOn('c1', 'settings', 'kiosk_on')).toBe(false);
    expect(await switches.isOn('c2', 'settings', 'online_on')).toBe(false);
    now += 1;
    expect(await switches.isOn('c1', 'settings', 'online_on')).toBe(false);
    await db.destroy();
  });
});
