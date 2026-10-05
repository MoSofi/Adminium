// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a generated page offers beyond its form — a record's buttons, a tab's
 * own words, a list's filters and bulk action — a role's grant on an add-on's
 * table, and what a typed code may find. Each is checked against the
 * manifest's own tables, so a typo is refused long before an install.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, lookUpOf, stateActionKind, validateManifest, type Manifest } from '../src/index.js';
import { BULK, CARD_ACTIONS, DESK, DESK_HOST, LOOK_UP } from './desk-fixture.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests reach into a manifest freely
type Doc = Record<string, any>;

/** The messages a changed copy of a fixture is refused with; none when it validates. */
function issuesOf(base: unknown, change: (doc: Doc) => void): string[] {
  const doc = structuredClone(base) as Doc;
  change(doc);
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}
const kit = (change: (doc: Doc) => void) => issuesOf(DESK, change);
const host = (change: (doc: Doc) => void) => issuesOf(DESK_HOST, change);
const cards = (doc: Doc): Doc => doc.requiredSchema.tables[0];
const action = (doc: Doc, id: string): Doc => cards(doc).states.actions.find((candidate: Doc) => candidate.id === id);
const page = (doc: Doc): Doc => doc.pages[0].config;

describe('the fixtures', () => {
  it('validate, and read back every key they were written with', () => {
    expect(kit(() => undefined)).toEqual([]);
    expect(host(() => undefined)).toEqual([]);
    const parsed = validateManifest(structuredClone(DESK)) as { ok: true; manifest: Manifest };
    const table = parsed.manifest.requiredSchema!.tables[0]!;
    expect((table as Doc).states.actions).toEqual(CARD_ACTIONS);
    expect((table as Doc).states.actions.map(stateActionKind)).toEqual(['move', 'set', 'link', 'child']);
    expect(lookUpOf(parsed.manifest)).toEqual(LOOK_UP);
    expect((parsed.manifest as Doc).pages[0].config.bulk).toEqual([BULK]);
    const app = validateManifest(structuredClone(DESK_HOST)) as { ok: true; manifest: Manifest };
    expect((app.manifest as Doc).roles[0].tables).toEqual(DESK_HOST.roles[0].tables);
    expect(lookUpOf(app.manifest)).toBeNull();
  });

  it('name every newer word they use', () => {
    const words = (doc: unknown) => installFloorWords(doc).map((found) => found.word);
    expect(words(DESK)).toEqual(expect.arrayContaining(['states.actions', 'config.tabs', 'config.bulk', 'addOn.lookUp']));
    expect(words(DESK_HOST)).toContain('roles.tables');
    const linked = structuredClone(DESK_HOST) as Doc;
    linked.pages[0].config = { layout: { toolbar: { links: [{ label: 'New sale', href: '/p/sales' }] } } };
    expect(installFloorWords(linked)).toContainEqual({ word: 'toolbar.links', path: 'pages.0.config.layout.toolbar.links' });
  });

  it('are refused under an older floor, word by word', () => {
    const old = (base: unknown) => issuesOf(base, (doc) => { doc.compatibility.minAdminiumVersion = '0.3.1'; }).join('\n');
    expect(old(DESK_HOST)).toContain('roles.tables');
    for (const word of ['states.actions', 'config.tabs', 'config.bulk', 'addOn.lookUp']) expect(old(DESK), word).toContain(word);
  });
});

