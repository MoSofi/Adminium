// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DOCUMENT'S OPTIONS, TRIGGER AND DELIVERY, AS AN APP'S FILE GIVES THEM.
 *
 * The profile an install makes takes them when it is first made: the
 * options under the app's own, the change that draws it (a rule, written the
 * way the documents screen writes one), and whether it is kept. Where it is
 * mailed is never taken from the file: the slot arrives empty, an "after you
 * install" item. Once made, all three are the operator's: an update does not
 * write them again, and the uninstall takes the rule with the profile.
 */
import { automationsRepo, documentProfilesRepo } from '@adminium/meta';
import { bareAddress } from '../src/installs/resolve.js';
import { onlyInstall } from './only-install.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { automationHashOf, installAutomations } from '../src/apps/manifest-automations.js';
import { deliveryItems } from '../src/apps/saved-parts.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { installedShapes, makeAppProfiles, removeAppProfiles } from '../src/documents/app-profiles.js';
import { installStudio, studioManifest, type StudioHarness } from './app-documents.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest changed freely
type Doc = Record<string, any>;

function seeded(options: Doc = { locale: 'de-DE', paper: 'a4', formats: ['pdf'], prefix: 'ST-', literals: { footer: 'Thank you' } }): Doc {
  const manifest = studioManifest() as Doc;
  manifest['compatibility'] = { ...manifest['compatibility'], minAdminiumVersion: '0.3.49' };
  manifest['documents'][0] = {
    ...manifest['documents'][0],
    options,
    trigger: { event: 'record.updated', when: { column: 'status', value: 'sent' } },
    deliver: { store: true, emailSlot: 'clientEmail' },
  };
  // A rule of the app's own that draws the document: bound to the app's profile here.
  manifest['automations'] = [
    {
      key: 'draw-on-change',
      name: 'Draw the invoice',
      enabled: true,
      trigger: { kind: 'record', event: 'updated', table: 'invoices', changedColumn: 'status' },
      graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'Changed' }, { id: 'd', kind: 'action', title: 'Draw', action: { kind: 'document.render', document: { table: 'invoices', kind: 'invoice' } } }] },
    },
  ];
  return manifest;
}

describe.each(LEGS)('a document seeded by its app on %s', (dialect, reachable) => {
  let h: StudioHarness;
  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect, seeded());
  }, 240_000);
  afterAll(async () => {
    await h?.close();
  });
  const invoice = async () => (await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio')).find((p) => p.kind === 'invoice')!;

  it.skipIf(!reachable)('is made with the options, the rule that draws it on the change, and nowhere to mail it yet', async () => {
    const profile = await invoice();
    expect(profile.options).toMatchObject({ locale: 'de-DE', paper: 'a4', formats: ['pdf'], prefix: 'ST-', literals: { footer: 'Thank you' } });
    expect(profile.deliver).toEqual({ store: true, emailSlot: null });
    expect(profile.trigger).toMatchObject({ event: 'record.updated', when: { column: 'status', op: 'is', value: 'sent' }, automationId: expect.any(String) });
    const rule = (await automationsRepo(h.meta).findById(profile.trigger!.automationId!))!;
    expect(rule.trigger).toMatchObject({ kind: 'record', event: 'updated', table: profile.table, watch: false, changedColumn: 'status', when: [{ left: { field: 'status' }, op: 'is', right: 'sent' }] });
    expect((rule.graph.nodes as Doc[])[1]!['action']).toEqual({ kind: 'document.render', profileId: profile.id });
    /*
     * The app's own rule that draws it. Its rules were written before the add-on could draw
     * (the profile was made once the add-on answered): the step waited, empty, and the rule
     * off. The next write of its rules binds the profile, and the switch stays the owner's.
     */
    const [waiting] = await automationsRepo(h.meta).listManagedBy('studio', h.connectionId);
    expect(waiting).toMatchObject({ templateKey: 'draw-on-change', enabled: false });
    expect((waiting!.graph.nodes as Doc[])[1]!['action']).toEqual({ kind: 'document.render', profileId: null });
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const rewritten = await installAutomations({ meta: h.meta, manifest: seeded() as never, install: bareAddress((await onlyInstall(h.meta, 'studio')).installId, 'studio'), connectionId: h.connectionId, view, realId: (ref) => h.realId(ref) ?? ref });
    expect(rewritten).toMatchObject({ written: ['draw-on-change'], afterInstall: [] });
    const [drawing] = await automationsRepo(h.meta).listManagedBy('studio', h.connectionId);
    expect((drawing!.graph.nodes as Doc[])[1]!['action']).toEqual({ kind: 'document.render', profileId: profile.id });
    expect(drawing!.contentHash).toBe(automationHashOf(drawing!));
    // The slot it is mailed to is the owner's to choose here.
    expect(deliveryItems(seeded() as never, [profile], h.realId)).toEqual([{ kind: 'delivery', item: 'invoices/invoice', field: 'deliver.emailSlot' }]);
    expect(deliveryItems(seeded() as never, [{ ...profile, deliver: { store: true, emailSlot: 'clientEmail' } }], h.realId)).toEqual([]);
  });

  it.skipIf(!reachable)('an update leaves what the operator made of them; the uninstall takes the rule with the profile', async () => {
    const before = await invoice();
    await documentProfilesRepo(h.meta).patch(before.id, { options: { ...before.options, paper: 'letter' } });
    const again = await makeAppProfiles({ meta: h.meta, manifest: seeded({ locale: 'fr-FR', paper: 'a5' }) as never, connectionId: h.connectionId, realId: h.realId, shapes: await installedShapes(h.meta), at: Date.now() + 60_000 });
    expect(again.made).toEqual([]);
    const after = await invoice();
    expect(after.options).toMatchObject({ locale: 'de-DE', paper: 'letter' });
    expect(after.trigger?.automationId).toBe(before.trigger?.automationId);

    await removeAppProfiles(h.meta, h.connectionId, 'studio');
    expect(await automationsRepo(h.meta).findById(before.trigger!.automationId!)).toBeNull();
  });
});
