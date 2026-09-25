// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RENDER PIPELINE.
 *
 * One function, called from two places, and that is the whole shape of the
 * file:
 *
 *   · `jobs/document-render.ts` — the queued path. A manual
 *     `POST /documents/render`, a public request-shaped intent, a retry.
 *   · `automations/actions/document-render.ts` — the triggered path, running
 *     inside an automation's own run job (D55: a profile's trigger IS an
 *     automation, so the render is a step in that run rather than a second
 *     job behind it).
 *
 * Two entry points and ONE implementation, for the reason the add-on's own
 * `renderSync` exists: "the same profile produces the same document however it
 * was asked for" is a fact when there is one code path and a hope when there
 * are two.
 *
 * ─── THE ORDER OF OPERATIONS IS THE DESIGN ─────────────────────────────────
 *
 *   1. Load the profile. Disabled or gone → SKIP with a reason, never a
 *      failure: an operator who turned a profile off has not caused an error.
 *   2. Find the provider BY THE PROFILE'S ADD-ON KEY. Not `resolveProvider`,
 *      which picks the lowest key and would render an invoice through a
 * barcode add-on (trap 11).
 *   3. Read the source row and its children with the REQUESTER'S grants
 *      (D16) — never with ambient authority, because a triggered render runs
 *      as whoever wrote the row.
 *   4. Build the subject and freeze it into a register row. The row exists
 *      BEFORE the bytes, with status `failed`, so a crash between here and
 *      the end leaves a record of an attempt rather than silence.
 *   5. Render. A refusal from the provider is DATA — it lands on the row.
 *   6. Claim the number, then store the bytes.
 *
 * ─── THE NUMBER IS PRINTED, AND A FAILED DRAW STILL BURNS NONE ─────────────
 *
 * A document has to show its own number, so the number must exist before
 * the provider draws. But a render that fails must not burn one either. So
 * the draw uses the number the register WOULD hand out next (a peek), and the
 * claim comes after a successful draw: when the claim returns that same
 * number — the ordinary case — the bytes are already right; when another
 * render took it in between, the document is drawn once more with the number
 * actually claimed. A failure before the claim costs nothing; only a failure
 * of that second draw leaves a gap, which the register allows.
 *
 * A row that carries its OWN number (an invoice numbered when it was made)
 * prints that, and the register's counter is never touched: two numbers for
 * one invoice is the one thing a numbered document may not have.
 *
 * ─── AN UNCHANGED ROW IS DRAWN ONCE ────────────────────────────────────────
 *
 * Every render records a reuse key — the profile, the row, and a hash of
 * everything the document was drawn from. A caller that asks for reuse (the
 * public surface, where a client presses "download" as often as they like)
 * gets the stored document back while that key still matches, instead of a
 * new file and a new register row per click.
 */

import { createHash } from 'node:crypto';

import { currencyScale } from '@adminium/manifest';

import { DOCUMENT_LOCALE_IDS } from '@adminium/add-on-contracts';
import {
  auditRepo,
  documentSequencesRepo,
  documentsRepo,
  documentProfilesRepo,
  filesRepo,
  newId,
  type DocumentProfile,
  type DocumentRow,
  type MetaDb,
  type RecordRef,
} from '@adminium/meta';

import type { RecordFilter } from '../crud/filters.js';
import type { FileStore } from '../files/store.js';
import { providerByKey, providersFor, type AddOnRuntimeState } from '../add-ons/runtime.js';
import type { EmailLogger } from '../email/send.js';
import { AppError } from '../errors.js';
import { emailDocument, type DocumentDelivery } from './deliver.js';
import {
  DOCUMENT_RENDER_CONTRACT,
  DOCUMENT_RENDER_VERSION,
  renderingProviderOf,
} from './provider.js';
import type { StatementPeriod, StatementRead } from './statement.js';
import { buildSubject, coerceSlot, mappedTables, type ProfileMapping, type SubjectSlot } from './subject.js';

/**
 * What a public reader may read of one table: a filter, nothing (the table
 * whole), or a narrowing already built — rows visible only with a parent,
 * which no single-table filter can say.
 */
export type ReadFilter = RecordFilter | null | ((query: unknown) => unknown);

export { DOCUMENT_RENDER_CONTRACT, DOCUMENT_RENDER_VERSION };

