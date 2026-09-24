// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminiumjs/public-client`.
 *
 * The tests worth having here are the ones about behaviour a caller depends on
 * and cannot see: that a demo build gets `null` rather than an exception, that
 * a failed claim is an ordinary `false`, that the config is fetched once, and
 * that the time helpers use the TENANT's zone rather than the machine's.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_ERROR_CODES,
  PublicApiError,
  createPublicClient,
  formatTenantMoney,
  isCanonicalTimeZone,
  toTenantDay,
  fromTenantLocal,
  toTenantMinutes,
} from '../src/index.js';

const CONFIG = {
  version: 1,
  side: 'customer',
  timezone: 'Europe/London',
  currency: 'GBP',
  claim: { strategy: 'lookup', ref: 'orders', match: ['ref', 'email'] },
  refs: {
    menu: {
      actions: ['read'],
      expose: ['id', 'name', 'price'],
      filterable: [],
      searchable: ['name'],
      orderable: ['name'],
      writable: [],
      limit: 50,
    },
  },
};

function stub(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
    const out = handler(String(url), init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const err = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: 'nope' } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('demo mode is structural, not a catch', () => {
  it.each([
    ['nothing', undefined],
    ['no key', { baseUrl: 'https://x' }],
    ['no base url', { publishableKey: 'adm_pub_x' }],
    ['empty strings', { baseUrl: '', publishableKey: '' }],
  ])('returns null for %s', (_label, options) => {
    // The hosted marketplace demos are static clones with no server. A client
    // that threw on a missing env var would break every one of them.
    expect(createPublicClient(options)).toBeNull();
  });

  it('builds a client when both are present', () => {
    expect(createPublicClient({ baseUrl: 'https://x', publishableKey: 'adm_pub_x' })).not.toBeNull();
  });
});

describe('requests', () => {
  const make = (handler: Parameters<typeof stub>[0]) => {
    const s = stub(handler);
    const client = createPublicClient({
      baseUrl: 'https://x/',
      publishableKey: 'adm_pub_k',
      fetch: s.fetch,
    });
    return { client: client as NonNullable<typeof client>, calls: s.calls };
  };

  it('sends the key and strips a trailing slash from the base url', async () => {
    const { client, calls } = make(() => ({ data: CONFIG }));
    await client.config();
    expect(calls[0]?.url).toBe('https://x/api/v1/public/config');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe(
      'Bearer adm_pub_k',
    );
  });

  it('fetches the config ONCE however many callers ask', async () => {
    // A boot that renders six components must not make six identical requests.
    const { client, calls } = make(() => ({ data: CONFIG }));
    await Promise.all([client.config(), client.config(), client.config()]);
    expect(calls.filter((c) => c.url.endsWith('/config'))).toHaveLength(1);
  });

  it('encodes `where` as JSON, not as flattened params', async () => {
    const { client, calls } = make(() => ({ data: [] }));
    await client.list('menu', { where: { column: 'available', op: 'eq', value: true }, limit: 5 });
    const url = new URL(calls[0]?.url ?? '');
    expect(JSON.parse(url.searchParams.get('where') ?? '')).toEqual({
      column: 'available',
      op: 'eq',
      value: true,
    });
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('omits query params that were not supplied', async () => {
    const { client, calls } = make(() => ({ data: [] }));
    await client.list('menu');
    expect(calls[0]?.url).toBe('https://x/api/v1/public/records/menu');
  });
});

describe('errors carry the code, not the prose', () => {
  const make = (handler: Parameters<typeof stub>[0]) =>
    createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_k',
      fetch: stub(handler).fetch,
    }) as NonNullable<ReturnType<typeof createPublicClient>>;

  it('surfaces a server code', async () => {
    const client = make(() => err(400, 'PUBLIC_QUERY_REFUSED'));
    await expect(client.list('menu')).rejects.toMatchObject({ code: 'PUBLIC_QUERY_REFUSED' });
  });

  it('flags the disabled surface as DISABLED but not TRANSIENT', async () => {
    // The distinction is the whole point. `isDisabled` says "fall back to demo
    // content"; `isTransient` says "retrying could plausibly work". An operator
    // turning the switch off is the first and not the second — an app that
    // retry-loops against it just hammers a server that is answering correctly.
    const client = make(() => err(503, 'PUBLIC_API_DISABLED'));
    await client.list('menu').catch((e: PublicApiError) => {
      expect(e.isDisabled).toBe(true);
      expect(e.isTransient).toBe(false);
    });
    expect.assertions(2);
  });

  it('reads Retry-After on a rate limit', async () => {
    const client = make(() => err(429, 'PUBLIC_RATE_LIMITED', { 'retry-after': '47' }));
    await client.list('menu').catch((e: PublicApiError) => {
      expect(e.retryAfterSeconds).toBe(47);
    });
    expect.assertions(1);
  });

  it('invents a code when the network answered nothing at all', async () => {
    const client = createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_k',
      fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
    }) as NonNullable<ReturnType<typeof createPublicClient>>;
    await client.list('menu').catch((e: PublicApiError) => {
      expect(e.code).toBe('PUBLIC_NETWORK_UNAVAILABLE');
      expect(e.isTransient).toBe(true);
    });
    expect.assertions(2);
  });

  it('knows a full time from a busy one, and only the busy one is worth trying again', async () => {
    for (const [code, transient] of [
      ['PUBLIC_SLOT_FULL', false],
      ['PUBLIC_SLOT_BUSY', true],
    ] as const) {
      const client = make(() => err(409, code));
      await client.list('menu').catch((e: PublicApiError) => {
        expect([e.code, e.isTransient]).toEqual([code, transient]);
      });
    }
    expect.assertions(2);
  });

  it('does not mistake an unrecognised code for a known one', async () => {
    const client = make(() => err(500, 'SOMETHING_NEW'));
    await client.list('menu').catch((e: PublicApiError) => {
      expect(e.code).toBe('PUBLIC_UPSTREAM_UNAVAILABLE');
    });
    expect.assertions(1);
  });
});

