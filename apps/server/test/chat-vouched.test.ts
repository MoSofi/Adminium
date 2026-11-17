// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A package that declares a live chat serves it only when Adminium can vouch
 * for its bytes, as forms are: a package uploaded by hand is recorded
 * nowhere, so it is not vouched for; the same bytes recorded as trusted (as
 * the bundle or the catalogue records them) are. On every engine this run
 * can reach, since what vouches is kept in the meta store.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chatAddOn } from '../../../packages/manifest/test/chat-fixture.js';
import { formsAddOn } from '../../../packages/manifest/test/forms-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { declaresChat, declaresForms, doorPackageVouched, formsPackageVouched } from '../src/forms/vouched.js';
import { packageTarball } from './app-bundle-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

describe('which packages declare a chat', () => {
  it('is a package whose add-on block names chat, and no other', () => {
    const chat = addOnManifestSchema.parse(chatAddOn());
    const forms = addOnManifestSchema.parse(formsAddOn());
    expect(declaresChat(chat)).toBe(true);
    expect(declaresForms(chat)).toBe(false);
    expect(declaresChat(forms)).toBe(false);
    // The forms name is the same judgement, under its first name.
    expect(formsPackageVouched).toBe(doorPackageVouched);
  });
});

describe.each(META_ENGINES)('a package that declares a chat — $name', (engine) => {
  let handle: MetaHandle;
  let dataDir: string;
  let store: AddOnStore;
  let manifest: AddOnManifest;
  let integrity: string;

  beforeEach(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    dataDir = await mkdtemp(join(tmpdir(), 'chat-vouched-'));
    store = createAddOnStore({ dataDir });
    manifest = addOnManifestSchema.parse(chatAddOn());
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
    expect(declaresChat(manifest)).toBe(true);
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
