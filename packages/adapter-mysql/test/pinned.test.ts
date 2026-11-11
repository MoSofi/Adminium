// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The driver dials the address the server checked, and only that.
 *
 * The server looks a source's host up, checks every address it gives, and
 * hands the adapter the fields of the DSN with those addresses. `mysql2` must
 * never look the name up again (a second answer could point anywhere), and
 * `host` must stay the name: `mysql2` takes the TLS server name and the
 * certificate check from `host`, and skips both for an address.
 *
 * Host names end in `.invalid`, which never resolves: a connection that
 * arrives at all arrived through the pin.
 */
import net from 'node:net';

import type { DatabaseEndpoint } from '@adminium/engine/adapter';
import { afterEach, describe, expect, it } from 'vitest';

import { endpointOf, mysqlEndpointConfig, pinnedLookup } from '../src/client-config.js';
import { MysqlAdapter } from '../src/index.js';
import { TEST_MYSQL_URL } from './harness.js';

const NAME = 'db.pinned.invalid';

function endpoint(extra: Partial<DatabaseEndpoint> = {}): DatabaseEndpoint {
  return { host: NAME, port: 3306, database: 'shop', user: 'app', password: 'pw', params: {}, ...extra };
}

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('the mysql2 config, built from fields', () => {
  it('never carries a URI, nor a parameter it does not map', () => {
    const config = mysqlEndpointConfig(
      endpoint({ params: { socketPath: '/var/run/mysqld/mysqld.sock', localAddress: '10.0.0.5', flags: '-FOUND_ROWS', multipleStatements: 'true', charset: 'utf8mb4', timezone: 'Z', connectTimeout: '5000' } }),
    );
    expect(config).not.toHaveProperty('uri');
    expect(Object.keys(config).sort()).toEqual(['charset', 'connectTimeout', 'database', 'host', 'password', 'port', 'timezone', 'user']);
    expect(config).toMatchObject({ host: NAME, port: 3306, charset: 'utf8mb4', timezone: 'Z', connectTimeout: 5000 });
  });

  it('reads ?ssl= as mysql2 does, held to what cannot change the trust', () => {
    const ssl = (value: string): unknown => mysqlEndpointConfig(endpoint({ params: { ssl: value } })).ssl;
    expect(ssl('Amazon RDS')).toBe('Amazon RDS');
    expect(ssl('true')).toBe(true);
    expect(ssl('{"rejectUnauthorized":false}')).toEqual({ rejectUnauthorized: false });
    expect(ssl('{"ca":"x","servername":"evil"}')).toEqual({});
    expect(ssl('[1]')).toBe('[1]');
    expect(mysqlEndpointConfig(endpoint({ params: { connectTimeout: 'soon' } }))).not.toHaveProperty('connectTimeout');
  });

  it('reads a DSN into the same fields when no endpoint is given', () => {
    expect(endpointOf({ dsn: 'mysql://ava:s%40cret@db.acme.io/my%2Fdb?charset=utf8mb4' }, 'x requires')).toEqual({
      host: 'db.acme.io',
      port: null,
      database: 'my/db',
      user: 'ava',
      password: 's@cret',
      params: { charset: 'utf8mb4' },
    });
    expect(() => endpointOf({}, 'x requires')).toThrow('x requires a DSN');
    expect(mysqlEndpointConfig(endpoint({ port: null, database: null, user: null, password: null }))).toEqual({ host: NAME });
  });

  it('answers a lookup with the checked addresses and nothing else', () => {
    const answers: unknown[] = [];
    const lookup = pinnedLookup(['::1', '127.0.0.1']);
    lookup('anything.example', { all: true }, (_error, address) => answers.push(address));
    lookup('anything.example', {}, (_error, address, family) => answers.push([address, family]));
    pinnedLookup([])('anything.example', {}, (error) => answers.push((error as NodeJS.ErrnoException | null)?.code));
    expect(answers).toEqual([
      [
        { address: '::1', family: 6 },
        { address: '127.0.0.1', family: 4 },
      ],
      ['::1', 6],
      'ENOTFOUND',
    ]);
  });
});

describe('a connection goes to the checked address', () => {
  it('opens its socket to the pin while host stays the name', async () => {
    let arrived = 0;
    const server = net.createServer((socket) => {
      arrived += 1;
      socket.destroy();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    const config = mysqlEndpointConfig(endpoint({ port, addresses: ['127.0.0.1'] }));
    // The name is what mysql2 sends as the TLS server name and checks the certificate against.
    expect(config.host).toBe(NAME);
    const socket = config.stream?.();
    await new Promise<void>((resolve, reject) => {
      socket?.once('connect', () => resolve());
      socket?.once('error', reject);
    });
    expect(socket?.remoteAddress).toBe('127.0.0.1');
    socket?.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(arrived).toBe(1);
  });
});

describe('each new connection asks the server’s re-check', () => {
  it('dials the address the re-check gives now, and fails on its refusal', async () => {
    const at: Record<string, number> = { '127.0.0.1': 0, '::1': 0 };
    const listen = async (host: string, port: number): Promise<number> => {
      const server = net.createServer((socket) => {
        at[host] = (at[host] ?? 0) + 1;
        socket.destroy();
      });
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return (server.address() as net.AddressInfo).port;
    };
    const port = await listen('127.0.0.1', 0);
    await listen('::1', port);
    let answer: readonly string[] | Error = ['127.0.0.1'];
    const config = mysqlEndpointConfig(
      endpoint({
        port,
        addresses: ['127.0.0.1'],
        resolveAddresses: async () => {
          if (answer instanceof Error) throw answer;
          return answer;
        },
      }),
    );
    const dial = async (): Promise<string> =>
      new Promise((resolve) => {
        const socket = config.stream?.();
        if (socket === undefined) throw new Error('no stream');
        socket.once('connect', () => {
          resolve(socket.remoteAddress ?? '');
          socket.destroy();
        });
        socket.once('error', (error) => resolve(`error: ${error.message}`));
      });
    expect(await dial()).toBe('127.0.0.1');
    answer = ['::1'];
    expect(await dial()).toBe('::1');
    answer = Object.assign(new Error('The host db.pinned.invalid now resolves to an address this server does not connect to (127.0.0.1): loopback.'), { code: 'ENOTFOUND' });
    expect(await dial()).toContain('loopback');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(at).toEqual({ '127.0.0.1': 1, '::1': 1 });
  });
});

describe.runIf(TEST_MYSQL_URL !== '')('against the local MySQL', () => {
  it('serves a query through the pin, the name never looked up', async () => {
    const url = new URL(TEST_MYSQL_URL);
    const adapter = new MysqlAdapter('introspect');
    await adapter.connect({
      role: 'introspect',
      endpoint: {
        host: 'mysql.pinned.invalid',
        port: url.port === '' ? 3306 : Number(url.port),
        database: 'mysql',
        user: decodeURIComponent(url.username),
        password: url.password === '' ? null : decodeURIComponent(url.password),
        params: {},
        addresses: [url.hostname.replace(/^\[|\]$/g, '')],
      },
    });
    try {
      const result = await adapter.test();
      expect(result.ok).toBe(true);
    } finally {
      await adapter.close();
    }
  });
});