describe('a record page\'s buttons', () => {
  it('two actions never share an id, and a table offers at most twelve', () => {
    expect(kit((doc) => { action(doc, 'find').id = 'activate'; }).join()).toContain('two actions share an id');
    expect(kit((doc) => { cards(doc).states.actions = Array.from({ length: 13 }, (_, i) => ({ id: `a${String(i)}`, label: 'A', move: { to: 'active' } })); })).not.toEqual([]);
  });

  it('an action is one of the four forms, with no key of another', () => {
    expect(kit((doc) => { action(doc, 'find').set = { note: 'x' }; })).not.toEqual([]);
    expect(kit((doc) => { action(doc, 'activate').child = { table: 'card_actions', via: 'card_id', form: [] }; })).not.toEqual([]);
    expect(kit((doc) => { action(doc, 'top-up').child.set = { action: 'top_up' }; })).not.toEqual([]);
  });

  it('a move goes to a state some listed move reaches by hand', () => {
    expect(kit((doc) => { action(doc, 'activate').move.to = 'archived'; }).join()).toContain('no listed move goes to "archived"');
    expect(kit((doc) => { action(doc, 'activate').move.to = 'spent'; }).join()).toContain('every move to "spent" is planned');
  });

  it('an action that moves nothing lists states the table has', () => {
    expect(kit((doc) => { action(doc, 'send-again').in = ['active', 'lost']; }).join()).toContain('"lost" is not a state of "cards"');
  });

  it('what it sets or asks for is a column of the row that is the row\'s to write', () => {
    expect(kit((doc) => { action(doc, 'send-again').set.missing = 1; }).join()).toContain('"cards" has no column "missing"');
    expect(kit((doc) => { action(doc, 'send-again').set.status = 'closed'; }).join()).toContain('"status" is the state itself');
    expect(kit((doc) => { action(doc, 'send-again').set.id = 4; }).join()).toContain('is the row\'s key');
    expect(kit((doc) => { action(doc, 'send-again').set.label = 'x'; }).join()).toContain('"cards.label" is decided by Adminium');
    expect(kit((doc) => { action(doc, 'send-again').ask = ['resends']; }).join()).toContain('set by the action or asked for in its confirm, not both');
    expect(kit((doc) => { action(doc, 'send-again').ask = ['pin']; }).join()).toContain('"cards.pin" is kept from staff');
    expect(kit((doc) => { action(doc, 'send-again').ask = ['a', 'b', 'c', 'd', 'e']; })).not.toEqual([]);
  });

  it('{"now": true} is written to a timestamptz and nothing else', () => {
    expect(kit((doc) => { action(doc, 'send-again').set.note = { now: true }; }).join()).toContain('"cards.note" is text, not a timestamptz');
    expect(kit((doc) => { action(doc, 'send-again').set.resent_at = '@now'; }).join()).toContain('"@now" is not a value "cards.resent_at" takes');
    expect(kit((doc) => { action(doc, 'send-again').set.resent_at = '2026-01-31T10:00:00Z'; })).toEqual([]);
    expect(kit((doc) => { action(doc, 'send-again').set.resends = 'once'; }).join()).toContain('"once" is not a value "cards.resends" takes');
    expect(kit((doc) => { action(doc, 'top-up').set.action = 'refund'; }).join()).toContain('"refund" is not a value "card_actions.action" takes');
    expect(kit((doc) => { action(doc, 'top-up').set.note = { now: true }; })).not.toEqual([]);
  });

  it('a locked table lets an action write only what the lock leaves open', () => {
    const locked = (except: string[]) => kit((doc) => { cards(doc).states.lock = { when: ['active'], except }; });
    expect(locked(['resent_at', 'resends', 'recipient_email', 'activated_at', 'note'])).toEqual([]);
    expect(locked(['resent_at', 'resends', 'activated_at', 'note']).join()).toContain('add "recipient_email" to lock.except');
    // A move INTO a locked state writes under the lock too.
    expect(locked(['resent_at', 'resends', 'recipient_email', 'note']).join()).toContain('add "activated_at" to lock.except');
  });

  it('a child action adds a row of a table that points back at this one', () => {
    expect(kit((doc) => { action(doc, 'top-up').child.table = 'ghosts'; }).join()).toContain('"ghosts" is not one of this manifest\'s tables');
    expect(kit((doc) => { action(doc, 'top-up').child.table = 'words'; action(doc, 'top-up').child.via = 'word'; }).join()).toContain('"words.word" is not a foreign key to "cards"');
    // A link to another table is no link to this one.
    expect(kit((doc) => { doc.requiredSchema.tables[2].columns.push({ ref: 'action_id', type: 'fk', references: 'card_actions', nullable: true }); action(doc, 'top-up').child = { table: 'words', via: 'action_id', form: [] }; delete action(doc, 'top-up').set; }).join()).toContain('"words.action_id" is not a foreign key to "cards"');
    expect(kit((doc) => { action(doc, 'top-up').child.form = ['card_id']; }).join()).toContain('the form never asks for it');
    expect(kit((doc) => { action(doc, 'top-up').child.form = ['ghost']; }).join()).toContain('"card_actions" has no column "ghost"');
    expect(kit((doc) => { action(doc, 'top-up').child.form = ['action']; }).join()).toContain('set by the action or asked for in its form, not both');
    expect(kit((doc) => { action(doc, 'top-up').set = { card_id: 1 }; }).join()).toContain('Adminium fills it');
    expect(kit((doc) => { action(doc, 'top-up').set = { ghost: 1 }; }).join()).toContain('"card_actions" has no column "ghost"');
    expect(kit((doc) => { action(doc, 'top-up').child.form = ['a', 'b', 'c', 'd', 'e', 'f', 'g']; })).not.toEqual([]);
  });

  it('a link opens one page, and it is a page of the manifest', () => {
    expect(kit((doc) => { action(doc, 'find').link = { page: 'desk-cards', addOnPage: 'desk-look-up', param: 'card' }; }).join()).toContain('a link opens one page');
    expect(kit((doc) => { action(doc, 'find').link = { param: 'card' }; }).join()).toContain('a link opens one page');
    expect(kit((doc) => { action(doc, 'find').link = { page: 'desk-cards', param: 'card' }; })).toEqual([]);
    expect(kit((doc) => { action(doc, 'find').link = { page: 'desk-ghost', param: 'card' }; }).join()).toContain('"desk-ghost" is not one of this manifest\'s pages');
    expect(kit((doc) => { action(doc, 'find').link.addOnPage = 'desk-ghost'; }).join()).toContain('is not one of this add-on\'s own pages');
    expect(kit((doc) => { action(doc, 'find').link.addOnPage = 'other:its-page'; })).toEqual([]);
    expect(kit((doc) => { action(doc, 'find').link.param = 'Card'; })).not.toEqual([]);
  });

  it('an app may give its own tables buttons too', () => {
    const withAction = (to: string) =>
      host((doc) => {
        const sales = doc.requiredSchema.tables[0];
        sales.columns.push({ ref: 'status', type: 'enum', enum: ['open', 'paid'], default: 'open' });
        sales.states = { column: 'status', initial: 'open', moves: { open: ['paid'] }, actions: [{ id: 'pay', label: 'Take payment', move: { to } }, { id: 'list', label: 'List', link: { page: 'sales', param: 'sale' }, in: ['open'] }] };
      });
    expect(withAction('paid')).toEqual([]);
    expect(withAction('void').join()).toContain('no listed move goes to "void"');
    // An app has no code pages of its own.
    expect(host((doc) => {
      const sales = doc.requiredSchema.tables[0];
      sales.columns.push({ ref: 'status', type: 'enum', enum: ['open', 'paid'], default: 'open' });
      sales.states = { column: 'status', initial: 'open', moves: { open: ['paid'] }, actions: [{ id: 'list', label: 'List', link: { addOnPage: 'sales', param: 'sale' }, in: ['open'] }] };
    }).join()).toContain('is not one of this add-on\'s own pages');
  });
});