describe('claims', () => {
  it('a wrong claim is FALSE, not an exception', async () => {
    // The visitor mistyped something. That is an ordinary outcome and callers
    // should not have to wrap it in try/catch to render "check your details".
    const client = createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_k',
      fetch: stub(() => err(403, 'PUBLIC_CLAIM_NO_MATCH')).fetch,
    }) as NonNullable<ReturnType<typeof createPublicClient>>;
    expect(await client.claim({ ref: 'x', email: 'y' })).toBe(false);
    expect(client.isClaimed()).toBe(false);
  });

  it('anything else still throws', async () => {
    const client = createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_k',
      fetch: stub(() => err(429, 'PUBLIC_RATE_LIMITED')).fetch,
    }) as NonNullable<ReturnType<typeof createPublicClient>>;
    await expect(client.claim({ ref: 'x' })).rejects.toBeInstanceOf(PublicApiError);
  });

  it('sends the session header on later requests, and drops it on sign-out', async () => {
    const s = stub((url) =>
      url.endsWith('/claim') ? { data: { session: 'adm_pubs_tok', expiresAt: 1 } } : { data: [] },
    );
    const client = createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_k',
      fetch: s.fetch,
    }) as NonNullable<ReturnType<typeof createPublicClient>>;

    expect(await client.claim({ ref: 'a', email: 'b' })).toBe(true);
    await client.list('orders');
    const headers = s.calls.at(-1)?.init?.headers as Record<string, string>;
    expect(headers['x-adminium-public-session']).toBe('adm_pubs_tok');

    await client.signOut();
    expect(client.isClaimed()).toBe(false);
    await client.list('orders');
    expect(
      (s.calls.at(-1)?.init?.headers as Record<string, string>)['x-adminium-public-session'],
    ).toBeUndefined();
  });

  it('drops the session locally even when sign-out fails', async () => {
    // A visitor who clicked sign out must not still hold a session because a
    // request failed.
    let claimed = false;
    const client = createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_k',
      fetch: stub((url) => {
        if (url.endsWith('/claim')) {
          claimed = true;
          return { data: { session: 'adm_pubs_tok', expiresAt: 1 } };
        }
        return err(503, 'PUBLIC_UPSTREAM_UNAVAILABLE');
      }).fetch,
    }) as NonNullable<ReturnType<typeof createPublicClient>>;

    await client.claim({ ref: 'a', email: 'b' });
    expect(claimed).toBe(true);
    await client.signOut().catch(() => undefined);
    expect(client.isClaimed()).toBe(false);
  });
});

describe('assertRefs turns a narrowed scope into a startup error', () => {
  const client = () =>
    createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_k',
      fetch: stub(() => ({ data: CONFIG })).fetch,
    }) as NonNullable<ReturnType<typeof createPublicClient>>;

  it('passes when everything is exposed', async () => {
    await expect(client().assertRefs({ menu: ['id', 'name'] })).resolves.toBeUndefined();
  });

  it('names the missing column rather than failing later with a 403', async () => {
    await expect(client().assertRefs({ menu: ['id', 'cost_price'] })).rejects.toThrow(
      /menu\.cost_price/,
    );
  });

  it('names a resource the scope does not have at all', async () => {
    await expect(client().assertRefs({ invoices: ['id'] })).rejects.toThrow(/invoices/);
  });
});

