// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PUBLIC CONSENT TICK, AS A WRITE CARRIES IT.
 *
 * An app's public entry may carry a tick a stranger gives ("Email me about
 * new shows", `publicAccess[].consent`): the yes/no of the row it writes,
 * the purpose, and the sentence shown beside the box in each language with
 * its version. The tick is declared in the app's manifest and nowhere else:
 * a request never says what the box said, so the log keeps the declared
 * words, not a stranger's.
 *
 * For a write through such an entry (a create or a change, found by the
 * endpoint's ref, which the install names from the entry), this reads the
 * entry and says, in the write's context (`WriteContext.consentTick`), what
 * the write path needs: the tick's column, whose tick it is (the person the
 * entry's identity finds, the person it is claimed by, or the row itself),
 * and what the log keeps of the request (its network address, its browser,
 * its languages). A tick never reaches another person than that one: a
 * signed-in guest's create is linked to them whatever address they type (an
 * identity create is always claimed, optionally, by the same person), and a
 * change reaches only their own rows. The write path does the rest
 * (`people/consent-writes.ts`, `crud/decide.ts`).
 *
 * An app's manifest is read again at most every fifteen seconds.
 */
import type { FastifyRequest } from 'fastify';
import { publicConsentSchema, publicTextConsentsSchema, textConsentBoxes, validateStoredManifest, type Manifest, type PublicTextConsent } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, type MetaDb } from '@adminium/meta';

import { publicEntryRefs, servedPublicEntries } from '../apps/manifest-public.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { PublicConsentTick, PublicTextConsentTick } from '../crud/write-context.js';
import type { ResolvedKey } from './resolve.js';

/** How long an app's entries are kept before they are read again. */
const KEPT_MS = 15_000;

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading a public tick never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading a public tick never reads a credential');
  },
};

type Entry = NonNullable<Extract<Manifest, { kind: 'app' }>['publicAccess']>[number];

/** An app's entries that carry a tick, by the ref of the endpoint each became. */
interface AppTicks {
  byRef: Map<string, { entry: Entry; consent: NonNullable<Entry['consent']> }>;
  /** The entries' separate boxes for texts: one, or one per class. */
  textByRef: Map<string, { entry: Entry; boxes: PublicTextConsent[] }>;
  /** Every entry's boxes for texts, a door's entries' (a forms entry's) among them. */
  allBoxes: { entry: Entry; boxes: PublicTextConsent[] }[];
  names: Readonly<Record<string, string>>;
}

/** A box for texts an app's entry draws, as a staff change of its column is told to the log. */
export interface TableTextBox {
  /** The app that declares it. */
  app: string;
  column: string;
  phone: string;
  purpose: 'text-service' | 'text-marketing';
  means: 'yes' | 'no';
  wording: { version: number; text: Readonly<Record<string, string>> };
  /** Whose answer it is: the people table (its id), and this table's link to it (null: the row is the person). */
  person: { table: string; link: string | null };
}

export interface ConsentTicks {
  /** The tick a write through this request's entry carries, or nothing. */
  tickFor(input: { request: FastifyRequest; key: ResolvedKey; view: SnapshotView }): Promise<PublicConsentTick | undefined>;
  /** The boxes for texts a write through this request's entry carries (one per class at most), or nothing. */
  textTicksFor(input: { request: FastifyRequest; key: ResolvedKey; view: SnapshotView }): Promise<PublicTextConsentTick[] | undefined>;
  /**
   * Every box for texts an installed app's entries draw on one table, by
   * column: what a staff change of such a column records (`people/consent-writes.ts`).
   */
  textBoxesOn(input: { connectionId: string; app: string; view: SnapshotView; tableId: string }): Promise<TableTextBox[]>;
}

