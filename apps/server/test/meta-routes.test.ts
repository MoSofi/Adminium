// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Meta-placement routes: `GET /meta/placement`, `POST /meta/relocate`.
 *
 * Two properties carry this resource and neither is visible by reading the
 * handler:
 *
 *  1. The reply is FLUSHED before the restart fires. The restart closes the
 *     socket the response travels on, so a hook armed even slightly too early
 *     turns a successful relocation into a connection reset — indistinguishable
 *     to the browser from a crash, and the wizard's whole "wait for healthz"
 *     recovery depends on telling those apart.
 *  2. The DSN never comes back. `/meta/placement` answers "are you still on the
 *     embedded store?", which the wizard needs, without handing a credential to
 *     anything that can read the reply.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstRun } from '@adminium/meta';

import { metaRoutes } from '../src/routes/meta/index.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import type { MetaRelocation } from '../src/meta/relocate.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

const SECRET = 'a-sufficiently-long-test-secret';

describe('meta placement routes', () => {
  let t: AuthTestApp;
  let cookie: string;
  let dir: string;
  let relocated: MetaRelocation[];
  let onMetaRelocated: ReturnType<typeof vi.fn>;

  const mount = async (opts: { metaUrl?: string } = {}): Promise<void> => {
    const metaStore: MetaStoreHandle = {
      meta: t.meta,
      url: `sqlite:${join(dir, 'meta.db')}`,
      engine: 'sqlite',
      source: 'embedded',
      close: async () => undefined,
    };
    await t.app.register(rbacPlugin, { meta: t.meta });
    await t.app.register(
      async (api) => {
        await api.register(
          metaRoutes({
            metaStore,
            env: {
              ADMINIUM_SECRET: SECRET,
              ADMINIUM_DATA_DIR: dir,
              ...(opts.metaUrl === undefined ? {} : { ADMINIUM_META_URL: opts.metaUrl }),
            } as never,
            onMetaRelocated: onMetaRelocated as never,
          }),
        );
      },
      { prefix: '/api/v1' },
    );
    await t.app.ready();
    cookie = (await login(t.app)).cookie ?? '';
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'adminium-meta-routes-'));
    relocated = [];
    onMetaRelocated = vi.fn((event: MetaRelocation) => {
      relocated.push(event);
    });
    t = await buildAuthApp();
    await firstRun(t.meta);
  });
  afterEach(async () => {
    await t.destroy();
    await rm(dir, { recursive: true, force: true });
  });

  describe('GET /meta/placement', () => {
    it('reports the embedded store as movable, without the DSN', async () => {
      await mount();
      const res = await t.app.inject({
        method: 'GET',
        url: '/api/v1/meta/placement',
        headers: { cookie },
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({
        data: {
          source: 'embedded',
          engine: 'sqlite',
          embedded: true,
          canRelocate: true,
          reason: null,
        },
      });
      // A meta DSN is a credential. The reply must not carry one, in any field.
      expect(res.body).not.toContain(dir);
    });

    it('says a pinned instance cannot move, and why', async () => {
      await mount({ metaUrl: 'postgres://pinned/db' });
      const res = await t.app.inject({
        method: 'GET',
        url: '/api/v1/meta/placement',
        headers: { cookie },
      });

      expect(res.json().data.canRelocate).toBe(false);
      expect(res.json().data.reason).toContain('ADMINIUM_META_URL');
      expect(res.body).not.toContain('postgres://pinned/db');
    });

    it('requires settings:manage', async () => {
      await mount();
      const res = await t.app.inject({ method: 'GET', url: '/api/v1/meta/placement' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /meta/relocate', () => {
    it('replies before the restart fires, and only then fires it', async () => {
      await mount();
      const target = join(dir, 'moved.db');

      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/meta/relocate',
        headers: { cookie },
        payload: { dsn: `sqlite:${target}` },
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        data: { engine: 'sqlite', restarting: true, healthPath: '/api/v1/healthz' },
      });
      expect(res.json().data.rowsCopied).toBeGreaterThan(0);

      // The hook is armed on the reply's `finish` event, so by the time inject
      // has resolved the response the restart has been signalled exactly once —
      // never before the payload was on the wire.
      await vi.waitFor(() => {
        expect(relocated).toHaveLength(1);
      });
      expect(relocated[0]).toMatchObject({
        url: `sqlite:${target}`,
        engine: 'sqlite',
        retiredSqlitePath: join(dir, 'meta.db'),
      });
    });

    it('refuses a pinned instance with 409 and never signals a restart', async () => {
      await mount({ metaUrl: 'sqlite:/pinned/meta.db' });
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/meta/relocate',
        headers: { cookie },
        payload: { dsn: `sqlite:${join(dir, 'moved.db')}` },
      });

      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().error.code).toBe('META_URL_PINNED');
      expect(onMetaRelocated).not.toHaveBeenCalled();
    });

    it('rejects a DSN it does not recognise with 400', async () => {
      await mount();
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/meta/relocate',
        headers: { cookie },
        payload: { dsn: 'mongodb://localhost/adminium' },
      });

      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().error.code).toBe('META_DSN_INVALID');
      expect(onMetaRelocated).not.toHaveBeenCalled();
    });

    it('refuses to move a store onto itself', async () => {
      await mount();
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/meta/relocate',
        headers: { cookie },
        payload: { dsn: `sqlite:${join(dir, 'meta.db')}` },
      });

      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().error.code).toBe('META_ALREADY_THERE');
      expect(onMetaRelocated).not.toHaveBeenCalled();
    });

    it('rejects an unknown key beside the DSN', async () => {
      await mount();
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/meta/relocate',
        headers: { cookie },
        payload: { dsn: `sqlite:${join(dir, 'moved.db')}`, secret: 'smuggled' },
      });

      // 422 VALIDATION_FAILED, the envelope every schema violation uses — the
      // point is that `.strict()` rejects rather than silently dropping a key
      // sitting next to a credential.
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
      expect(onMetaRelocated).not.toHaveBeenCalled();
    });

    it('requires settings:manage', async () => {
      await mount();
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/meta/relocate',
        payload: { dsn: `sqlite:${join(dir, 'moved.db')}` },
      });
      expect(res.statusCode).toBe(401);
      expect(onMetaRelocated).not.toHaveBeenCalled();
    });
  });
});
