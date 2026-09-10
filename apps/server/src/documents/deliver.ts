// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A drawn document on its way to the person it names
 * (34-invoices-add-on.md §7.7, §3.7 step 6; 34-T19).
 *
 * ─── `delivery` IS A RECORD, NOT A TOAST ───────────────────────────────────
 *
 * Every outcome below is written to the register row, including the refusals.
 * A document that was not emailed because nobody configured SMTP, or because
 * the mapping names no address column, is a fact somebody has to be able to
 * find months later — and the row is the only place that outlives the request.
 * `send.ts:213` set the precedent for the SMTP case; this file follows it for
 * the other three.
 *
 * ─── THE BYTES TRAVEL AS A `generated` ATTACHMENT (39 D8) ──────────────────
 *
 * The `document-ready` template declares one attachment whose token this send
 * fills with THIS document's file id, so one stored row serves every recipient
 * and every document. Nothing about invoices reaches the email layer.
 *
 * ─── AND THE KIND IS A WORD, NOT AN ID ─────────────────────────────────────
 *
 * "Your invoice INV-1042" reads; "Your invoice_v2 INV-1042" does not. The
 * localized label belongs to the PROVIDER (eight-locale records, D14), so it is
 * read from the loaded runtime — and falls back to the stored kind id when the
 * add-on has since been removed, because an email that says slightly the wrong
 * word beats one that is never sent.
 */

import { LOCALES } from '@adminium/i18n';
import { documentsRepo, type DocumentProfile, type DocumentRow, type MetaDb } from '@adminium/meta';

import { providersFor, type AddOnRuntimeState } from '../add-ons/runtime.js';
import {
  DOCUMENT_READY_TEMPLATE_KEY,
  enqueueEmail,
  type EmailLogger,
} from '../email/send.js';
import { labelForKind, providerOf } from './provider.js';
import { DOCUMENT_RENDER_CONTRACT, DOCUMENT_RENDER_VERSION } from './render.js';

/**
 * What a profile's `deliver` json says (§3.7 step 6).
 *
 * `store` is always true and is kept as a field rather than assumed, because
 * "kept on the record" is a promise the UI makes in eight languages and a
 * reader of the stored row should see it stated.
 */
export interface DocumentDelivery {
  store?: boolean;
  /**
   * The outline slot whose value is the recipient's address, or null for "do
   * not email". A SLOT rather than a column: the address may arrive through a
   * lookup across a foreign key, and by the time a document exists the slot is
   * the only name that still means anything — the subject is frozen (D12) and
   * the source row may be gone.
   */
  emailSlot?: string | null;
}

/**
 * Every outcome, spelled once.
 *
 * `sent` is the only one that means bytes left the building — and even then it
 * means QUEUED, because delivery itself is the job's business and its failures
 * are the job's retries.
 */
export type DeliveryOutcome =
  | 'sent'
  | 'not-sent:no-email'
  | 'not-sent:no-file'
  | 'not-sent:smtp-unconfigured'
  | 'pending-review';

/*
 * These are the strings migration 0031's `delivery` column documents. Keep the
 * two in step: the column's comment is what a reader of the schema believes,
 * and a value only this file knows about is a value nobody can interpret from
 * the database.
 */

export interface DeliverDeps {
  meta: MetaDb;
  secret?: string | undefined;
  /** For the provider's localized kind label; absent = fall back to the id. */
  runtime?: (() => AddOnRuntimeState | null) | undefined;
  logger?: EmailLogger | undefined;
}

export interface DeliverInput {
  document: DocumentRow;
  /** Null for a request-shaped intent (D15), which has no mapping. */
  profile: DocumentProfile | null;
  /**
   * The recipient, when the CALLER knows it — a claim-bound public send, whose
   * address is the claim's and never the document's (§7.6). Overrides the
   * profile's slot, and is the only way a request-shaped intent is delivered.
   */
  to?: string | undefined;
  /** A link the recipient can actually open; the button is dropped without one. */
  url?: string | undefined;
}

/**
 * A document's locale TAG as the email layer's locale ID.
 *
 * Documents speak `en-US` (the contract's `DOCUMENT_LOCALE_IDS`, DEP-33) and
 * email template rows are keyed `en_US`. Handing one to the other LOOKS like
 * it works: `resolveEmailTemplate` falls back to `en_US` when it finds no row,
 * so a German customer receives a correct-looking English email and nothing
 * anywhere records that their language was lost.
 *
 * Matched against the table rather than by replacing a hyphen, so an unknown
 * tag falls through to the email layer's own default instead of inventing an
 * id no row will ever have.
 */
