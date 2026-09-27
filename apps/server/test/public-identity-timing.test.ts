// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A known address and an unknown one, as the database and the clock see
 * them — the two ways a stranger could tell whether an address is a
 * customer's:
 *
 *  - a quote (a dry run, free to ask) runs the very same statements for
 *    both: it never finds nor makes a person;
 *  - a create runs the same statements but one: the new person's INSERT;
 *  - and takes the same time, within noise, over twenty tries each.
 *
 * Statements are compared on every engine; the time on SQLite, where the
 * one INSERT is the whole difference.
 */
import { performance } from 'node:perf_hooks';

import { Kysely, type Dialect as KyselyDialect, type LogEvent } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SourceDatabase } from '../src/connections/manager.js';
import { solveProof } from '../src/public-api/proof.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const TRIES = 20;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};
const deviation = (values: readonly number[]): number => {
  const m = median(values);
  return median(values.map((value) => Math.abs(value - m)));
};

describe.each(LEGS)('a known address and an unknown one — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let ip = 0;
  /** The statements the source database ran while `logging` is on. */
  const statements: string[] = [];
  let logging = false;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shopManifest());
    for (let i = 0; i < TRIES + 2; i += 1) await h.rows(`insert into ${h.real('customers')} (email, name) values ('known${String(i)}@example.com', 'K')`);
    // The source database, with every statement it runs written down.
    const real = h.manager.data.bind(h.manager);
    let logged: Awaited<ReturnType<typeof real>> | null = null;
    vi.spyOn(h.manager, 'data').mockImplementation(async (connection) => {
      const handle = await real(connection);
      if (typeof connection !== 'string' || connection !== h.connectionId) return handle;
      logged ??= {
        ...handle,
        db: new Kysely<SourceDatabase>({
          dialect: handle.engine.dialect as KyselyDialect,
          log: (event: LogEvent) => {
            if (logging && event.level === 'query') statements.push(event.query.sql);
          },
        }),
      };
      return logged;
    });
    shop = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    vi.restoreAllMocks();
    await shop.close();
    await h.close();
  });

  const from = () => {
    ip += 1;
    return `10.11.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  /** A create (or a quote) ready to send, its proof solved beforehand so the time is the request's own. */
  const ready = async (email: string, quote = false) => {
    const address = from();
    let headers = shop.headers();
    if (!quote) {
      const res = await shop.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers });
      const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
      headers = shop.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    }
    const url = `/api/v1/public/records/${h.real('orders')}_verified_2${quote ? '/dry-run' : ''}`;
    return () => shop.composed.app.inject({ method: 'POST', url, remoteAddress: address, headers, payload: { values: { email, name: 'Guest' } } });
  };
  /** One request's statements. */
  const traced = async (send: () => Promise<{ statusCode: number; body: string }>) => {
    statements.length = 0;
    logging = true;
    const res = await send();
    logging = false;
    // What the write announced after it answered may still be running: a moment for it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { res, sql: [...statements] };
  };

  it.skipIf(!available)('runs the same statements for both in a quote', async () => {
    const known = await traced(await ready('known0@example.com', true));
    const unknown = await traced(await ready('never-seen@example.com', true));
    expect([known.res.statusCode, unknown.res.statusCode]).toEqual([200, 200]);
    expect(unknown.sql).toEqual(known.sql);
    expect(known.sql.join('\n')).not.toContain(h.real('customers'));
    expect(unknown.res.body).toBe(known.res.body);
  });

  it.skipIf(!available)('runs the same statements for both in a create, but the new person\'s INSERT', async () => {
    const known = await traced(await ready('known1@example.com'));
    const unknown = await traced(await ready('first-time@example.com'));
    expect([known.res.statusCode, unknown.res.statusCode]).toEqual([201, 201]);
    // Every statement of the known address's create, in order, is the unknown one's too.
    const extra = [...unknown.sql];
    for (const statement of known.sql) {
      const at = extra.indexOf(statement);
      expect(at, `the unknown address's create did not run: ${statement}`).toBeGreaterThanOrEqual(0);
      extra.splice(at, 1);
    }
    // What it ran besides: the person made (inside a savepoint on Postgres, as every INSERT inside a write is), and nothing else.
    expect(extra.length).toBeGreaterThan(0);
    for (const statement of extra.filter((s) => !/^(release )?savepoint /i.test(s))) {
      expect(statement).toContain(h.real('customers'));
      expect(statement.toLowerCase()).toMatch(/^(insert|select)/);
    }
    expect(extra.filter((statement) => statement.toLowerCase().startsWith('insert'))).toHaveLength(1);
  });

  it.runIf(available && dialect === 'sqlite')('takes the same time for both, within noise', async () => {
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < TRIES; i += 1) {
      const a = await ready(`known${String(i + 2)}@example.com`);
      const b = await ready(`stranger${String(i)}@example.com`);
      // Interleaved, so a slower moment of the machine lands on both alike.
      let t = performance.now();
      const x = await a();
      known.push(performance.now() - t);
      t = performance.now();
      const y = await b();
      unknown.push(performance.now() - t);
      expect([x.statusCode, y.statusCode]).toEqual([201, 201]);
    }
    const gap = Math.abs(median(known) - median(unknown));
    const noise = Math.max(deviation(known), deviation(unknown));
    const allowed = Math.max(0.5, 3 * noise, 0.2 * Math.max(median(known), median(unknown)));
    expect(gap, `known ${median(known).toFixed(2)} ms, unknown ${median(unknown).toFixed(2)} ms, noise ${noise.toFixed(2)} ms`).toBeLessThanOrEqual(allowed);
  });
});
