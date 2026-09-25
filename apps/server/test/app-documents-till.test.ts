// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A till's documents through its staff screen, on SQLite, Postgres and MySQL.
 *
 * A receipt lists a ticket's lines, and a line the cashier voided is not on
 * it: the app's mapping leaves rows out of a child list by the child's own
 * columns. A shelf-label sheet prints as many labels as the screen asks for:
 * the screen sends a value for the one slot the app lets a request fill
 * (`requestValues: ["count"]`), typed by the outline — and nothing else. Not a
 * mapped column, not a slot the add-on fills itself (the day, the number),
 * not a money figure, a name or an address, not a value the operator typed
 * into the profile. A sheet drawn with a request's values says so, is never
 * emailed on its own, and never feeds a later draw.
 *
 * And a document of an app whose add-on is switched off for it is refused on
 * every door, not only the app's own: the generic render route and the
 * automation step too.
 */
import { appTablesRepo, documentProfilesRepo, documentsRepo } from '@adminium/meta';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runDocumentRenderAction } from '../src/automations/actions/document-render.js';
import { addOnAvailability, realIdIn } from '../src/documents/app-documents.js';
import { installedShapes, makeAppProfiles } from '../src/documents/app-profiles.js';
import { renderDocument } from '../src/documents/render.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';

import { addOnHarness, addOnManifest, appManifest, ENGINES, type Harness } from './app-add-ons.helpers.js';

/** The kinds the stand-in add-on draws, as its outline describes them. */
const KINDS: Record<string, { id: string; type: string; required: boolean; default?: string; columns?: { id: string; type: string }[] }[]> = {
  receipt: [
    { id: 'number', type: 'text', required: false },
    { id: 'amount', type: 'money', required: true },
    { id: 'lines', type: 'collection', required: false, columns: [{ id: 'description', type: 'text' }, { id: 'amount', type: 'money' }] },
  ],
  // As Barcode Labels describes its sheet: `count` is the labels to print.
  'label-sheet': [
    { id: 'sku', type: 'text', required: true },
    { id: 'code', type: 'text', required: true },
    { id: 'reference', type: 'text', required: true },
    { id: 'count', type: 'number', required: false },
    { id: 'on', type: 'date', required: true, default: 'now' },
    // Nothing maps these, and the app lets a request fill none of them.
    { id: 'number', type: 'text', required: false, default: 'sequence' },
    { id: 'price', type: 'money', required: false },
    { id: 'signedName', type: 'text', required: false },
    { id: 'email', type: 'email', required: false },
    { id: 'copies', type: 'number', required: false },
  ],
  // A card for the shelf, drawn as a PDF, under a file name the add-on chose badly.
  'price-card': [{ id: 'reference', type: 'text', required: true }],
};

/** A provider that prints the subject it is given, and keeps what it drew. */
function provider() {
  const drawn: { kind: string; subject: { fields: Record<string, unknown>; collections: Record<string, Record<string, unknown>[]> } }[] = [];
  const module = {
    key: 'printing',
    kinds: () => Object.keys(KINDS).map((id) => ({ id, formats: id === 'price-card' ? (['pdf', 'html'] as const) : (['html'] as const), paper: ['a4'] })),
    describe: (kind: string) => ({ slots: KINDS[kind] ?? [] }),
    render: (input: { kind: string; subject: (typeof drawn)[number]['subject'] }) => {
      drawn.push({ kind: input.kind, subject: input.subject });
      const bytes = new TextEncoder().encode(JSON.stringify(input.subject));
      if (input.kind === 'price-card') {
        const name = 'Oat "milk"\r\nSet-Cookie: a=b\\ card\u0007';
        return Promise.resolve([
          { format: 'pdf' as const, filename: `${name}.pdf`, mediaType: 'application/pdf', bytes, locale: 'en-US', warnings: [] },
          { format: 'html' as const, filename: `${name}.html`, mediaType: 'text/html; charset=utf-8', bytes, locale: 'en-US', warnings: [] },
        ]);
      }
      return Promise.resolve([
        { format: 'html' as const, filename: `${input.kind}.html`, mediaType: 'text/html; charset=utf-8', bytes, locale: 'en-US', warnings: [] },
      ]);
    },
  };
  const runtime = {
    providers: new Map([['document-render@1', [{ addOnKey: 'printing', contract: 'document-render', version: 1, module }]]]),
    slots: new Map(),
    conflicts: [],
    problems: [],
  } as unknown as AddOnRuntimeState;
  return { drawn, runtime };
}