describe('money carries the tenant currency, not a guess', () => {
  it('formats a decimal STRING without turning it into arithmetic', () => {
    // `numeric` serializes as a string precisely to avoid float rounding, so
    // parsing happens once, at the last moment, for display only.
    expect(formatTenantMoney('45.00', 'GBP', 'en-GB')).toBe('£45.00');
    expect(formatTenantMoney('45.00', 'USD', 'en-US')).toBe('$45.00');
  });

  it('renders a bare number when the scope declares no currency', () => {
    // Better than defaulting to a currency nobody chose: fifteen apps hardcode
    // one and three already disagree.
    expect(formatTenantMoney('45.5', null, 'en-GB')).toBe('45.5');
  });

  it('passes a non-numeric value through rather than printing NaN', () => {
    expect(formatTenantMoney('n/a', 'GBP', 'en-GB')).toBe('n/a');
  });
});

describe('time is the tenant’s, not the reader’s', () => {
  // 2026-08-20T14:00:00Z is 15:00 in London and 16:00 in Berlin. Reading it
  // through the browser's clock is exactly the bug found in a real browser.
  const iso = '2026-08-20T14:00:00.000Z';

  it('gives the tenant day and minutes, whatever the machine is set to', () => {
    expect(toTenantDay(iso, 'Europe/London')).toBe('2026-08-20');
    expect(toTenantMinutes(iso, 'Europe/London')).toBe(15 * 60);
    expect(toTenantMinutes(iso, 'Europe/Berlin')).toBe(16 * 60);
    expect(toTenantMinutes(iso, 'UTC')).toBe(14 * 60);
  });

  it('rolls the DAY correctly across a zone boundary', () => {
    const late = '2026-08-20T23:30:00.000Z';
    expect(toTenantDay(late, 'UTC')).toBe('2026-08-20');
    expect(toTenantDay(late, 'Asia/Tokyo')).toBe('2026-08-21');
    expect(toTenantDay(late, 'America/New_York')).toBe('2026-08-20');
  });

  it('refuses the ALIASES that Intl silently remaps', () => {
    // `BST` resolves to Asia/Dhaka — six hours from the British Summer Time
    // somebody meant — and constructing a formatter with it does NOT throw.
    expect(isCanonicalTimeZone('Europe/London')).toBe(true);
    expect(isCanonicalTimeZone('UTC')).toBe(true);
    expect(isCanonicalTimeZone('BST')).toBe(false);
    expect(isCanonicalTimeZone('EST')).toBe(false);
    expect(isCanonicalTimeZone('banana')).toBe(false);
  });
});

describe('documents', () => {
  const DOC = {
    id: 'doc_1',
    kind: 'invoice',
    number: 'INV-9',
    status: 'rendered',
    delivery: 'pending-review',
    format: 'pdf',
    locale: 'en-US',
    createdAt: 1,
    hasContent: true,
  };

  function make(handler: Parameters<typeof stub>[0]) {
    const s = stub(handler);
    const client = createPublicClient({
      baseUrl: 'https://api.test',
      publishableKey: 'adm_pub_x',
      fetch: s.fetch,
    })!;
    return { client, calls: s.calls };
  }

  it('lists and gets through the claim-gated routes', async () => {
    const { client, calls } = make((url) =>
      url.endsWith('/documents') ? { data: [DOC] } : { data: DOC },
    );
    expect(await client.documents.list()).toEqual([DOC]);
    expect(await client.documents.get('doc_1')).toEqual(DOC);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.test/api/v1/public/documents',
      'https://api.test/api/v1/public/documents/doc_1',
    ]);
  });

  it('hands the caller’s abort signal to fetch, so a page that unmounts can cancel', async () => {
    const { client, calls } = make((url) =>
      url.endsWith('/documents') ? { data: [DOC] } : { data: DOC },
    );
    const controller = new AbortController();
    await client.documents.list(controller.signal);
    await client.documents.get('doc_1', controller.signal);
    // `toBe`, not `toEqual`: an AbortSignal has no enumerable fields, so ANY
    // signal would deep-equal this one and the assertion could not fail.
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init?.signal).toBe(controller.signal);
    expect(calls[1]!.init?.signal).toBe(controller.signal);
  });

  it('sends the VALUES form as the body, with nothing the server stamps', async () => {
    const { client, calls } = make(() => ({ data: DOC }));
    await client.documents.render({ kind: 'invoice', fields: { total: '10.00' }, collections: {} });
    const body = JSON.parse(String(calls[0]!.init!.body)) as Record<string, unknown>;
    expect(body).toEqual({ kind: 'invoice', fields: { total: '10.00' }, collections: {} });
    // The letterhead, the clock, the currency and the number are the server's.
    for (const stamped of ['business', 'now', 'currency', 'entity', 'number']) {
      expect(body[stamped]).toBeUndefined();
    }
  });

  it('emails with NO body at all — the address is the session’s', async () => {
    /*
     * The visitor decides whether, never where. An address in this request
     * would make the route a way to send somebody else's document anywhere.
     */
    const { client, calls } = make(() => ({ data: { ...DOC, delivery: 'sent' } }));
    const out = await client.documents.email('doc_1');
    expect(out.delivery).toBe('sent');
    expect(calls[0]!.init?.body).toBeUndefined();
    expect(calls[0]!.url).toBe('https://api.test/api/v1/public/documents/doc_1/email');
  });

  it('builds a same-origin content URL and puts no key in it', () => {
    const { client } = make(() => ({ data: DOC }));
    const url = client.documents.contentUrl('doc_1');
    expect(url).toBe('https://api.test/api/v1/public/documents/doc_1/content');
    expect(url).not.toContain('adm_pub_');
  });

  it('carries a refusal through as a code, like every other verb', async () => {
    const { client } = make(() => err(404, 'PUBLIC_REF_NOT_FOUND'));
    await expect(client.documents.get('doc_missing')).rejects.toMatchObject({
      code: 'PUBLIC_REF_NOT_FOUND',
    });
  });
});