/** A rendered document as the contract returns it. */
interface RenderedDocument {
  format: 'html' | 'pdf';
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  locale: string;
  warnings: readonly string[];
}

export interface RenderDeps {
  meta: MetaDb;
  storage: FileStore;
  runtime: () => AddOnRuntimeState | null;
  /** Read the source row and its children with the requester's own grants. */
  readSource: (input: {
    profile: DocumentProfile;
    pk: Readonly<Record<string, unknown>>;
    tables: readonly string[];
    /** A statement's period; the others ignore it. */
    period?: StatementPeriod | undefined;
    /** The render's own clock, so a statement's "today" is the render's. */
    at: number;
    /**
     * What a public caller may read of the tables the document reads beside
     * its own row, by table id: a filter narrows those rows, null reads them
     * whole. Absent: a staff or triggered render, read with its own grants.
     */
    readFilters?: ReadonlyMap<string, ReadFilter> | undefined;
  }) => Promise<SourceRead | null>;
  /** The add-on's own non-secret settings. */
  settingsFor: (addOnKey: string) => Promise<Record<string, unknown>>;
  /**
   * The deployment's business identity, for a profile that maps none.
   *
   * Takes the add-on key so the ADD-ON'S own letterhead settings win over the
   * workspace's name — they are the ones somebody typed for documents.
   */
  business: (addOnKey?: string) => Promise<{
    name: string;
    lines: readonly string[];
    logoDataUrl?: string;
    taxNumber?: string;
    paymentInstructions?: string;
    footer?: string;
  }>;
  now?: () => number;
  /**
   * The connection's own currency and timezone, for a render that does NOT
   * read a source row. The mapped path gets both from `readSource`, which has
   * the connection open anyway; an intent has no row to read.
   */
  connectionFacts?: (
    connectionId: string | null,
  ) => Promise<{ currency: string; timezone: string }>;
  /**
   * Where step 8's delivery reports itself.
   *
   * Optional because the outcome is written to the register row either way —
   * the log is for an operator watching a queue, and its absence costs
   * diagnostics rather than a fact.
   */
  logger?: EmailLogger | undefined;
}

export interface SourceRead {
  row: Readonly<Record<string, unknown>>;
  collections: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  lookups: Readonly<Record<string, unknown>>;
  entity: RecordRef;
  /** The row's own currency when it carries one, else the connection's; and the connection's timezone. */
  currency: string;
  timezone: string;
  /**
   * Present when the profile numbers documents by the row's own number: the
   * number (null while the row has none yet). Absent: the register counts.
   */
  ownNumber?: string | null | undefined;
  /** A statement's period, read by its own function. */
  statement?: StatementRead | undefined;
}

/** The source could not be read as the document needs it (too many lines, say). */
export class DocumentReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentReadError';
  }
}

export interface RenderRequest {
  profileId: string;
  pk: Readonly<Record<string, unknown>>;
  /** Who asked. A triggered render carries the actor that wrote the row. */
  requestedBy?: string | null;
  actorKind?: string;
  jobId?: string | null;
  /** Overrides the profile's own locale option. */
  locale?: string;
  /** Answer with the stored document while the row is unchanged. */
  reuse?: boolean;
  /** A statement's period (`all` when absent). */
  period?: StatementPeriod | undefined;
  /** What a public caller may read beside the row (see `RenderDeps.readSource`). */
  readFilters?: ReadonlyMap<string, ReadFilter> | undefined;
  /**
   * Values for slots the profile does not map, from whoever asked — a label
   * sheet's count, from the screen that prints it. Typed by the outline like
   * the profile's own typed values, and over them; never over a mapped column.
   * A slot the outline does not have, a list, a mapped slot or a value its
   * type cannot hold is refused (400, naming the slot) before anything is
   * written.
   */
  values?: Readonly<Record<string, string | number | boolean>> | undefined;
}

/** A value a render request carries for a slot, refused: the slot is named. */
export class DocumentValueError extends AppError {
  override readonly name = 'DocumentValueError';

  constructor(slot: string, message: string) {
    super(400, 'DOCUMENT_VALUE_REFUSED', message, { slot });
  }
}

/**
 * A request's values, each typed as its slot's type — or the first one that
 * cannot be. Typed here, before the reuse key is made, so `"12"` and `12`
 * are the same sheet.
 */
