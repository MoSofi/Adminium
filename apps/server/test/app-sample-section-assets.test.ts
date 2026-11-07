// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FILES OF AN APP'S ROWS FOR AN ADD-ON. A section file (`sampleData.addOns.<key>.file`) ships its own
 * `assets`, as the app's own sample file does: each is checked against its sha256, added to the Files library
 * as the type an upload of it is stored as (a picture, a GLB model), and named by the section's rows with
 * `{"@asset": …}`. The files leave with the section: with the app's sample, and with the add-on's sample when
 * the section points at it. A file that is not the one the section names refuses the section, and nothing of
 * it stays.
 */
import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp, findSampleOwner, type SampleApp } from '../src/apps/sample-data.js';
import { cleanSvg } from '../src/files/svg.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { goodGlb } from './model-files.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const pk = { ref: 'id', type: 'int', role: 'pk' };
const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const PHOTO = 'a photo of the box';
const MODEL = goodGlb();
const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
/** A cut file with what the cleaner drops: a script and an `onload`. */
const CUT = `<svg ${SVG_NS} viewBox="0 0 10 10" onload="steal()"><script>alert(document.cookie)</script><rect width="10" height="10"/></svg>`;

const KIT_SAMPLE = {
  format: 'adminium.sample/1',
  app: 'stock-kit',
  tables: [{ ref: 'items', rows: [{ '@label': 'flour', name: 'Flour', opening: '10.00' }] }],
};
const kit = () => ({ manifest: { ...stockKitManifest(), sampleData: { file: 'seeds/stock.sample.json' } }, files: { 'seeds/stock.sample.json': JSON.stringify(KIT_SAMPLE) } });

/** A shop whose own `kit_media` links into the kit's items and holds a picture and a preview model of each. */
function shop(section: Record<string, unknown>, files: Record<string, string | Uint8Array> = { 'seeds/photos/box.jpg': PHOTO, 'seeds/models/box.glb': MODEL }, own: Record<string, unknown> = {}) {
  const manifest = {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.3.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.43' },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    addOns: { suggests: [{ key: 'stock-kit', range: '>=1.0.0', reason: { 'en-US': 'Keeps the stock.' } }] },
    requiredSchema: {
      tables: [
        { ref: 'orders', columns: [pk, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] },
        {
          ref: 'kit_media',
          columns: [
            pk,
            { ref: 'item_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'stock-kit', table: 'items' } } },
            { ref: 'photo', type: 'text', maxLength: 600, nullable: true, semantic: 'image', rules: { file: { accept: ['png', 'jpeg', 'webp'], maxBytes: 2 * 1024 * 1024 } } },
            // Larger than a model every visitor loads may be: the public cap holds it, as it holds an upload.
            { ref: 'model', type: 'text', maxLength: 600, nullable: true, rules: { file: { accept: ['glb'], maxBytes: 64 * 1024 * 1024 } } },
            { ref: 'cut', type: 'text', maxLength: 600, nullable: true, rules: { file: { accept: ['svg'], maxBytes: 2 * 1024 * 1024 } } },
          ],
        },
      ],
    },
    sampleData: { file: 'seeds/shop.sample.json', addOns: { 'stock-kit': { file: 'seeds/shop.stock-kit.sample.json' } } },
  };
  return {
    manifest,
    files: {
      'seeds/shop.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', tables: [{ ref: 'orders', rows: [{ note: 'First order' }, { note: 'Second order' }] }], ...own }),
      'seeds/shop.stock-kit.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', addOn: 'stock-kit', ...section }),
      ...files,
    },
  };
}

const ASSETS = { 'photo-box': { file: 'seeds/photos/box.jpg', sha256: sha(PHOTO) }, 'model-box': { file: 'seeds/models/box.glb', sha256: sha(MODEL) } };
/** An item of the shop's own for the kit, and two media rows of it: both show the same photo, one carries the model. */
const OWN_ITEM = {
  assets: ASSETS,
  tables: [
    { ref: 'items', rows: [{ '@label': 'shop-box', name: 'Box', opening: '1.00' }] },
    {
      ref: 'kit_media',
      own: true,
      rows: [
        { item_id: { '@ref': 'shop-box' }, photo: { '@asset': 'photo-box' }, model: { '@asset': 'model-box' } },
        { item_id: { '@ref': 'shop-box' }, photo: { '@asset': 'photo-box' }, model: null },
      ],
    },
  ],
};