const id = { ref: 'id', type: 'int', role: 'pk' };

const till = () =>
  appManifest('till', {
    name: 'Till',
    requiredSchema: {
      tables: [
        { ref: 'menu_items', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'barcode', type: 'text', maxLength: 20, nullable: true }] },
        { ref: 'tickets', columns: [id, { ref: 'number', type: 'text', maxLength: 24, nullable: true }, { ref: 'total', type: 'decimal', scale: 2, nullable: true }] },
        {
          ref: 'ticket_lines',
          columns: [
            id,
            { ref: 'ticket_id', type: 'fk', references: 'tickets' },
            { ref: 'position', type: 'int', default: 0 },
            { ref: 'kind', type: 'text', maxLength: 16, default: 'item' },
            { ref: 'name', type: 'text', maxLength: 120, nullable: true },
            { ref: 'amount', type: 'decimal', scale: 2, nullable: true },
            { ref: 'voided', type: 'bool', default: false },
          ],
        },
      ],
    },
    addOns: { suggests: [{ key: 'printing', range: '>=1.0.0', reason: { 'en-US': 'Prints receipts and labels.' } }] },
    documents: [
      {
        kind: 'receipt',
        addOn: 'printing',
        table: 'tickets',
        name: 'Till receipt',
        mapping: {
          number: { column: 'number' },
          amount: { column: 'total' },
          lines: {
            collection: {
              table: 'ticket_lines',
              via: 'ticket_id',
              orderBy: 'position',
              columns: { description: 'name', amount: 'amount' },
              where: { column: 'kind', in: ['item'] },
              unless: 'voided',
            },
          },
        },
      },
      {
        kind: 'label-sheet',
        addOn: 'printing',
        table: 'menu_items',
        name: 'Shelf labels',
        mapping: { sku: { column: 'id' }, code: { column: 'barcode' }, reference: { column: 'name' } },
        requestValues: ['count'],
      },
      { kind: 'price-card', addOn: 'printing', table: 'menu_items', name: 'Price card', mapping: { reference: { column: 'name' } } },
    ],
  });