describe('get, replace, remove and batch', () => {
  const make = (handler: (url: string, init?: RequestInit) => unknown) => {
    const s = stub(handler);
    const client = createPublicClient({ baseUrl: 'https://shop.example', publishableKey: 'adm_pub_x', fetch: s.fetch });
    if (client === null) throw new Error('expected a client');
    return { client, calls: s.calls };
  };

  it('replace is a PUT of {values}; remove is a DELETE; batch POSTs {rows} and returns the count', async () => {
    const { client, calls } = make((url, init) => {
      if (init?.method === 'PUT') return { data: { id: 7, name: 'Tea' } };
      if (init?.method === 'DELETE') return { data: {} };
      return { data: { count: 2 } };
    });
    expect(await client.replace('menu', '7', { name: 'Tea' })).toEqual({ id: 7, name: 'Tea' });
    await client.remove('menu', 'a/b');
    expect(await client.batch('menu', [{ name: 'A' }, { name: 'B' }])).toEqual({ count: 2 });

    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
      ['PUT', 'https://shop.example/api/v1/public/records/menu/7'],
      ['DELETE', 'https://shop.example/api/v1/public/records/menu/a%2Fb'],
      ['POST', 'https://shop.example/api/v1/public/records/menu/batch'],
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ values: { name: 'Tea' } });
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ rows: [{ name: 'A' }, { name: 'B' }] });
  });

  it('list() answers every response shape as one ListResult, without a /config request', async () => {
    let reply: Response | unknown = null;
    const { client, calls } = make(() => reply);

    reply = { data: [{ id: 1 }], page: { limit: 20, offset: 0, total: null }, cursor: { next: 'c2' } };
    expect(await client.list('menu')).toEqual(reply);

    reply = new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-next-cursor': 'c3' },
    });
    expect(await client.list('menu')).toEqual({ data: [{ id: 1 }, { id: 2 }], cursor: { next: 'c3' } });

    // `single`: one bare row — even one with a column called `data`.
    reply = { id: 9, data: 'x' };
    expect(await client.list('menu')).toEqual({ data: [{ id: 9, data: 'x' }] });

    expect(calls.some((c) => c.url.endsWith('/config'))).toBe(false);
  });
});

describe('fromTenantLocal', () => {
  it('names the instant of a wall time on the tenant clock, round-tripping the readers', () => {
    const iso = fromTenantLocal('2026-09-25', 19 * 60, 'Europe/London');
    expect(iso).toBe('2026-09-25T18:00:00.000Z');
    expect([toTenantDay(iso, 'Europe/London'), toTenantMinutes(iso, 'Europe/London')]).toEqual(['2026-09-25', 19 * 60]);
    expect(fromTenantLocal('2026-01-15', 19 * 60, 'Europe/London')).toBe('2026-01-15T19:00:00.000Z');
    expect(fromTenantLocal('2026-09-25', 0, 'Asia/Tokyo')).toBe('2026-09-24T15:00:00.000Z');
  });

  it('reads a skipped spring hour as the hour after, and a doubled autumn hour as the first', () => {
    // Europe/Berlin: 2026-03-29 02:00 → 03:00; 2026-10-25 03:00 → 02:00.
    expect(fromTenantLocal('2026-03-29', 2 * 60 + 30, 'Europe/Berlin')).toBe('2026-03-29T01:30:00.000Z');
    expect(fromTenantLocal('2026-10-25', 2 * 60 + 30, 'Europe/Berlin')).toBe('2026-10-25T00:30:00.000Z');
  });
});

