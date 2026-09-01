// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local-bridge routes: `GET /bridge/hello`, `POST /bridge/handoff`,
 * `GET /bridge/seed/:ticket`.
 *
 * These tests are the bridge's security argument, written down. The resource
 * accepts a credential-bearing string from a cross-origin page, so the three
 * gates in `routes/bridge/index.ts` — allow-listed origin, pairing code,
 * authenticated session — each get their own failing case, and the headers a
 * browser relies on to enforce gate 1 are asserted rather than assumed.
 *
 * The last block covers what the gates leave behind: every hand-off outcome
 * writes an `auth`-category row naming the origin that presented the code, and
 * none of them writes the code, the ticket or the DSN.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditRepo } from '@adminium/meta';

import { createBridgeStore, type BridgeStore } from '../src/bridge/store.js';
import { bridgeRoutes } from '../src/routes/bridge/index.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import type { InjectPayload } from './helpers.js';

const SITE = 'https://adminium.dev';
const EVIL = 'https://evil.example';
const CODE = 'ABCD2345';
const DSN = 'postgres://u:p@localhost:5432/shop';

describe('local bridge routes', () => {
  let t: AuthTestApp;
  let cookie: string;
  let store: BridgeStore;

  beforeEach(async () => {
    t = await buildAuthApp();
    store = createBridgeStore();
    await t.app.register(rbacPlugin, { meta: t.meta });
    await t.app.register(
      async (api) => {
        await api.register(
          bridgeRoutes({
            meta: t.meta,
            origins: [SITE],
            pairingCode: CODE,
            store,
            version: '9.9.9',
          }),
        );
      },
      { prefix: '/api/v1' },
    );
    await t.app.ready();
    cookie = (await login(t.app)).cookie ?? '';
  });
  afterEach(async () => {
    await t.destroy();
  });

  const handoff = (payload: InjectPayload, origin: string | undefined = SITE) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/bridge/handoff',
      headers: origin === undefined ? {} : { origin },
      payload,
    });

  // ── gate 1: origin ─────────────────────────────────────────────────────────

  describe('gate 1 — origin allow-list', () => {
    it('greets an allow-listed origin and echoes it back', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: '/api/v1/bridge/hello',
        headers: { origin: SITE },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(SITE);
      // Echoing one origin means a shared cache must key on it.
      expect(res.headers['vary']).toContain('Origin');
      expect(res.json()).toMatchObject({
        data: { product: 'adminium', version: '9.9.9', connectPath: '/studio/connect' },
      });
    });

    it('never sends Allow-Credentials, so cross-origin calls carry no cookies', async () => {
      // This is what lets gate 3 treat a session cookie as proof of same-origin:
      // a credentialed cross-origin POST would otherwise be a CSRF primitive
      // against an authenticated admin panel.
      const res = await t.app.inject({
        method: 'GET',
        url: '/api/v1/bridge/hello',
        headers: { origin: SITE },
      });
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('refuses an origin that is not on the list', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: '/api/v1/bridge/hello',
        headers: { origin: EVIL },
      });
      expect(res.statusCode).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('refuses a hand-off from an origin that is not on the list', async () => {
      const res = await handoff({ code: CODE, dsn: DSN }, EVIL);
      expect(res.statusCode).toBe(403);
      expect(store.size()).toBe(0);
    });

    it('answers the preflight with the methods and headers the site needs', async () => {
      const res = await t.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/bridge/handoff',
        headers: { origin: SITE, 'access-control-request-method': 'POST' },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(SITE);
      expect(res.headers['access-control-allow-methods']).toContain('POST');
      expect(res.headers['access-control-allow-headers']).toContain('content-type');
    });

    it('opts into Private Network Access only when the browser asks', async () => {
      // Chrome preflights every public→loopback request with this header; the
      // hand-off is dead in Chrome without the matching answer. It must not
      // appear otherwise — an unconditional grant is a broader claim than the
      // one the site actually needs.
      const asked = await t.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/bridge/handoff',
        headers: {
          origin: SITE,
          'access-control-request-method': 'POST',
          'access-control-request-private-network': 'true',
        },
      });
      expect(asked.headers['access-control-allow-private-network']).toBe('true');

      const notAsked = await t.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/bridge/handoff',
        headers: { origin: SITE, 'access-control-request-method': 'POST' },
      });
      expect(notAsked.headers['access-control-allow-private-network']).toBeUndefined();
    });

    it('refuses a preflight from a disallowed origin, with no allow headers', async () => {
      const res = await t.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/bridge/handoff',
        headers: { origin: EVIL, 'access-control-request-method': 'POST' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-private-network']).toBeUndefined();
    });
  });

  // ── gate 2: pairing code ───────────────────────────────────────────────────

  describe('gate 2 — pairing code', () => {
    it('parks the seed and returns a ticket for the right code', async () => {
      const res = await handoff({ code: CODE, dsn: DSN, engine: 'postgres' });
      expect(res.statusCode, res.body).toBe(200);
      const { data } = res.json() as { data: { ticket: string; connectPath: string } };
      expect(data.ticket).toBeTruthy();
      expect(data.connectPath).toBe('/studio/connect');
      expect(store.size()).toBe(1);
    });

    it('accepts the code as typed, in any case', async () => {
      const res = await handoff({ code: CODE.toLowerCase(), dsn: DSN });
      expect(res.statusCode).toBe(200);
    });

    it('refuses a wrong code and parks nothing', async () => {
      const res = await handoff({ code: 'ZZZZ9999', dsn: DSN });
      expect(res.statusCode).toBe(403);
      expect(store.size()).toBe(0);
    });

    it('does not echo the DSN back in the reply', async () => {
      // The site already has the string; sending it back would only widen where
      // a credential can end up (a proxy log, an error reporter).
      const res = await handoff({ code: CODE, dsn: DSN });
      expect(res.body).not.toContain('postgres://');
    });

    it('rejects an unknown key rather than silently dropping it', async () => {
      // 422 is the house status for a Zod rejection (src/errors.ts).
      const res = await handoff({ code: CODE, dsn: DSN, sneak: 'value' });
      expect(res.statusCode).toBe(422);
    });

    it('rejects a DSN past the size cap', async () => {
      const res = await handoff({ code: CODE, dsn: 'x'.repeat(4097) });
      expect(res.statusCode).toBe(422);
    });
  });

  // ── gate 3: session ────────────────────────────────────────────────────────

  describe('gate 3 — the redemption route is session-gated', () => {
    const park = async (): Promise<string> => {
      const res = await handoff({ code: CODE, dsn: DSN, engine: 'postgres' });
      return (res.json() as { data: { ticket: string } }).data.ticket;
    };

    it('hands the DSN to an authenticated admin', async () => {
      const ticket = await park();
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/bridge/seed/${ticket}`,
        headers: { cookie },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ data: { dsn: DSN, engine: 'postgres' } });
    });

    it('refuses an anonymous caller holding a valid ticket', async () => {
      // The whole reason a guessed ticket is worthless.
      const ticket = await park();
      const res = await t.app.inject({ method: 'GET', url: `/api/v1/bridge/seed/${ticket}` });
      expect(res.statusCode).toBe(401);
    });

    it('leaves the seed redeemable after an unauthenticated attempt', async () => {
      const ticket = await park();
      await t.app.inject({ method: 'GET', url: `/api/v1/bridge/seed/${ticket}` });
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/bridge/seed/${ticket}`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
    });

    it('burns the ticket on redemption', async () => {
      const ticket = await park();
      const headers = { cookie };
      expect((await t.app.inject({ method: 'GET', url: `/api/v1/bridge/seed/${ticket}`, headers })).statusCode).toBe(200);
      const again = await t.app.inject({ method: 'GET', url: `/api/v1/bridge/seed/${ticket}`, headers });
      expect(again.statusCode).toBe(404);
    });

    it('404s an unknown ticket', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: '/api/v1/bridge/seed/00000000-0000-0000-0000-000000000000',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── the trail (this route used to be a KNOWN GAP) ──────────────────────────

  describe('the hand-off leaves an audit trail', () => {
    const rows = async () => await auditRepo(t.meta).list({ category: 'auth' });

    it('records a successful hand-off, naming the origin that presented the code', async () => {
      const res = await handoff({ code: CODE, dsn: DSN, engine: 'postgres' });
      expect(res.statusCode).toBe(200);

      const entry = (await rows()).find((e) => e.action === 'bridge_handoff');
      expect(entry, 'minting a seed for a cross-origin caller must leave a row').toBeDefined();
      // There is no principal here by design, so "who" is the origin — plus the
      // ip/user-agent/request-id `auditAuth` stamps on every auth row.
      expect(entry?.actorLabel).toBe(SITE);
      expect(entry?.actorId).toBeNull();
      expect(entry?.requestId).toMatch(/^req_[0-9a-f]{8}$/);
      expect((entry?.changes?.after as { origin?: string }).origin).toBe(SITE);
      expect((entry?.changes?.after as { engine?: string }).engine).toBe('postgres');
    });

    it('never writes the pairing code, the ticket, or the DSN into the row', async () => {
      const res = await handoff({ code: CODE, dsn: DSN, engine: 'postgres' });
      const ticket = (res.json() as { data: { ticket: string } }).data.ticket;
      const entry = (await rows()).find((e) => e.action === 'bridge_handoff');
      const serialized = JSON.stringify(entry);
      // `adminium_audit_log` is readable by anyone with `system:audit:read`;
      // all three of these are credentials that would survive there forever.
      expect(serialized).not.toContain(CODE);
      expect(serialized).not.toContain(ticket);
      expect(serialized).not.toContain(DSN);
      expect(serialized).not.toContain('postgres://');
    });

    it('records a wrong code as a REFUSAL, not as a hand-off', async () => {
      const res = await handoff({ code: 'ZZZZ9999', dsn: DSN });
      expect(res.statusCode).toBe(403);

      const all = await rows();
      expect(all.some((e) => e.action === 'bridge_handoff')).toBe(false);
      const refusal = all.find((e) => e.action === 'bridge_handoff_refused');
      expect(refusal, 'a code-guessing run is the thing this trail is for').toBeDefined();
      expect(refusal?.actorLabel).toBe(SITE);
      expect((refusal?.changes?.after as { reason?: string }).reason).toBe(
        'pairing-code-mismatch',
      );
      // The near-miss would narrow the real code for an audit-log reader.
      expect(JSON.stringify(refusal)).not.toContain('ZZZZ9999');
    });

    it('records a disallowed origin — the gate a non-browser caller walks into', async () => {
      const res = await handoff({ code: CODE, dsn: DSN }, EVIL);
      expect(res.statusCode).toBe(403);

      const refusal = (await rows()).find((e) => e.action === 'bridge_handoff_refused');
      expect(refusal).toBeDefined();
      expect(refusal?.actorLabel).toBe(EVIL);
      expect((refusal?.changes?.after as { reason?: string }).reason).toBe('origin-not-allowed');
    });
  });
});