describe('a records page\'s tab words', () => {
  it('word a tab the page has: a table with a foreign key to the page\'s', () => {
    expect(kit((doc) => { page(doc).tabs = { ghosts: { noNew: true } }; }).join()).toContain('"ghosts" is not a table of the manifest');
    expect(kit((doc) => { page(doc).tabs = { words: { noNew: true } }; }).join()).toContain('"words" has no foreign key to "cards"');
    expect(kit((doc) => { page(doc).tabs.card_actions.title = 'Actions'; })).not.toEqual([]);
    expect(kit((doc) => { page(doc).tabs.card_actions.noNew = false; })).not.toEqual([]);
  });

  it('are read on a records page bound to a table', () => {
    expect(kit((doc) => { doc.pages[0].template = 'page-calendar'; delete page(doc).filters; delete page(doc).bulk; page(doc).calendar = { start: 'activated_at' }; }).join()).toContain('only a page-crud takes "tabs"');
  });
});

describe('a records page\'s filters', () => {
  it('name columns of the page\'s table, each once, at most six', () => {
    expect(kit((doc) => { page(doc).filters[0].column = 'ghost'; }).join()).toContain('"ghost" is not a column of the page\'s table "cards"');
    expect(kit((doc) => { page(doc).filters[1].column = 'status'; }).join()).toContain('"status" is named twice');
    expect(kit((doc) => { page(doc).filters = ['status', 'kind', 'activated_at', 'balance', 'resent_at', 'resends', 'id'].map((column) => ({ column })); })).not.toEqual([]);
  });

  it('take a control the column can be filtered with', () => {
    expect(kit((doc) => { page(doc).filters[0].control = 'date-range'; }).join()).toContain('"cards.status" cannot be filtered that way: it takes "one-of" or "any-of"');
    expect(kit((doc) => { page(doc).filters[0].column = 'note'; delete page(doc).filters[0].control; }).join()).toContain('"cards.note" cannot be filtered that way');
    expect(kit((doc) => { page(doc).filters[0].column = 'id'; delete page(doc).filters[0].control; }).join()).toContain('"cards.id" cannot be filtered that way');
    expect(kit((doc) => { page(doc).filters[0].control = 'contains'; })).not.toEqual([]);
  });
});

