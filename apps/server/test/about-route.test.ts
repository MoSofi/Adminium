/**
 * About resource (M10-T04): `GET /api/v1/about` + `GET /api/v1/about/update-check`.
 *
 * Covers the exit criterion "the About screen shows version/license", the AGPL
 * §13 source offer (01-architecture.md §9.3), the meta-store engine, and the
 * update notice's gating on `updates.checkEnabled`.
 */

import { settingsRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUpdateCheckService } from '../src/telemetry/update-check.js';
import { aboutRoutes } from '../src/routes/about/index.js';
import { APP_VERSION } from '../src/version.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

describe('GET /api/v1/about (M10-T04)', () => {
  let t: AuthTestApp;
  let cookie: string;

  beforeEach(async () => {
    t = await buildAuthApp();
    const result = await login(t.app);
    cookie = result.cookie ?? '';
  });
  afterEach(async () => {
    await t.destroy();
  });

  const getAbout = (headers: Record<string, string> = { cookie }) =>
    t.app.inject({ method: 'GET', url: '/api/v1/about', headers });

  it('reports version, AGPL-3.0 + a link to the LICENSE, the source offer, and the meta engine', async () => {
    const res = await getAbout();
    expect(res.statusCode, res.body).toBe(200);

    const { data } = res.json() as {
      data: {
        version: string;
        license: string;
        licenseUrl: string;
        sourceUrl: string;
        metaEngine: string;
        telemetry: { enabled: boolean };
        updates: { checkEnabled: boolean };
      };
    };

    expect(data.version).toBe(APP_VERSION);
    expect(data.license).toBe('AGPL-3.0-only');
    // AGPL §13: the instance links to the corresponding source + full licence.
    expect(data.sourceUrl).toBe('https://github.com/adminium/adminium');
    expect(data.licenseUrl).toContain('/LICENSE');
    // The harness runs on the SQLite meta store — reported, not hardcoded null.
    expect(data.metaEngine).toBe('sqlite');
    // Both consents render on About; both off on a fresh install.
    expect(data.telemetry.enabled).toBe(false);
    expect(data.updates.checkEnabled).toBe(false);
  });

  it('reflects the stored consents once they are flipped', async () => {
    await settingsRepo(t.meta).set('telemetry.enabled', true);
    await settingsRepo(t.meta).set('updates.checkEnabled', true);

    const { data } = (await getAbout()).json() as {
      data: { telemetry: { enabled: boolean }; updates: { checkEnabled: boolean } };
    };
    expect(data.telemetry.enabled).toBe(true);
    expect(data.updates.checkEnabled).toBe(true);
  });

  it('requires a session — an anonymous visitor cannot fingerprint the build', async () => {
    const res = await getAbout({});
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain(APP_VERSION);
  });
});

describe('GET /api/v1/about/update-check (M10-T04)', () => {
  let t: AuthTestApp;
  let cookie: string;

  /** Registers a second About instance with a stubbed release feed. */
  async function withFeed(tag: string): Promise<{ calls: string[] }> {
    const calls: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ tag_name: tag }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await t.app.register(
      async (api) => {
        await api.register(
          aboutRoutes({
            meta: t.meta,
            version: '0.5.0',
            updates: createUpdateCheckService({ meta: t.meta, version: '0.5.0', fetchImpl }),
          }),
        );
      },
      { prefix: '/api/v2' }, // a distinct prefix so it can't collide with the default wiring
    );
    await t.app.ready();
    return { calls };
  }

  // NOTE: the stub feed must be registered BEFORE the first inject — Fastify
  // boots the root plugin on the first request, and `login()` is a request.
  async function signIn(): Promise<void> {
    const result = await login(t.app);
    cookie = result.cookie ?? '';
  }

  beforeEach(async () => {
    t = await buildAuthApp();
  });
  afterEach(async () => {
    await t.destroy();
  });

  it('returns `disabled` and makes no outbound call while opted out', async () => {
    const { calls } = await withFeed('v9.9.9');
    await signIn();
    const res = await t.app.inject({ method: 'GET', url: '/api/v2/about/update-check', headers: { cookie } });

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'disabled' } });
    expect(calls, 'an opted-out instance must not reach the release feed').toEqual([]);
  });

  it('surfaces the update notice once the preference is on', async () => {
    await settingsRepo(t.meta).set('updates.checkEnabled', true);
    const { calls } = await withFeed('v0.6.0');
    await signIn();

    const res = await t.app.inject({ method: 'GET', url: '/api/v2/about/update-check', headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      data: {
        status: 'update-available',
        current: '0.5.0',
        latest: '0.6.0',
        url: 'https://github.com/adminium/adminium/releases',
      },
    });
    expect(calls).toHaveLength(1);
  });

  it('requires a session', async () => {
    await withFeed('v0.6.0');
    const res = await t.app.inject({ method: 'GET', url: '/api/v2/about/update-check' });
    expect(res.statusCode).toBe(401);
  });
});
