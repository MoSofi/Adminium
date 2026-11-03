// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN APP'S CUSTOMER SIDE MAY RUN: a 3D viewer among it.
 *
 * The engine serves an app's customer bundle at `/apps/<key>/customer/` under
 * the server's one content policy. A shopper's design editor draws a model
 * with WebGL (which the policy never names), runs its heavy work in a worker
 * made from a blob, reads the pictures packed inside a model back through
 * blob URLs (as pictures, and with fetch), and loads the shop's pictures,
 * models and fonts from this server's own public routes. Nothing else is
 * opened: no scheme or wildcard source (a named host stays the operator's:
 * the map server, a picture host), and no evaluated script.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { buildAuthApp, type AuthTestApp } from './auth-helpers.js';

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-dash-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><body data-app="dashboard"></body>', 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-surfaces-'));
  await mkdir(join(surfacesDir, 'printing', 'customer', 'assets'), { recursive: true });
  await writeFile(join(surfacesDir, 'printing', 'customer', 'index.html'), '<body data-app="printing-customer"></body>', 'utf8');
  await writeFile(join(surfacesDir, 'printing', 'customer', 'assets', 'viewer.js'), 'export {};', 'utf8');
  surfaces = discoverSurfaces(surfacesDir);
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
  await rm(surfacesDir, { recursive: true, force: true });
});

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** A policy's directives, each with its sources. */
const directives = (policy: unknown): Map<string, string[]> =>
  new Map(
    String(policy)
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0] !== '')
      .map((parts) => [parts[0]!, parts.slice(1)]),
  );

describe("an app's customer side", () => {
  it('may run a 3D viewer: blob workers, blob pictures read as pictures and with fetch, and its own pictures and fonts', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    for (const url of ['/apps/printing/customer/', '/apps/printing/customer/assets/viewer.js']) {
      const res = await t.app.inject({ method: 'GET', url, headers: { 'sec-fetch-mode': 'navigate', accept: 'text/html' } });
      expect(res.statusCode, url).toBe(200);
      const policy = directives(res.headers['content-security-policy']);
      expect(policy.get('worker-src'), url).toEqual(["'self'", 'blob:']);
      expect(policy.get('img-src'), url).toEqual(expect.arrayContaining(["'self'", 'blob:']));
      expect(policy.get('connect-src'), url).toEqual(expect.arrayContaining(["'self'", 'blob:']));
      expect(policy.get('font-src'), url).toEqual(["'self'", 'data:']);
      // Nothing more than it needs: no evaluated script, and no source that lets in any host at all.
      expect(policy.get('script-src') ?? [], url).not.toContain("'unsafe-eval'");
      for (const sources of policy.values()) expect(sources.filter((source) => /^(https?|wss?|data|blob):$/.test(source) && source !== 'blob:' && source !== 'data:').concat(sources.filter((source) => source === '*')), url).toEqual([]);
    }
  });
});