const service = (harness: Harness) => createSampleDataService(harness.sampleData);
const OPTS = { locale: 'en-US', userId: null, userLabel: 'test' };
const REMOVE = { keepChanged: true, userId: null, userLabel: 'test' };
const count = async (harness: Harness, table: string) => Number((await harness.rows(`SELECT COUNT(*) AS n FROM ${table}`))[0]!['n']);
const media = async (harness: Harness) => (await harness.rows('SELECT id, photo, model FROM kit_media ORDER BY id')).map((row) => ({ photo: row['photo'] as string | null, model: row['model'] as string | null }));
const filesOf = async (harness: Harness) => harness.meta.db.selectFrom('adminium_files').select(['id', 'mime', 'sha256', 'sizeBytes', 'entityId', 'deletedAt']).execute();

describe.each(LEGS)('the files of an app\'s sample rows for an add-on — %s', (dialect, available) => {
  async function world(section: Record<string, unknown>, files?: Record<string, string | Uint8Array>, own?: Record<string, unknown>): Promise<{ harness: Harness; app: SampleApp; addOn: SampleApp }> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    const made = shop(section, files, own);
    const theKit = kit();
    await harness.stageAddOn(theKit.manifest, { files: theKit.files, bundled: true });
    await harness.stageApp(made.manifest, made.files);
    const installed = await harness.install('shop', '0.3.0', { addOns: [{ key: 'stock-kit', version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    return { harness, app: (await findSampleApp(harness.meta, 'shop'))!, addOn: (await findSampleOwner(harness.meta, 'stock-kit', 'add-on'))! };
  }

  it.runIf(available)('are added as an upload of each is stored, named by the rows, and removed with the app\'s sample', async () => {
    const w = await world(OWN_ITEM);
    h = w.harness;
    const added = await service(h).add(w.app, OPTS);
    expect(added.counts).toEqual({ orders: 2, 'stock-kit:items': 1, kit_media: 2 });
    // The photo, its copy for the second row, and the model.
    expect(added.files).toBe(2);
    const rows = await media(h);
    const files = new Map((await filesOf(h)).map((file) => [file.id, file]));
    expect(files.size).toBe(3);
    const [first, second] = rows;
    expect(files.get(first!.photo!)).toMatchObject({ mime: 'image/jpeg', deletedAt: null });
    expect(files.get(first!.model!)).toMatchObject({ mime: 'model/gltf-binary', deletedAt: null });
    // One asset named by two rows: each row holds a file of its own.
    expect(second!.photo).not.toBe(first!.photo);
    expect(files.get(second!.photo!)).toMatchObject({ mime: 'image/jpeg', deletedAt: null });
    expect(second!.model).toBeNull();
    // Each file is its row's.
    for (const id of [first!.photo, first!.model, second!.photo]) expect(files.get(id!)!.entityId).not.toBeNull();

    await service(h).remove(w.app, REMOVE);
    expect(await count(h, 'kit_media')).toBe(0);
    expect((await filesOf(h)).every((file) => file.deletedAt !== null)).toBe(true);
  });

  it.runIf(available)('a section that points at the add-on\'s sample takes its files away with it when that sample leaves', async () => {
    const w = await world({ assets: ASSETS, tables: [{ ref: 'kit_media', own: true, rows: [{ item_id: { '@ref': 'flour' }, photo: { '@asset': 'photo-box' }, model: { '@asset': 'model-box' } }] }] });
    h = w.harness;
    await service(h).add(w.app, OPTS);
    expect(await count(h, 'kit_media')).toBe(0);
    expect(await filesOf(h)).toEqual([]);
    // The kit's sample arrives, and the shop's waiting rows with their files.
    await service(h).add(w.addOn, OPTS);
    const [row] = await media(h);
    expect((await filesOf(h)).filter((file) => file.deletedAt === null).map((file) => file.id).sort()).toEqual([row!.photo, row!.model].sort());
    // The kit's sample leaves: the shop's rows for it go first, and their files with them; the shop's own rows stay.
    await service(h).remove(w.addOn, REMOVE);
    expect(await count(h, 'kit_media')).toBe(0);
    expect((await filesOf(h)).every((file) => file.deletedAt !== null)).toBe(true);
    expect(await count(h, 'orders')).toBe(2);
    expect((await service(h).status(w.app)).total).toBe(2);
    // And the app's own removal, after, finds nothing of the section's left to take.
    expect(await service(h).remove(w.app, REMOVE)).toMatchObject({ removed: 2 });
  });

  it.runIf(available)('a file that is not the one the section names refuses the section, and leaves nothing of it', async () => {
    const w = await world(OWN_ITEM, { 'seeds/photos/box.jpg': PHOTO, 'seeds/models/box.glb': 'another model' });
    h = w.harness;
    await expect(service(h).add(w.app, OPTS)).rejects.toThrow('The sample file "seeds/models/box.glb" is not the file the bundle names.');
    // The app's own rows are in; nothing of the section is: no rows, and no file left in the library.
    expect(await count(h, 'orders')).toBe(2);
    expect(await count(h, 'kit_media')).toBe(0);
    expect(await count(h, 'stock_kit_items')).toBe(0);
    expect((await filesOf(h)).every((file) => file.deletedAt !== null)).toBe(true);
    expect((await service(h).status(w.app)).total).toBe(2);
  });

  it.runIf(available)('a model in a column that does not take models is refused as an upload of it would be', async () => {
    const w = await world({ assets: ASSETS, tables: [{ ref: 'kit_media', own: true, rows: [{ item_id: null, photo: { '@asset': 'model-box' } }] }] });
    h = w.harness;
    // The manifest's own check says so first, before anything is read.
    await expect(service(h).add(w.app, OPTS)).rejects.toThrow(/does not fit this app/);
    expect(await count(h, 'kit_media')).toBe(0);
    expect((await filesOf(h)).every((file) => file.deletedAt !== null)).toBe(true);
  });

  /** One media row of the shop's own for the kit, given these files. */
  const mediaWith = (assets: Record<string, unknown>, row: Record<string, unknown>) => ({ assets, tables: [{ ref: 'kit_media', own: true, rows: [{ item_id: null, ...row }] }] });
  const expectNothingKept = async (harness: Harness) => {
    expect(await count(harness, 'kit_media')).toBe(0);
    expect((await filesOf(harness)).every((file) => file.deletedAt !== null)).toBe(true);
  };

  it.runIf(available)('an SVG is kept as an upload of it is: written again by the cleaner, its script and its onload gone', async () => {
    const w = await world(mediaWith({ 'cut-box': { file: 'seeds/cuts/box.svg', sha256: sha(CUT) } }, { cut: { '@asset': 'cut-box' } }), { 'seeds/cuts/box.svg': CUT });
    h = w.harness;
    await service(h).add(w.app, OPTS);
    const [row] = (await h.rows('SELECT cut FROM kit_media')) as { cut: string }[];
    const kept = (await filesOf(h)).find((file) => file.id === row!.cut);
    const cleaned = cleanSvg(Buffer.from(CUT));
    expect(cleaned.toString('utf8')).not.toMatch(/script|onload/);
    expect(kept).toMatchObject({ mime: 'image/svg+xml', sha256: sha(cleaned), deletedAt: null });
    expect(Number(kept!.sizeBytes)).toBe(cleaned.length);
  });

  it.runIf(available)('an SVG of the app\'s own sample is cleaned too', async () => {
    const own = { assets: { 'cut-box': { file: 'seeds/cuts/box.svg', sha256: sha(CUT) } }, tables: [{ ref: 'orders', rows: [{ note: 'First order' }, { note: 'Second order' }] }, { ref: 'kit_media', rows: [{ item_id: null, cut: { '@asset': 'cut-box' } }] }] };
    const w = await world({ tables: [{ ref: 'items', rows: [{ '@label': 'shop-box', name: 'Box', opening: '1.00' }] }] }, { 'seeds/cuts/box.svg': CUT }, own);
    h = w.harness;
    await service(h).add(w.app, OPTS);
    const [row] = (await h.rows('SELECT cut FROM kit_media')) as { cut: string }[];
    expect((await filesOf(h)).find((file) => file.id === row!.cut)).toMatchObject({ sha256: sha(cleanSvg(Buffer.from(CUT))) });
  });

  it.runIf(available)('an SVG the cleaner refuses (a foreignObject, a link out) refuses the sample, naming the file', async () => {
    for (const svg of [
      `<svg ${SVG_NS}><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject></svg>`,
      `<svg ${SVG_NS}><use href="https://evil.example/sprite.svg#a"/></svg>`,
    ]) {
      const w = await world(mediaWith({ 'cut-box': { file: 'seeds/cuts/box.svg', sha256: sha(svg) } }, { cut: { '@asset': 'cut-box' } }), { 'seeds/cuts/box.svg': svg });
      h = w.harness;
      await expect(service(h).add(w.app, OPTS)).rejects.toThrow(/^The sample file "seeds\/cuts\/box\.svg" cannot be kept: This SVG/);
      await expectNothingKept(h);
      await h.close();
      h = null;
    }
  });

  it.runIf(available)('a model larger than every visitor may load is refused, naming it, as an upload of it would be', async () => {
    const big = goodGlb(31 * 1024 * 1024);
    const w = await world(mediaWith({ 'model-box': { file: 'seeds/models/box.glb', sha256: sha(big) } }, { model: { '@asset': 'model-box' } }), { 'seeds/models/box.glb': big });
    h = w.harness;
    await expect(service(h).add(w.app, OPTS)).rejects.toThrow('The sample file "seeds/models/box.glb" is 31 MB. Every visitor\'s browser loads a file of its kind, so it can be at most 30 MB.');
    await expectNothingKept(h);
  });

  it.runIf(available)('a .glb that is no GLB is refused by its bytes, not taken by its name', async () => {
    for (const [bytes, said] of [
      [Buffer.from('not a model at all'), 'The sample file "seeds/models/box.glb" is not the GLB model its name says.'],
      [Buffer.from('glTF but nothing else of one'), /^The sample file "seeds\/models\/box\.glb" cannot be kept: This (GLB|is not a GLB)/],
    ] as const) {
      const w = await world(mediaWith({ 'model-box': { file: 'seeds/models/box.glb', sha256: sha(bytes) } }, { model: { '@asset': 'model-box' } }), { 'seeds/models/box.glb': bytes });
      h = w.harness;
      await expect(service(h).add(w.app, OPTS)).rejects.toThrow(said);
      await expectNothingKept(h);
      await h.close();
      h = null;
    }
  });

  it.runIf(available)('a section whose every row is left out keeps none of its files, and is not taken as loaded', async () => {
    // Pointing at the kit's sample, which is in, at a row it does not have: the row is left out.
    const w = await world(mediaWith(ASSETS, { item_id: { '@ref': 'sugar' }, photo: { '@asset': 'photo-box' }, model: { '@asset': 'model-box' } }));
    h = w.harness;
    await service(h).add(w.addOn, OPTS);
    const added = await service(h).add(w.app, OPTS);
    expect(added.counts).toEqual({ orders: 2 });
    expect(added.files).toBe(0);
    await expectNothingKept(h);
    // Its list holds the app's own rows and nothing of the section: no file entry stands in for rows that never went in.
    const ledger = (await h.rows("SELECT table_ref FROM shop_sample_data ORDER BY seq")).map((row) => row['table_ref']);
    expect(ledger).toEqual(['orders', 'orders']);
  });
});
