// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Egress enforcement (26-T12, §5.5, 24 D14) — "declaring is not enforcing".
 *
 * The first block attacks the pure predicate directly, because that is where
 * an allow-list bypass would live and testing it through a fetch mock would
 * hide half the cases. The second drives the real client and asserts the three
 * things a predicate cannot: that a redirect is refused rather than followed,
 * that a body is metered, and that every refusal reaches the audit hook.
 */

import BetterSqlite3 from 'better-sqlite3';
import { auditRepo, createSqliteMetaDb, firstRun } from '@adminium/meta';
import { describe, expect, it, vi } from 'vitest';

import {
  AddOnEgressError,
  addOnHttpClientFor,
  createAddOnHttpClient,
  type EgressRefusalRecord,
} from '../src/add-ons/egress.js';
import { hostnameAllowed } from '../src/add-ons/egress-policy.js';

const ALLOW = ['express.api.dhl.com', 'api.canva.com'];

const verdict = (href: string, allow: readonly string[] = ALLOW): string =>
  hostnameAllowed(new URL(href), allow);

describe('the egress predicate: what is allowed', () => {
  it('allows an exact declared hostname over https', () => {
    expect(verdict('https://express.api.dhl.com/shipments')).toBe('ok');
    expect(verdict('https://api.canva.com/v1/designs?x=1')).toBe('ok');
  });

  it('is case-insensitive on both sides, as DNS is', () => {
    expect(verdict('https://EXPRESS.API.DHL.COM/x')).toBe('ok');
    expect(verdict('https://express.api.dhl.com/x', ['EXPRESS.API.DHL.COM'])).toBe('ok');
  });

  it('treats a trailing dot as the same host, not a free bypass', () => {
    // `api.example.com.` is the fully-qualified form and resolves identically,
    // so an exact match that missed it would be trivially bypassable.
    expect(verdict('https://express.api.dhl.com./x')).toBe('ok');
    expect(verdict('https://express.api.dhl.com/x', ['express.api.dhl.com.'])).toBe('ok');
  });

  it('allows an explicit :443, which is the same as no port', () => {
    expect(verdict('https://express.api.dhl.com:443/x')).toBe('ok');
  });
});

describe('the egress predicate: what is refused, and with which reason', () => {
  it('refuses a host that is simply not declared', () => {
    expect(verdict('https://evil.example/x')).toBe('HOST_NOT_ALLOWED');
  });

  it('refuses a SUFFIX that merely ends with an allowed host', () => {
    // The classic allow-list bypass. Nothing here does suffix matching, and
    // these are the two shapes that would exploit it if anything did.
    expect(verdict('https://express.api.dhl.com.evil.example/x')).toBe('HOST_NOT_ALLOWED');
    expect(verdict('https://notexpress.api.dhl.com/x')).toBe('HOST_NOT_ALLOWED');
  });

  it('refuses a PREFIX that an allowed host merely ends with', () => {
    expect(verdict('https://dhl.com/x')).toBe('HOST_NOT_ALLOWED');
    expect(verdict('https://api.dhl.com/x')).toBe('HOST_NOT_ALLOWED');
  });

  it('refuses credentials in the URL, which move the real host', () => {
    // `https://evil.example@allowed/` has hostname `allowed` — a guard reading
    // only the hostname passes it, and anything that later re-parses the href
    // can reach the other host. Refused outright rather than stripped.
    expect(verdict('https://evil.example@express.api.dhl.com/x')).toBe('CREDENTIALS_IN_URL');
    expect(verdict('https://user:pass@express.api.dhl.com/x')).toBe('CREDENTIALS_IN_URL');
  });

  it('refuses every scheme but https', () => {
    expect(verdict('http://express.api.dhl.com/x')).toBe('NOT_HTTPS');
    expect(hostnameAllowed(new URL('file:///etc/passwd'), ALLOW)).toBe('NOT_HTTPS');
    expect(hostnameAllowed(new URL('ftp://express.api.dhl.com/x'), ALLOW)).toBe('NOT_HTTPS');
  });

  it('refuses a literal IP by name, not as an ordinary miss', () => {
    // D14's grammar bans bare IPs from the list, so an IP can never match one.
    // Naming the reason tells an operator why adding it would not help.
    expect(verdict('https://203.0.113.10/x')).toBe('LITERAL_IP');
    expect(verdict('https://127.0.0.1/x')).toBe('LITERAL_IP');
    expect(verdict('https://[::1]/x')).toBe('LITERAL_IP');
    expect(verdict('https://169.254.169.254/latest/meta-data/')).toBe('LITERAL_IP');
  });

  it('refuses a non-default port, because the grammar cannot declare one', () => {
    expect(verdict('https://express.api.dhl.com:8443/x')).toBe('NON_DEFAULT_PORT');
  });

  it('refuses everything when the allow-list is empty', () => {
    expect(verdict('https://express.api.dhl.com/x', [])).toBe('HOST_NOT_ALLOWED');
  });
});

