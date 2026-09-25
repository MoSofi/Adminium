// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A client's address and a stranger's get the same answer from the sign-in
 * link's routes — the same status, the same body, and the same time, within
 * noise over a hundred tries each: asking for a link (under the caps and
 * over them), typing a wrong code, and typing one once the code path has
 * locked. Nothing in the request path depends on whose address it is; this
 * is what shows it.
 *
 * On SQLite only: the request path reads the meta store and never the
 * client's database (the lookup is the job's), so the engine under the
 * client's rows cannot move these numbers.
 */
import { performance } from 'node:perf_hooks';

import { settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { solveProof } from '../src/public-api/proof.js';
import { SIGN_IN_LINK_JOB_KIND } from '../src/public-api/sign-in-link.js';
import { installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const TRIES = 100;

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'clients',
        columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'contact_name', type: 'text', maxLength: 120 }, { ref: 'email', type: 'text', maxLength: 254, unique: true }],
      },
    ]),
    publicAccess: [{ table: 'clients', methods: ['GET'], select: ['contact_name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true }],
  };
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** The spread of a sample around its median: the noise the difference is judged against. */
const deviation = (values: readonly number[]): number => {
  const m = median(values);
  return median(values.map((value) => Math.abs(value - m)));
};

/** Two samples of one path, as alike as noise allows: their medians closer than the noise around them. */
function expectAlike(label: string, known: readonly number[], unknown: readonly number[]): void {
  const gap = Math.abs(median(known) - median(unknown));
  const noise = Math.max(deviation(known), deviation(unknown));
  const allowed = Math.max(0.5, 3 * noise, 0.2 * Math.max(median(known), median(unknown)));
  if (process.env['ADMINIUM_TIMING_REPORT'] === '1') process.stdout.write(`${label}: known ${median(known).toFixed(3)} ms, unknown ${median(unknown).toFixed(3)} ms, noise ${noise.toFixed(3)} ms\n`);
  expect(gap, `${label}: known ${median(known).toFixed(2)} ms, unknown ${median(unknown).toFixed(2)} ms, noise ${noise.toFixed(2)} ms`).toBeLessThanOrEqual(allowed);
}

describe('the sign-in link answers any address alike', () => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let ip = 0;
  const from = () => {
    ip += 1;
    return `10.${String((ip >> 16) & 255)}.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const proof = async () => {
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=claim', remoteAddress: from(), headers: served.headers() });
    const challenge = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}`;
  };
  /** One request, timed from the moment it is handed to the server. */
  const timed = async (url: string, payload: Record<string, unknown>, proved: boolean) => {
    const headers = served.headers(undefined, proved ? { 'x-adminium-proof': await proof() } : {});
    const remoteAddress = from();
    const started = performance.now();
    const res = await served.composed.app.inject({ method: 'POST', url: `/api/v1/public${url}`, remoteAddress, headers, payload });
    return { ms: performance.now() - started, status: res.statusCode, body: res.body };
  };
  /*
   * The key-wide rungs count on the server's real clock, not the test's: a
   * hundred and ten requests to a window, then a wait for the next — so every
   * request measured is one the server answered, never a 429.
   */
  let windowOpened = performance.now();
  let inWindow = 0;
  /** Requests to a window: under the link rung (120), then under the verify rung (300). */
  let budget = 110;
  const pace = async () => {
    if (inWindow >= budget) {
      const wait = 61_000 - (performance.now() - windowOpened);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      inWindow = 0;
    }
    // The server's window opens with its first request, so ours does too.
    if (inWindow === 0) windowOpened = performance.now();
  };
  /** Both addresses, a hundred times each, turn about — the order swapped every other turn. */
  const pairs = async (url: string, body: (email: string) => Record<string, unknown>, proved: boolean, tries = TRIES) => {
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < tries; i += 1) {
      await pace();
      inWindow += 2;
      // A proof lives two minutes on the test's clock: each pair a little later.
      vi.setSystemTime(new Date(Date.now() + 1_500));
      const order = i % 2 === 0 ? (['ada@example.com', 'axe@example.com'] as const) : (['axe@example.com', 'ada@example.com'] as const);
      const answers: Record<string, { ms: number; status: number; body: string }> = {};
      for (const email of order) answers[email] = await timed(url, body(email), proved);
      const a = answers['ada@example.com']!;
      const x = answers['axe@example.com']!;
      expect(a.status, a.body).not.toBe(429);
      expect(x.status, x.body).toBe(a.status);
      expect(x.body).toBe(a.body);
      known.push(a.ms);
      unknown.push(x.ms);
    }
    return { known, unknown };
  };

  beforeAll(async () => {
    h = await installInvoicing('sqlite', manifest());
    await h.rows(`insert into ${h.real('clients')} (contact_name, email) values ('Ada Lovelace', 'ada@example.com')`);
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://studio.example.com');
    await settingsRepo(h.meta).set('email.smtp', {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
      from: 'Studio <no-reply@studio.test>',
      secure: false,
    } as never);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
    vi.useFakeTimers({ toFake: ['Date'] });
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await served.close();
    await h.close();
  });

  it('asking for a link, under the caps and over them', async () => {
    // Warm the path first: the first calls pay for compiling it.
    await pairs('/claim/link', (email) => ({ email }), true, 10);
    const asked = await pairs('/claim/link', (email) => ({ email }), true);
    expect(asked.known.length).toBe(TRIES);
    expectAlike('link asked for', asked.known, asked.unknown);
    // Every one of them was queued alike: a hundred and ten jobs each, whatever the address.
    const jobs = await h.meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', SIGN_IN_LINK_JOB_KIND).execute();
    expect(jobs.length).toBe(2 * (TRIES + 10));
  }, 300_000);

  it('a wrong code, then the locked code path', async () => {
    // Another rung, another window.
    inWindow = 0;
    budget = 290;
    // The queued work runs: three real links for Ada, three decoys for the stranger, the rest over the caps.
    const entry = served.composed.jobs.registry.get(SIGN_IN_LINK_JOB_KIND)!;
    for (const job of await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', SIGN_IN_LINK_JOB_KIND).execute()) {
      await entry.run(entry.schema.parse(typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload), {} as never);
    }
    const wrong = await pairs('/claim/link/verify', (email) => ({ email, code: '000000' }), false, 10);
    expectAlike('wrong code', wrong.known, wrong.unknown);
    const locked = await pairs('/claim/link/verify', (email) => ({ email, code: '000000' }), false);
    expectAlike('locked', locked.known, locked.unknown);
  }, 300_000);
});