function typedValues(
  values: Readonly<Record<string, string | number | boolean>>,
  slots: readonly SubjectSlot[],
  mapping: ProfileMapping,
  kind: string,
  currency: string,
  timezone: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(values)) {
    const slot = slots.find((candidate) => candidate.id === id);
    if (slot === undefined) throw new DocumentValueError(id, `A ${kind} has no slot "${id}".`);
    if (slot.type === 'collection') throw new DocumentValueError(id, `"${id}" is a list, and a list cannot be sent as a value.`);
    if (mapping[id] !== undefined) {
      throw new DocumentValueError(id, `"${id}" is read from the row, so a value sent for it would print something the row does not say.`);
    }
    const typed = coerceSlot(slot.type, value, currencyScale(currency), timezone);
    if (typed === null || typed === '' || (slot.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(typed)))) {
      throw new DocumentValueError(id, `"${id}" cannot hold ${JSON.stringify(value)}.`);
    }
    out[id] = typed;
  }
  return out;
}

export type RenderOutcome =
  | { status: 'rendered'; document: DocumentRow; reused?: boolean }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; document: DocumentRow | null; error: string };

const MIME = { html: 'text/html; charset=utf-8', pdf: 'application/pdf' } as const;

/**
 * The language a document is drawn in: one of the languages documents are
 * written in, never whatever a caller typed.
 *
 * The asked-for language is made canonical (`EN-gb` → `en-GB`) and matched to
 * a document language — exactly, else by its language alone (`de` → `de-DE`,
 * `en-GB` → `en-US`; Chinese by its script or region). Anything else — an
 * unknown or malformed tag — falls back to the profile's own language, then
 * US English. Bounded on purpose: each language is a different file, and a
 * caller free to name any tag could ask for a new one on every request.
 */
export function documentLocale(requested: string | undefined, fallback: string | undefined): string {
  for (const candidate of [requested, fallback]) {
    if (candidate === undefined || candidate === '' || candidate === 'viewer') continue;
    let canonical: string | undefined;
    try {
      canonical = Intl.getCanonicalLocales(candidate)[0];
    } catch {
      continue;
    }
    if (canonical === undefined) continue;
    const exact = DOCUMENT_LOCALE_IDS.find((id) => id === canonical);
    if (exact !== undefined) return exact;
    const language = canonical.split('-')[0]!.toLowerCase();
    if (language === 'zh') return /-(Hant|TW|HK|MO)\b/.test(canonical) ? 'zh-TW' : 'zh-CN';
    const same = DOCUMENT_LOCALE_IDS.find((id) => id.split('-')[0] === language);
    if (same !== undefined) return same;
  }
  return 'en-US';
}

/** JSON with sorted keys and dates as ISO text, so one row hashes one way on every driver. */
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value instanceof Uint8Array) return JSON.stringify(Buffer.from(value).toString('base64'));
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * What makes a render reusable: the profile as it is now (an edited mapping
 * is a different document), the row and everything read around it, and the
 * letterhead and settings it would be drawn with. The profile id leads, so a
 * key is never shared between two profiles however their data compares.
 */
export function reuseKeyOf(profile: DocumentProfile, parts: Record<string, unknown>): string {
  const hash = createHash('sha256')
    .update(canonical({ profile: profile.id, edited: profile.updatedAt, ...parts }))
    .digest('hex');
  return `${profile.id}:${hash}`;
}


/**
 * The rendered formats, written to storage and to the files table.
 *
 * Shared by the mapped path and the intent path so that "a document's bytes are
 * a `kind: 'document'` library file with the source row's entity on it" is one
 * statement. The `kind` matters beyond bookkeeping: the unattached-upload sweep
 * is scoped to `kind = 'upload'`, so a document's file is not swept away for
 * never having been attached to anything.
 */