/** A fetch that records what it was called with, and answers 200. */
function recordingFetch(calls: Array<{ url: string; init: RequestInit }>, response?: Response) {
  return ((input: unknown, init: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(response ?? new Response('{}', { status: 200 }));
  }) as unknown as typeof globalThis.fetch;
}

function client(over: Partial<Parameters<typeof createAddOnHttpClient>[0]> = {}) {
  return createAddOnHttpClient({
    key: 'shipping-dhl',
    allow: ALLOW,
    hasOutboundHttp: true,
    ...over,
  });
}

describe('the client an add-on is handed', () => {
  it('lets a declared host through, and never follows a redirect', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const call = client({ fetchImpl: recordingFetch(calls) });
    const res = await call('https://express.api.dhl.com/shipments');
    expect(res.status).toBe(200);
    // `redirect: 'manual'` is the load-bearing option — a hostname check
    // necessarily runs BEFORE the request, so following a 302 would undo it.
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a 302 out of an allowed host rather than obeying it', async () => {
    const call = client({
      fetchImpl: recordingFetch(
        [],
        new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }),
      ),
    });
    await expect(call('https://express.api.dhl.com/x')).rejects.toMatchObject({
      reason: 'REDIRECTED',
    });
  });

  it('never reaches the network for a refused host', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const call = client({ fetchImpl: recordingFetch(calls) });
    await expect(call('https://evil.example/x')).rejects.toBeInstanceOf(AddOnEgressError);
    expect(calls).toEqual([]);
  });

  it('refuses everything without the outbound-http capability, allow-list or not', async () => {
    // §5.5: the capability is the consent; the allow-list only narrows it.
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const call = client({ hasOutboundHttp: false, fetchImpl: recordingFetch(calls) });
    await expect(call('https://express.api.dhl.com/x')).rejects.toMatchObject({
      reason: 'NO_OUTBOUND_CAPABILITY',
    });
    expect(calls).toEqual([]);
  });

  it('audits every refusal, naming the add-on and where it tried to go', async () => {
    const seen: EgressRefusalRecord[] = [];
    const call = client({
      fetchImpl: recordingFetch([]),
      onRefusal: (r) => {
        seen.push(r);
      },
    });
    await call('https://169.254.169.254/latest/meta-data/').catch(() => undefined);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      addOnKey: 'shipping-dhl',
      reason: 'LITERAL_IP',
      allow: ALLOW,
    });
  });

  it('strips credentials before anything records the target', async () => {
    // A refused URL still reaches an audit row and a log line.
    const seen: EgressRefusalRecord[] = [];
    const call = client({
      fetchImpl: recordingFetch([]),
      onRefusal: (r) => {
        seen.push(r);
      },
    });
    await call('https://user:hunter2@evil.example/x').catch(() => undefined);
    expect(seen[0]?.target).not.toContain('hunter2');
    expect(seen[0]?.target).not.toContain('user:');
  });

  it('refuses an over-cap response on its declared length', async () => {
    const call = client({
      maxResponseBytes: 128,
      fetchImpl: recordingFetch(
        [],
        new Response('x', { status: 200, headers: { 'content-length': '99999' } }),
      ),
    });
    await expect(call('https://express.api.dhl.com/x')).rejects.toMatchObject({
      reason: 'RESPONSE_TOO_LARGE',
    });
  });

  it('meters a body that LIES about its length', async () => {
    // The add-on runs in this process, so a response big enough to exhaust
    // memory takes the whole server with it.
    const call = client({
      maxResponseBytes: 1024,
      fetchImpl: (() => {
        const chunk = new Uint8Array(512);
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            sent += 1;
            if (sent > 20) controller.close();
            else controller.enqueue(chunk);
          },
        });
        return Promise.resolve(
          new Response(body, { status: 200, headers: { 'content-length': '1' } }),
        );
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(call('https://express.api.dhl.com/x')).rejects.toMatchObject({
      reason: 'RESPONSE_TOO_LARGE',
    });
  });

  it('reports a transport failure as a typed refusal, not a raw throw', async () => {
    const onRefusal = vi.fn();
    const call = client({
      onRefusal,
      fetchImpl: (() => Promise.reject(new Error('ECONNRESET'))) as unknown as typeof globalThis.fetch,
    });
    await expect(call('https://express.api.dhl.com/x')).rejects.toMatchObject({
      reason: 'REQUEST_FAILED',
    });
    expect(onRefusal).toHaveBeenCalled();
  });

  it('returns the body unchanged for an ordinary response', async () => {
    const call = client({
      fetchImpl: recordingFetch([], new Response('{"tracking":"JD01"}', { status: 200 })),
    });
    const res = await call('https://express.api.dhl.com/x');
    expect(await res.json()).toEqual({ tracking: 'JD01' });
  });
});

