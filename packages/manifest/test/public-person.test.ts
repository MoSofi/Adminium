// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person found by the address a guest types, the row's own link, "delete
 * my details", and a read for a signed-in guest alone — each rule broken once
 * on a manifest that otherwise validates.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';
import { boxOffice, columnOf, entryOf, guestHouse, issuesText, kitchen, messages, tableOf, type Doc } from './orders-stays-fixture.js';

const create = (m: Doc) => entryOf(m, 'orders', 'POST');
const identity = (m: Doc) => create(m)['identity'] as Doc;

function broken(make: () => Doc, change: (m: Doc) => void): string {
  const m = make();
  change(m);
  return issuesText(m);
}

describe('a person found by address', () => {
  it('is found on a create, or on a change through the row\'s own link', () => {
    expect(messages(boxOffice())).toEqual([]);
    expect(broken(kitchen, (m) => (create(m)['methods'] = ['POST', 'PATCH']))).toContain('a person is found by address on a create alone');
    // A change through a key whose link is not the owner's own is refused.
    const m = boxOffice();
    delete (entryOf(m, 'tickets', 'PATCH', 'ticket')['claim'] as Doc)['own'];
    expect(issuesText(m)).toContain('a person is found by address on a create alone');
    expect(issuesText(m)).toContain('an identity entry claims its person; it does not find one by address');
  });

  it('signs in by an emailed link to that address', () => {
    expect(broken(kitchen, (m) => (identity(m)['table'] = 'menu_items'))).toContain('a person found by address signs in by a link to it: "menu_items" needs an identity entry');
  });

  it('is typed into a text column that checks an address, and a create requires it', () => {
    expect(broken(kitchen, (m) => delete columnOf(m, 'orders', 'email')['rules'])).toContain('"orders.email" holds an address, so it checks one');
    expect(broken(kitchen, (m) => (create(m)['requires'] = ['name']))).toContain('"email" finds the person, so a create requires it');
  });

  it('is one row per address, stored trimmed and in lower case, emptied when forgotten', () => {
    expect(broken(kitchen, (m) => delete columnOf(m, 'customers', 'email')['unique'])).toContain('"customers.email" finds one person by address, so it is unique');
    expect(broken(kitchen, (m) => ((columnOf(m, 'customers', 'email')['rules'] as Doc)['normalize'] = 'trim'))).toContain('(normalize: "email")');
    expect(broken(kitchen, (m) => (columnOf(m, 'customers', 'email')['maxLength'] = 100))).toContain('"customers.email" holds fewer characters than "orders.email"');
  });

  it('is linked through an empty-able key, never shown or written', () => {
    expect(broken(kitchen, (m) => (create(m)['select'] as string[]).push('customer_id'))).toContain('"customer_id" would tell whether the address was on file, so it is never shown');
    expect(broken(kitchen, (m) => (identity(m)['link'] = 'number'))).toContain('"orders.number" does not point at "customers"');
    expect(broken(kitchen, (m) => ((create(m)['claimedBy'] as Doc)['optional'] = undefined))).toContain('claimedBy {table: "customers", column: "customer_id", optional: true}');
  });

  it('is asked for with the human check and capped per address', () => {
    expect(broken(kitchen, (m) => ((create(m)['anonymous'] as Doc)['perValue'] = { columns: ['phone'], n: 3 }))).toContain('anonymous.perValue counts "email"');
  });

  it('is filled, when new, only with plain text columns the guest typed', () => {
    expect(broken(kitchen, (m) => (identity(m)['fill'] = { email: 'email' }))).toContain('"customers.email" is not a text column a new person is filled with');
    expect(broken(kitchen, (m) => (identity(m)['fill'] = { name: 'number' }))).toContain('"number" is not writable, so it holds nothing to fill with');
    expect(broken(kitchen, (m) => Object.assign(columnOf(m, 'customers', 'phone'), { unique: true }) && (identity(m)['fill'] = { phone: 'phone' }))).toContain(
      '"customers.phone" is unique, so filling it would refuse only a new person',
    );
    expect(broken(kitchen, (m) => (tableOf(m, 'customers')['columns'] as Doc[]).push({ ref: 'born_on', type: 'date' }))).toContain(
      '"customers.born_on" must be given when a person is made, and nothing fills it',
    );
  });

  it('is made the way a known one is found: nothing numbered, counted or mailed', () => {
    expect(broken(kitchen, (m) => (tableOf(m, 'customers')['columns'] as Doc[]).push({ ref: 'no', type: 'int', nullable: true, rules: { sequence: { gapless: true } } }))).toContain(
      '"customers" numbers its rows',
    );
    expect(
      broken(kitchen, (m) => {
        m['outbox'] = {
          table: 'messages',
          columns: { kind: 'kind', status: 'status', to: 'to', language: 'language', due: 'due', sentAt: 'sent', error: 'error' },
          links: { customer: 'customer_id' },
          recipient: { via: 'customer_id', table: 'customers', email: 'email', name: 'name' },
          kinds: { welcome: 'kitchen-welcome' },
          producers: [{ kind: 'welcome', link: 'customer_id', onCreate: { table: 'customers' } }],
        };
      }),
    ).toContain('a message is sent when a "customers" row is made');
  });

  it('is never read back through the link by the creating row', () => {
    const m = kitchen();
    (tableOf(m, 'orders')['columns'] as Doc[]).push({ ref: 'known_phone', type: 'text', maxLength: 32, nullable: true, rules: { copy: { via: 'customer_id', from: 'phone' } } });
    (tableOf(m, 'orders')['columns'] as Doc[]).push({ ref: 'visits', type: 'int', nullable: true });
    expect(issuesText(m)).toContain('"orders.known_phone" reads the person "customer_id" points at, whom a stranger may have typed the address of');
  });

  it('is never read back through a formula over what the link copied', () => {
    const m = guestHouse();
    const stays = tableOf(m, 'stays')['columns'] as Doc[];
    stays.push({ ref: 'discount', type: 'decimal', scale: 2, nullable: true, rules: { copy: { via: 'customer_id', from: 'loyalty' } } });
    (tableOf(m, 'guests')['columns'] as Doc[]).push({ ref: 'loyalty', type: 'decimal', scale: 2, nullable: true });
    columnOf(m, 'stays', 'total')['rules'] = { formula: { sub: [{ coalesce: ['room_total', 0] }, { coalesce: ['discount', 0] }] } };
    const text = issuesText(m);
    expect(text).toContain('"stays.discount" reads the person');
    expect(text).toContain('"stays.total" reads the person');
  });
});

