// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE THE INSTALL'S WORK LIVES. The route file takes a request and gives a
 * reply; what an install writes and an uninstall removes is the service's and
 * the removals module's, so an add-on that installs like an app runs the same
 * steps. And the add-on installer reaches them through a port, never by
 * importing from `apps/`: the arrow goes one way, and a cycle is refused.
 * Reads source text; no server.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { planAddOn } from '../src/add-ons/install.js';
import type { InstallCore } from '../src/add-ons/install-core.js';
import { addOnNeedsOf } from '../src/apps/add-ons.js';
import { DESK } from '../../../packages/manifest/test/desk-fixture.js';
import { manifestOf } from './rule-round-trip.helpers.js';

const src = join(import.meta.dirname, '..', 'src');
const read = (path: string): string => readFileSync(join(src, path), 'utf8');

describe('the app route file', () => {
  const route = read('routes/apps/index.ts');

  it('writes and removes nothing itself', () => {
    for (const call of [
      'removeManifestRules(',
      'removeOutbox(',
      'uninstallAppDocuments(',
      'forgetAppRoleGrants(',
      'planInstall(',
      'materialiseManifestPages(',
      'writeManifestRules(',
      'writeManifestRoles(',
      'installPublicAccess(',
    ]) {
      expect(route.includes(call), call).toBe(false);
    }
  });

  it('asks the removals for the list, the refusals and the steps of an uninstall', () => {
    for (const call of ['service.removals.listOf(', 'service.removals.checkDrop(', 'service.removals.remove(']) expect(route, call).toContain(call);
    const removal = read('apps/removal.ts');
    for (const reason of ['DROP_NEEDS_SUPER_ADMIN', 'DDL_UNAVAILABLE', 'SCHEMA_EDIT_REFUSED']) {
      expect(removal, reason).toContain(reason);
    }
    // The drop's own refusal is said in one place.
    expect(route.includes('DROP_NEEDS_SUPER_ADMIN')).toBe(false);
  });
});

describe('the add-on installer', () => {
  it('imports nothing from apps/, in any of its files', () => {
    const files = readdirSync(join(src, 'add-ons')).filter((name) => name.endsWith('.ts'));
    expect(files).toContain('install.ts');
    expect(files).toContain('install-core.ts');
    for (const name of files) {
      const text = read(`add-ons/${name}`);
      expect(/from\s+'\.\.\/apps\//.test(text) || /import\(\s*'\.\.\/apps\//.test(text), name).toBe(false);
    }
  });

  const kit = manifestOf(structuredClone(DESK));
  if (kit.kind !== 'add-on') throw new Error('fixture');

  it('plans an add-on that installs like an app through the port, on the connection it is given', async () => {
    const asked: [string, string][] = [];
    const core = {
      planFor: async (manifest: { key: string }, connectionId: string) => {
        asked.push([manifest.key, connectionId]);
        return { plan: { installable: true, problems: [], create: [{ ref: 'cards', table: 'desk_cards', columns: [] }], reuse: [], requiresSchemaChange: true }, dto: {}, existing: [] };
      },
    } as unknown as InstallCore;
    const planned = await planAddOn({ core: () => core }, kit, { attachTo: [], connectionId: 'cnx_1' });
    expect(asked).toEqual([['desk', 'cnx_1']]);
    expect(planned.plan.installable).toBe(true);
    expect(planned.plan.create.map((table) => table.ref)).toEqual(['cards']);
  });

  it('refuses it by name where nothing that installs an app is wired in, or no database is named', async () => {
    await expect(planAddOn({}, kit, { attachTo: [], connectionId: 'cnx_1' })).rejects.toMatchObject({ details: { code: 'ADD_ON_DDL_REQUIRED' } });
    await expect(planAddOn({ core: () => null }, kit, { attachTo: [], connectionId: 'cnx_1' })).rejects.toMatchObject({ details: { code: 'ADD_ON_DDL_REQUIRED' } });
    const core = { planFor: async () => { throw new Error('never asked'); } } as unknown as InstallCore;
    await expect(planAddOn({ core: () => core }, kit, { attachTo: [] })).rejects.toMatchObject({ details: { code: 'ADD_ON_SCHEMA_CONNECTION' } });
  });

  it('plans every other add-on as it always did, never asking the port', async () => {
    const plain = manifestOf({
      kind: 'add-on', manifestVersion: 1, key: 'labels', name: 'Labels', version: '1.0.0', publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT',
      description: { key: 'd', fallback: 'd' }, categories: ['data'], compatibility: { minAdminiumVersion: '0.3.1' },
      addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' } },
      requiredSchema: { tables: [{ ref: 'labels', columns: [{ ref: 'id', type: 'int', role: 'pk' }] }] },
    });
    if (plain.kind !== 'add-on') throw new Error('fixture');
    const core = { planFor: async () => { throw new Error('the port was asked'); } } as unknown as InstallCore;
    const planned = await planAddOn({ core: () => core }, plain, { attachTo: [] });
    expect(planned.plan.create.map((table) => table.ref)).toEqual(['labels']);
  });
});

describe('an add-on\'s own suggests', () => {
  it('never reach an app\'s add-on rows: only an app names add-ons to resolve', () => {
    const doc = structuredClone(DESK) as unknown as Record<string, unknown>;
    doc['addOns'] = { suggests: [{ key: 'other', range: '>=1.0.0', reason: { 'en-US': 'Goes well with it.' } }] };
    expect(addOnNeedsOf(manifestOf(doc))).toBeUndefined();
  });
});
