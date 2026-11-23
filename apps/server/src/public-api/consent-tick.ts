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
import { publicConsentSchema, publicTextConsentSchema, validateManifest, type Manifest, type PublicTextConsent } from '@adminium/manifest';
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
  /** The entries' separate boxes for texts. */
  textByRef: Map<string, { entry: Entry; box: PublicTextConsent }>;
  names: Readonly<Record<string, string>>;
}

export interface ConsentTicks {
  /** The tick a write through this request's entry carries, or nothing. */
  tickFor(input: { request: FastifyRequest; key: ResolvedKey; view: SnapshotView }): Promise<PublicConsentTick | undefined>;
  /** The box for texts a write through this request's entry carries, or nothing. */
  textTickFor(input: { request: FastifyRequest; key: ResolvedKey; view: SnapshotView }): Promise<PublicTextConsentTick | undefined>;
}

export function createConsentTicks(meta: MetaDb, now: () => number = Date.now): ConsentTicks {
  const kept = new Map<string, { at: number; ticks: Promise<AppTicks | null> }>();

  async function read(appKey: string, connectionId: string): Promise<AppTicks | null> {
    // The app's install on this key's database.
    const row = await manifestsRepo(meta, NO_SECRETS).findInScope(appKey, connectionId);
    if (row === null || row.row.kind !== 'app' || row.row.connectionId !== connectionId) return null;
    const checked = validateManifest(row.document, { allowLocalPublisher: true });
    if (!checked.ok || checked.manifest.kind !== 'app') return null;
    const entries = servedPublicEntries(checked.manifest);
    if (!entries.some((entry) => entry.consent !== undefined || entry.textConsent !== undefined)) return null;
    const names = await appTablesRepo(meta).realNames(connectionId, appKey);
    const refs = publicEntryRefs(entries, names);
    const byRef = new Map<string, { entry: Entry; consent: NonNullable<Entry['consent']> }>();
    const textByRef = new Map<string, { entry: Entry; box: PublicTextConsent }>();
    entries.forEach((entry, at) => {
      const consent = publicConsentSchema.safeParse(entry.consent);
      if (consent.success) byRef.set(refs[at]!, { entry, consent: consent.data });
      const box = publicTextConsentSchema.safeParse(entry.textConsent);
      if (box.success) textByRef.set(refs[at]!, { entry, box: box.data });
    });
    return { byRef, textByRef, names };
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

  /** The entry's table, whose tick it is, and what the log keeps of the request. */
  function placed(entry: Entry, ticks: AppTicks, request: FastifyRequest, managedBy: string, view: SnapshotView): (Pick<PublicConsentTick, 'table' | 'person' | 'form' | 'ip' | 'userAgent' | 'acceptLanguage'>) | undefined {
    const tableOf = (short: string): ResolvedTable | null => {
      try {
        return view.table(ticks.names[short] ?? short);
      } catch {
        return null;
      }
    };
    const table = tableOf(entry.table);
    if (table === null) return undefined;
    // Whose tick: the person the entry finds by the address typed, the person it is claimed by, or the row itself.
    let person: PublicConsentTick['person'];
    if (entry.identity !== undefined) {
      const of = tableOf(entry.identity.table);
      if (of === null) return undefined;
      person = { table: of.id, link: entry.identity.link };
    } else if (entry.claimedBy !== undefined && entry.claimedBy.table !== entry.table) {
      const of = tableOf(entry.claimedBy.table);
      if (of === null) return undefined;
      person = { table: of.id, link: entry.claimedBy.column };
    } else {
      person = { table: table.id, link: null };
    }
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

    async textTickFor({ request, key, view }) {
      const held = await writing(request, key);
      const found = held?.ticks.textByRef.get(held.ref);
      if (held === undefined || found === undefined) return undefined;
      const { entry, box } = found;
      const where = placed(entry, held.ticks, request, held.managedBy, view);
      if (where === undefined) return undefined;
      return {
        ...where,
        column: box.column,
        phone: box.phone,
        purpose: box.class === 'marketing' ? 'text-marketing' : 'text-service',
        means: box.means ?? 'yes',
        wording: { version: box.wording.version, text: box.wording.text },
      };
    },
  };
}
