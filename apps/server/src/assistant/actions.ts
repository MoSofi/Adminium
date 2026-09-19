// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What happens when a person clicks a button on the result card.
 *
 * THE MODEL IS NOT HERE. Nothing in this file is reachable from a turn: the
 * assistant's terminal move is a validated draft, and every one of these runs
 * only because somebody read that draft and pressed Save, Send test or
 * Preview another sample. That is the whole shape of the feature — the
 * assistant proposes, a person decides — and it is why the catalogue has no
 * write tool for the model to reach for.
 *
 * WHAT ACTUALLY WRITES. Not this module either. Each save calls the SAME
 * functions the host page's own route calls — the same normalizer, the same
 * validator, the same repo, the same number minting — so a document the
 * assistant saved is indistinguishable from one somebody typed, and there is
 * no second way into these tables to keep in step with the first.
 *
 * THE GRANT IS THE PAGE'S. Every write needs `system:settings:manage`, which
 * is what each host page's own save needs. Being allowed to USE the assistant
 * is a different, smaller thing, so a role that can draft and preview but not
 * save is the ordinary case rather than an edge.
 *
 * ONE ROW PER ACTION. Each write leaves one audit entry naming the page and
 * the verb, carrying the session and turn that proposed it — so the trail
 * answers "where did this document come from" and not merely "something was
 * created".
 */

import {
  auditRepo,
  emailTemplatesRepo,
  invoiceLangSchema,
  invoiceTopicSchema,
  invoiceDocumentsRepo,
  reportDocumentsRepo,
  settingsRepo,
  type AssistantContextKey,
  type MetaDb,
} from '@adminium/meta';

import { ConflictError, ForbiddenError, ValidationFailedError } from '../errors.js';
import { documentColumns, mintKey, normalizeDocument, slugKey, type EmailDocument } from '../email/document.js';
import { renderEmail } from '../email/render.js';
import {
  enqueueRenderedEmail,
  isEmailConfigured,
  prepareEmail,
  resolveGeneratedAttachments,
  type EmailLogger,
} from '../email/send.js';
import { starterSampleVars } from '../email/starters.js';
import { bodyColumn as invoiceBodyColumn, normalizeInvoiceBody, type InvoiceBody } from '../invoices/document.js';
import { isInvoiceLang, localizeBody } from '../invoices/languages.js';
import { nextInvoiceNumber } from '../invoices/numbering.js';
import { summaryOf as invoiceSummaryOf } from '../invoices/summary.js';
import { bodyColumn as reportBodyColumn, normalizeReportBody } from '../report-documents/document.js';
import { summaryOf as reportSummaryOf } from '../report-documents/summary.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { contextAdapter } from './contexts/index.js';
import type { AssistantToolDeps } from './types.js';
import { dirForLocale, isLocaleId } from '@adminium/i18n';

/** The four things a result card can do. */
export type AssistantActionKind = 'save' | 'test-send' | 'sample' | 'language.add';

/** Who is doing it, for the audit row. */
export interface AssistantActor {
  kind: 'user' | 'api-key' | 'system';
  id: string | null;
  label: string;
}

export interface AssistantActionInput {
  meta: MetaDb;
  action: AssistantActionKind;
  context: AssistantContextKey;
  /** The validated draft the turn produced. */
  artefact: Record<string, unknown>;
  /** Which turn of which session proposed it — the trail's thread. */
  sessionId: string;
  turnId: string;
  actor: AssistantActor;
  /** Answers a system permission for the acting person. */
  can: (permission: string) => Promise<boolean>;
  /** Overrides the artefact's own name, when the person renamed it on the card. */
  name?: string | undefined;
  /** `save` only: create the row AND open it in the editor. */
  open?: boolean | undefined;
  /**
   * `sample` only: the tool deps a RE-RUN reads through — the acting
   * person's grants, built the same way a turn's are. Absent on a page with
   * nothing to re-run, and absent in a harness that does not need one.
   */
  toolDeps?: AssistantToolDeps | undefined;
  /** `language.add` only: the language to add. */
  locale?: string | undefined;
  /** Where a test message goes — the acting person's own address. */
  to?: string | undefined;
  /** The master secret, for the mail transport. */
  secret?: string | null | undefined;
  logger?: EmailLogger | undefined;
  now?: (() => number) | undefined;
}

