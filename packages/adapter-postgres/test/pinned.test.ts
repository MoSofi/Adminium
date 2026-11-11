// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The driver dials the address the server checked, and only that.
 *
 * The server looks a source's host up, checks every address it gives, and
 * hands the adapter the fields of the DSN with those addresses. Between that
 * check and the connection a second lookup could answer differently (DNS
 * rebinding), so `pg` must never look the name up again: every connection,
 * including the pools rebuilt by the pooler and time-zone downgrades, goes to
 * the checked addresses, while the name stays the TLS server name.
 *
 * The host names below end in `.invalid`, which never resolves: a connection
 * that arrives at all arrived through the pin.
 */
import net from 'node:net';

import type { DatabaseEndpoint } from '@adminium/engine/adapter';
import { Kysely, sql, type Dialect } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { endpointOf, pgEndpointConfig, pinnedLookup } from '../src/client-config.js';
import { PostgresAdapter } from '../src/index.js';
import { createQueryEngine } from '../src/query-engine.js';
import { psqlAvailable } from './harness.js';

const NAME = 'db.pinned.invalid';

function endpoint(port: number, extra: Partial<DatabaseEndpoint> = {}): DatabaseEndpoint {
  return { host: NAME, port, database: 'shop', user: 'app', password: null, params: {}, addresses: ['127.0.0.1'], ...extra };
}

