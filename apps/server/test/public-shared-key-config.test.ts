// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's public side is handed the key its shared links open rows with (a
 * handover page), beside its own key — and never a staff-bound key (a
 * kiosk's), nor another app's.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { connectionsRepo, manifestsRepo, publicKeysRepo, publicScopesRepo } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { buildAuthApp, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const IDENTITY = { encrypt: (v: string) => v, decrypt: (v: string) => v };

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-dash-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><body data-app="dashboard"></body>', 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-surfaces-'));
  for (const side of ['staff', 'customer']) {
    await mkdir(join(surfacesDir, 'clients', side), { recursive: true });
    await writeFile(join(surfacesDir, 'clients', side, 'index.html'), `<body data-app="clients-${side}"></body>`, 'utf8');
  }
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

describe('the public side’s surface config', () => {
  it('carries the app’s shared-link key, and no kiosk’s', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    const crypto = dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET);
    const conn = await connectionsRepo(t.meta, crypto).create({ name: 'src', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/p', dataDsn: 'postgres://rw:s@db/p' });
    await manifestsRepo(t.meta, IDENTITY).install({ manifestKey: 'clients', version: '0.2.0', kind: 'app', source: 'file', connectionId: conn.id, document: { name: 'Client Portal' } });
    const scope = await publicScopesRepo(t.meta).create({ connectionId: conn.id, side: 'customer', name: 'portal', timezone: 'Europe/London', document: JSON.stringify({ version: 1 }) });
    const tokens: Record<string, string> = {};
    for (const [purpose, staff, managedBy] of [
      ['customer', false, 'clients'],
      ['handover', false, 'clients'],
      ['kiosk', true, 'clients'],
      ['elsewhere', false, 'other-app'],
    ] as const) {
      const generated = generatePublishableKey();
      tokens[purpose] = generated.token;
      await publicKeysRepo(t.meta).create({
        name: purpose,
        prefix: generated.prefix,
        tokenHash: generated.tokenHash,
        tokenEncrypted: sealPublishableKey(crypto, generated.token),
        scopeId: scope.id,
        side: 'customer',
        appKey: 'clients',
        managedBy,
        purpose,
        ...(staff ? { requiresStaff: { appKey: 'clients', roleSlug: 'clients-kiosk' } } : {}),
      });
    }
    t.app.surfaceSettings?.invalidate();
    const customer = await t.app.inject({ method: 'GET', url: '/apps/clients/customer/surface-config.json' });
    expect(customer.statusCode, customer.body).toBe(200);
    expect(customer.json().publishableKey).toBe(tokens['customer']);
    expect(customer.json().publicKeys).toEqual({ handover: tokens['handover'] });
    expect(customer.body).not.toContain(tokens['kiosk']);
  });
});