/** What the card shows afterwards. The words are the dashboard's; this is the fact. */
export type AssistantEcho =
  | { kind: 'saved'; open: boolean; name: string }
  | { kind: 'language-added'; locale: string; name: string }
  | { kind: 'test-sent'; to: string }
  | { kind: 'sampled'; label: string }
  /**
   * A re-run: how many block figures moved, and how many sources refused.
   * COUNTS, not a sentence — the sentence is the dashboard's, in the
   * operator's own language.
   */
  | { kind: 'resampled'; refreshed: number; refused: number };

export interface AssistantActionResult {
  echo: AssistantEcho;
  /** The row a save created, for the manager's list and the editor's route. */
  created?: { id: string; kind: string; name: string };
  /** A re-drawn preview, when the action produced one and wrote nothing. */
  sample?: { artefact: Record<string, unknown>; label: string };
}

/** Every save rides the grant the host page's own save rides. */
async function requireSettingsManage(input: AssistantActionInput, what: string): Promise<void> {
  if (!(await input.can(PERMISSIONS.settingsManage))) {
    throw new ForbiddenError(`Your role cannot ${what} here.`, 'FORBIDDEN', {
      permission: PERMISSIONS.settingsManage,
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** The one audit row an action leaves, naming the page, the verb and the turn. */
async function writeAudit(
  input: AssistantActionInput,
  verb: string,
  after: Record<string, unknown>,
  at: number,
): Promise<void> {
  await auditRepo(input.meta).append(
    {
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      actorLabel: input.actor.label,
      // The host pages' own category: what changed is a workspace document,
      // however it came to be written.
      category: 'settings',
      action: `assistant.${input.context}.${verb}`,
      changes: { after: { ...after, sessionId: input.sessionId, turnId: input.turnId } },
    },
    at,
  );
}

export async function runAssistantAction(input: AssistantActionInput): Promise<AssistantActionResult> {
  const at = (input.now ?? Date.now)();
  switch (input.action) {
    case 'save':
      return saveDraft(input, at);
    case 'language.add':
      return addLanguage(input, at);
    case 'test-send':
      return testSend(input, at);
    case 'sample':
      return sampleAgain(input);
  }
}

// ── save ─────────────────────────────────────────────────────────────────────

/**
 * Create the row the draft describes.
 *
 * It lands as a DRAFT on every page — an email document disabled, an invoice
 * and a report `draft`. A document that arrived from a model is a proposal
 * until somebody who read it says otherwise, and the page's own controls are
 * where that happens. Undoing it is the page's own delete; there is no second
 * mechanism.
 */
async function saveDraft(input: AssistantActionInput, at: number): Promise<AssistantActionResult> {
  await requireSettingsManage(input, 'save documents');
  const artefact = input.artefact;
  const open = input.open ?? false;

  if (input.context === 'email') {
    const templates = emailTemplatesRepo(input.meta);
    const name = text(input.name, text(artefact.name, 'Untitled template'));
    const kind = artefact.kind === 'campaign' ? 'campaign' : 'template';
    const locale = text(artefact.locale, 'en_US');
    const document: EmailDocument = normalizeDocument(record(artefact.document) as never);
    const row = await templates.create(
      {
        kind,
        key: mintKey(name, await templates.keysLike(slugKey(name))),
        locale,
        name,
        category: 'lifecycle',
        starter: null,
        // A draft: the manager's Draft pill, not a live document.
        enabled: false,
        createdBy: input.actor.id,
        ...documentColumns(document),
      },
      at,
    );
    await writeAudit(input, 'create', { id: row.id, kind, key: row.key, locale, name }, at);
    return { echo: { kind: 'saved', open, name }, created: { id: row.id, kind, name } };
  }

  if (input.context === 'report') {
    const body = normalizeReportBody(record(artefact.body));
    const name = text(input.name, text(artefact.name, 'Untitled report'));
    const row = await reportDocumentsRepo(input.meta).create(
      {
        kind: 'template',
        name,
        // Never `sent`: publishing is a person's act on this page's own
        // primary button, and nothing here reaches it.
        status: 'draft',
        starter: null,
        originId: null,
        body: reportBodyColumn(body),
        summary: reportSummaryOf(body),
        createdBy: input.actor.id,
      },
      at,
      { at: 'first' },
    );
    await writeAudit(input, 'create', { id: row.id, kind: 'template', name }, at);
    return { echo: { kind: 'saved', open, name }, created: { id: row.id, kind: 'template', name } };
  }

  const repo = invoiceDocumentsRepo(input.meta);
  const name = text(input.name, text(artefact.name, 'Untitled invoice'));

  if (input.context === 'invoice-template') {
    const body = normalizeInvoiceBody(record(artefact.body));
    const row = await repo.create(
      {
        kind: 'template',
        name,
        status: 'draft',
        // Both are closed vocabularies: a value the model invented reads as
        // the neutral default rather than failing a save the person asked for.
        topic: invoiceTopicSchema.catch('other').parse(artefact.topic),
        lang: invoiceLangSchema.catch('en').parse(artefact.lang),
        number: body.number,
        starter: null,
        originId: null,
        body: invoiceBodyColumn(body),
        summary: invoiceSummaryOf(body),
        createdBy: input.actor.id,
      },
      at,
      { at: 'first' },
    );
    await writeAudit(input, 'create', { id: row.id, kind: 'template', name }, at);
    return { echo: { kind: 'saved', open, name }, created: { id: row.id, kind: 'template', name } };
  }

  // An invoice: built from a named template, and NUMBERED HERE. The model
  // left `number` empty because a serial is a fact about this workspace's
  // sequence, not a thing to be guessed.
  const basedOn = text(artefact.basedOn);
  const template = basedOn === '' ? null : await repo.findById(basedOn);
  if (template === null || template.kind !== 'template') {
    throw new ValidationFailedError('Only a template can start an invoice.', { basedOn });
  }
  const number = await nextInvoiceNumber(repo);
  const body: InvoiceBody = { ...normalizeInvoiceBody(record(artefact.body)), number };
  const row = await repo.create(
    {
      kind: 'invoice',
      name,
      status: 'draft',
      topic: template.topic,
      lang: template.lang,
      number,
      starter: template.starter,
      originId: template.id,
      body: invoiceBodyColumn(body),
      summary: invoiceSummaryOf(body),
      createdBy: input.actor.id,
    },
    at,
    { at: 'first' },
  );
  await writeAudit(input, 'create', { id: row.id, kind: 'invoice', name, number, templateId: template.id }, at);
  return { echo: { kind: 'saved', open, name }, created: { id: row.id, kind: 'invoice', name } };
}

// ── language.add ─────────────────────────────────────────────────────────────

/**
 * Save the draft as a LANGUAGE VARIATION of an existing document rather than
 * as a new one: same family, different language. The page's own rule that a
 * family holds one document per language is what refuses a second.
 */
async function addLanguage(input: AssistantActionInput, at: number): Promise<AssistantActionResult> {
  await requireSettingsManage(input, 'add languages');
  const artefact = input.artefact;
  const basedOn = text(artefact.basedOn);
  if (basedOn === '') {
    throw new ValidationFailedError('A language variation needs the document it varies.', {});
  }

  if (input.context === 'email') {
    const templates = emailTemplatesRepo(input.meta);
    const source = await templates.findById(basedOn);
    if (source === null) throw new ValidationFailedError('That document no longer exists.', { basedOn });
    const locale = text(input.locale, text(artefact.locale));
    if (locale === '') throw new ValidationFailedError('A language variation needs a language.', {});
    const existing = await templates.findByKeyLocale(source.key, locale);
    if (existing !== null) {
      throw new ConflictError(`${source.key} already has a ${locale} variation.`, 'CONFLICT', {
        existingId: existing.id,
      });
    }
    const name = text(input.name, text(artefact.name, source.name));
    const document = normalizeDocument(record(artefact.document) as never);
    const row = await templates.create(
      {
        kind: source.kind,
        // The KEY is the family; the locale is what makes this row its own.
        key: source.key,
        locale,
        name,
        category: source.category,
        starter: source.starter,
        enabled: false,
        createdBy: input.actor.id,
        ...documentColumns(document),
      },
      at,
    );
    await writeAudit(input, 'language.add', { id: row.id, key: row.key, locale, name }, at);
    return { echo: { kind: 'language-added', locale, name }, created: { id: row.id, kind: row.kind, name } };
  }

  if (input.context !== 'invoice-template') {
    throw new ValidationFailedError('This page has no language variations.', { context: input.context });
  }

  const repo = invoiceDocumentsRepo(input.meta);
  const source = await repo.findById(basedOn);
  if (source === null) throw new ValidationFailedError('That document no longer exists.', { basedOn });
  const lang = text(input.locale, text(artefact.lang));
  if (!isInvoiceLang(lang)) {
    throw new ValidationFailedError(`${lang} is not a language this page writes.`, { lang });
  }
  const body = localizeBody(normalizeInvoiceBody(record(artefact.body)), lang);
  const name = text(input.name, text(artefact.name, source.name));
  const row = await repo.create(
    {
      kind: source.kind,
      name,
      status: 'draft',
      topic: source.topic,
      lang,
      number: body.number,
      starter: source.starter,
      originId: source.id,
      body: invoiceBodyColumn(body),
      summary: invoiceSummaryOf(body),
      createdBy: input.actor.id,
    },
    at,
    { at: 'first' },
  );
  await writeAudit(input, 'language.add', { id: row.id, lang, name }, at);
  return { echo: { kind: 'language-added', locale: lang, name }, created: { id: row.id, kind: row.kind, name } };
}

// ── test-send ────────────────────────────────────────────────────────────────

/**
 * Send the UNSAVED draft to the person looking at it, with sample data.
 *
 * One address, one click, no dialog: the address is the acting person's own,
 * so there is nothing to choose and nobody else's inbox to reach. Picking
 * other recipients is the editor's own test dialog, one *Open in editor* away.
 */
async function testSend(input: AssistantActionInput, at: number): Promise<AssistantActionResult> {
  await requireSettingsManage(input, 'send test emails');
  if (input.context !== 'email') {
    throw new ValidationFailedError('Only the email page sends test messages.', { context: input.context });
  }
  const to = text(input.to);
  if (to === '') {
    throw new ValidationFailedError('A test message needs an address to go to.', {});
  }

  const secret = input.secret ?? null;
  let configured = false;
  let reason = 'not configured';
  try {
    configured = await isEmailConfigured(input.meta, secret);
  } catch (error) {
    reason = error instanceof Error ? error.message : 'unreadable';
  }
  if (!configured) {
    // The same 409 the editor's own test send answers, so the card can say
    // the same thing and link to the same settings page.
    throw new ConflictError(
      reason === 'not configured'
        ? 'No SMTP transport is configured — set one up before sending a test message.'
        : reason,
      'CONFLICT',
      { setting: 'email.smtp', reason },
    );
  }

  const artefact = input.artefact;
  const document = normalizeDocument(record(artefact.document) as never);
  const locale = text(artefact.locale, 'en_US');
  const settings = settingsRepo(input.meta);
  const appName = await settings.get('branding.appName');
  const origin = await settings.get('system.publicOrigin');
  const vars = starterSampleVars({ appName, origin: origin ?? '', to });
  const prepared = await prepareEmail(input.meta, document);
  const generated = await resolveGeneratedAttachments(input.meta, document.attachments, vars, input.logger);
  const rendered = renderEmail({
    ...prepared.render,
    locale,
    vars,
    dir: isLocaleId(locale) ? dirForLocale(locale) : 'ltr',
  });
  await enqueueRenderedEmail(
    {
      meta: input.meta,
      ...(secret === null ? {} : { secret }),
      ...(input.logger === undefined ? {} : { logger: input.logger }),
    },
    {
      to,
      // There is no row yet — the draft is what is being tested — so the
      // family key is the one the save would mint.
      templateKey: slugKey(text(artefact.name, 'assistant-draft')),
      locale,
      rendered,
      from: prepared.from,
      attachments: [...prepared.attachments, ...generated],
    },
  );
  // The RECIPIENT is the audit-worthy fact; the rendered body is not.
  await writeAudit(input, 'test-send', { to, locale }, at);
  return { echo: { kind: 'test-sent', to } };
}

// ── sample ───────────────────────────────────────────────────────────────────

/**
 * Re-draw the preview. It writes nothing, so it needs no grant beyond being
 * able to use the assistant at all, and it leaves no audit row — a preview is
 * not a change.
 *
 * ON A PAGE WHOSE FIGURES CAME FROM A DATABASE it is not a re-draw at all but
 * a RE-RUN: the report context stored the descriptor behind every block it
 * filled, and this is where they are executed again, with the acting person's
 * own grants (`toolDeps`). A page with nothing to re-run, or an action
 * reached without those deps, falls back to redrawing the artefact as it
 * stands — which is what the invoice and email previews have always done.
 */
async function sampleAgain(input: AssistantActionInput): Promise<AssistantActionResult> {
  const artefact = input.artefact;
  const label = text(record(artefact.body).customerName, 'sample');
  const adapter = contextAdapter(input.context);
  if (adapter.resample === undefined || input.toolDeps === undefined) {
    return { echo: { kind: 'sampled', label }, sample: { artefact, label } };
  }
  const run = await adapter.resample(artefact, input.toolDeps);
  // A redraw NAMES its record; a re-run COUNTS its figures. The page decides
  // which it did, because only the page knows what its preview is made of.
  return {
    echo:
      run.label === undefined
        ? { kind: 'resampled', refreshed: run.refreshed, refused: run.refused.length }
        : { kind: 'sampled', label: run.label },
    sample: { artefact: run.artefact, label: run.label ?? label },
  };
}