describe('availability', () => {
  it('asks for a day and a party, and hands back the times as the server answered', async () => {
    let asked = '';
    const client = createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_k',
      fetch: stub((url) => {
        asked = url;
        return { data: [{ time: '19:00', state: 'free' }, { time: '19:30', state: 'full' }] };
      }).fetch,
    })!;
    expect(await client.availability('pos_reservations_availability', '2026-09-25', 4)).toEqual([
      { time: '19:00', state: 'free' },
      { time: '19:30', state: 'full' },
    ]);
    expect(asked).toBe('https://x/api/v1/public/availability/pos_reservations_availability?date=2026-09-25&party=4');
  });
});

/** A client over a stub, with the calls it made. */
function clientOver(handler: Parameters<typeof stub>[0], options: Partial<Parameters<typeof createPublicClient>[0]> = {}) {
  const s = stub(handler);
  const client = createPublicClient({ baseUrl: 'https://x', publishableKey: 'adm_pub_k', fetch: s.fetch, ...options })!;
  return { client, calls: s.calls };
}

const headersOf = (call: { init?: RequestInit } | undefined) => (call?.init?.headers ?? {}) as Record<string, string>;

describe('the codes the server can say', () => {
  it.each([
    [403, 'PUBLIC_SWITCHED_OFF'],
    [403, 'PUBLIC_STAFF_REQUIRED'],
    [503, 'PUBLIC_KEY_OFF'],
    [409, 'PUBLIC_LIMIT_REACHED'],
    [403, 'PUBLIC_PROOF_REQUIRED'],
    [403, 'PUBLIC_CLAIM_LEVEL'],
    [409, 'PUBLIC_CLAIM_NO_EMAIL'],
    [403, 'PUBLIC_CLAIM_LOCKED'],
    [429, 'PUBLIC_CODE_LIMIT'],
    [410, 'PUBLIC_CODE_EXPIRED'],
    [503, 'PUBLIC_CODE_UNAVAILABLE'],
    [403, 'PUBLIC_CODE_STEP_UP'],
    [429, 'PUBLIC_EMAIL_CHANGE_LIMIT'],
  ])('surfaces %i %s as itself, not as an upstream failure', async (status, code) => {
    expect(PUBLIC_ERROR_CODES).toContain(code);
    const { client } = clientOver(() => err(status, code));
    await expect(client.list('menu')).rejects.toMatchObject({ code, status });
  });

  it('carries the reply’s params, and reads `retryAfter` from them when there is no header', async () => {
    const { client } = clientOver(
      () =>
        new Response(JSON.stringify({ error: { code: 'PUBLIC_CODE_TOO_SOON', params: { retryAfter: 42 }, message: 'x' } }), {
          status: 429,
        }),
    );
    await client.list('menu').catch((e: PublicApiError) => {
      expect(e.params).toEqual({ retryAfter: 42 });
      expect(e.retryAfterSeconds).toBe(42);
    });
    expect.assertions(2);
  });

  it('has empty params when the reply named none', async () => {
    const { client } = clientOver(() => err(404, 'PUBLIC_REF_NOT_FOUND'));
    await client.list('menu').catch((e: PublicApiError) => {
      expect(e.params).toEqual({});
      expect(e.retryAfterSeconds).toBeNull();
    });
    expect.assertions(2);
  });
});

describe('availability on a booking table', () => {
  const TIMES = [{ time: '09:00', state: 'free' }, { time: '09:20', state: 'full' }];
  const DAYS = [{ date: '2026-09-25', open: 4, state: 'open' }, { date: '2026-09-26', open: 0, state: 'closed' }];

  it('asks one day’s times for a kind of visit and a person', async () => {
    const { client, calls } = clientOver(() => ({ data: TIMES }));
    expect(await client.bookingTimes('slots', { kind: 'checkup', resource: 'dr-5', date: '2026-09-25' })).toEqual(TIMES);
    expect(calls[0]?.url).toBe('https://x/api/v1/public/availability/slots?kind=checkup&resource=dr-5&date=2026-09-25');
  });

  it('asks a strip of days, and carries `exclude` so the visit being moved does not block itself', async () => {
    const { client, calls } = clientOver(() => ({ data: DAYS }));
    expect(await client.bookingDays('slots', { kind: 'checkup', from: '2026-09-25', days: 14, exclude: 'AP-9' })).toEqual(DAYS);
    const url = new URL(calls[0]?.url ?? '');
    expect(Object.fromEntries(url.searchParams)).toEqual({ kind: 'checkup', from: '2026-09-25', days: '14', exclude: 'AP-9' });
  });

  it('never mixes the two forms, which the server refuses', async () => {
    // A caller's stray field — here a `from` on a one-day read — is not sent.
    const { client, calls } = clientOver(() => ({ data: TIMES }));
    const query = { kind: 'checkup', date: '2026-09-25', from: '2026-09-25', party: 2 };
    await client.bookingTimes('slots', query);
    expect(calls[0]?.url).toBe('https://x/api/v1/public/availability/slots?kind=checkup&date=2026-09-25');
  });

  it('hands the abort signal to fetch', async () => {
    const { client, calls } = clientOver(() => ({ data: DAYS }));
    const controller = new AbortController();
    await client.bookingDays('slots', { kind: 'checkup', from: '2026-09-25', days: 2 }, controller.signal);
    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });
});

