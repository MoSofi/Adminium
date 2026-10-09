// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shapes the assistant's server half is built from: what a tool is given,
 * what a tool answers, and what a host page has to provide to be a context.
 *
 * Two rules are expressed here rather than repeated everywhere:
 *
 * A TOOL NEVER TAKES A REQUEST. Tools run inside a job, long after the request
 * that started the turn is gone, so every authority they need arrives as a
 * function on {@link AssistantToolDeps} — resolved once for the acting user.
 * A tool that could reach for a request could also reach for one that belongs
 * to somebody else.
 *
 * A TOOL FAILURE IS DATA. A forbidden table, an unknown column, a cap the
 * model blew past: each is answered as `{ error: { code, message } }`, handed
 * back to the model in the next message, and shown on the step row. Throwing
 * would end the turn over something the model can simply do differently.
 */

import type { AssistantContextKey, AssistantHost, MetaDb } from '@adminium/meta';
import type { AssistantToolSpec } from '@adminium/llm';
import type { I18nInstance } from '@adminium/i18n/server';

import type { ConnectionManager } from '../connections/manager.js';

/** Answers one table-read question for one connection; `false` for every table without a user. */
export type CanReadTable = (tableId: string) => Promise<boolean>;

export interface AssistantToolDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  /** A system permission, for the acting user, outside a request. */
  can: (permission: string) => Promise<boolean>;
  /** Per-connection read predicate — resolved once per connection and reused. */
  canReadTable: (connectionId: string) => Promise<CanReadTable>;
  /** The person the turn runs as. `null` means the tools read no table at all. */
  userId: string | null;
  /** Whether `read_rows` / `aggregate` exist in this session at all. */
  rowData: boolean;
  /** The operator's UI locale, e.g. `de_DE`. */
  locale: string;
  /** Translator for that locale — the starters and page labels are authored as keys. */
  t: I18nInstance['t'];
  context: AssistantContextKey;
  host: AssistantHost;
}

/** A tool failure the model can recover from. */
export interface AssistantToolFailure {
  code: string;
  message: string;
}

export interface AssistantToolOutcome {
  /** Present when the call succeeded. */
  result?: unknown;
  /** Present when it did not. Exactly one of the two. */
  error?: AssistantToolFailure;
  /** `<connection name>.<table>` this call read — appended to the turn's sources, which a person reads. */
  tables?: string[];
}

export interface AssistantTool {
  name: string;
  /** What it returns and its caps, as the model is told. */
  description: string;
  /** JSON Schema of `args`. */
  args: unknown;
  run: (args: Record<string, unknown>, deps: AssistantToolDeps) => Promise<AssistantToolOutcome>;
}

/**
 * The rows the details tab can show, as KINDS rather than sentences.
 *
 * Each page picks the rows that mean something on it and supplies the numbers
 * and names they read; the dashboard owns both the label and the wording,
 * because a sentence composed here would be English on the wire and no locale
 * could translate it. A kind the dashboard does not know renders as nothing
 * rather than as a raw key.
 */
export type AssistantDetailKind =
  | 'formatEmail'
  | 'variables'
  | 'formatInvoice'
  | 'taxLines'
  | 'record'
  | 'lines'
  | 'notTouched'
  | 'sourcesChosen'
  | 'figures'
  | 'notPublished';

/** One row of the result card's details tab: which row, and what it reads. */
export interface AssistantDetailRow {
  kind: AssistantDetailKind;
  args: Record<string, string | number>;
}

/**
 * What the prompt says is true of the page right now, and what the modal's
 * header says.
 *
 * `values` carries NUMBERS AND NAMES, never sentences. The header's blurb is
 * one sentence per page, with counts in it, and a sentence composed here would
 * be English on the wire — which no locale can translate. So the server
 * measures and the dashboard words it.
 */
export interface AssistantPageFacts {
  /** The named facts the page's own sentence interpolates. */
  values: AssistantFactValues;
  /** The scope chip: this page's own collection, plus how much else is readable. */
  scope: { primary: string; extra: number };
  /** The prompt's "This page" section, rendered. */
  prompt: string;
}

