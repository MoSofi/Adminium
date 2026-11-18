// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A package that declares landing pages serves them only when Adminium can
 * vouch for its bytes, as forms and chat are: a package uploaded by hand is
 * recorded nowhere, so it is not vouched for; the same bytes recorded as
 * trusted (as the bundle or the catalogue records them) are. On every engine
 * this run can reach, since what vouches is kept in the meta store.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chatAddOn } from '../../../packages/manifest/test/chat-fixture.js';
import { formsAddOn } from '../../../packages/manifest/test/forms-fixture.js';
import { landingAddOn } from '../../../packages/manifest/test/landing-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { declaresChat, declaresForms, declaresLanding, doorPackageVouched } from '../src/forms/vouched.js';
import { packageTarball } from './app-bundle-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

describe('which packages declare landing pages', () => {
  it('is a package whose add-on block names landing, and no other', () => {
    const landing = addOnManifestSchema.parse(landingAddOn());
    expect(declaresLanding(landing)).toBe(true);
    expect(declaresForms(landing)).toBe(false);
    expect(declaresChat(landing)).toBe(false);
    expect(declaresLanding(addOnManifestSchema.parse(formsAddOn()))).toBe(false);
    expect(declaresLanding(addOnManifestSchema.parse(chatAddOn()))).toBe(false);
  });
});

describe.each(META_ENGINES)('a package that declares landing pages — $name', (engine) => {
  let handle: MetaHandle;
  let dataDir: string;
  let store: AddOnStore;
  let manifest: AddOnManifest;
  let integrity: string;

  beforeEach(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    dataDir = await mkdtemp(join(tmpdir(), 'landing-vouched-'));
    store = createAddOnStore({ dataDir });
    manifest = addOnManifestSchema.parse(landingAddOn());
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest) });
    integrity = sha512Integrity(tarball);
    // Staged as a hand upload stages it: its bytes are checked, and recorded nowhere as trusted.
    await store.stage({ key: manifest.key, version: manifest.version, tarball, expectedIntegrity: integrity });
  });
  afterEach(async () => {
    if (!engine.available) return;
    await handle.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  it.skipIf(!engine.available)('uploaded by hand, is not vouched for', async () => {
    expect(declaresLanding(manifest)).toBe(true);
    expect(await doorPackageVouched(store, handle.meta, { key: manifest.key, version: manifest.version })).toBe(false);
  });

  it.skipIf(!engine.available)('is vouched for once its bytes are recorded as trusted, and not for other bytes', async () => {
    await recordDeciderTrust(handle.meta, { key: manifest.key, version: manifest.version, integrity: `sha512-${'A'.repeat(86)}==` });
    expect(await doorPackageVouched(store, handle.meta, { key: manifest.key, version: manifest.version })).toBe(false);
    await recordDeciderTrust(handle.meta, { key: manifest.key, version: manifest.version, integrity });
    expect(await doorPackageVouched(store, handle.meta, { key: manifest.key, version: manifest.version })).toBe(true);
  });

  it.skipIf(!engine.available)('is not vouched for when nothing of it is on disk', async () => {
    await recordDeciderTrust(handle.meta, { key: manifest.key, version: '9.9.9', integrity });
    expect(await doorPackageVouched(store, handle.meta, { key: manifest.key, version: '9.9.9' })).toBe(false);
  });
});