describe('the row\'s own link', () => {
  it('is answered by the create, as a share code a token claim with own opens', () => {
    expect(broken(kitchen, (m) => delete (entryOf(m, 'orders', 'GET', 'link')['claim'] as Doc)['own'])).toContain('a token claim on "orders" opens by it with own: true');
  });

  it('changes its row within what each entry names, and never its own code', () => {
    expect(broken(kitchen, (m) => delete entryOf(m, 'orders', 'GET', 'link')['writable'])).toContain('a change through a row\'s own link names what it may write');
    expect(broken(kitchen, (m) => (entryOf(m, 'orders', 'GET', 'link')['writable'] = ['note', 'link_stopped']))).toContain('"orders.link_stopped" opens or closes the row\'s own link');
    expect(broken(kitchen, (m) => (entryOf(m, 'orders', 'GET', 'link')['writable'] = ['note', 'status']))).toContain('"status" is an enum a browser changes');
    expect(broken(kitchen, (m) => delete entryOf(m, 'order_items', 'GET', 'link')['level'])).toContain('the "link" key opens a row\'s own link at level "verified"');
  });

  it('only reads when it is not the owner\'s own', () => {
    expect(broken(kitchen, (m) => delete (entryOf(m, 'orders', 'GET', 'link')['claim'] as Doc)['own'])).toContain('"link" opens a row to whoever holds its link, so it only reads');
  });
});

describe('delete my details', () => {
  const identityEntry = (m: Doc) => entryOf(m, 'customers', 'GET');
  it('empties the address it signs in with, and stamps the time', () => {
    expect(broken(kitchen, (m) => ((identityEntry(m)['forget'] as Doc)['columns'] = ['name']))).toContain('"email" signs the person in, so forgetting them empties it');
    expect(broken(kitchen, (m) => ((identityEntry(m)['forget'] as Doc)['stamp'] = 'name'))).toContain('"customers.name" is not a nullable timestamptz');
    expect(broken(kitchen, (m) => ((identityEntry(m)['forget'] as Doc)['columns'] = ['email', 'id']))).toContain('"id" is the key of the person, which is kept');
  });

  it('belongs to an identity signed in by email', () => {
    expect(broken(kitchen, (m) => (entryOf(m, 'orders', 'GET', 'link')['forget'] = { columns: ['note'] }))).toContain('a person forgets their details on the identity they sign in with by email');
  });
});

describe('a read for a signed-in guest alone', () => {
  const read = (m: Doc) => entryOf(m, 'settings', 'GET');
  it('only reads, at the level the key signs people in at, listing what it shows', () => {
    expect(broken(kitchen, (m) => (read(m)['level'] = 'lookup'))).toContain('the "customer" key\'s sessions are verified, so this entry is read at level "verified"');
    expect(broken(kitchen, (m) => delete read(m)['select'])).toContain('a read for a signed-in guest lists what it shows');
    expect(broken(kitchen, (m) => (read(m)['key'] = 'nobody'))).toContain('the "nobody" key signs nobody in');
  });
});

describe('bank details in a manifest setting', () => {
  it('are warned about unless secret', () => {
    const m = kitchen();
    m['settings'] = [{ key: 'bank_account_number', type: 'string' }, { key: 'iban', type: 'string', secret: true }, { key: 'sort_order', type: 'string' }];
    const result = validateManifest(m);
    expect(result.ok).toBe(true);
    expect(result.warnings.filter((w) => w.path.startsWith('settings')).map((w) => w.path)).toEqual(['settings.0']);
  });
});