/**
 * The facts a page's copy can name: an OPEN list of numbers, names and
 * yes/no answers, keyed by what each page measures (`templates`, `rules`,
 * `rows`, …). Open on purpose: when it was a fixed list, a new page's count
 * had to be added in three places, and a place that was missed drew the raw
 * placeholder in the header. The dashboard reads the keys its sentence names
 * and ignores the rest.
 */
export type AssistantFactValues = Record<string, string | number | boolean>;

/** A fact's key: an identifier, so it can be a placeholder in a translated sentence. */
export const ASSISTANT_FACT_KEY = /^[a-z][A-Za-z0-9]{0,31}$/;

/** Why an artefact was refused, in the shape the correction message takes. */
export interface AssistantArtefactRejection {
  path: string;
  code: string;
  message: string;
}

export type AssistantArtefactCheck =
  | { ok: true; artefact: Record<string, unknown> }
  | { ok: false; errors: AssistantArtefactRejection[] };

/**
 * What a page DRAFTS: its format, its worked examples, its own validator and
 * what a diff compares. A page that drafts nothing (a data page, the general
 * assistant) has none of this, and says so by leaving
 * {@link AssistantContextAdapter.document} out — the prompt then has no
 * document sections and the reply contract no `result`.
 */
export interface AssistantDocument {
  /** The document format, rendered for the prompt. */
  formatSpec: () => string;
  /** Worked examples in that format — the page's own starters, rendered. */
  examples: (deps: AssistantToolDeps) => string[];
  /**
   * The host's OWN validator — a draft that passes here is a draft its editor
   * can open and its save will accept. Takes deps because a page validates
   * against the workspace (configured senders, attachment budgets), not
   * against the document alone.
   */
  acceptArtefact: (artefact: Record<string, unknown>, deps: AssistantToolDeps) => Promise<AssistantArtefactCheck>;
  /** The artefact as canonical lines, for the computed diff. */
  projectForDiff: (artefact: Record<string, unknown>) => string[];
  /** The base document `basedOn` names, as the same lines; `null` when there is none. */
  baseForDiff: (basedOn: string, deps: AssistantToolDeps) => Promise<string[] | null>;
  /** The details tab's rows for this page, beside the shared ones. */
  details: (artefact: Record<string, unknown>) => AssistantDetailRow[];
  /**
   * Re-run whatever the artefact's figures were computed from, and hand back
   * the artefact with today's answers in it. Only a page whose blocks hold
   * VALUES rather than queries has anything to do here — a report — and only
   * that page records the descriptors to re-run.
   *
   * It reads with the acting person's grants, like every other read this
   * surface makes: a table they have lost access to since the draft was made
   * refuses, and the figure it filled stays as it was rather than being
   * silently recomputed by somebody else's reach.
   */
  resample?: (artefact: Record<string, unknown>, deps: AssistantToolDeps) => Promise<AssistantResample>;
}

/**
 * One host page, as the runner sees it. Everything that differs between the
 * pages lives behind this and nothing else in the runner branches on the
 * context.
 */
export interface AssistantContextAdapter {
  key: AssistantContextKey;
  /** The page's name in the prompt's first line. English; the model answers in the operator's locale. */
  pageLabel: string;
  /** Which tools this page offers, in catalogue order. Row tools are filtered out elsewhere. */
  toolNames: readonly string[];
  /** What is true of the page right now. */
  pageFacts: (deps: AssistantToolDeps) => Promise<AssistantPageFacts>;
  /** What the page drafts. Absent on a page that drafts nothing. */
  document?: AssistantDocument;
}

/** What a re-run came back with. */
export interface AssistantResample {
  artefact: Record<string, unknown>;
  /** How many block figures were actually refreshed. */
  refreshed: number;
  /** Sources that refused, by block, for the echo — never silently dropped. */
  refused: { blockId: string; message: string }[];
  /**
   * The record this redraw was drawn over, when that is what happened.
   *
   * A report RE-RUNS its sources and the echo counts figures; an invoice
   * template is REDRAWN over a different document, and the only thing worth
   * saying about that is which one. Set it and the echo names the record;
   * leave it and the echo counts.
   */
  label?: string;
}

/** The tool catalogue as the prompt lists it. */
export type AssistantToolSpecList = readonly AssistantToolSpec[];
