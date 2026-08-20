// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminiumjs/public-client` (28-T12).
 *
 * The tests worth having here are the ones about behaviour a caller depends on
 * and cannot see: that a demo build gets `null` rather than an exception, that
 * a failed claim is an ordinary `false`, that the config is fetched once, and
 * that the time helpers use the TENANT's zone rather than the machine's.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  PublicApiError,
  createPublicClient,
  formatTenantMoney,
  isCanonicalTimeZone,
  toTenantDay,
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
