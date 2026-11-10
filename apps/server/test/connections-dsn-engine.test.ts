// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A connection string must be for the engine it is handed to.
 *
 * The guard checks hosts and parameters for `postgres:` and `mysql:` strings
 * and leaves a `sqlite:` path alone. The drivers do not look at the scheme:
 * `pg` reads `sqlite://x/db?host=169.254.169.254` as a URL and dials the
 * `?host=`. So the body's `engine` and the string's scheme have to agree, on
 * every route that takes a string and on every dial of a stored one. Run as
 * the role that manages connections, with a fake adapter that records every
 * dial, so a refusal is proven to come before the driver.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  type AdapterProvider,
  type DatabaseAdapter,
} from '@adminium/engine/adapter';

import { asUser, buildDataTestApp, type DataTestContext } from './connections-helpers.js';

const dials: { dialect: string; dsn: string }[] = [];

function recordingRegistry(): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const registry = new AdapterRegistry<AdapterProvider>();
  for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
    registry.register({
      dialect,
      create: (config: { role: string; dsn: string }) => {
        dials.push({ dialect, dsn: config.dsn });
        return {
          dialect,
          capabilities,
          role: config.role,
          connect: async () => undefined,
          test: async () => ({ ok: true, latencyMs: 1, serverVersion: 'Fake 1', currentUser: 'fake', canWrite: true, ssl: false }),
          probeCapabilities: async () => ({
            capabilities,
            privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
            serverVersion: 'Fake 1',
            currentRole: { name: 'fake', readOnly: false },
          }),
          close: async () => undefined,
        } as unknown as DatabaseAdapter as never;
      },
      createQueryEngine: () => {
        throw new Error('not used');
      },
    } as unknown as AdapterProvider);
  }
  return registry;
}

const SMUGGLED = [
  { engine: 'postgres', dsn: 'sqlite://x/db?host=169.254.169.254&port=80' },
  { engine: 'postgres', dsn: 'sqlite://169.254.169.254/db?sslrootcert=/etc/passwd' },
  { engine: 'mysql', dsn: 'sqlite://169.254.169.254/db' },
  { engine: 'mysql', dsn: 'file://169.254.169.254/db' },
  { engine: 'sqlite', dsn: 'postgres://u@db.example.com/app' },
  { engine: 'postgres', dsn: 'mysql://u@db.example.com/app' },
];

let t: DataTestContext;

beforeEach(async () => {
  dials.length = 0;
  t = await buildDataTestApp({ registry: recordingRegistry() });
});

afterEach(async () => {
  await t.app.close();
});

describe('the engine and the connection string must agree', () => {
  it('POST /connections/test refuses a string for another engine before dialling, naming both', async () => {
    for (const { engine, dsn } of SMUGGLED) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/connections/test',
        headers: asUser(t.users.admin),
        payload: { engine, dsn },
      });
      expect(res.statusCode, `${engine} ${dsn}`).toBe(422);
      const message = (res.json() as { error: { message: string } }).error.message;
      expect(message).toContain(engine);
      expect(message).toMatch(/sqlite|postgres|mysql/);
    }
    expect(dials).toEqual([]);
  });

  it('POST /connections refuses it for the single string and for each role', async () => {
    const bodies = [
      { name: 'one', engine: 'postgres', dsn: 'sqlite://x/db?host=169.254.169.254' },
      { name: 'split', engine: 'postgres', roles: { introspect: 'sqlite://x/db?host=169.254.169.254', data: 'postgres://u@db.example.com/app' } },
      { name: 'split2', engine: 'postgres', roles: { introspect: 'postgres://u@db.example.com/app', data: 'sqlite://x/db?host=169.254.169.254' } },
    ];
    for (const payload of bodies) {
      const res = await t.app.inject({ method: 'POST', url: '/api/v1/connections', headers: asUser(t.users.admin), payload });
      expect(res.statusCode, payload.name).toBe(422);
    }
    expect(dials).toEqual([]);
    expect(await t.manager.connections.list()).toEqual([]);
  });

  it('still accepts a string whose scheme is an alias of the engine', async () => {
    for (const [engine, dsn] of [
      ['postgres', 'postgresql://u@db.example.com/app'],
      ['mysql', 'mariadb://u@db.example.com/app'],
      ['sqlite', 'file:/data/app.db'],
    ] as const) {
      const res = await t.app.inject({ method: 'POST', url: '/api/v1/connections/test', headers: asUser(t.users.admin), payload: { engine, dsn } });
      expect(res.statusCode, dsn).toBe(200);
    }
    expect(dials.map((d) => d.dialect)).toEqual(['postgres', 'mysql', 'sqlite']);
  });

  it('refuses to dial a stored connection whose string is for another engine', async () => {
    // Stored straight through the repository, as a row written before the check existed would be.
    const stored = await t.manager.connections.create({
      name: 'old',
      engine: 'postgres',
      sourceKind: 'dsn',
      introspectDsn: 'sqlite://x/db?host=169.254.169.254',
      dataDsn: null,
      readOnly: false,
      settings: {},
      status: 'connected',
      createdBy: null,
    });
    const res = await t.app.inject({ method: 'POST', url: `/api/v1/connections/${stored.id}/test`, headers: asUser(t.users.admin) });
    expect(res.statusCode).toBe(422);
    await expect(t.manager.introspectAdapter(stored.id)).rejects.toMatchObject({ statusCode: 422 });
    await expect(t.manager.dataAdapter(stored.id)).rejects.toMatchObject({ statusCode: 422 });
    await expect(t.manager.data(stored.id)).rejects.toMatchObject({ statusCode: 422 });
    expect(dials).toEqual([]);
  });
});
