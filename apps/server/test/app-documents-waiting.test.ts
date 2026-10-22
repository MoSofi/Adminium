// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S DOCUMENT OF A KIND ITS ADD-ON DOES NOT DRAW YET, on SQLite,
 * Postgres and MySQL.
 *
 * A crew app ships a "signed copy" drawn by an add-on whose installed version
 * does not draw that kind yet (the app was released before the add-on's
 * update). The app's install and its update go through: the document, and
 * the email attachment made of it, are left off, and the reply says which
 * document waits for which add-on — the notice the console shows. The other
 * documents are made as ever. When the add-on is updated to a version that
 * draws the kind, the document is made then, with no step of the app's.
 */
import { documentProfilesRepo, manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { addOnAvailability, appDocumentDetached } from '../src/documents/app-documents.js';

import { addOnHarness, addOnManifest, appManifest, CRYPTO, ENGINES, type Harness } from './app-add-ons.helpers.js';

type Doc = Record<string, unknown>;

const RECEIPT = { kind: 'receipt', addOn: 'papers', table: 'sign_offs', name: 'Receipt', mapping: { signer: { column: 'signer' } } };
const SIGNED = { kind: 'signed-copy', addOn: 'papers', table: 'sign_offs', name: 'Signed copy', mapping: { signer: { column: 'signer' } } };

const crew = (version: string, documents: Doc[]) =>
  appManifest('crew', {
    name: 'Crew',
    version,
    requiredSchema: {
      tables: [
        {
          ref: 'sign_offs',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'signer', type: 'text', maxLength: 120, nullable: true },
          ],
        },
      ],
    },
    addOns: { suggests: [{ key: 'papers', range: '>=1.0.0', reason: { 'en-US': 'Draws the papers.' } }] },
    documents,
  });

/** An add-on whose loaded version draws the kinds in `kinds` (an update adds one). */
function papers() {
  const kinds = ['receipt'];
  const module = {
    key: 'papers',
    kinds: () => kinds.map((id) => ({ id, formats: ['html'], paper: ['a4'] })),
    describe: () => ({ slots: [{ id: 'signer', type: 'text', required: true }] }),
    render: () => Promise.resolve([{ format: 'html', filename: 'paper.html', mediaType: 'text/html; charset=utf-8', bytes: new TextEncoder().encode('<p>paper</p>'), locale: 'en-US', warnings: [] }]),
  };
  const runtime = {
    providers: new Map([['document-render@1', [{ addOnKey: 'papers', contract: 'document-render', version: 1, module }]]]),
    slots: new Map(),
    conflicts: [],
    problems: [],
  } as unknown as AddOnRuntimeState;
  return { kinds, runtime };
}

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a document its add-on does not draw yet on ${dialect}`, () => {
    let made: ReturnType<typeof papers>;

    const setUp = async () => {
      made = papers();
      h = await addOnHarness(dialect, { documents: { runtime: () => made.runtime } });
      await h.stageAddOn(addOnManifest('papers', { name: 'Papers' }));
      expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'papers', version: '1.0.0', attachTo: [] } })).statusCode).toBe(200);
      return h;
    };
    const kinds = async (harness: Harness) => (await documentProfilesRepo(harness.meta).listOwnedBy(harness.connectionId, 'crew')).map((profile) => profile.kind).sort();
    const draw = (harness: Harness, kind: string) => harness.inject({ method: 'POST', url: '/apps/crew/documents/render', payload: { kind, ref: 'sign_offs', pk: { id: 1 } } });
    /** Whether a message that may go without the signed copy goes without it: nothing draws it for the app. */
    const goesWithout = async (harness: Harness) => {
      const manifest = (await manifestsRepo(harness.meta, CRYPTO).findByKey('crew'))!.document as never;
      return await appDocumentDetached(harness.meta, manifest, 'sign_offs', 'signed-copy', undefined, (await addOnAvailability(harness.meta, 'crew', () => made.runtime)).kindsOf);
    };
    /** The add-on's next version, which draws the signed copy, staged and loaded. */
    const nextVersion = async (harness: Harness) => {
      await harness.stageAddOn(addOnManifest('papers', { name: 'Papers', version: '1.1.0' }));
      made.kinds.push('signed-copy');
    };
    const WAITING = {
      kind: 'signed-copy',
      table: 'sign_offs',
      addOn: 'papers',
      addOnName: 'Papers',
      name: 'Signed copy',
      reason: 'the "papers" add-on does not draw a "signed-copy" document yet, so it is left off until the add-on is updated to a version that draws it',
    };

    it('installs the app with the document left off and says so; the add-on\'s update makes it', async () => {
      const harness = await setUp();
      await harness.stageApp(crew('0.2.0', [RECEIPT, SIGNED]));
      const installed = await harness.install('crew', '0.2.0', { addOns: [{ key: 'papers', version: '1.0.0' }] });
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().documents).toEqual({ waiting: [WAITING] });
      expect(await kinds(harness)).toEqual(['receipt']);
      await harness.rows("insert into sign_offs (id, signer) values (1, 'Maria Lopez')");
      expect((await draw(harness, 'receipt')).statusCode).toBe(201);
      expect((await draw(harness, 'signed-copy')).statusCode).not.toBeLessThan(400);
      expect(await goesWithout(harness)).toBe(true);

      await nextVersion(harness);
      const updated = await harness.inject({ method: 'POST', url: '/add-ons/papers/update', payload: { to: '1.1.0' } });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await kinds(harness)).toEqual(['receipt', 'signed-copy']);
      const drawn = await draw(harness, 'signed-copy');
      expect(drawn.statusCode, drawn.body).toBe(201);
      expect(await goesWithout(harness)).toBe(false);
    }, 120_000);

    it('updates the app to a version with the document left off and says so; the add-on\'s upgrade makes it', async () => {
      const harness = await setUp();
      await harness.stageApp(crew('0.2.0', [RECEIPT]));
      expect((await harness.install('crew', '0.2.0', { addOns: [{ key: 'papers', version: '1.0.0' }] })).statusCode).toBe(200);
      expect(await kinds(harness)).toEqual(['receipt']);

      await harness.stageApp(crew('0.3.0', [RECEIPT, SIGNED]));
      const updated = await harness.inject({ method: 'POST', url: '/apps/crew/update', payload: { to: '0.3.0' } });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().to).toBe('0.3.0');
      expect(updated.json().app.documents).toEqual({ waiting: [WAITING] });
      expect(await kinds(harness)).toEqual(['receipt']);
      expect(await goesWithout(harness)).toBe(true);

      await nextVersion(harness);
      const upgraded = await harness.inject({ method: 'POST', url: '/add-ons/papers/upgrade' });
      expect(upgraded.statusCode, upgraded.body).toBe(200);
      expect(await kinds(harness)).toEqual(['receipt', 'signed-copy']);
      await harness.rows("insert into sign_offs (id, signer) values (1, 'Maria Lopez')");
      expect((await draw(harness, 'signed-copy')).statusCode).toBe(201);
    }, 120_000);
  });
}