describe('rank on a create', () => {
  it('createWithRank hands back where the new row stands', async () => {
    const { client } = clientOver(() => ({ data: { id: 3 }, rank: 12 }));
    expect(await client.createWithRank('waiting_list', { visit_type_id: 1 })).toEqual({ data: { id: 3 }, rank: 12 });
  });

  it('is null where the endpoint does not rank, and `create` still answers the bare row', async () => {
    const { client } = clientOver(() => ({ data: { id: 3 } }));
    expect(await client.createWithRank('orders', {})).toEqual({ data: { id: 3 }, rank: null });
    expect(await client.create('orders', {})).toEqual({ id: 3 });
  });
});

describe('the human check', () => {
  const CHALLENGE = { id: 'eyJ2IjoxfQ~sig', salt: 'c2FsdA', difficulty: 8, expiresAt: 0 };

  /** Does a proof header hold for {@link CHALLENGE}, by Node's hash? */
  function holds(header: string | undefined): boolean {
    if (header === undefined || !header.startsWith(`${CHALLENGE.id}.`)) return false;
    const nonce = header.slice(CHALLENGE.id.length + 1);
    if (!/^[0-9a-z]{1,32}$/.test(nonce)) return false;
    const digest = createHash('sha256').update(`${CHALLENGE.salt}${nonce}`).digest();
    return digest[0] === 0;
  }

  /** A server that asks for a proof on the routes named, and takes any that holds. */
  function server(opts: { asks: (url: string) => boolean; refuseEvery?: boolean }) {
    return (url: string, init?: RequestInit) => {
      if (url.includes('/challenge')) return { data: CHALLENGE };
      const proof = headersOf({ ...(init === undefined ? {} : { init }) })['x-adminium-proof'];
      if (opts.asks(url) && (opts.refuseEvery === true || !holds(proof))) return err(403, 'PUBLIC_PROOF_REQUIRED');
      if (url.endsWith('/claim')) return { data: { session: 'adm_pubs_tok', expiresAt: Date.now() + 60_000 } };
      return { data: { id: 1 } };
    };
  }

  const route = (url: string) => (url.includes('/challenge') ? `challenge?${new URL(url).searchParams.get('purpose') ?? ''}` : new URL(url).pathname.replace('/api/v1/public/', ''));

  it('sends without one first, and fetches a challenge only when refused', async () => {
    const { client, calls } = clientOver(server({ asks: (url) => url.endsWith('/records/registrations') }));
    expect(await client.create('registrations', { name: 'A' })).toEqual({ id: 1 });
    expect(calls.map((c) => route(c.url))).toEqual(['records/registrations', 'challenge?write', 'records/registrations']);
    expect(headersOf(calls[0])['x-adminium-proof']).toBeUndefined();
    expect(holds(headersOf(calls[2])['x-adminium-proof'])).toBe(true);
    // The body is sent again unchanged.
    expect(calls[2]?.init?.body).toBe(calls[0]?.init?.body);
  });

  it('never fetches a challenge for a write that does not ask', async () => {
    const { client, calls } = clientOver(server({ asks: () => false }));
    await client.create('orders', {});
    await client.claim({ ref: 'a' });
    expect(calls.map((c) => route(c.url))).toEqual(['records/orders', 'claim']);
  });

  it('retries ONCE with a fresh proof, then lets the refusal through', async () => {
    const { client, calls } = clientOver(server({ asks: () => true, refuseEvery: true }));
    await expect(client.create('registrations', {})).rejects.toMatchObject({ code: 'PUBLIC_PROOF_REQUIRED' });
    expect(calls.map((c) => route(c.url))).toEqual(['records/registrations', 'challenge?write', 'records/registrations']);
  });

  it('a proof sent up front and refused gets one fresh proof, not a loop', async () => {
    const { client, calls } = clientOver(server({ asks: () => true, refuseEvery: true }), { humanCheck: true });
    await expect(client.create('registrations', {})).rejects.toMatchObject({ code: 'PUBLIC_PROOF_REQUIRED' });
    expect(calls.map((c) => route(c.url))).toEqual([
      'challenge?write',
      'records/registrations',
      'challenge?write',
      'records/registrations',
    ]);
  });

  it('does not answer anything but a proof refusal with a proof', async () => {
    const { client, calls } = clientOver(() => err(409, 'PUBLIC_LIMIT_REACHED'));
    await expect(client.create('appointments', {})).rejects.toMatchObject({ code: 'PUBLIC_LIMIT_REACHED' });
    expect(calls).toHaveLength(1);
  });

  it('`humanCheck: true` solves first, saving the refused round trip', async () => {
    const { client, calls } = clientOver(server({ asks: () => true }), { humanCheck: true });
    await client.create('registrations', {});
    expect(calls.map((c) => route(c.url))).toEqual(['challenge?write', 'records/registrations']);
    expect(holds(headersOf(calls[1])['x-adminium-proof'])).toBe(true);
  });

  it('`humanCheck: false` never solves one, and the refusal reaches the page', async () => {
    const { client, calls } = clientOver(server({ asks: () => true }), { humanCheck: false });
    await expect(client.create('registrations', {})).rejects.toMatchObject({ code: 'PUBLIC_PROOF_REQUIRED' });
    await expect(client.claim({ ref: 'a' })).rejects.toMatchObject({ code: 'PUBLIC_PROOF_REQUIRED' });
    expect(calls.map((c) => route(c.url))).toEqual(['records/registrations', 'claim']);
  });

  it('the object form solves first for what it names, and answers the server for the rest', async () => {
    const { client, calls } = clientOver(server({ asks: () => true }), { humanCheck: { refs: ['registrations'], claim: true } });
    await client.create('registrations', {});
    await client.claim({ ref: 'a' });
    await client.create('appointments', {});
    expect(calls.map((c) => route(c.url))).toEqual([
      'challenge?write',
      'records/registrations',
      'challenge?claim',
      'claim',
      'records/appointments',
      'challenge?write',
      'records/appointments',
    ]);
  });

  it('remembers a ref that asked, until the session changes', async () => {
    const { client, calls } = clientOver(server({ asks: (url) => url.includes('/records/') }));
    await client.create('appointments', {});
    await client.create('appointments', {});
    expect(calls.map((c) => route(c.url))).toEqual([
      'records/appointments',
      'challenge?write',
      'records/appointments',
      // Asked once: solved first from now on.
      'challenge?write',
      'records/appointments',
    ]);
    // A signed-in person may be excused, so a new session starts from nothing.
    calls.length = 0;
    await client.claim({ ref: 'a' });
    await client.create('appointments', {});
    expect(calls.map((c) => route(c.url))).toEqual(['claim', 'records/appointments', 'challenge?write', 'records/appointments']);
  });

  it('proves a claim with a claim challenge, and a wrong claim after it is still FALSE', async () => {
    let matches = true;
    const asks = server({ asks: (url) => url.endsWith('/claim') });
    const { client, calls } = clientOver((url, init) => {
      const out = asks(url, init);
      return url.endsWith('/claim') && !(out instanceof Response) && !matches ? err(403, 'PUBLIC_CLAIM_NO_MATCH') : out;
    });
    expect(await client.claim({ ref: 'a', email: 'b' })).toBe(true);
    expect(calls.map((c) => route(c.url))).toEqual(['claim', 'challenge?claim', 'claim']);
    expect(holds(headersOf(calls[2])['x-adminium-proof'])).toBe(true);

    await client.signOut();
    matches = false;
    expect(await client.claim({ ref: 'a', email: 'c' })).toBe(false);
  });
});