describe('a list\'s bulk action', () => {
  const bulk = (doc: Doc): Doc => page(doc).bulk[0];

  it('a list has at most two, under their own ids', () => {
    expect(kit((doc) => { page(doc).bulk = [BULK, BULK]; }).join()).toContain('two bulk actions share an id');
    expect(kit((doc) => { page(doc).bulk = [BULK, { ...BULK, id: 'b' }, { ...BULK, id: 'c' }]; })).not.toEqual([]);
    expect(kit((doc) => { bulk(doc).extra = 1; })).not.toEqual([]);
  });

  it('makes a row of a table that points back at the page\'s', () => {
    expect(kit((doc) => { bulk(doc).child.table = 'ghosts'; }).join()).toContain('"ghosts" is not a table of the manifest');
    expect(kit((doc) => { bulk(doc).child.via = 'note'; }).join()).toContain('"card_actions.note" is not a foreign key to the page\'s table "cards"');
    expect(kit((doc) => { bulk(doc).child.form = ['card_id']; }).join()).toContain('nobody types it');
    expect(kit((doc) => { bulk(doc).child.form = ['ghost']; }).join()).toContain('"card_actions" has no column "ghost"');
    expect(kit((doc) => { bulk(doc).child.form = ['note', 'note']; }).join()).toContain('"note" is named twice');
    expect(kit((doc) => { bulk(doc).child.form = ['action']; }).join()).toContain('typed in the form or set, not both');
    expect(kit((doc) => { bulk(doc).set = { card_id: 1 }; }).join()).toContain('it is never set');
    expect(kit((doc) => { bulk(doc).set = { ghost: 1 }; }).join()).toContain('"card_actions" has no column "ghost"');
    expect(kit((doc) => { bulk(doc).set = { action: 'refund' }; }).join()).toContain('"refund" is not a value "card_actions.action" takes');
    expect(kit((doc) => { bulk(doc).set = { amount: { now: true } }; })).not.toEqual([]);
  });

  it('reads and shows columns of the page\'s table that staff may see', () => {
    expect(kit((doc) => { bulk(doc).where.column = 'ghost'; }).join()).toContain('"ghost" is not a column of the page\'s table "cards"');
    expect(kit((doc) => { bulk(doc).where.eq = 'lost'; }).join()).toContain('"lost" is not a value "cards.status" takes');
    expect(kit((doc) => { bulk(doc).confirm.columns = ['ghost']; }).join()).toContain('"ghost" is not a column of the page\'s table "cards"');
    expect(kit((doc) => { bulk(doc).confirm.columns = ['code']; }).join()).toContain('"cards.code" is a code only its last four characters are shown of');
    expect(kit((doc) => { bulk(doc).confirm.columns = ['pin']; }).join()).toContain('"cards.pin" is a code staff never see');
    expect(kit((doc) => { cards(doc).columns.find((column: Doc) => column.ref === 'note').rules = { secret: true }; bulk(doc).where = { column: 'note', eq: 'x' }; }).join()).toContain('"cards.note" is a secret');
  });

  it('its words name the count of rows and nothing else', () => {
    expect(kit((doc) => { bulk(doc).confirm.title = 'Reissue {label}?'; }).join()).toContain('{label} is not a value these words may name');
    expect(kit((doc) => { bulk(doc).confirm.body = { 'en-US': 'All of {them}.' }; }).join()).toContain('{them} is not a value');
    expect(kit((doc) => { bulk(doc).done = 'Done for {n}'; }).join()).toContain('{n} is not a value');
  });
});

