// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RENDER PIPELINE (34-invoices-add-on.md §7.3, D8; 34-T11).
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
 *      barcode add-on (§0.3 trap 11).
 *   3. Read the source row and its children with the REQUESTER'S grants
 *      (D16) — never with ambient authority, because a triggered render runs
 *      as whoever wrote the row.
 *   4. Build the subject and freeze it into a register row. The row exists
 *      BEFORE the bytes, with status `failed`, so a crash between here and
 *      the end leaves a record of an attempt rather than silence.
 *   5. Render. A refusal from the provider is DATA — it lands on the row.
 *   6. Store the bytes.
 *   7. CLAIM THE NUMBER — last, and only now (D11). A failed render burns no
 *      number, which is why the sequence is not touched before step 5.
 *
 * Step 7 after step 6 is deliberate too: bytes with no number can be given a
 * number by a retry, and a number with no bytes is a hole in a register
 * somebody has to explain.
 */

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

import type { FileStore } from '../files/store.js';
import { providerByKey, providersFor, type AddOnRuntimeState } from '../add-ons/runtime.js';
import type { EmailLogger } from '../email/send.js';
import { emailDocument, type DocumentDelivery } from './deliver.js';
import { renderingProviderOf } from './provider.js';
import { buildSubject, mappedTables, type ProfileMapping } from './subject.js';

/** The contract this pipeline consumes, at the version it was bought at. */
export const DOCUMENT_RENDER_CONTRACT = 'document-render';
export const DOCUMENT_RENDER_VERSION = 1;

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
  }) => Promise<SourceRead | null>;
  /** The add-on's own non-secret settings. */
  settingsFor: (addOnKey: string) => Promise<Record<string, unknown>>;
  /**
   * The deployment's business identity, for a profile that maps none.
   *
   * Takes the add-on key so the ADD-ON'S own letterhead settings win over the
   * workspace's name — they are the ones somebody typed for documents.
   */
  business: (
    addOnKey?: string,
  ) => Promise<{ name: string; lines: readonly string[]; logoDataUrl?: string }>;
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
   * Where step 8's delivery reports itself (§7.7).
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
  /** The connection's own currency and timezone. */
  currency: string;
  timezone: string;
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
}

export type RenderOutcome =
  | { status: 'rendered'; document: DocumentRow }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; document: DocumentRow | null; error: string };

const MIME = { html: 'text/html; charset=utf-8', pdf: 'application/pdf' } as const;


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
     * §7.10 disables a profile in the same transaction as an uninstall, so
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
  const source = await deps.readSource({ profile, pk: request.pk, tables });
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
  };
  const locale = request.locale ?? (options.locale === 'viewer' ? 'en-US' : options.locale) ?? 'en-US';
  const outline = provider.describe(profile.kind);
  const built = buildSubject({
    slots: outline.slots,
    mapping: profile.mapping as ProfileMapping,
    row: source.row,
    collections: source.collections,
    lookups: source.lookups,
    // §3.7 step 4 — the values somebody typed into the mapping rather than
    // pointing at a column. Absent on every profile made before the editor
    // offered them, which `buildSubject` reads as "nothing typed".
    ...(options.literals === undefined ? {} : { values: options.literals }),
    now: { iso: new Date(at).toISOString(), timezone: source.timezone },
    locale,
    currency: source.currency,
    business: await deps.business(profile.addOnKey),
    entity: source.entity,
    number: null,
  });

  const kind = provider.kinds().find((entry) => entry.id === profile.kind);
  const formats = (options.formats ?? kind?.formats ?? ['html']) as ('html' | 'pdf')[];
  const paper = (options.paper ?? kind?.paper[0] ?? 'a4') as string;

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
  let produced: unknown;
  try {
    produced = await provider.render({
      kind: profile.kind,
      subject: built.subject,
      formats,
      paper,
      settings: await deps.settingsFor(profile.addOnKey),
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return { status: 'failed', document: await documents.markFailed(document.id, error), error };
  }

  if (!Array.isArray(produced)) {
    const refusal = produced as { code?: string; detail?: string; dropped?: string[] };
    const error = [refusal.code ?? 'INVALID_SUBJECT', refusal.detail, (refusal.dropped ?? []).join(' ')]
      .filter((part) => part !== undefined && part !== '')
      .join(': ');
    return { status: 'failed', document: await documents.markFailed(document.id, error), error };
  }

  // 6 — the bytes.
  const stored = await storeRendered(
    deps,
    produced as RenderedDocument[],
    source.entity,
    request.requestedBy ?? null,
    at,
  );

  // 7 — the number, LAST (D11).
  const sequences = documentSequencesRepo(deps.meta);
  const prefix = (profile.options as { prefix?: string }).prefix ?? '';
  const claimed = await sequences.claim(profile.id, at);
  const number = `${prefix}${String(claimed)}`;

  const done = await documents.markRendered(
    document.id,
    {
      number,
      fileId: stored.pdf ?? null,
      htmlFileId: stored.html ?? null,
      format: stored.pdf !== undefined ? 'pdf' : 'html',
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
   * 8 — DELIVERY, after the audit row and after the number (§7.7).
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

// --- the request-shaped intent (D15; §7.6) -----------------------------------------

export interface IntentRequest {
  /** Which kind to draw. The provider is resolved from it — see below. */
  kind: string;
  locale?: string | undefined;
  fields: Readonly<Record<string, unknown>>;
  collections: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /** The connection whose currency and number sequence this borrows (D11). */
  connectionId: string | null;
  /** Stamped LAST, so a failure leaves no claimable row (§7.6). */
  claim?: { column: string; value: string } | undefined;
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

  const locale = request.locale ?? 'en-US';
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
   * The CLAIM, last (§7.6). A row that failed to draw must not be claimable:
   * stamping it first would leave a `failed` document a customer can list, and
   * "your invoice could not be made" is a sentence the operator should say, not
   * a status a stranger discovers.
   */
  if (request.claim !== undefined) await documents.stampClaim(document.id, request.claim);

  return { status: 'rendered', document: (await documents.findById(document.id)) ?? done! };
}
