// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ticket sent to a friend, written with the vocabulary as it stands: the
 * guest offers the ticket to an address (valid → offered, the old code still
 * working), the friend is emailed the ticket's own link, accepts it (offered
 * → valid, a new code, the holder copied and found by that address), and an
 * offer nobody accepts goes back by itself. Reads through the buyer's order
 * leave out the code and the holder's address once the ticket is someone
 * else's.
 *
 * The manifest validates as it is; each test breaks one thing and reads the
 * sentence.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { claimSchema, validateManifest } from '../src/index.js';

type Doc = Record<string, unknown>;

const FIXTURE = new URL('./fixtures/ticket-transfer.manifest.json', import.meta.url);
const boxOffice = (): Doc => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Doc;

const entries = (m: Doc) => m['publicAccess'] as Doc[];
/** The entry on `table` (and `key`) with `method`, and (for two alike) one that is visible with a parent or not. */
const entryOf = (m: Doc, table: string, method: string, key?: string, visible?: boolean) =>
  entries(m).find(
    (e) => e['table'] === table && e['key'] === key && (e['methods'] as string[]).includes(method) && (visible === undefined || (e['visibleWith'] !== undefined) === visible),
  )!;
const tableOf = (m: Doc, ref: string) => (m['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === ref)!;
const columnOf = (m: Doc, table: string, ref: string) => (tableOf(m, table)['columns'] as Doc[]).find((c) => c['ref'] === ref)!;

const friendLink = (m: Doc) => entryOf(m, 'tickets', 'PATCH', 'ticket');
const friendClaim = (m: Doc) => friendLink(m)['claim'] as Doc;
const buyerTickets = (m: Doc) => entryOf(m, 'tickets', 'PATCH', undefined, true);
const withholdOf = (e: Doc) => e['withhold'] as Doc;

function issuesText(m: Doc): string {
  const result = validateManifest(m);
  return result.ok ? '' : result.issues.map((i) => `${i.path}: ${i.message}`).join('\n');
}

function broken(change: (m: Doc) => void): string {
  const m = boxOffice();
  change(m);
  return issuesText(m);
}

describe('a ticket sent to a friend', () => {
  it('validates with the vocabulary as it stands', () => {
    expect(issuesText(boxOffice())).toBe('');
  });

  it('is offered once at a time, taken back by the clock, and let in once', () => {
    const states = tableOf(boxOffice(), 'tickets')['states'] as Doc;
    expect(states['moves']).toEqual({ valid: ['offered', 'checked_in'], offered: ['valid', 'checked_in'] });
    expect(states['strict']).toBe(true);
    expect(states['timed']).toEqual([{ from: 'offered', to: 'valid', at: { column: 'offer_until' } }]);
    // A timed move is one the table lists.
    expect(broken((m) => ((tableOf(m, 'tickets')['states'] as Doc)['moves'] = { valid: ['offered', 'checked_in'], offered: ['checked_in'] }))).not.toBe('');
  });

  it('renews its code and copies the holder when the friend is linked — never when an offer lapses back', () => {
    expect(columnOf(boxOffice(), 'tickets', 'code')['rules']).toEqual({ code: { length: 12, renew: { on: { column: 'holder_customer_id', changed: true } } } });
    expect(broken((m) => (((columnOf(m, 'tickets', 'code')['rules'] as Doc)['code'] as Doc)['renew'] = { on: { column: 'status', values: ['accepted'] } }))).toContain(
      '"accepted" is not a value of "tickets.status"',
    );
    expect(broken((m) => (((columnOf(m, 'tickets', 'holder_email')['rules'] as Doc)['stamp'] as Doc)['on'] = { columns: ['holder_email'] }))).toContain('a stamp watches another column');
  });

  it('limits what a sender sends: per address a day, and the name as plain text', () => {
    expect(broken((m) => (entries(m).find((e) => e['limits'] !== undefined)!['limits'] = { perValue: { columns: ['holder_email'], n: 5 } }))).toContain(
      '"holder_email" is not writable, so a guest never sends it',
    );
    expect(broken((m) => (entries(m).find((e) => e['limits'] !== undefined)!['methods'] = ['GET']))).toContain('limits apply to a change (PATCH); a create has anonymous');
  });

  it('mails the friend at the pending address when it is offered', () => {
    expect(broken((m) => (((m['outbox'] as Doc)['producers'] as Doc[])[0]!['recipient'] = { column: 'pending_at' }))).toContain('pending_at');
  });
});

describe('the addresses a row\'s own link may be emailed to', () => {
  it('take one column, or two', () => {
    expect(claimSchema.safeParse({ by: 'token', column: 'link_token', own: true, address: 'email' }).success).toBe(true);
    expect(claimSchema.safeParse({ by: 'token', column: 'link_token', own: true, address: ['a', 'b'] }).success).toBe(true);
    expect(claimSchema.safeParse({ by: 'token', column: 'link_token', own: true, address: [] }).success).toBe(false);
    expect(claimSchema.safeParse({ by: 'token', column: 'link_token', own: true, address: ['a', 'b', 'c'] }).success).toBe(false);
    expect(claimSchema.safeParse({ verify: 'email-link', email: 'email', address: 'email' }).success).toBe(false);
  });

  it('belong to the row\'s own link alone', () => {
    const text = broken((m) => {
      // A link that is not the owner's own only reads.
      const link = friendLink(m);
      delete (link['claim'] as Doc)['own'];
      for (const name of ['identity', 'writable', 'writableValues', 'writableWhen']) delete link[name];
      link['methods'] = ['GET'];
    });
    expect(text).toContain("a link is emailed to its row's own address only when it is the row's own link (own: true)");
  });

  it('are text columns of the row, named once, and never its secret', () => {
    expect(broken((m) => (friendClaim(m)['address'] = ['pending_email', 'nope']))).toContain('"tickets" has no column "nope"');
    expect(broken((m) => (friendClaim(m)['address'] = ['pending_email', 'offer_until']))).toContain('"tickets.offer_until" is not a text column holding an address');
    expect(broken((m) => (friendClaim(m)['address'] = ['pending_email', 'pending_email']))).toContain('"pending_email" is named twice');
    expect(broken((m) => (friendClaim(m)['address'] = ['pending_email', 'link_token']))).toContain('"tickets.link_token" is the link\'s secret, not an address');
  });

  it('are never set through the link they address', () => {
    expect(broken((m) => (friendLink(m)['writable'] as string[]).push('pending_email'))).toContain(
      '"tickets.pending_email" is an address the row\'s own link is emailed to, so a change through that link may not set it',
    );
  });

  it('let the friend be found by the address the link went to, without typing it', () => {
    // Without the address, the friend would have to type (and so could change) where the ticket goes.
    expect(broken((m) => delete friendClaim(m)['address'])).toContain('"pending_email" is typed by the guest, so it is writable');
    expect(broken((m) => (friendClaim(m)['address'] = 'holder_email'))).toContain('"pending_email" is typed by the guest, so it is writable');
  });
});

describe('columns withheld from rows read through a parent', () => {
  it('are one to eight columns and a holder', () => {
    expect(broken((m) => (withholdOf(buyerTickets(m))['columns'] = []))).not.toBe('');
    expect(broken((m) => delete withholdOf(buyerTickets(m))['unlessHolder'])).not.toBe('');
    expect(broken((m) => (withholdOf(buyerTickets(m))['also'] = true))).not.toBe('');
  });

  it('are withheld from rows reached through a parent, or claimed by a column naming someone else', () => {
    expect(broken((m) => (entryOf(m, 'events', 'GET')['withhold'] = { columns: ['name'], unlessHolder: 'id' }))).toContain(
      'columns are withheld from rows read through a parent: the entry needs visibleWith (or claimedBy)',
    );
    const holders = (m: Doc) => entryOf(m, 'tickets', 'GET', undefined, false);
    expect(broken((m) => (holders(m)['withhold'] = { columns: ['code'], unlessHolder: 'holder_customer_id' }))).toContain(
      '"holder_customer_id" is the column this entry is claimed by, so every row it reads is already its holder\'s',
    );
    // Claimed through the buyer's own column, a ticket's holder is someone else: that qualifies.
    const buyerColumn = (m: Doc) => {
      (tableOf(m, 'tickets')['columns'] as Doc[]).push({ ref: 'buyer_id', type: 'fk', references: 'customers', nullable: true });
      holders(m)['claimedBy'] = { table: 'customers', column: 'buyer_id' };
    };
    expect(broken((m) => buyerColumn(m) || (holders(m)['withhold'] = { columns: ['code'], unlessHolder: 'holder_customer_id' }))).toBe('');
  });

  it('are columns the entry shows, each once', () => {
    expect(broken((m) => (withholdOf(buyerTickets(m))['columns'] = ['code', 'price']))).toContain('"price" is not one of the columns the entry shows');
    expect(broken((m) => (withholdOf(buyerTickets(m))['columns'] = ['code', 'code']))).toContain('a column is withheld once');
  });

  it('are shown to the holder the key signs in, named by a link to that person', () => {
    expect(broken((m) => (withholdOf(buyerTickets(m))['unlessHolder'] = 'nope'))).toContain('"tickets" has no column "nope"');
    expect(broken((m) => (withholdOf(buyerTickets(m))['unlessHolder'] = 'pending_name'))).toContain('"tickets.pending_name" is not a foreign key to a person');
    expect(broken((m) => (withholdOf(buyerTickets(m))['unlessHolder'] = 'order_id'))).toContain(
      '"tickets.order_id" does not point at "customers", the person the "customer" key signs in',
    );
    // A key that opens a row by its link signs no person in: the holder is one another key signs in.
    const linkTickets = (m: Doc) => entryOf(m, 'tickets', 'GET', 'link');
    expect(broken((m) => (withholdOf(linkTickets(m))['unlessHolder'] = 'order_id'))).toContain('"tickets.order_id" does not point at a person any key signs in');
  });

  it('are shown by a holder no browser writes', () => {
    expect(
      broken((m) => {
        (buyerTickets(m)['writable'] as string[]).push('holder_customer_id');
        delete (buyerTickets(m)['writableWhen'] as Doc)['holder_customer_id'];
      }),
    ).toContain('"tickets.holder_customer_id" decides who reads the withheld columns, so no browser writes it');
  });
});