async function storeRendered(
  deps: RenderDeps,
  produced: readonly RenderedDocument[],
  entity: RecordRef | null,
  uploadedBy: string | null,
  at: number,
): Promise<Partial<Record<'html' | 'pdf', string>>> {
  const files = filesRepo(deps.meta);
  const stored: Partial<Record<'html' | 'pdf', string>> = {};
  for (const rendered of produced) {
    const fileId = newId('file');
    const mime = rendered.mediaType || MIME[rendered.format];
    const written = await deps.storage.write({
      id: fileId,
      kind: 'document',
      filename: rendered.filename,
      mime,
      bytes: Buffer.from(rendered.bytes),
    });
    await files.create(
      {
        id: fileId,
        filename: rendered.filename,
        mime,
        sizeBytes: written.sizeBytes,
        sha256: written.sha256,
        kind: 'document',
        uploadedBy,
        storageKey: written.storageKey,
        destinationId: written.destinationId,
        storage: written.storage,
        ...(entity === null ? {} : { entity }),
      },
      at,
    );
    stored[rendered.format] = fileId;
  }
  return stored;
}

export async function renderDocument(
  deps: RenderDeps,
  request: RenderRequest,
): Promise<RenderOutcome> {
  const now = deps.now ?? Date.now;
  const at = now();
  const profiles = documentProfilesRepo(deps.meta);
  const documents = documentsRepo(deps.meta);
  const audit = auditRepo(deps.meta);

  // 1 — the profile.
  const profile = await profiles.findById(request.profileId);
  if (profile === null) return { status: 'skipped', reason: 'profile-gone' };
  if (!profile.enabled) return { status: 'skipped', reason: 'profile-disabled' };

  // 2 — the provider the PROFILE names.
  const runtime = deps.runtime();
  const entry =
    runtime === null
      ? null
      : providerByKey(
          runtime,
          DOCUMENT_RENDER_CONTRACT,
          DOCUMENT_RENDER_VERSION,
          profile.addOnKey,
        );
  const provider = entry === null ? null : renderingProviderOf(entry.module);
  if (provider === null) {
    /*
     * The add-on is uninstalled, disabled, or failed to load. SKIP, not fail:
     * A profile is disabled in the same transaction as an uninstall, so
     * reaching here means a job was already in flight when that happened —
     * an ordinary race, not a fault anybody can act on.
     */
    await audit.append(
      {
        actorKind: request.actorKind === 'user' ? 'user' : 'system',
        actorId: request.requestedBy ?? null,
        actorLabel: request.requestedBy ?? 'system',
        category: 'data',
        action: 'document.skipped',
        connectionId: profile.connectionId,
        changes: {
          after: { profileId: profile.id, addOnKey: profile.addOnKey, reason: 'provider-missing' },
        },
      },
      at,
    );
    return { status: 'skipped', reason: 'provider-missing' };
  }

  // 3 — the source row, with the requester's grants.
  const tables = mappedTables(profile.mapping as ProfileMapping, profile.table);
  let source: SourceRead | null;
  try {
    source = await deps.readSource({ profile, pk: request.pk, tables, period: request.period, at, readFilters: request.readFilters });
  } catch (cause) {
    if (!(cause instanceof DocumentReadError) && !(cause instanceof Error && cause.name === 'StatementTooLargeError')) throw cause;
    // Too much to draw honestly: said, never drawn with lines missing.
    return { status: 'failed', document: null, error: cause.message };
  }
  if (source === null) {
    // The row was deleted between the trigger and the job — the undo window's
    // ordinary outcome, and one the register records rather than swallows.
    await audit.append(
      {
        actorKind: request.actorKind === 'user' ? 'user' : 'system',
        actorId: request.requestedBy ?? null,
        actorLabel: request.requestedBy ?? 'system',
        category: 'data',
        action: 'document.skipped',
        connectionId: profile.connectionId,
        changes: { after: { profileId: profile.id, reason: 'row-gone' } },
      },
      at,
    );
    return { status: 'skipped', reason: 'row-gone' };
  }

  // 4 — the subject, frozen into a row that exists before the bytes do.
  const options = profile.options as {
    locale?: string;
    paper?: string;
    formats?: string[];
    literals?: Record<string, unknown>;
    prefix?: string;
  };
  const locale = documentLocale(request.locale, options.locale);
  const outline = provider.describe(profile.kind);
  const kind = provider.kinds().find((entry) => entry.id === profile.kind);
  const formats = (options.formats ?? kind?.formats ?? ['html']) as ('html' | 'pdf')[];
  const paper = (options.paper ?? kind?.paper[0] ?? 'a4') as string;
  const settings = await deps.settingsFor(profile.addOnKey);
  const business = await deps.business(profile.addOnKey);
  const values =
    request.values === undefined || Object.keys(request.values).length === 0
      ? undefined
      : typedValues(request.values, outline.slots, profile.mapping as ProfileMapping, profile.kind, source.currency, source.timezone);

  const reuseKey = reuseKeyOf(profile, {
    // Only when sent: a key that always held them would miss every document
    // drawn before, and draw each one again under a new number.
    ...(values === undefined ? {} : { values }),
    pk: source.entity.pk,
    row: source.row,
    collections: source.collections,
    lookups: source.lookups,
    statement: source.statement ?? null,
    currency: source.currency,
    settings,
    business,
    locale,
    formats,
    paper,
  });
  if (request.reuse === true) {
    const stored = await documents.findReusable(profile.connectionId, reuseKey);
    if (stored !== null) return { status: 'rendered', document: stored, reused: true };
  }

  /*
   * The number the document prints: the row's own; else the number this
   * profile already gave this row — a document drawn again (a new language,
   * an edited row) is the same document, and carries its number rather than
   * taking a new one; else the register's next.
   */
  const sequences = documentSequencesRepo(deps.meta);
  const prefix = options.prefix ?? '';
  const ownNumber = source.ownNumber;
  const carried = ownNumber === undefined ? await documents.numberFor(profile.id, source.entity) : null;
  let number: string | null =
    ownNumber !== undefined ? ownNumber : (carried ?? `${prefix}${String(await sequences.peek(profile.id))}`);
  // Drawn again, it is the same document: a slot it filled by default (the day it was made) stays as it was.
  const drawnBefore = (await documents.drawnFor(profile.id, source.entity))?.subject?.['fields'];

  const subjectFor = (printed: string | null) =>
    buildSubject({
      slots: outline.slots,
      mapping: profile.mapping as ProfileMapping,
      row: source.row,
      collections: source.collections,
      lookups: source.lookups,
      // The values somebody typed into the mapping rather than pointing at a
      // column, and a statement's figures: both fill only slots nothing maps.
      // A request's own values stand over the profile's, as its language does;
      // a statement's figures are read from the data, and stand over both.
      ...(options.literals === undefined && values === undefined && source.statement === undefined
        ? {}
        : { values: { ...(options.literals ?? {}), ...(values ?? {}), ...(source.statement?.fields ?? {}) } }),
      ...(source.statement === undefined ? {} : { collectionValues: source.statement.collections }),
      ...(drawnBefore === undefined || drawnBefore === null ? {} : { drawnBefore: drawnBefore as Record<string, unknown> }),
      now: { iso: new Date(at).toISOString(), timezone: source.timezone },
      locale,
      currency: source.currency,
      business,
      entity: source.entity,
      number: printed,
    });
  let built = subjectFor(number);

  const document = await documents.create(
    {
      profileId: profile.id,
      addOnKey: profile.addOnKey,
      kind: profile.kind,
      connectionId: profile.connectionId,
      entity: source.entity,
      subject: built.subject as unknown as Record<string, unknown>,
      locale,
      format: formats.includes('pdf') ? 'pdf' : 'html',
      requestedBy: request.requestedBy ?? null,
      actorKind: request.actorKind ?? 'system',
      jobId: request.jobId ?? null,
      reuseKey,
    },
    at,
  );

  if (built.missing.length > 0) {
    // The mapping did not cover a required slot, or this row has nothing in
    // the column it names. Either way the operator is the one who can fix it,
    // and the row names which slots so they do not have to guess.
    const error = `unmapped or empty: ${built.missing.join(', ')}`;
    return { status: 'failed', document: await documents.markFailed(document.id, error), error };
  }

  // 5 — render. A refusal is DATA and lands on the row.
  const draw = async (subject: typeof built.subject): Promise<{ produced: RenderedDocument[] } | { error: string }> => {
    let produced: unknown;
    try {
      produced = await provider.render({ kind: profile.kind, subject, formats, paper, settings });
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
    if (!Array.isArray(produced)) {
      const refusal = produced as { code?: string; detail?: string; dropped?: string[] };
      return {
        error: [refusal.code ?? 'INVALID_SUBJECT', refusal.detail, (refusal.dropped ?? []).join(' ')]
          .filter((part) => part !== undefined && part !== '')
          .join(': '),
      };
    }
    return { produced: produced as RenderedDocument[] };
  };

  let drawn = await draw(built.subject);
  if ('error' in drawn) {
    return { status: 'failed', document: await documents.markFailed(document.id, drawn.error), error: drawn.error };
  }

  // 6 — the number, claimed only now that the draw succeeded (D11).
  if (ownNumber === undefined && carried === null) {
    const claimed = `${prefix}${String(await sequences.claim(profile.id, at))}`;
    if (claimed !== number) {
      // Another render took the peeked number: draw again with the one claimed.
      number = claimed;
      built = subjectFor(number);
      drawn = await draw(built.subject);
      if ('error' in drawn) {
        const error = `${drawn.error} (number ${number} was claimed and is not reused)`;
        return { status: 'failed', document: await documents.markFailed(document.id, error), error };
      }
    }
  }

  const stored = await storeRendered(deps, drawn.produced, source.entity, request.requestedBy ?? null, at);

  const done = await documents.markRendered(
    document.id,
    {
      number,
      fileId: stored.pdf ?? null,
      htmlFileId: stored.html ?? null,
      format: stored.pdf !== undefined ? 'pdf' : 'html',
      subject: built.subject as unknown as Record<string, unknown>,
    },
    at,
  );

  await audit.append(
    {
      actorKind: request.actorKind === 'user' ? 'user' : 'system',
      actorId: request.requestedBy ?? null,
      actorLabel: request.requestedBy ?? 'system',
      category: 'data',
      action: 'document.rendered',
      connectionId: profile.connectionId,
      entity: source.entity,
      changes: {
        after: { documentId: document.id, number, kind: profile.kind, profileId: profile.id },
      },
    },
    at,
  );

  /*
   * 8 — DELIVERY, after the audit row and after the number.
   *
   * Last on purpose. Every earlier step is what makes the document exist, and
   * this one is about what happens to it afterwards: an email that cannot be
   * built must not be able to unmake a document that was drawn correctly. So
   * `emailDocument` records its own outcome on the row and returns, and the
   * render is `rendered` either way.
   *
   * A mapping that names no address slot is not asking for an email at all, so
   * it is not consulted — the alternative would stamp `not-sent:no-address` on
   * every document from every mapping that never wanted one.
   */
  const deliver = (profile.deliver ?? {}) as DocumentDelivery;
  if (deliver.emailSlot !== null && deliver.emailSlot !== undefined && deliver.emailSlot !== '') {
    await emailDocument(
      {
        meta: deps.meta,
        runtime: deps.runtime,
        ...(deps.logger === undefined ? {} : { logger: deps.logger }),
      },
      { document: done!, profile },
    );
    return { status: 'rendered', document: (await documents.findById(document.id)) ?? done! };
  }

  return { status: 'rendered', document: done! };
}

// --- the request-shaped intent (D15) -----------------------------------------

export interface IntentRequest {
  /** Which kind to draw. The provider is resolved from it — see below. */
  kind: string;
  locale?: string | undefined;
  fields: Readonly<Record<string, unknown>>;
  collections: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /** The connection whose currency and number sequence this borrows (D11). */
  connectionId: string | null;
  /** Stamped LAST, so a failure leaves no claimable row. */
  claim?: { column: string; value: string; keyId?: string | undefined } | undefined;
  requestedBy?: string | null;
  actorKind?: string;
}

/**
 * Draw a document from VALUES, with no mapping and no source row.
 *
 * ─── WHAT THE CALLER MAY NOT SET ───────────────────────────────────────────
 *
 * `business`, `now`, `currency`, `entity` and `number` are stamped here, from
 * settings and the connection. That list is the whole reason this function
 * exists instead of the public route calling `buildSubject` itself: a door that
 * let a stranger choose the letterhead and the clock is a way to put their text
 * under the operator's name, on the operator's SMTP (0.3 trap 17).
 *
 * ─── AND WHY `delivery` STARTS `pending-review` ────────────────────────────
 *
 * D15: an inline-request intent never auto-emails. A person settles it from
 * Studio or the record page. The row is written that way here rather than by
 * the route, so every producer of an intent inherits it.
 */
export async function renderIntent(
  deps: RenderDeps,
  request: IntentRequest,
): Promise<RenderOutcome> {
  const now = deps.now ?? Date.now;
  const at = now();
  const documents = documentsRepo(deps.meta);

  /*
   * The provider is resolved from the KIND, because an intent has no profile to
   * carry `add_on_key` (D8). Exactly one provider must offer it: zero is a
   * deployment that cannot draw this, and two is a question only a human can
   * answer — drawing with whichever loaded first would make the document depend
   * on install order.
   */
  const state = deps.runtime();
  const offering =
    state === null
      ? []
      : providersFor(state, DOCUMENT_RENDER_CONTRACT, DOCUMENT_RENDER_VERSION)
          .map((entry) => ({ addOnKey: entry.addOnKey, provider: renderingProviderOf(entry.module) }))
          .filter((row) => row.provider !== null && row.provider.kinds().some((k) => k.id === request.kind));
  if (offering.length !== 1) {
    return { status: 'skipped', reason: offering.length === 0 ? 'provider-missing' : 'kind-ambiguous' };
  }
  const { addOnKey, provider } = offering[0]!;

  const locale = documentLocale(request.locale, undefined);
  const facts = (await deps.connectionFacts?.(request.connectionId)) ?? {
    currency: 'USD',
    timezone: 'UTC',
  };
  const outline = provider!.describe(request.kind);
  const built = buildSubject({
    slots: outline.slots,
    // No mapping AT ALL: every value is the caller's, and every value goes
    // through the outline's own coercion before it reaches a provider.
    mapping: {},
    row: {},
    values: request.fields,
    collectionValues: request.collections,
    now: { iso: new Date(at).toISOString(), timezone: facts.timezone },
    locale,
    currency: facts.currency,
    business: await deps.business(addOnKey),
    entity: null,
    number: null,
  });

  const kind = provider!.kinds().find((entry) => entry.id === request.kind);
  const formats = (kind?.formats ?? ['html']) as ('html' | 'pdf')[];
  const paper = (kind?.paper[0] ?? 'a4') as string;

  const document = await documents.create(
    {
      profileId: null,
      addOnKey,
      kind: request.kind,
      connectionId: request.connectionId,
      entity: null,
      subject: built.subject as unknown as Record<string, unknown>,
      locale,
      format: formats.includes('pdf') ? 'pdf' : 'html',
      requestedBy: request.requestedBy ?? null,
      actorKind: request.actorKind ?? 'api-key',
      jobId: null,
    },
    at,
  );

  if (built.missing.length > 0) {
    const error = `missing: ${built.missing.join(', ')}`;
    return { status: 'failed', document: await documents.markFailed(document.id, error), error };
  }

  let produced: unknown;
  try {
    produced = await provider!.render({
      kind: request.kind,
      subject: built.subject,
      settings: await deps.settingsFor(addOnKey),
      formats,
      paper,
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return { status: 'failed', document: await documents.markFailed(document.id, error), error };
  }
  if (!Array.isArray(produced)) {
    const refusal = produced as { code?: string; detail?: string };
    const error = [refusal.code ?? 'INVALID_SUBJECT', refusal.detail].filter(Boolean).join(': ');
    return { status: 'failed', document: await documents.markFailed(document.id, error), error };
  }

  const stored = await storeRendered(deps, produced as RenderedDocument[], null, request.requestedBy ?? null, at);

  /*
   * D11's profile-less sequence key. A number is still minted — an issued
   * document without one is not identifiable in a conversation — but it counts
   * on its own series rather than borrowing a mapping's.
   */
  const claimed = await documentSequencesRepo(deps.meta).claim(
    `intent:${addOnKey}:${request.kind}:${request.connectionId ?? 'none'}`,
    at,
  );

  const done = await documents.markRendered(
    document.id,
    {
      number: String(claimed),
      fileId: stored.pdf ?? null,
      htmlFileId: stored.html ?? null,
      format: stored.pdf !== undefined ? 'pdf' : 'html',
    },
    at,
  );

  // D15 — never auto-emailed. A person settles it.
  await documents.markDelivery(document.id, 'pending-review');

  /*
   * The CLAIM, last. A row that failed to draw must not be claimable: stamping
   * it first would leave a `failed` document a customer can list, and "your
   * invoice could not be made" is a sentence the operator should say, not a
   * status a stranger discovers.
   */
  if (request.claim !== undefined) await documents.stampClaim(document.id, request.claim);

  return { status: 'rendered', document: (await documents.findById(document.id)) ?? done! };
}
