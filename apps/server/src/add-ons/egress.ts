// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The guarded outbound client an add-on's server half is handed
 * (26-add-on-runtime.md §5.5, D4; 24 D14).
 *
 * ─── Declaring is not enforcing, and this is the wave where that matters ────
 *
 * 24 D14 rules that an add-on's egress is an exact-hostname allow-list, and
 * until now that list was a field in a JSON document nobody consulted at
 * runtime. `validate.ts` refuses `outbound-http` without a non-empty list
 * (`NETWORK_ALLOW_REQUIRED`), which makes the DECLARATION well-formed and stops
 * exactly nothing at the moment a call is made. This module is the moment.
 *
 * ─── What this actually enforces, stated without overclaim ─────────────────
 *
 * §5.5 says a call to an undeclared host "fails at the socket". **It does not,
 * and it cannot while 24 D13 stands.** An add-on's server half runs in this
 * process with no sandbox, so it can reach `globalThis.fetch`, `node:net`, or
 * `node:http` directly, and nothing short of a process-level permission model
 * or a child process could stop it. What this module provides is a client that
 * REFUSES, handed to the add-on so it has no reason to build its own — and
 * every refusal audited so an operator can see one being attempted.
 *
 * The control that is actually load-bearing against a hostile add-on remains
 * D13's first-party publisher gate; this is the control against an honest
 * add-on with a bug, a misconfiguration, or a dependency that phones home. Both
 * are worth having. Only one of them is a sandbox, and neither is called one
 * here. (O1 — whether server halves should run in-process at all — is still
 * unratified, and this module is the reason to answer it.)
 *
 * ─── Why a redirect is refused rather than re-checked ──────────────────────
 *
 * A redirect is THE way out of a hostname allow-list: the check necessarily
 * runs on the URL before the request, so `fetch`'s default of following one
 * would let an allowed host hand back `302 Location: https://anywhere` and be
 * obeyed. Following-with-a-recheck would work, but "refuse and say where it
 * tried to send you" is a better failure for a first-party integration talking
 * to a documented API — and it is the same decision the add-on catalog client
 * made for the same reason.
 */

import { auditRepo, type MetaDb } from '@adminium/meta';

import { hostnameAllowed, type EgressRefusal } from './egress-policy.js';

export type { EgressRefusal };

/** A refused or failed outbound call, typed so the audit row can name it. */
export class AddOnEgressError extends Error {
  override readonly name = 'AddOnEgressError';
  readonly reason: EgressRefusal;
  /** The add-on that tried. */
  readonly addOnKey: string;
  /** Where it tried to go, with any credentials stripped. */
  readonly target: string;

  constructor(reason: EgressRefusal, addOnKey: string, target: string, message: string) {
    super(message);
    this.reason = reason;
    this.addOnKey = addOnKey;
    this.target = target;
  }
}

/** What the audit hook is told about a refusal. */
export interface EgressRefusalRecord {
  addOnKey: string;
  reason: EgressRefusal;
  target: string;
  allow: readonly string[];
}

export interface AddOnHttpClientOptions {
  /** The add-on's manifest key — what an audit row names. */
  key: string;
  /** `addOn.network.allow` — exact hostnames, no wildcards, no ports (D14). */
  allow: readonly string[];
  /**
   * Whether the manifest declares the `outbound-http` capability.
   *
   * FALSE MEANS REFUSE EVERYTHING, including hosts that somehow appear in
   * `allow`. §5.5: "An add-on that declares no `outbound-http` capability gets
   * a client that refuses everything." The capability is the consent the
   * operator gave; the allow-list only narrows it.
   */
  hasOutboundHttp: boolean;
  /** Injected so tests can observe calls; defaults to the global fetch. */
  fetchImpl?: typeof globalThis.fetch | undefined;
  /** Called on every refusal. The route wires this to the audit log. */
  onRefusal?: ((record: EgressRefusalRecord) => void | Promise<void>) | undefined;
  /** Wall-clock budget per request. */
  timeoutMs?: number | undefined;
  /** Cap on a response body, enforced while streaming. */
  maxResponseBytes?: number | undefined;
}

export const DEFAULT_EGRESS_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/** The fetch-shaped function an add-on's server half receives. */
export type AddOnHttpClient = (
  input: string | URL,
  init?: Omit<RequestInit, 'redirect' | 'signal'>,
) => Promise<Response>;

/**
 * Builds the one client an add-on is given.
 *
 * `init.redirect` and `init.signal` are deliberately excluded from the type: an
 * add-on that could set `redirect: 'follow'` could undo the allow-list, and one
 * that could replace the signal could remove the timeout.
 */