describe('a kiosk: a key bound to staff', () => {
  it('sends the staff member’s CSRF token on every write, and on no read', async () => {
    const { client, calls } = clientOver(() => ({ data: { id: 1 } }), { csrfToken: 'csrf-tok' });
    await client.list('menu');
    await client.get('menu', '1');
    await client.create('menu', {});
    await client.update('menu', '1', {});
    await client.replace('menu', '1', {});
    await client.remove('menu', '1');
    expect(calls.map((c) => [c.init?.method ?? 'GET', headersOf(c)['x-adminium-csrf']])).toEqual([
      ['GET', undefined],
      ['GET', undefined],
      ['POST', 'csrf-tok'],
      ['PATCH', 'csrf-tok'],
      ['PUT', 'csrf-tok'],
      ['DELETE', 'csrf-tok'],
    ]);
  });

  it('reads a getter on each request, so a new sign-in’s token is picked up', async () => {
    let token: string | null = 'first';
    const { client, calls } = clientOver(() => ({ data: { id: 1 } }), { csrfToken: () => token });
    await client.create('menu', {});
    token = 'second';
    await client.create('menu', {});
    token = null;
    await client.create('menu', {});
    expect(calls.map((c) => headersOf(c)['x-adminium-csrf'])).toEqual(['first', 'second', undefined]);
  });

  it('never tells fetch to leave the staff cookie behind', async () => {
    // The staff sign-in IS the cookie; `credentials: 'omit'` would make every
    // kiosk write a PUBLIC_STAFF_REQUIRED. Unset is fetch's `same-origin`.
    const { client, calls } = clientOver(() => ({ data: { id: 1 } }), { csrfToken: 't' });
    await client.create('menu', {});
    await client.list('menu');
    for (const call of calls) expect(call.init?.credentials).toBeUndefined();
  });
});