describe('a role\'s grants on an add-on\'s tables', () => {
  const grants = (doc: Doc): Doc[] => doc.roles[0].tables;

  it('are an app\'s to give, on an add-on it names', () => {
    expect(host((doc) => { grants(doc)[0]!.addOn = 'other-kit'; }).join()).toContain('"other-kit" is not an add-on this app names');
    expect(host((doc) => { doc.addOns = { requires: [{ key: 'desk', range: '>=1.0.0', reason: { 'en-US': 'Cards.' } }] }; })).toEqual([]);
    expect(kit((doc) => { doc.roles = [{ key: 'clerk', name: 'Clerk', permissions: ['table:@cards:read'], tables: [{ addOn: 'desk', table: 'cards', actions: ['read'] }] }]; }).join()).toContain('"tables" is how an app\'s role reaches an add-on\'s');
  });

  it('name a table once, with read, create or update', () => {
    expect(host((doc) => { grants(doc)[1]!.table = 'cards'; }).join()).toContain('"cashier" is granted "cards" of "desk" twice');
    expect(host((doc) => { grants(doc)[0]!.actions = ['read', 'read']; }).join()).toContain('an action is listed once');
    expect(host((doc) => { grants(doc)[0]!.actions = ['read', 'delete']; })).not.toEqual([]);
    expect(host((doc) => { grants(doc)[0]!.actions = []; })).not.toEqual([]);
    expect(host((doc) => { doc.roles[0].tables = Array.from({ length: 13 }, (_, i) => ({ addOn: 'desk', table: `t${String(i)}`, actions: ['read'] })); })).not.toEqual([]);
  });

  it('a limit narrows an action the grant gives', () => {
    expect(host((doc) => { grants(doc)[0]!.actions = ['read']; }).join()).toContain('the grant has no "update", so there is nothing for "writable" to limit');
    expect(host((doc) => { grants(doc)[0]!.actions = ['update']; }).join()).toContain('the grant has no "read", so there is nothing for "readable" to limit');
    expect(host((doc) => { grants(doc)[1]!.actions = ['read']; }).join()).toContain('the grant has no "create", so there is nothing for "creatable" to limit');
    expect(host((doc) => { grants(doc)[0]!.limit.writableValues = { label: ['x'] }; }).join()).toContain('list it in "writable" too');
  });
});