export function createConsentTicks(meta: MetaDb, now: () => number = Date.now): ConsentTicks {
  const kept = new Map<string, { at: number; ticks: Promise<AppTicks | null> }>();

  async function read(appKey: string, connectionId: string): Promise<AppTicks | null> {
    // The app's install on this key's database.
    const row = await manifestsRepo(meta, NO_SECRETS).findInScope(appKey, connectionId);
    if (row === null || row.row.kind !== 'app' || row.row.connectionId !== connectionId) return null;
    const checked = validateStoredManifest(row.document, { allowLocalPublisher: true });
    if (!checked.ok || checked.manifest.kind !== 'app') return null;
    const entries = servedPublicEntries(checked.manifest);
    // Every entry's boxes for texts, a forms entry's too (the forms door draws those): what a staff change of a box's column records.
    const allBoxes = (checked.manifest.publicAccess ?? []).flatMap((entry) => {
      const boxes = publicTextConsentsSchema.safeParse(entry.textConsent);
      return boxes.success ? [{ entry, boxes: textConsentBoxes(boxes.data) }] : [];
    });
    if (allBoxes.length === 0 && !entries.some((entry) => entry.consent !== undefined)) return null;
    const names = await appTablesRepo(meta).realNames(connectionId, appKey);
    const refs = publicEntryRefs(entries, names);
    const byRef = new Map<string, { entry: Entry; consent: NonNullable<Entry['consent']> }>();
    const textByRef = new Map<string, { entry: Entry; boxes: PublicTextConsent[] }>();
    entries.forEach((entry, at) => {
      const consent = publicConsentSchema.safeParse(entry.consent);
      if (consent.success) byRef.set(refs[at]!, { entry, consent: consent.data });
      const boxes = publicTextConsentsSchema.safeParse(entry.textConsent);
      if (boxes.success) textByRef.set(refs[at]!, { entry, boxes: textConsentBoxes(boxes.data) });
    });
    return { byRef, textByRef, allBoxes, names };
  }

  function ticksOf(appKey: string, connectionId: string): Promise<AppTicks | null> {
    const id = `${connectionId}\u0000${appKey}`;
    const held = kept.get(id);
    if (held !== undefined && now() - held.at < KEPT_MS) return held.ticks;
    const ticks = read(appKey, connectionId);
    const entry = { at: now(), ticks };
    kept.set(id, entry);
    ticks.catch(() => {
      if (kept.get(id) === entry) kept.delete(id);
    });
    return ticks;
  }

  /** An entry's table and whose tick it is: the person the entry finds by the address typed, the person it is claimed by, or the row itself. */
  function whose(entry: Entry, names: Readonly<Record<string, string>>, view: SnapshotView): { table: ResolvedTable; person: PublicConsentTick['person'] } | undefined {
    const tableOf = (short: string): ResolvedTable | null => {
      try {
        return view.table(names[short] ?? short);
      } catch {
        return null;
      }
    };
    const table = tableOf(entry.table);
    if (table === null) return undefined;
    if (entry.identity !== undefined) {
      const of = tableOf(entry.identity.table);
      return of === null ? undefined : { table, person: { table: of.id, link: entry.identity.link } };
    }
    if (entry.claimedBy !== undefined && entry.claimedBy.table !== entry.table) {
      const of = tableOf(entry.claimedBy.table);
      return of === null ? undefined : { table, person: { table: of.id, link: entry.claimedBy.column } };
    }
    return { table, person: { table: table.id, link: null } };
  }

  /** The entry's table, whose tick it is, and what the log keeps of the request. */
  function placed(entry: Entry, ticks: AppTicks, request: FastifyRequest, managedBy: string, view: SnapshotView): (Pick<PublicConsentTick, 'table' | 'person' | 'form' | 'ip' | 'userAgent' | 'acceptLanguage'>) | undefined {
    const found = whose(entry, ticks.names, view);
    if (found === undefined) return undefined;
    const { table, person } = found;
    const header = (name: string): string | null => {
      const value = request.headers[name];
      return typeof value === 'string' && value !== '' ? value : null;
    };
    return {
      table: table.id,
      person,
      form: `${managedBy}:${entry.table}`.slice(0, 255),
      ip: request.ip === '' ? null : request.ip,
      userAgent: header('user-agent'),
      acceptLanguage: header('accept-language'),
    };
  }

  /** The app's boxes, when this request is a write through one of its entries. */
  async function writing(request: FastifyRequest, key: ResolvedKey): Promise<{ ref: string; managedBy: string; ticks: AppTicks } | undefined> {
    const ref = (request.params as { ref?: unknown } | undefined)?.ref;
    if (key.managedBy === null || typeof ref !== 'string' || !['POST', 'PATCH', 'PUT'].includes(request.method)) return undefined;
    const ticks = await ticksOf(key.managedBy, key.connectionId);
    return ticks === null ? undefined : { ref, managedBy: key.managedBy, ticks };
  }

  return {
    async tickFor({ request, key, view }) {
      const held = await writing(request, key);
      const found = held?.ticks.byRef.get(held.ref);
      if (held === undefined || found === undefined) return undefined;
      const { entry, consent } = found;
      const where = placed(entry, held.ticks, request, held.managedBy, view);
      if (where === undefined) return undefined;
      return {
        ...where,
        column: consent.column,
        purpose: consent.purpose,
        means: consent.means ?? 'yes',
        wording: { version: consent.wording.version, text: consent.wording.text },
      };
    },

    async textTicksFor({ request, key, view }) {
      const held = await writing(request, key);
      const found = held?.ticks.textByRef.get(held.ref);
      if (held === undefined || found === undefined) return undefined;
      const { entry, boxes } = found;
      const where = placed(entry, held.ticks, request, held.managedBy, view);
      if (where === undefined) return undefined;
      return boxes.map((box) => ({
        ...where,
        column: box.column,
        phone: box.phone,
        purpose: box.class === 'marketing' ? ('text-marketing' as const) : ('text-service' as const),
        means: box.means ?? 'yes',
        wording: { version: box.wording.version, text: box.wording.text },
      }));
    },

    async textBoxesOn({ connectionId, app, view, tableId }) {
      const ticks = await ticksOf(app, connectionId);
      if (ticks === null) return [];
      const out: TableTextBox[] = [];
      const seen = new Set<string>();
      for (const { entry, boxes } of ticks.allBoxes) {
        const found = whose(entry, ticks.names, view);
        if (found === undefined || found.table.id !== tableId) continue;
        for (const box of boxes) {
          // One column, one answer: the first entry that names it says what it means.
          if (seen.has(box.column)) continue;
          seen.add(box.column);
          out.push({
            app,
            column: box.column,
            phone: box.phone,
            purpose: box.class === 'marketing' ? 'text-marketing' : 'text-service',
            means: box.means ?? 'yes',
            wording: { version: box.wording.version, text: box.wording.text },
            person: found.person,
          });
        }
      }
      return out;
    },
  };
}
