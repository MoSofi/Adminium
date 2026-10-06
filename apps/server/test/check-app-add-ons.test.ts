// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FOLDER CHECK WITH THE ADD-ONS IN SIGHT — what `checkApp` can say once it
 * is handed the manifests of the add-ons an app names (the Designer's
 * `check_app` reads the installed ones): what each adds to the customer side,
 * a link that cannot hold the add-on table's key, rows for a table that is not
 * the add-on's. Without them, the same checks are left for the apply.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { validateManifest, type AddOnManifest } from '@adminium/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { accessInWords, checkApp } from '../src/project/apps/check-app.js';
import { CARDS_KIT, cardsKitManifest } from './fixtures/cards-kit/index.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-app-add-ons-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const kit = (): AddOnManifest => {
  const read = validateManifest(cardsKitManifest());
  if (!read.ok) throw new Error(JSON.stringify(read.issues));
  return read.manifest as AddOnManifest;
};

const id = { ref: 'id', type: 'int', role: 'pk' };
function app(over: { link?: Record<string, unknown>; files?: Record<string, unknown>; sample?: unknown } = {}): void {
  const manifest = {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'local', name: 'Local' },
    license: 'UNLICENSED',
    description: { key: 'shop.description', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.18' },
    frontends: [{ side: 'staff', kind: 'none' }],
    requiredSchema: {
      prefixed: true,
      tables: [{ ref: 'orders', columns: [id, { ref: 'note', type: 'text', maxLength: 80, nullable: true }, ...(over.link === undefined ? [] : [over.link])] }],
    },
    pages: [{ ref: 'shop-orders', template: 'page-crud', title: { key: 'shop.orders', fallback: 'Orders' }, nav: { group: 'manifest:shop', icon: 'box', order: 1 }, bindings: { main: 'orders' } }],
    addOns: { suggests: [{ key: CARDS_KIT, range: '*', reason: { 'en-US': 'Gift cards.' } }] },
    publicAccess: [{ table: 'orders', methods: ['POST'], select: ['id'], writable: ['note'] }],
    ...(over.sample === undefined ? {} : { sampleData: over.sample }),
  };
  const files: Record<string, unknown> = { 'apps/shop/manifest.json': manifest, ...(over.files ?? {}) };
  for (const [path, value] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
}
const check = (addOns?: ReadonlyMap<string, AddOnManifest>) => checkApp(root, 'shop', { version: '0.3.18', ...(addOns === undefined ? {} : { addOns }) });
const said = (result: ReturnType<typeof check>, level = 'error') => result.findings.filter((finding) => finding.level === level).map((finding) => finding.message);

describe('the folder check with the add-ons in sight', () => {
  it('says what each add-on adds to the customer side, entry by entry; by name when it cannot see them', () => {
    app();
    expect(check().access).toEqual(['orders: add a row (note)', 'plus what cards-kit grants when it is connected']);
    // In sight: its entry served through the app's key, in words; the one on its own link key is not the app's.
    expect(check(new Map([[CARDS_KIT, kit()]])).access).toEqual(['orders: add a row (note)', 'Cards kit adds: cards: read (id, balance), its own row by its code']);
    // In sight and with no public side: nothing is added, and nothing is promised.
    const { publicAccess: _entries, publicKeys: _keys, ...bare } = cardsKitManifest();
    const plain = validateManifest(bare);
    if (!plain.ok) throw new Error(JSON.stringify(plain.issues));
    expect(check(new Map([[CARDS_KIT, plain.manifest as AddOnManifest]])).access).toEqual(['orders: add a row (note)']);
  });

  it('an availability answered by an add-on reads as stock, not as a free slot', () => {
    const entry = { table: 'orders', kind: 'availability', methods: ['GET'], words: 'stock-kit:in-stock' };
    expect(accessInWords({ publicAccess: [entry] } as never)).toEqual(['orders: see whether it is in stock (answered by stock-kit)']);
  });

  it('a link that cannot hold the add-on table\'s key is refused at the column, and one into a table it does not have', () => {
    const seen = new Map([[CARDS_KIT, kit()]]);
    app({ link: { ref: 'card_id', type: 'text', maxLength: 20, nullable: true, rules: { addOnLink: { addOn: CARDS_KIT, table: 'cards' } } } });
    expect(said(check(seen)).join('\n')).toContain('"orders.card_id" is text, and the key of "cards-kit.cards" is int: it cannot hold it (ADD_ON_LINK_MISMATCH).');
    // Not in sight: left for the apply.
    expect(said(check()).join('\n')).not.toContain('ADD_ON_LINK_MISMATCH');
    app({ link: { ref: 'card_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: CARDS_KIT, table: 'ghosts' } } } });
    expect(said(check(seen)).join('\n')).toContain('links into "cards-kit.ghosts", and Cards kit 1.0.0 has no such table.');
    app({ link: { ref: 'card_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: CARDS_KIT, table: 'cards' } } } });
    expect(said(check(seen)).join('\n')).not.toMatch(/ADD_ON_LINK_MISMATCH|no such table/);
  });

  it('its rows for an add-on are about that add-on\'s tables, once it can see them', () => {
    const sample = { file: 'seeds/sample.json', addOns: { [CARDS_KIT]: { file: 'seeds/cards.json' } } };
    const main = { 'apps/shop/seeds/sample.json': { format: 'adminium.sample/1', app: 'shop', tables: [{ ref: 'orders', rows: [{ note: 'First' }] }] } };
    const rows = (ref: string) => ({ format: 'adminium.sample/1', app: 'shop', addOn: CARDS_KIT, tables: [{ ref, rows: [{ label: 'For Mia' }] }] });
    app({ sample, files: { ...main, 'apps/shop/seeds/cards.json': rows('ghosts') } });
    // Not in sight: the table cannot be judged, and the check says when it will be.
    expect(said(check())).toEqual([]);
    expect(said(check(), 'note').join('\n')).toContain('its tables of "cards-kit" are checked when it is applied');
    expect(said(check(new Map([[CARDS_KIT, kit()]]))).join('\n')).toContain('"ghosts" is not a table of "cards-kit"');
    app({ sample, files: { ...main, 'apps/shop/seeds/cards.json': rows('cards') } });
    expect(said(check(new Map([[CARDS_KIT, kit()]])))).toEqual([]);
  });
});
