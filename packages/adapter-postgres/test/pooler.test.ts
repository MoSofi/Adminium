// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Transaction-pooling endpoints, end to end — no database required.
 *
 * A fake server answers the startup packet with the exact ErrorResponse a Neon
 * `-pooler` host sends, which is the only way to prove the *whole* path rather
 * than the mapper alone: that `pg` surfaces SQLSTATE 08P01 on `.code`, and that
 * `test()` reports the failure instead of returning a green result that then
 * breaks on the first introspection query.
 */
import net from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresAdapter } from '../src/index.js';

const NEON_MESSAGE =
  'unsupported startup parameter in options: statement_timeout. Please use unpooled connection or remove this parameter from the startup package.';

/** Postgres wire ErrorResponse: 'E' + Int32 length + (tag + cstring)* + \0 */
function errorResponse(code: string, message: string): Buffer {
  const field = (tag: string, value: string): Buffer =>
    Buffer.concat([Buffer.from(tag, 'ascii'), Buffer.from(value, 'utf8'), Buffer.from([0])]);
  const body = Buffer.concat([
    field('S', 'FATAL'),
    field('V', 'FATAL'),
    field('C', code),
    field('M', message),
    Buffer.from([0]),
  ]);
  const header = Buffer.alloc(5);
  header.write('E', 0, 'ascii');
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

describe('a PgBouncer transaction-pooling endpoint', () => {
  let server: net.Server;
  let dsn: string;

  beforeAll(async () => {
    server = net.createServer((socket) => {
      // The first client packet is the StartupMessage — the DSN sets no
      // sslmode, so there is no SSLRequest to negotiate first.
      socket.once('data', () => {
        socket.write(errorResponse('08P01', NEON_MESSAGE));
        socket.end();
      });
      socket.on('error', () => {
        /* the client hangs up on the FATAL; nothing to do */
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port bound');
    dsn = `postgres://app@127.0.0.1:${address.port}/prod`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fails the connection test rather than reporting a healthy connection', async () => {
    const adapter = new PostgresAdapter('introspect');
    await adapter.connect({ role: 'introspect', dsn });
    try {
      const result = await adapter.test();

      // The whole point: the wizard must not paint this green.
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('UNSUPPORTED');
      expect(result.error?.detail).toContain('08P01');
      expect(result.error?.hint).toContain('-pooler');
      expect(result.error?.hint).toContain('6543');
    } finally {
      await adapter.close();
    }
  });

  it('rejects probeCapabilities() with the same typed error', async () => {
    const adapter = new PostgresAdapter('introspect');
    await adapter.connect({ role: 'introspect', dsn });
    try {
      await expect(adapter.probeCapabilities()).rejects.toMatchObject({
        code: 'UNSUPPORTED',
        hint: expect.stringContaining('unpooled'),
      });
    } finally {
      await adapter.close();
    }
  });
});