/** Postgres wire ErrorResponse: 'E' + Int32 length + (tag + cstring)* + \0 */
function errorResponse(code: string, message: string): Buffer {
  const field = (tag: string, value: string): Buffer => Buffer.concat([Buffer.from(tag, 'ascii'), Buffer.from(value, 'utf8'), Buffer.from([0])]);
  const body = Buffer.concat([field('S', 'FATAL'), field('V', 'FATAL'), field('C', code), field('M', message), Buffer.from([0])]);
  const header = Buffer.alloc(5);
  header.write('E', 0, 'ascii');
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

const POOLER_REFUSAL = errorResponse('08P01', 'unsupported startup parameter in options: statement_timeout. Please use unpooled connection.');

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** A fake server on 127.0.0.1 that hands each first packet to `answer`, counting connections. */
async function fakeServer(answer: (socket: net.Socket, first: Buffer) => void): Promise<{ port: number; connections: () => number }> {
  let count = 0;
  const server = net.createServer((socket) => {
    count += 1;
    socket.on('error', () => undefined);
    socket.once('data', (first) => answer(socket, first));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;
  return { port: address.port, connections: () => count };
}

describe('the pg config, built from fields', () => {
  it('never carries a connection string, nor a parameter it does not map', () => {
    const { config, options } = pgEndpointConfig(
      endpoint(5432, {
        params: { host: '10.0.0.5', hostaddr: '10.0.0.5', port: '6379', sslrootcert: '/dev/zero', application_name: 'shop', options: '-c search_path=a' },
      }),
    );
    expect(config).not.toHaveProperty('connectionString');
    expect(config).toMatchObject({ host: NAME, port: 5432, database: 'shop', user: 'app', application_name: 'shop' });
    expect(Object.keys(config).sort()).toEqual(['application_name', 'database', 'host', 'port', 'stream', 'user']);
    expect(options).toBe('-c search_path=a');
  });

  it('reads TLS as pg-connection-string does, without its certificate files', () => {
    const ssl = (params: Record<string, string>): unknown => pgEndpointConfig(endpoint(5432, { params, addresses: undefined })).config.ssl;
    expect(ssl({})).toBeUndefined();
    expect(ssl({ ssl: 'true' })).toBe(true);
    expect(ssl({ ssl: '1' })).toBe(true);
    expect(ssl({ ssl: '0' })).toBe(false);
    expect(ssl({ ssl: 'false' })).toBe(false);
    expect(ssl({ ssl: 'no-verify' })).toEqual({ rejectUnauthorized: false });
    expect(ssl({ sslmode: 'require' })).toEqual({});
    expect(ssl({ sslmode: 'verify-full' })).toEqual({});
    expect(ssl({ sslmode: 'disable' })).toBe(false);
    expect(ssl({ sslmode: 'no-verify' })).toEqual({ rejectUnauthorized: false });
    expect(ssl({ sslnegotiation: 'direct' })).toBe(true);
    expect(ssl({ uselibpqcompat: 'true', sslmode: 'disable' })).toBe(false);
    expect(ssl({ uselibpqcompat: 'true', sslmode: 'prefer' })).toEqual({ rejectUnauthorized: false });
    expect(ssl({ uselibpqcompat: 'true', sslmode: 'require' })).toEqual({ rejectUnauthorized: false });
    expect(ssl({ uselibpqcompat: 'true', sslmode: 'verify-full' })).toEqual({});
    expect(() => ssl({ uselibpqcompat: 'true', sslmode: 'verify-ca' })).toThrow('verify-ca');
    const negotiated = pgEndpointConfig(endpoint(5432, { params: { sslnegotiation: 'direct', fallback_application_name: 'adminium' } })).config;
    expect(negotiated).toMatchObject({ sslnegotiation: 'direct', fallback_application_name: 'adminium' });
  });

  it('reads a DSN into the same fields when no endpoint is given', () => {
    expect(endpointOf({ dsn: 'postgres://ava:s%40cret@db.acme.io:6543/my%20db?sslmode=require' }, 'x requires')).toEqual({
      host: 'db.acme.io',
      port: 6543,
      database: 'my db',
      user: 'ava',
      password: 's@cret',
      params: { sslmode: 'require' },
    });
    // Host-less: the driver's own default host, as before.
    expect(endpointOf({ dsn: 'postgres:///shop' }, 'x requires').host).toBe('');
    expect(() => endpointOf({}, 'x requires')).toThrow('x requires a DSN');
  });

  it('answers a lookup with the checked addresses and nothing else', () => {
    const answers: unknown[] = [];
    const lookup = pinnedLookup(['::1', '127.0.0.1']);
    lookup('anything.example', { all: true }, (_error, address) => answers.push(address));
    lookup('anything.example', {}, (_error, address, family) => answers.push([address, family]));
    expect(answers).toEqual([
      [
        { address: '::1', family: 6 },
        { address: '127.0.0.1', family: 4 },
      ],
      ['::1', 6],
    ]);
    pinnedLookup([])('anything.example', {}, (error) => answers.push((error as NodeJS.ErrnoException | null)?.code));
    expect(answers.at(-1)).toBe('ENOTFOUND');
  });
});

describe('a connection goes to the checked address', () => {
  it('reaches it although the name resolves nowhere, and the pooler retry reaches it again', async () => {
    const fake = await fakeServer((socket) => {
      socket.write(POOLER_REFUSAL);
      socket.end();
    });
    const adapter = new PostgresAdapter('introspect');
    await adapter.connect({ role: 'introspect', endpoint: endpoint(fake.port) });
    try {
      const result = await adapter.test();
      // Both the first pool and the one rebuilt without startup options dialled the pin.
      expect(result.ok).toBe(false);
      expect(fake.connections()).toBe(2);
    } finally {
      await adapter.close();
    }
  });

  it('keeps the pin across the query engine’s pooler downgrade', async () => {
    const fake = await fakeServer((socket) => {
      socket.write(POOLER_REFUSAL);
      socket.end();
    });
    const engine = createQueryEngine({ role: 'data', endpoint: endpoint(fake.port) });
    const db = new Kysely<Record<string, never>>({ dialect: engine.dialect as Dialect });
    await expect(sql`select 1`.execute(db)).rejects.toThrow();
    // The zone-less rebuild and the options-less rebuild each dialled the pin too.
    expect(fake.connections()).toBeGreaterThanOrEqual(2);
    await engine.destroy();
  });

  it('sends the name, not the address, as the TLS server name', async () => {
    let hello = Buffer.alloc(0);
    const helloSeen = new Promise<void>((resolve) => {
      void fakeServer((socket, first) => {
        // The SSLRequest: say yes, then read the ClientHello, whose server name is plain text.
        expect(first.readInt32BE(4)).toBe(80877103);
        socket.write('S');
        socket.once('data', (chunk) => {
          hello = chunk;
          socket.destroy();
          resolve();
        });
      }).then((fake) => {
        const adapter = new PostgresAdapter('introspect');
        void adapter
          .connect({ role: 'introspect', endpoint: endpoint(fake.port, { params: { sslmode: 'require' } }) })
          .then(async () => {
            await adapter.test();
            await adapter.close();
          });
      });
    });
    await helloSeen;
    expect(hello.includes(Buffer.from(NAME))).toBe(true);
  });
});

describe.runIf(psqlAvailable)('against the local Postgres', () => {
  it('serves a query through the pin, the name never looked up', async () => {
    const adapter = new PostgresAdapter('introspect');
    await adapter.connect({
      role: 'introspect',
      endpoint: { host: 'pg.pinned.invalid', port: 5432, database: 'postgres', user: null, password: null, params: {}, addresses: ['127.0.0.1'] },
    });
    try {
      const result = await adapter.test();
      expect(result.ok).toBe(true);
    } finally {
      await adapter.close();
    }
  });
});
