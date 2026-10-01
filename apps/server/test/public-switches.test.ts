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
  it('read a written table again at once, by its id or its bare name, and no other', async () => {
    /*
     * A switch thrown at the desk goes through Adminium, which knows the
     * table was written: the kiosk used to go on checking patients in, and
     * the order page taking orders, until the fifteen seconds ran out.
     */
    const db = source();
    await db.schema.createTable('settings').addColumn('online_on', 'integer').execute();
    await db.schema.createTable('hours').addColumn('open', 'integer').execute();
    await db.insertInto('settings' as never).values({ online_on: 1 } as never).execute();
    await db.insertInto('hours' as never).values({ open: 1 } as never).execute();
    const switches = createSwitches(async () => db, () => 1_000_000);
    expect([await switches.isOn('c1', 'settings', 'online_on'), await switches.isOn('c1', 'hours', 'open')]).toEqual([true, true]);
    await db.updateTable('settings' as never).set({ online_on: 0 } as never).execute();
    await db.updateTable('hours' as never).set({ open: 0 } as never).execute();
    // Another connection's write, or another table's, leaves it trusted.
    switches.forget('c2', 'main.settings');
    expect(await switches.isOn('c1', 'settings', 'online_on')).toBe(true);
    // The write names the table by its id; the switch was asked by its bare name.
    switches.forget('c1', 'main.settings');
    expect(await switches.isOn('c1', 'settings', 'online_on')).toBe(false);
    expect(await switches.isOn('c1', 'hours', 'open')).toBe(true);
    await db.destroy();
  });
});
