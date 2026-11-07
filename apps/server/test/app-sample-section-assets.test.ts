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
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const pk = { ref: 'id', type: 'int', role: 'pk' };
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const PHOTO = 'a photo of the box';
const MODEL = 'glTF a model of the box';

const KIT_SAMPLE = {
  format: 'adminium.sample/1',
  app: 'stock-kit',
  tables: [{ ref: 'items', rows: [{ '@label': 'flour', name: 'Flour', opening: '10.00' }] }],
};
const kit = () => ({ manifest: { ...stockKitManifest(), sampleData: { file: 'seeds/stock.sample.json' } }, files: { 'seeds/stock.sample.json': JSON.stringify(KIT_SAMPLE) } });

/** A shop whose own `kit_media` links into the kit's items and holds a picture and a preview model of each. */
function shop(section: Record<string, unknown>, files: Record<string, string> = { 'seeds/photos/box.jpg': PHOTO, 'seeds/models/box.glb': MODEL }) {
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
            { ref: 'model', type: 'text', maxLength: 600, nullable: true, rules: { file: { accept: ['glb'], maxBytes: 30 * 1024 * 1024 } } },
          ],
        },
      ],
    },
    sampleData: { file: 'seeds/shop.sample.json', addOns: { 'stock-kit': { file: 'seeds/shop.stock-kit.sample.json' } } },
  };
  return {
    manifest,
    files: {
      'seeds/shop.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', tables: [{ ref: 'orders', rows: [{ note: 'First order' }, { note: 'Second order' }] }] }),
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
const filesOf = async (harness: Harness) => harness.meta.db.selectFrom('adminium_files').select(['id', 'mime', 'sha256', 'entityId', 'deletedAt']).execute();

describe.each(LEGS)('the files of an app\'s sample rows for an add-on — %s', (dialect, available) => {
  async function world(section: Record<string, unknown>, files?: Record<string, string>): Promise<{ harness: Harness; app: SampleApp; addOn: SampleApp }> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    const made = shop(section, files);
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
});
