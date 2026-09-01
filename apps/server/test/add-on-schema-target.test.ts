// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH database an add-on's tables go into (26-T02).
 *
 * `install-ddl.test.ts` proves the DDL is right. This proves it is aimed at the
 * right database — a distinction with no visible difference when it goes wrong.
 * Creating an add-on's tables in the wrong connection succeeds, returns 200,
 * writes real tables, and is discovered later by an operator wondering why the
 * add-on's list is empty. So every branch that could pick one is asserted, and
 * so is every branch that refuses to.
 */

import BetterSqlite3 from 'better-sqlite3';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  manifestsRepo,
  type MetaDb,
} from '@adminium/meta';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAddOnSchemaTarget } from '../src/add-ons/schema-target.js';
import type { ConnectionManager } from '../src/connections/manager.js';

let meta: MetaDb;

const crypto = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.slice(4) };

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
});

/**
 * Real connection rows, then a manager holding the real repo.
 *
 * Rows rather than a stubbed list because `adminium_manifests.connection_id`
 * carries a foreign key: a host app cannot name a connection that does not
 * exist, and a stub would let this file assert a state the database forbids.
 */
async function connect(names: { disabled?: boolean }[]): Promise<{
  manager: ConnectionManager;
  ids: string[];
}> {
  const repo = connectionsRepo(meta, crypto);
  const ids: string[] = [];
  for (const [index, spec] of names.entries()) {
    const row = await repo.create({
      name: `source-${index}`,
      engine: 'postgres',
      introspectDsn: `postgres://localhost/source_${index}`,
      dataDsn: `postgres://localhost/source_${index}`,
    });
    if (spec.disabled === true) await repo.setDisabled(row.id, true);
    ids.push(row.id);
  }
  return { manager: { connections: repo } as unknown as ConnectionManager, ids };
}

/** Installs a host APP manifest bound to a connection, the way generate does. */
async function installHostApp(key: string, connectionId: string | null): Promise<void> {
  await manifestsRepo(meta, crypto).install({
    manifestKey: key,
    version: '1.0.0',
    kind: 'app',
    source: 'generated',
    document: { key, version: '1.0.0' },
    installedBy: null,
    connectionId,
    attachTo: [],
  });
}

describe('picking the connection an add-on installs into', () => {
  it("uses the HOST APP's connection, which is the only one its FKs can reach", async () => {
    // The rule that matters: an add-on attaching to `printing` puts its tables
    // where `printing` reads, because a foreign key into the host's data is
    // impossible anywhere else.
    const { manager, ids } = await connect([{}, {}]);
    await installHostApp('printing', ids[0]!);
    const target = createAddOnSchemaTarget({ meta, manager, credentialCrypto: crypto });
    // Two connections exist, so the sole-connection fallback would REFUSE here.
    // Resolving instead is the proof that rule 1 answered. (No snapshot exists
    // for it yet, which is why the table list is empty.)
    await expect(target.read(['printing'])).resolves.toEqual([]);
  });

  it('falls back to the SOLE connection when no host app names one', async () => {
    const { manager } = await connect([{}]);
    const target = createAddOnSchemaTarget({ meta, manager, credentialCrypto: crypto });
    await expect(target.read(['*'])).resolves.toEqual([]);
  });

  it('REFUSES when the apps it attaches to read different databases', async () => {
    const { manager, ids } = await connect([{}, {}]);
    await installHostApp('printing', ids[0]!);
    await installHostApp('signage', ids[1]!);
    const target = createAddOnSchemaTarget({ meta, manager, credentialCrypto: crypto });
    await expect(target.read(['printing', 'signage'])).rejects.toThrow(/different databases/);
  });

  it('REFUSES a multi-connection instance rather than picking the first', async () => {
    const { manager } = await connect([{}, {}]);
    const target = createAddOnSchemaTarget({ meta, manager, credentialCrypto: crypto });
    await expect(target.read([])).rejects.toThrow(/more than one connection/);
  });

  it('ignores a DISABLED connection when deciding whether there is only one', async () => {
    // A disabled connection cannot be written to, so counting it would refuse
    // an instance that in fact has exactly one usable database.
    const { manager } = await connect([{}, { disabled: true }]);
    const target = createAddOnSchemaTarget({ meta, manager, credentialCrypto: crypto });
    await expect(target.read([])).resolves.toEqual([]);
  });

  it('reads no tables on an instance with no connection at all, rather than failing', async () => {
    // A supported shape, not a degraded one: an add-on that touches no data
    // installs happily here, and the planner needs an empty list to say so.
    const { manager } = await connect([]);
    const target = createAddOnSchemaTarget({ meta, manager, credentialCrypto: crypto });
    await expect(target.read(['printing'])).resolves.toEqual([]);
  });

  it('says so plainly when an add-on needs tables and there is nowhere to make them', async () => {
    const { manager } = await connect([]);
    const target = createAddOnSchemaTarget({ meta, manager, credentialCrypto: crypto });
    await expect(
      target.apply(
        {
          addOnKey: 'shipping-dhl',
          version: '1.0.0',
          installable: true,
          touchesData: true,
          create: [{ ref: 'shipments', action: 'create', columns: [], missingColumns: [] }],
          reuse: [],
          references: [],
          problems: [],
        },
        { key: 'shipping-dhl', version: '1.0.0' } as never,
        [],
      ),
    ).rejects.toThrow(/no database connection/);
  });
});
