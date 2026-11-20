// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reviews: the host's `review` word on the table of the rows reviewed, the
 * add-on's `addOn.reviews` block and its two tables, and `appGrants.appColumn`
 * — each rule broken once on manifests that otherwise validate.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';
// The same kit and shop the server's tests install (`apps/server/test/fixtures/reviews-kit`).
import { reviewedShopManifest, reviewsKitManifest } from './reviews-fixture.js';

type Doc = Record<string, unknown>;
const text = (doc: Doc): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`).join('\n');
};
const shop = (edit: (m: Doc & { requiredSchema: { tables: Doc[] }; publicAccess: Doc[] }) => void = () => {}): Doc => {
  const m = structuredClone(reviewedShopManifest('shop')) as Doc & { requiredSchema: { tables: Doc[] }; publicAccess: Doc[] };
  edit(m);
  return m;
};
const lines = (m: { requiredSchema: { tables: Doc[] } }) => m.requiredSchema.tables.find((table) => table['ref'] === 'order_lines')!;
const word = (m: { requiredSchema: { tables: Doc[] } }) => lines(m)['review'] as Doc;
const kit = (edit: (m: Doc & { requiredSchema: { tables: Doc[] }; publicAccess: Doc[]; roles?: Doc[] }) => void = () => {}): Doc => {
  const m = structuredClone(reviewsKitManifest()) as Doc & { requiredSchema: { tables: Doc[] }; publicAccess: Doc[] };
  edit(m);
  return m;
};
const reviews = (m: { requiredSchema: { tables: Doc[] } }) => m.requiredSchema.tables.find((table) => table['ref'] === 'reviews')!;

describe("a table's review word", () => {
  it('validates as the shop writes it, and carries the floor', () => {
    expect(text(shop())).toBe('');
    expect(installFloorWords(shop()).map((found) => found.word)).toContain('table.review');
    expect(WORD_FLOORS['table.review']).toBe('0.3.68');
    expect(text(shop((m) => (m['compatibility'] = { minAdminiumVersion: '0.3.67' })))).toContain('0.3.68');
  });

  it("names the person the row's claim reaches, never another link", () => {
    expect(text(shop((m) => (word(m)['person'] = ['order_id'])))).toContain('the person is the one the row\'s claim reaches: ["order_id","customer_id"]');
    // No entry reaches the lines as a person's own: nobody could prove they bought one.
    expect(text(shop((m) => (m.publicAccess = m.publicAccess.filter((entry) => entry['table'] === 'products'))))).toContain("as a person's own rows");
  });

  it('is stamped by Adminium alone, on a nullable moment', () => {
    expect(text(shop((m) => (m.publicAccess.find((entry) => entry['table'] === 'order_lines')!['writable'] = ['reviewed_at'])))).toContain("is Adminium's to stamp");
    expect(text(shop((m) => (word(m)['stamp'] = 'product_name')))).toContain('a nullable timestamptz');
  });

  it('is about a link, named by text, while a value along links holds', () => {
    expect(text(shop((m) => (word(m)['about'] = { link: 'product_name', name: 'product_name' })))).toContain('names what the row is about: a link');
    expect(text(shop((m) => (word(m)['when'] = { path: ['order_id', 'nothing'], in: ['shipped'] })))).toContain('"orders" has no column "nothing"');
    expect(text(shop((m) => (word(m)['when'] = { path: ['product_name', 'status'], in: ['shipped'] })))).toContain('is not a link of this app');
  });

  it('names an add-on the app names; never on an add-on\'s own table', () => {
    expect(text(shop((m) => (m['addOns'] = undefined)))).toContain('"reviews-kit" is not an add-on this manifest names');
    expect(text(kit((m) => (reviews(m)['review'] = word(reviewedShopManifest('shop') as never))))).toContain("an add-on's own tables carry no review word");
  });
});

describe("an add-on's reviews and their totals", () => {
  it('validate as the kit writes them, and carry the floors', () => {
    expect(text(kit())).toBe('');
    const words = installFloorWords(kit()).map((found) => found.word);
    expect(words).toEqual(expect.arrayContaining(['addOn.reviews', 'appGrants.appColumn']));
  });

  it('hold the columns Adminium writes, the unique set bounded on every engine', () => {
    expect(text(kit((m) => (reviews(m)['columns'] = (reviews(m)['columns'] as Doc[]).filter((column) => column['ref'] !== 'shown_name'))))).toContain('"reviews" holds the reviews, so it has a column "shown_name"');
    expect(text(kit((m) => (reviews(m)['unique'] = undefined)))).toContain('unique together app, subject_table, subject_key');
    expect(text(kit((m) => ((reviews(m)['columns'] as Doc[]).find((column) => column['ref'] === 'subject_key')!['maxLength'] = 300)))).toContain('maxLength 200');
  });

  it("an app's role moderates three columns of its own app's reviews; the add-on's roles hold none of them", () => {
    expect(text(kit((m) => ((reviews(m)['appGrants'] as Doc)['writable'] = ['state', 'stars'])))).toContain('"stars" is not writable');
    expect(text(kit((m) => ((reviews(m)['appGrants'] as Doc)['actions'] = ['read', 'update', 'delete'])))).toContain('never delete');
    expect(text(kit((m) => ((reviews(m)['appGrants'] as Doc)['appColumn'] = undefined)))).toContain('"appColumn": "app"');
    expect(text(kit((m) => ((reviews(m)['appGrants'] as Doc)['readable'] = ['id', 'person_key'])))).toContain("erasure's to read");
    expect(text(kit((m) => (m['roles'] = [{ key: 'reader', name: 'Reader', permissions: ['table:@reviews:read'] }])))).toContain("the add-on's own roles hold nothing of the reviews");
  });

  it('a stranger only reads them, held to the app', () => {
    expect(text(kit((m) => (m.publicAccess[0]!['methods'] = ['GET', 'POST'])))).toContain('which a stranger only reads');
    expect(text(kit((m) => (m.publicAccess[1]!['appColumn'] = undefined)))).toContain('an entry on it is held to its app');
    // The reviews: published ones, never whose they are, the row reviewed, or why one was hidden.
    expect(text(kit((m) => (m.publicAccess[0]!['filters'] = [])))).toContain('a fixed filter "state" eq "published"');
    expect(text(kit((m) => ((m.publicAccess[0]!['select'] as string[]).push('person_key'))))).toContain('a stranger never reads person_key of a review');
    expect(text(kit((m) => ((reviews(m)['appGrants'] as Doc)['readable'] = undefined)))).toContain('named in "readable"');
  });

  it("appColumn: a text column, which no app's role writes", () => {
    expect(text(kit((m) => ((reviews(m)['appGrants'] as Doc)['appColumn'] = 'stars')))).toContain('holds an app\'s key: a text column');
  });
});