function localeIdFor(tag: string): string | undefined {
  return LOCALES.find((locale) => locale.tag === tag || locale.id === tag)?.id;
}

/** `subject.fields[slot]`, when it is a usable address. */
function addressFrom(document: DocumentRow, slot: string | null | undefined): string | null {
  if (slot === null || slot === undefined || slot === '') return null;
  const subject = document.subject as { fields?: Record<string, unknown> } | null;
  const value = subject?.fields?.[slot];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  /*
   * The shallowest possible check, on purpose. The address came out of the
   * operator's own data through a slot they chose; refusing anything more here
   * would be this file having an opinion about their customers' addresses, and
   * the transport is the thing that actually knows.
   */
  return trimmed.includes('@') ? trimmed : null;
}

/**
 * The address a CLAIMED document is bound to (§7.6).
 *
 * A request-shaped intent (D15) has no mapping and therefore no address slot;
 * what it has is the claim that made it, and §7.6 is explicit that such a
 * document settles only to "the claimed session's own bound address". Reading
 * it from the row rather than from a request body is what stops this being a
 * way to send somebody else's document anywhere — the operator settling a
 * `pending-review` row decides WHETHER, never WHERE.
 */
function claimAddress(document: DocumentRow): string | null {
  const value = document.claim?.value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.includes('@') ? trimmed : null;
}

/** The provider's word for this kind, in the document's own locale. */
function kindLabel(deps: DeliverDeps, document: DocumentRow): string {
  const state = deps.runtime?.() ?? null;
  if (state === null) return document.kind;
  const entry = providersFor(state, DOCUMENT_RENDER_CONTRACT, DOCUMENT_RENDER_VERSION).find(
    (candidate) => candidate.addOnKey === document.addOnKey,
  );
  return labelForKind(
    entry === undefined ? null : providerOf(entry.module),
    document.kind,
    document.locale,
  );
}

/**
 * Email a drawn document, and record what happened either way.
 *
 * Returns the outcome it wrote. NEVER throws for a missing address, a missing
 * file or an unconfigured server: all three are states of the world the
 * operator can fix, and an exception here would turn "we could not email it"
 * into "the render failed", which is a different and false statement.
 */
export async function emailDocument(
  deps: DeliverDeps,
  input: DeliverInput,
): Promise<DeliveryOutcome> {
  const documents = documentsRepo(deps.meta);
  const { document } = input;

  const deliver = (input.profile?.deliver ?? {}) as DocumentDelivery;
  const to = input.to ?? addressFrom(document, deliver.emailSlot) ?? claimAddress(document);
  if (to === null || to === undefined || to === '') {
    return await record(documents, document.id, 'not-sent:no-email');
  }

  // The PDF when there is one, else the HTML — the same preference the
  // register's own `format` column records.
  const fileId = document.fileId ?? document.htmlFileId;
  if (fileId === null || fileId === undefined) {
    return await record(documents, document.id, 'not-sent:no-file');
  }

  const subject = document.subject as { business?: { name?: string } } | null;
  const job = await enqueueEmail(
    {
      meta: deps.meta,
      ...(deps.secret === undefined ? {} : { secret: deps.secret }),
      ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    },
    {
      to,
      templateKey: DOCUMENT_READY_TEMPLATE_KEY,
      // Absent, not the tag: `enqueueEmail` then resolves the workspace
      // default, which is a better answer than a locale no row can match.
      ...(localeIdFor(document.locale) === undefined
        ? {}
        : { locale: localeIdFor(document.locale)! }),
      vars: {
        kind: kindLabel(deps, document),
        number: document.number ?? '',
        business: subject?.business?.name ?? '',
        // Absent is not empty-string-safe by accident: `renderButton` drops a
        // block whose url is nothing, which is what makes the link optional
        // without making the template conditional.
        documentUrl: input.url ?? '',
        // The `generated` attachment's token — this is the document itself.
        documentFileId: fileId,
      },
    },
  );

  /*
   * `enqueueEmail` returns null for every reason a message cannot be built —
   * no SMTP, no master secret, no template row, a template the operator
   * disabled. It never throws and never says which, deliberately, so this is
   * recorded as the one an operator can act on. The detail is in the log the
   * enqueue itself wrote.
   */
  return await record(
    documents,
    document.id,
    job === null ? 'not-sent:smtp-unconfigured' : 'sent',
  );
}

async function record(
  documents: ReturnType<typeof documentsRepo>,
  id: string,
  outcome: DeliveryOutcome,
): Promise<DeliveryOutcome> {
  await documents.markDelivery(id, outcome);
  return outcome;
}