let h: Harness | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await h?.close();
  h = undefined;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a till's documents on ${dialect}`, () => {
    const bool = (value: boolean) => (dialect === 'postgres' ? String(value) : value ? '1' : '0');
    const setUp = async () => {
      const { drawn, runtime } = provider();
      h = await addOnHarness(dialect, { documents: { runtime: () => runtime } });
      await h.stageAddOn(addOnManifest('printing', { name: 'Printing' }));
      await h.stageApp(till());
      const installed = await h.install('till', '0.2.0');
      expect(installed.statusCode, installed.body).toBe(200);
      const printing = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'printing', version: '1.0.0', attachTo: ['till'] } });
      expect(printing.statusCode, printing.body).toBe(200);
      return { harness: h, drawn };
    };
    const draw = (harness: Harness, payload: Record<string, unknown>) =>
      harness.inject({ method: 'POST', url: '/apps/till/documents/render', payload });

    it('leaves a voided line, and a line that is not an item, off the receipt', async () => {
      const { harness, drawn } = await setUp();
      await harness.rows(`insert into tickets (id, number, total) values (1, 'T-1', '5.50')`);
      await harness.rows(
        'insert into ticket_lines (id, ticket_id, position, kind, name, amount, voided) values ' +
          `(1, 1, 1, 'item', 'Latte', '3.50', ${bool(false)}), ` +
          `(2, 1, 2, 'item', 'Scone', '2.50', ${bool(true)}), ` +
          `(3, 1, 3, 'note', 'No sugar', null, ${bool(false)}), ` +
          `(4, 1, 4, 'item', 'Tea', '2.00', ${bool(false)})`,
      );
      const res = await draw(harness, { kind: 'receipt', ref: 'tickets', pk: { id: 1 } });
      expect(res.statusCode, res.body).toBe(201);
      expect(drawn.at(-1)!.subject.collections['lines']!.map((line) => [line['description'], line['amount']])).toEqual([
        ['Latte', 350],
        ['Tea', 200],
      ]);
    }, 90_000);

    it('prints as many labels as the screen asks for, and never over a mapped column', async () => {
      const { harness, drawn } = await setUp();
      await harness.rows(`insert into menu_items (id, name, barcode) values (7, 'Oat milk', '5012345678900')`);
      const labels = (values?: Record<string, unknown>) => draw(harness, { kind: 'label-sheet', ref: 'menu_items', pk: { id: 7 }, ...(values === undefined ? {} : { values }) });

      const one = await labels();
      expect(one.statusCode, one.body).toBe(201);
      expect(drawn.at(-1)!.subject.fields).toMatchObject({ sku: '7', code: '5012345678900', reference: 'Oat milk' });
      expect(drawn.at(-1)!.subject.fields['count']).toBeUndefined();
      // Unchanged and asked the same way: the same sheet.
      expect((await labels()).statusCode).toBe(200);

      const twelve = await labels({ count: 12 });
      expect(twelve.statusCode, twelve.body).toBe(201);
      expect(drawn.at(-1)!.subject.fields).toMatchObject({ count: 12, reference: 'Oat milk' });
      // Typed by the outline, as a profile's own typed value is.
      expect((await labels({ count: '12' })).statusCode).toBe(200);
      expect((await labels({ count: 24 })).statusCode).toBe(201);
      expect(drawn.at(-1)!.subject.fields['count']).toBe(24);
      // No values is the sheet it was before any were sent.
      expect((await labels()).json().id).toBe(one.json().id);

      // Refused, naming the slot, before anything is drawn or written: a mapped
      // column, a slot the outline does not have, a value its type cannot hold,
      // and every slot the app does not list — the day and the number the
      // engine fills, a money figure the add-on would print over the one it
      // works out, a signature, an address, a number the app did not name.
      const before = drawn.length;
      const register = (await documentsRepo(harness.meta).list({})).length;
      for (const [values, slot] of [
        [{ reference: 'Soya milk' }, 'reference'],
        [{ quantity: 3 }, 'quantity'],
        [{ count: 'lots' }, 'count'],
        [{ on: '2020-01-01' }, 'on'],
        [{ number: 'L-9999' }, 'number'],
        [{ price: '0.01' }, 'price'],
        [{ signedName: 'The Manager' }, 'signedName'],
        [{ email: 'someone@example.com' }, 'email'],
        [{ copies: 3 }, 'copies'],
        [{ count: 12, on: '2020-01-01' }, 'on'],
      ] as const) {
        const refused = await labels(values);
        expect(refused.statusCode, JSON.stringify(values)).toBe(400);
        expect(refused.json().error.code).toBe('DOCUMENT_VALUE_REFUSED');
        expect(refused.body).toContain(`"${slot}"`);
      }
      expect(drawn.length).toBe(before);
      expect(await documentsRepo(harness.meta).list({})).toHaveLength(register);

      // A value the operator typed into the profile is theirs: a request does not change it.
      const profile = (await documentProfilesRepo(harness.meta).listOwnedBy(harness.connectionId, 'till')).find((p) => p.kind === 'label-sheet')!;
      await documentProfilesRepo(harness.meta).patch(profile.id, { options: { ...profile.options, literals: { count: 3 } } });
      const typed = await labels({ count: 12 });
      expect(typed.statusCode).toBe(400);
      expect(typed.body).toContain('"count"');
      await documentProfilesRepo(harness.meta).patch(profile.id, { options: profile.options });

      // Bounded by the route's schema: a long text and too many values never reach a render.
      expect((await labels({ count: 'x'.repeat(2_001) })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await labels(Object.fromEntries(Array.from({ length: 33 }, (_, n) => [`s${String(n)}`, 1])))).statusCode).toBeGreaterThanOrEqual(400);
      expect(drawn.length).toBe(before);
    }, 90_000);

    it('refuses an app that lets a request fill a slot the add-on’s outline keeps for itself, before anything is written', async () => {
      const { harness } = await setUp();
      const view = await loadSnapshotView(harness.meta, harness.connectionId);
      const sync = async (requestValues: string[]) => {
        const manifest = till() as { documents: Record<string, unknown>[] };
        manifest.documents[1] = { ...manifest.documents[1], requestValues };
        return await makeAppProfiles({
          meta: harness.meta,
          manifest: manifest as never,
          connectionId: harness.connectionId,
          realId: realIdIn(view, await appTablesRepo(harness.meta).realNames(harness.connectionId, 'till')),
          shapes: await installedShapes(harness.meta),
          availability: await addOnAvailability(harness.meta, 'till', () => provider().runtime),
        });
      };
      const before = await documentProfilesRepo(harness.meta).listOwnedBy(harness.connectionId, 'till');
      for (const [slot, reason] of [
        ['on', '"on" is filled by the add-on itself (now)'],
        ['number', '"number" is filled by the add-on itself (sequence)'],
        ['price', '"price" holds money'],
        ['email', '"email" holds email'],
        ['sku', '"sku" is mapped'],
        ['quantity', 'has no slot "quantity"'],
      ] as const) {
        const result = await sync(['count', slot]);
        expect(result.refused.map((r) => r.reason).join('; '), slot).toContain(reason);
        expect(result.made.length + result.updated.length + result.removed.length).toBe(0);
      }
      expect(await documentProfilesRepo(harness.meta).listOwnedBy(harness.connectionId, 'till')).toEqual(before);
      // What the app does list is carried onto the profile the install made.
      expect(before.find((p) => p.kind === 'label-sheet')!.options).toMatchObject({ requestValues: ['count'] });
    }, 90_000);

    it('marks a sheet drawn with a request’s values, never emails it, and never draws from it again', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
      const { harness, drawn } = await setUp();
      await harness.rows(`insert into menu_items (id, name, barcode) values (7, 'Oat milk', '5012345678900')`);
      const profiles = documentProfilesRepo(harness.meta);
      const profile = (await profiles.listOwnedBy(harness.connectionId, 'till')).find((p) => p.kind === 'label-sheet')!;
      // A profile that emails what it draws, to the address in one of its slots.
      await profiles.patch(profile.id, { deliver: { emailSlot: 'code' } });

      // The row's first sheet, asked for with a count.
      const asked = await draw(harness, { kind: 'label-sheet', ref: 'menu_items', pk: { id: 7 }, values: { count: 12 } });
      expect(asked.statusCode, asked.body).toBe(201);
      const stored = (await documentsRepo(harness.meta).findById(asked.json().id))!;
      expect(stored.subject).toMatchObject({ requestValues: ['count'], fields: { count: 12, on: '2026-09-25' } });
      // Settled by a person, as a stranger's document is: never sent on its own.
      expect(stored.delivery).toBe('pending-review');

      // A later day, the row edited: its sheet is drawn from the row, not from the one a request asked for.
      vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
      await harness.rows(`update menu_items set name = 'Oat milk 1l' where id = 7`);
      const plain = await draw(harness, { kind: 'label-sheet', ref: 'menu_items', pk: { id: 7 } });
      expect(plain.statusCode, plain.body).toBe(201);
      expect(drawn.at(-1)!.subject.fields).toMatchObject({ reference: 'Oat milk 1l', on: '2026-10-02' });
      expect(drawn.at(-1)!.subject.fields['count']).toBeUndefined();
      const again = (await documentsRepo(harness.meta).findById(plain.json().id))!;
      expect(again.subject?.['requestValues']).toBeUndefined();
      // Drawn from the row alone, it is delivered the way the profile says.
      expect(again.delivery).not.toBe('pending-review');
      expect(again.delivery).not.toBeNull();
    }, 90_000);

    it('refuses a switched-off app’s document on the generic door and in an automation step', async () => {
      const { harness, drawn } = await setUp();
      await harness.rows(`insert into menu_items (id, name, barcode) values (7, 'Oat milk', '5012345678900')`);
      const profile = (await documentProfilesRepo(harness.meta).listOwnedBy(harness.connectionId, 'till')).find((p) => p.kind === 'label-sheet')!;
      const generic = () => harness.inject({ method: 'POST', url: '/documents/render', payload: { profileId: profile.id, pk: { id: 7 } } });
      expect((await generic()).statusCode).toBe(200);

      const off = await harness.inject({ method: 'PATCH', url: '/add-ons/printing', payload: { attachedTo: 'till', enabled: false } });
      expect(off.statusCode, off.body).toBe(200);
      const refused = await generic();
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error.code).toBe('FEATURE_OFF');

      // The pipeline itself, which the queued job and the automation step both call.
      const before = drawn.length;
      expect(await renderDocument(harness.pipeline!, { profileId: profile.id, pk: { id: 7 } })).toEqual({ status: 'skipped', reason: 'feature-off' });
      const step = await runDocumentRenderAction({ kind: 'document.render', profileId: profile.id } as never, {
        meta: harness.meta,
        documents: harness.pipeline!,
        source: { record: { pk: { id: 7 } } },
        rule: { createdBy: null },
        runId: 'run_1',
        text: { docOk: (n: string) => `drawn ${n}`, docSkipped: (why: string) => `skipped: ${why}` },
      } as never);
      expect(step).toEqual({ log: 'skipped: feature-off' });
      expect(drawn.length).toBe(before);

      // Switched back on, the generic door draws again.
      expect((await harness.inject({ method: 'PATCH', url: '/add-ons/printing', payload: { attachedTo: 'till', enabled: true } })).statusCode).toBe(200);
      expect((await generic()).statusCode).toBe(200);
    }, 90_000);

    it('serves a PDF to print as a PDF, and names every file safely', async () => {
      const { harness } = await setUp();
      await harness.rows(`insert into menu_items (id, name, barcode) values (7, 'Oat milk', '5012345678900')`);
      const card = await draw(harness, { kind: 'price-card', ref: 'menu_items', pk: { id: 7 } });
      expect(card.statusCode, card.body).toBe(201);
      const { printUrl, contentUrl } = card.json() as { printUrl: string; contentUrl: string };
      type Served = { statusCode: number; headers: Record<string, unknown> };
      const at = async (url: string) => (await harness.inject({ method: 'GET', url: url.replace(/^\/api\/v1/, '') })) as unknown as Served;

      const printed = await at(printUrl);
      expect(printed.statusCode).toBe(200);
      // The HTML copy, rendered in the tab, sandboxed.
      expect(printed.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(String(printed.headers['content-security-policy'])).toMatch(/^sandbox;/);

      // A PDF-only document prints as its PDF: inline, and never under the sandbox a PDF viewer may not open in.
      await harness.meta.db.updateTable('adminium_documents').set({ htmlFileId: null } as never).where('id', '=', card.json().id).execute();
      const pdf = await at(printUrl);
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['content-security-policy']).toBeUndefined();
      expect(String(pdf.headers['content-disposition'])).toMatch(/^inline;/);

      for (const res of [printed, pdf, await at(contentUrl)]) {
        const disposition = String(res.headers['content-disposition']);
        // One header line, one plain name, and the real one spelled for the browsers that read it.
        // eslint-disable-next-line no-control-regex -- a control character in the header is what this looks for
        expect(disposition).not.toMatch(/[\u0000-\u001f\\]/);
        expect(/filename="([^"]*)"/.exec(disposition)?.[1]).toMatch(/^Oat _milk_ ?Set-Cookie: a=b_? card\.(pdf|html)$/);
        expect(disposition).toMatch(/; filename\*=UTF-8''Oat%20/);
        expect(disposition).not.toMatch(/filename\*=[^;]*(%0D|%0A|%22|%5C|%07)/i);
      }
    }, 90_000);
  });
}
