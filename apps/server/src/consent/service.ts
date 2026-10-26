// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CONSENT SERVICE — the only door to the consent log and the stop list.
 *
 * The mail door (unsubscribe, one-click, the relays' notices), the send
 * ledger, a sequence step's re-check, the first-send review, the erasure and
 * the staff routes all come through here. They speak in addresses as typed
 * and rows as the record pages name them; the keyed hashes, their key
 * versions and the encrypted display copies stay inside (`keys.ts`).
 *
 * A person is found by their row OR by their address (under every key
 * version there is): an unsubscribe that knew only the address and a staff
 * record that knew only the row are the same person's.
 *
 * The stop list binds marketing mail only (plan D2); which mail is marketing
 * is the caller's to know. A staff or review event names its staff member;
 * every other source names none.
 */
import { consentLogRepo, stopListRepo, type AddressHash, type ConsentPerson, type ConsentSubject, type MetaDb, type StopEntry } from '@adminium/meta';

import { ValidationFailedError } from '../errors.js';
import { normaliseAddress } from '../public-api/claim-code.js';
import { applyConsentToColumn, type ConsentTableSource } from './apply-column.js';
import { addressKeyRing, openAddress, sealAddress } from './keys.js';
import type { ConsentRecordInput, ConsentService, ConsentWho, StopEntryView, StopListPage } from './types.js';

export interface ConsentServiceDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`: what the address keys and the display copies are encrypted under. */
  secret: string;
  /** The source tables, for {@link ConsentService.applyToColumn}; without it that door refuses. */
  tables?: ConsentTableSource | undefined;
  now?: () => number;
}

/** Sources a staff member writes, and must be named on. */
const STAFF_SOURCES: ReadonlySet<string> = new Set(['staff', 'review']);

/** The longest address kept (RFC 5321's path limit). */
export const ADDRESS_MAX = 254;

/** Whether a text is an address worth keeping: one `@`, something either side, no spaces, not too long. */
export function looksLikeAddress(address: string): boolean {
  const norm = normaliseAddress(address);
  return norm.length <= ADDRESS_MAX && /^[^\s@]+@[^\s@]+$/.test(norm);
}

/** A page cursor: the time and id of the last entry given. */
function cursorOf(entry: { addedAt: number; id: string }): string {
  return Buffer.from(JSON.stringify([entry.addedAt, entry.id])).toString('base64url');
}

function readCursor(cursor: string | null | undefined): { addedAt: number; id: string } | undefined {
  if (cursor === null || cursor === undefined || cursor === '') return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === 'number' && typeof parsed[1] === 'string') return { addedAt: parsed[0], id: parsed[1] };
  } catch {
    // Not one of ours: refused below.
  }
  throw new ValidationFailedError('That page cursor is not one this list gave.', { field: 'cursor' });
}

export function createConsentService(deps: ConsentServiceDeps): ConsentService {
  const { meta, secret } = deps;
  const now = deps.now ?? Date.now;
  const log = consentLogRepo(meta);
  const list = stopListRepo(meta);
  const ring = addressKeyRing(meta, secret);

  /** The address as kept, or null; refused when it is no address. */
  function addressOf(address: string | null | undefined): string | null {
    if (address === null || address === undefined || address.trim() === '') return null;
    if (!looksLikeAddress(address)) throw new ValidationFailedError('That is not an e-mail address.', { field: 'address' });
    return normaliseAddress(address);
  }

  /** The rows a question is about: the row, and the address under every key version. */
  async function subjectOf(who: ConsentWho): Promise<ConsentSubject> {
    const address = addressOf(who.address);
    return { person: who.person ?? null, hashes: address === null ? [] : await ring.hashesOf(address) };
  }

  function viewOf(entry: StopEntry): StopEntryView {
    return {
      id: entry.id,
      address: entry.addressEncrypted === null ? null : openAddress(secret, entry.addressEncrypted),
      reason: entry.reason,
      origin: entry.origin,
      addedAt: entry.addedAt,
      addedBy: entry.addedById === null ? null : { id: entry.addedById, label: entry.addedByLabel ?? '' },
      erasedAt: entry.erasedAt,
    };
  }

  async function append(input: ConsentRecordInput, state: 'yes' | 'no') {
    const address = addressOf(input.address);
    if (input.person == null && address === null) throw new ValidationFailedError('A consent event names a person or an address.');
    const staffed = STAFF_SOURCES.has(input.source);
    if (staffed && input.staff == null) throw new ValidationFailedError(`A ${input.source} event names the staff member who recorded it.`);
    const staff = staffed ? input.staff! : null;
    const hash: AddressHash | null = address === null ? null : await ring.hashForWrite(address);
    return log.append({
      person: input.person ?? null,
      address: hash,
      purpose: input.purpose,
      state,
      source: input.source,
      detail: input.detail ?? null,
      how: staffed ? (input.how ?? null) : null,
      note: staffed ? (input.note ?? null) : null,
      staffId: staff?.id ?? null,
      staffLabel: staff?.label ?? null,
      wording: input.wording?.text ?? null,
      wordingVersion: input.wording?.version ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      at: input.at ?? now(),
      confirmedAt: input.confirmedAt ?? null,
    });
  }

  async function entryFor(address: string): Promise<StopEntry | null> {
    const norm = addressOf(address);
    if (norm === null) return null;
    const found = await list.findAny(await ring.hashesOf(norm));
    // Under two versions at once (a re-hash cut short): the one still holding its address first.
    return found.sort((a, b) => Number(a.addressEncrypted === null) - Number(b.addressEncrypted === null))[0] ?? null;
  }

  return {
    record: (input) => append(input, input.state),
    withdraw: (input) => append(input, 'no'),

    async stateFor(who, purpose) {
      const event = await log.latest(await subjectOf(who), purpose);
      return { purpose, state: event === null ? 'not-asked' : (event.state as 'yes' | 'no'), event };
    },

    async statesAmong(who, purpose) {
      const norms = who.map((one) => addressOf(one.address));
      const hashed = await ring.hashesOfMany([...new Set(norms.filter((one): one is string => one !== null))]);
      const events = await log.latestAmong(
        who.map((one, i) => {
          const norm = norms[i];
          return { person: one.person ?? null, hashes: norm === null || norm === undefined ? [] : (hashed.get(norm) ?? []) };
        }),
        purpose,
      );
      return events.map((event) => ({ purpose, state: event === null ? 'not-asked' : (event.state as 'yes' | 'no'), event }));
    },

    async history(who, opts = {}) {
      return log.history(await subjectOf(who), { limit: Math.min(Math.max(opts.limit ?? 100, 1), 500) });
    },

    async askedOnce(person: ConsentPerson, purpose) {
      return (await log.answeredAmong(person.connectionId, person.table, [person.key], purpose)).has(person.key);
    },

    askedAmong: (connectionId, table, keys, purpose) => log.answeredAmong(connectionId, table, keys, purpose),

    async markReplied(who) {
      const address = addressOf(who.address);
      if (who.person == null && address === null) throw new ValidationFailedError('A reply names a person or an address.');
      return log.append({
        person: who.person ?? null,
        address: address === null ? null : await ring.hashForWrite(address),
        purpose: null,
        state: 'replied',
        source: 'staff',
        staffId: who.staff.id,
        staffLabel: who.staff.label,
        at: who.at ?? now(),
      });
    },

    async lastReplied(who) {
      return log.lastReplied(await subjectOf(who));
    },

    async deleteForPerson(who) {
      return log.deleteForPerson(await subjectOf(who));
    },

    async eraseDisplay(address, opts = {}) {
      const norm = addressOf(address);
      if (norm === null) throw new ValidationFailedError('The erasure names an address.', { field: 'address' });
      const at = opts.at ?? now();
      const entry = await entryFor(norm);
      if (entry !== null) {
        // Every copy of it, under every version, keeps its hash alone.
        for (const one of await list.findAny(await ring.hashesOf(norm))) await list.eraseDisplay(one.id, at);
        return 'erased';
      }
      if (opts.addIfMissing !== true) return 'missing';
      const { entry: added } = await list.add({ address: await ring.hashForWrite(norm), addressEncrypted: null, reason: 'erased', addedAt: at });
      await list.eraseDisplay(added.id, at);
      return 'added';
    },

    async applyToColumn(target, event) {
      if (deps.tables === undefined) throw new Error('The consent service was built without the source tables: it cannot write a column.');
      return applyConsentToColumn(meta, deps.tables, target, event);
    },

    stop: {
      async add(input) {
        const norm = addressOf(input.address);
        if (norm === null) throw new ValidationFailedError('That is not an e-mail address.', { field: 'address' });
        // An erased person's entry is made by the erasure alone (`eraseDisplay`).
        if (input.reason === 'erased') throw new ValidationFailedError('An erased person is put on the list by the erasure.', { field: 'reason' });
        const there = await entryFor(norm);
        if (there !== null) return { entry: viewOf(there), added: false };
        const { entry, added } = await list.add({
          address: await ring.hashForWrite(norm),
          addressEncrypted: sealAddress(secret, norm),
          reason: input.reason,
          origin: input.origin ?? null,
          addedAt: input.at ?? now(),
          addedById: input.staff?.id ?? null,
          addedByLabel: input.staff?.label ?? null,
        });
        return { entry: viewOf(entry), added };
      },

      async remove(id) {
        const entry = await list.byId(id);
        if (entry === null) return 'missing';
        // An erased person's objection outlives them: nobody takes it off.
        if (entry.addressEncrypted === null) return 'erased';
        return (await list.remove(id)) ? 'removed' : 'missing';
      },

      async has(address) {
        return (await entryFor(address)) !== null;
      },

      async stoppedAmong(addresses) {
        const out = new Set<string>();
        const norms = [...new Set(addresses.filter((one) => looksLikeAddress(one)).map(normaliseAddress))];
        const byHash = new Map<string, string>();
        const hashes: AddressHash[] = [];
        for (const [norm, mine] of await ring.hashesOfMany(norms)) {
          for (const one of mine) {
            byHash.set(`${String(one.version)}:${one.hash}`, norm);
            hashes.push(one);
          }
        }
        for (const entry of await list.findAny(hashes)) {
          const norm = byHash.get(`${String(entry.address.version)}:${entry.address.hash}`);
          if (norm !== undefined) out.add(norm);
        }
        return out;
      },

      async entryFor(address) {
        const entry = await entryFor(address);
        return entry === null ? null : viewOf(entry);
      },

      async get(id) {
        const entry = await list.byId(id);
        return entry === null ? null : viewOf(entry);
      },

      count: (reason) => list.count(reason),

      async list(opts): Promise<StopListPage> {
        const limit = Math.min(Math.max(opts.limit, 1), 200);
        let after = readCursor(opts.cursor);
        const q = opts.q?.trim().toLowerCase() ?? '';
        const entries: StopEntryView[] = [];
        // Addresses are kept encrypted, so a search reads the list a batch at a time and keeps what holds the words.
        for (;;) {
          const batch = await list.page({ limit: q === '' ? limit + 1 : 500, after, reason: opts.reason });
          for (const entry of batch) {
            const view = viewOf(entry);
            if (q !== '' && !(view.address ?? '').includes(q)) continue;
            if (entries.length === limit) return { entries, next: cursorOf(entries.at(-1)!) };
            entries.push(view);
          }
          if (batch.length < (q === '' ? limit + 1 : 500)) return { entries, next: null };
          const last = batch.at(-1)!;
          after = { addedAt: last.addedAt, id: last.id };
        }
      },
    },
  };
}