describe('what a typed code may find', () => {
  const lookUp = (doc: Doc): Doc => doc.addOn.lookUp;
  const kind = (doc: Doc, id: string): Doc => lookUp(doc).kinds.find((candidate: Doc) => candidate.id === id);

  it('is written in the look-up\'s own words and nothing more', () => {
    expect(kit((doc) => { lookUp(doc).extra = true; })).not.toEqual([]);
    expect(kit((doc) => { lookUp(doc).kinds = []; })).not.toEqual([]);
    expect(kit((doc) => { kind(doc, 'gift-card').prefix = 'gc-'; })).not.toEqual([]);
    expect(kit((doc) => { kind(doc, 'gift-card').where = [{ column: 'kind', eq: 'gift', in: ['gift'] }]; }).join()).toContain('one value (eq) or a list (in)');
    expect(kit((doc) => { kind(doc, 'gift-card').show = []; })).not.toEqual([]);
  });

  it('a kind reads one of the add-on\'s own tables by its code', () => {
    expect(kit((doc) => { kind(doc, 'word').table = 'ghosts'; }).join()).toContain('"ghosts" is not a table of this add-on');
    expect(kit((doc) => { kind(doc, 'word').code = 'ghost'; }).join()).toContain('"words" has no column "ghost"');
    expect(kit((doc) => { kind(doc, 'word').code = 'active'; kind(doc, 'word').show = ['word']; }).join()).toContain('it is a text column with a code rule, or a unique one');
    expect(kit((doc) => { kind(doc, 'gift-card').code = 'note'; }).join()).toContain('"cards.note" is compared with what was typed');
  });

  it('kinds are told apart: by id, by prefix, and by what they ask of one table', () => {
    expect(kit((doc) => { kind(doc, 'pass').id = 'gift-card'; }).join()).toContain('two kinds are called "gift-card"');
    expect(kit((doc) => { kind(doc, 'pass').prefix = 'GC-'; }).join()).toContain('two kinds claim the prefix "GC-"');
    expect(kit((doc) => { kind(doc, 'pass').where = [{ column: 'kind', eq: 'gift' }]; }).join()).toContain('give them a "where" that differs');
    expect(kit((doc) => { delete kind(doc, 'pass').where; delete kind(doc, 'gift-card').where; }).join()).toContain('give them a "where" that differs');
    expect(kit((doc) => { kind(doc, 'pass').where = [{ column: 'ghost', eq: 1 }]; }).join()).toContain('"cards" has no column "ghost"');
    expect(kit((doc) => { kind(doc, 'pass').where = [{ column: 'kind', in: ['pass', 'lost'] }]; }).join()).toContain('"lost" is not a value "cards.kind" takes');
  });

  it('an answer never carries a code, a secret, or a column that is none', () => {
    expect(kit((doc) => { kind(doc, 'gift-card').show.push('code'); }).join()).toContain('"cards.code" is the code itself');
    expect(kit((doc) => { kind(doc, 'word').show.push('word'); }).join()).toContain('"words.word" is the code itself');
    expect(kit((doc) => { kind(doc, 'gift-card').show.push('pin'); }).join()).toContain('"cards.pin" is a code staff never see: a look-up never answers it');
    expect(kit((doc) => { kind(doc, 'gift-card').show.push('ghost'); }).join()).toContain('"cards" has no column "ghost"');
    expect(kit((doc) => { kind(doc, 'gift-card').show.push('label'); }).join()).toContain('"label" is listed twice');
    expect(kit((doc) => { lookUp(doc).address.show.push('code'); }).join()).toContain('"cards.code" is the code itself');
  });

  it('a kind\'s history is one table that points at its rows', () => {
    expect(kit((doc) => { kind(doc, 'gift-card').rows.table = 'ghosts'; }).join()).toContain('"ghosts" is not a table of this add-on');
    expect(kit((doc) => { kind(doc, 'gift-card').rows.via = 'note'; }).join()).toContain('"card_actions.note" is not a foreign key to "cards"');
    expect(kit((doc) => { kind(doc, 'gift-card').rows.columns = ['ghost']; }).join()).toContain('"card_actions" has no column "ghost"');
    expect(kit((doc) => { kind(doc, 'gift-card').rows.columns = []; })).not.toEqual([]);
  });

  it('an address is compared as one', () => {
    expect(kit((doc) => { lookUp(doc).address.column = 'recipient_email'; }).join()).toContain('give it normalize "email"');
    expect(kit((doc) => { lookUp(doc).address.column = 'ghost'; }).join()).toContain('"cards" has no column "ghost"');
    expect(kit((doc) => { lookUp(doc).address.table = 'ghosts'; }).join()).toContain('"ghosts" is not a table of this add-on');
  });
});