describe('what this does NOT claim (26 §5.5 overclaims; D4/O1)', () => {
  it('guards the client it hands out, which is not the same as guarding a socket', () => {
    // Stated as a test so the limit is recorded next to the thing that has it,
    // rather than only in a docblock somebody may not read. An add-on's server
    // half runs IN THIS PROCESS under 24 D13, so it can reach global fetch or
    // node:net directly and nothing here would see it. The control against a
    // HOSTILE add-on is D13's first-party publisher gate; this is the control
    // against an honest one with a bug or a phoning-home dependency.
    const guarded = createAddOnHttpClient({ key: 'x', allow: [], hasOutboundHttp: true });
    expect(typeof guarded).toBe('function');
    // The global is untouched — deliberately, because patching it would break
    // telemetry, the update check and the add-on catalog client too.
    expect(globalThis.fetch).toBeDefined();
  });
});

describe('the per-add-on client, with its refusals in the audit trail', () => {
  it('takes its allow-list from the manifest, so no caller can widen it', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const calls: Array<{ url: string; init: RequestInit }> = [];

    const call = addOnHttpClientFor(
      meta,
      {
        key: 'shipping-dhl',
        capabilities: ['outbound-http'],
        addOn: { network: { allow: ['express.api.dhl.com'] } },
      },
      { fetchImpl: recordingFetch(calls) },
    );

    await expect(call('https://express.api.dhl.com/x')).resolves.toBeDefined();
    await expect(call('https://evil.example/x')).rejects.toBeInstanceOf(AddOnEgressError);
    expect(calls).toHaveLength(1);

    // §5.5: the refusal is in the audit trail. That row is the whole
    // operator-facing value — an add-on quietly reaching for an undeclared host
    // is exactly what nobody would otherwise find out about.
    const rows = await auditRepo(meta).list({ category: 'add-on', limit: 10 });
    expect(rows.map((r) => r.action)).toEqual(['add-on.egress-refused']);
    expect(rows[0]?.changes).toMatchObject({
      after: { key: 'shipping-dhl', reason: 'HOST_NOT_ALLOWED' },
    });
    // The add-on is the actor, not whoever happened to trigger the code path.
    expect(rows[0]?.actorLabel).toBe('add-on:shipping-dhl');
    expect(rows[0]?.actorKind).toBe('system');
  });

  it('refuses everything for a manifest with no outbound-http capability', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const call = addOnHttpClientFor(meta, {
      key: 'design-studio',
      capabilities: ['file-storage'],
      addOn: { network: { allow: ['express.api.dhl.com'] } },
    });
    await expect(call('https://express.api.dhl.com/x')).rejects.toMatchObject({
      reason: 'NO_OUTBOUND_CAPABILITY',
    });
  });

  it('refuses everything for a manifest that declares no network block at all', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const call = addOnHttpClientFor(meta, {
      key: 'holiday-calendars',
      capabilities: ['outbound-http'],
      addOn: {},
    });
    await expect(call('https://anything.example/x')).rejects.toMatchObject({
      reason: 'HOST_NOT_ALLOWED',
    });
  });
});