describe('the emailed code', () => {
  /** A client already holding a found (`lookup`) session. */
  async function claimed(handler: (url: string, init?: RequestInit) => unknown) {
    const made = clientOver((url, init) =>
      url.endsWith('/claim') ? { data: { session: 'adm_pubs_tok', expiresAt: Date.now() + 60_000 } } : handler(url, init),
    );
    await made.client.claim({ ref: 'a', email: 'b' });
    made.calls.length = 0;
    return made;
  }

  it('a claim holds a found session, at the lookup level', async () => {
    const { client } = await claimed(() => ({ data: [] }));
    expect(client.session()).toMatchObject({ level: 'lookup' });
  });

  it('asks for a code with exactly the body the server takes, on the session', async () => {
    const SENT = { sentTo: 'l•••@e•••.com', resendAfter: 60, expiresAt: 5 };
    const { client, calls } = await claimed(() => ({ data: SENT }));
    expect(await client.requestCode({ purpose: 'verify' })).toEqual(SENT);
    await client.requestCode({ purpose: 'email-change', email: 'new@example.com' });
    expect(calls.map((c) => [c.init?.method, c.url, JSON.parse(String(c.init?.body))])).toEqual([
      ['POST', 'https://x/api/v1/public/claim/code', { purpose: 'verify' }],
      ['POST', 'https://x/api/v1/public/claim/code', { purpose: 'email-change', email: 'new@example.com' }],
    ]);
    expect(headersOf(calls[0])['x-adminium-public-session']).toBe('adm_pubs_tok');
  });

  it('says how long to wait when a code was asked for too soon', async () => {
    const { client } = await claimed(
      () =>
        new Response(JSON.stringify({ error: { code: 'PUBLIC_CODE_TOO_SOON', params: { retryAfter: 37 }, message: 'x' } }), {
          status: 429,
        }),
    );
    await expect(client.requestCode({ purpose: 'verify' })).rejects.toMatchObject({
      code: 'PUBLIC_CODE_TOO_SOON',
      retryAfterSeconds: 37,
    });
  });

  it('raises the session it holds to the level and expiry the reply names', async () => {
    const later = Date.now() + 30 * 60_000;
    const { client, calls } = await claimed(() => ({ data: { level: 'verified', expiresAt: later } }));
    expect(await client.verifyCode({ code: '123456' })).toEqual({ ok: true, level: 'verified', expiresAt: later, ended: false });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ purpose: 'verify', code: '123456' });
    expect(client.session()).toEqual({ level: 'verified', expiresAt: later });
  });

  it('a wrong code is a result with the tries left, not an exception', async () => {
    const { client } = await claimed(
      () =>
        new Response(JSON.stringify({ error: { code: 'PUBLIC_CODE_WRONG', params: { triesLeft: 2 }, message: 'x' } }), {
          status: 403,
        }),
    );
    expect(await client.verifyCode({ code: '000000' })).toEqual({ ok: false, triesLeft: 2 });
    expect(client.session()).toMatchObject({ level: 'lookup' });
  });

  it.each([
    [410, 'PUBLIC_CODE_EXPIRED', {}],
    [429, 'PUBLIC_CODE_LOCKED', { retryAfter: 300 }],
    [403, 'PUBLIC_CLAIM_LOCKED', {}],
  ])('anything else still throws: %i %s', async (status, code, params) => {
    const { client } = await claimed(() => new Response(JSON.stringify({ error: { code, params, message: 'x' } }), { status }));
    await expect(client.verifyCode({ code: '1' })).rejects.toMatchObject({ code, retryAfterSeconds: params.retryAfter ?? null });
  });

  it('drops the session after an address change, which ended it', async () => {
    const now = Date.now();
    const { client, calls } = await claimed((url) =>
      url.endsWith('/verify') ? { data: { level: 'lookup', expiresAt: now, email: 'n•••@e•••.com' } } : { data: [] },
    );
    expect(await client.verifyCode({ purpose: 'email-change', code: '654321' })).toEqual({
      ok: true,
      level: 'lookup',
      expiresAt: now,
      ended: true,
      email: 'n•••@e•••.com',
    });
    expect(client.isClaimed()).toBe(false);
    expect(client.session()).toBeNull();
    await client.list('appointments');
    expect(headersOf(calls.at(-1))['x-adminium-public-session']).toBeUndefined();
  });
});