export function createAddOnHttpClient(opts: AddOnHttpClientOptions): AddOnHttpClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EGRESS_TIMEOUT_MS;
  const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const doFetch = (): typeof globalThis.fetch => opts.fetchImpl ?? globalThis.fetch;

  async function refuse(reason: EgressRefusal, target: string, message: string): Promise<never> {
    await opts.onRefusal?.({ addOnKey: opts.key, reason, target, allow: opts.allow });
    throw new AddOnEgressError(reason, opts.key, target, message);
  }

  return async (input, init) => {
    const raw = typeof input === 'string' ? input : input.href;

    // No capability ⇒ nothing is reachable, and the message says why rather
    // than reading as a network error the add-on might retry.
    if (!opts.hasOutboundHttp) {
      return refuse(
        'NO_OUTBOUND_CAPABILITY',
        raw,
        `"${opts.key}" does not declare the outbound-http capability, so it cannot make network ` +
          'requests. Add the capability to its manifest and reinstall it.',
      );
    }

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return refuse('MALFORMED_URL', raw, `"${raw}" is not a URL.`);
    }

    const verdict = hostnameAllowed(url, opts.allow);
    if (verdict !== 'ok') {
      return refuse(
        verdict,
        // Credentials stripped before anything records the target: a refused
        // URL still ends up in an audit row and a log line.
        `${url.protocol}//${url.host}${url.pathname}`,
        `"${opts.key}" tried to reach ${url.host}, which is not in the hostnames its manifest ` +
          `declares (${opts.allow.join(', ') || 'none'}).`,
      );
    }

    let response: Response;
    try {
      response = await doFetch()(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return refuse('REQUEST_FAILED', url.host, `Request to ${url.host} failed: ${String(error)}`);
    }

    // See the header: a redirect is the way out of an allow-list.
    if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
      return refuse(
        'REDIRECTED',
        url.host,
        `${url.host} answered with a redirect to ${response.headers.get('location') ?? '<opaque>'}; ` +
          'an add-on\'s allow-list is a list of hosts it may reach, so redirects are not followed.',
      );
    }

    const declared = Number(response.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return refuse(
        'RESPONSE_TOO_LARGE',
        url.host,
        `${url.host} declared a ${declared}-byte response, over the ${maxBytes}-byte limit.`,
      );
    }

    const body = response.body;
    if (body === null) return response;

    // Metered rather than buffered wholesale: the add-on is in this process, so
    // a response big enough to exhaust memory takes the whole server with it.
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return refuse(
          'RESPONSE_TOO_LARGE',
          url.host,
          `${url.host} sent more than the ${maxBytes}-byte limit.`,
        );
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    // Re-wrapped so the caller gets an ordinary Response with the metered body.
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/**
 * The client for ONE installed add-on, with its refusals wired to the audit log.
 *
 * This is the seam 26-T09/T10 hand to an add-on's server half: the add-on never
 * constructs a client, it is given this one. Built from the manifest rather
 * than from arguments, so the allow-list a call is checked against is
 * necessarily the one the operator consented to at install — there is no way to
 * pass a wider list than the manifest declares.
 *
 * §5.5 asks for refusals in the audit trail, and they go in under the `add-on`
 * category as `add-on.egress-refused`. That row is the whole operator-facing
 * value of this guard: an add-on quietly trying to reach a host it never
 * declared is exactly the thing nobody would otherwise find out about.
 */
export function addOnHttpClientFor(
  meta: MetaDb,
  manifest: {
    key: string;
    capabilities?: readonly string[] | undefined;
    addOn: { network?: { allow: readonly string[] } | undefined };
  },
  overrides: Pick<AddOnHttpClientOptions, 'fetchImpl' | 'timeoutMs' | 'maxResponseBytes'> = {},
): AddOnHttpClient {
  return createAddOnHttpClient({
    key: manifest.key,
    allow: manifest.addOn.network?.allow ?? [],
    hasOutboundHttp: manifest.capabilities?.includes('outbound-http') ?? false,
    ...overrides,
    onRefusal: async (record) => {
      await auditRepo(meta).append({
        actorKind: 'system',
        actorId: null,
        // The ADD-ON is the actor here, not a person: nobody clicked anything,
        // and naming a user would attribute the attempt to whoever happened to
        // trigger the code path.
        actorLabel: `add-on:${record.addOnKey}`,
        category: 'add-on',
        action: 'add-on.egress-refused',
        changes: {
          after: {
            key: record.addOnKey,
            reason: record.reason,
            target: record.target,
            declared: [...record.allow],
          },
        },
      });
    },
  });
}
