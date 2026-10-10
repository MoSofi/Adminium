// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant API client.
 *
 * TYPE-ONLY MIRROR of `apps/server/src/routes/assistant/schema.ts`: the
 * dashboard may not import server runtime code, and `dependency-cruiser`
 * additionally forbids it from importing `@adminium/llm` — so the turn
 * contract's shapes are restated here by hand and the two files change
 * together (the server file carries the same SYNC NOTE). Replies are
 * un-enveloped, the email/invoice/report clients' style.
 *
 * WHAT IS DELIBERATELY LOOSE HERE. `steps`, `ask`, `result` and `error` are
 * stored documents: a turn written by a newer server has to render rather than
 * crash the one screen that explains a failure. So each is narrowed on READ,
 * by a small reader below, and a field that no longer fits is simply absent.
 */
import { api } from '../app/api.js';

const BASE = '/api/v1/assistant';

/** The four pages the assistant can be opened from. */
export type AssistantContext = 'email' | 'invoice-template' | 'invoices' | 'report' | 'automation' | 'data' | 'general';

/** Why the modal cannot work, when it cannot. */
export type AssistantUnavailableReason = 'no-provider' | 'network-disabled' | 'forbidden';

export interface AssistantAvailability {
  enabled: boolean;
  reason: AssistantUnavailableReason | null;
  /** What the assistant is called here (`assistant.name`). */
  name: string;
  /** Whether its tools may read rows at all. */
  rowData: boolean;
  /** Whether this session may SAVE what it drafts (`system:settings:manage`). */
  canWrite: boolean;
  /** Whether it may reach Settings → AI, which the unavailable bar links to. */
  canConfigure: boolean;
  provider: string | null;
  model: string | null;
  /** The asking person's allowance for the UTC day. `limit` 0 means there is none. */
  budget: { limit: number; used: number; resetsAt: number; left: boolean };
  /** What the workspace lets the assistant do, beyond reading. Absent from a server before the switches. */
  abilities?: AssistantAbilities;
  /** The most changes one confirmation may make. */
  maxRows?: number;
  /**
   * Voice. `input`: a recording is written down by the workspace's own model
   * service (`provider`, named in `to`), by the browser's own speech service,
   * or not at all. `output`: replies may be read aloud. Absent from a server
   * before voice.
   */
  voice?: { input: 'provider' | 'browser' | 'none'; to: string | null; output: boolean; maxSeconds: number };
}

/** The workspace's four switches on what the assistant may do. */
export interface AssistantAbilities {
  create: boolean;
  change: boolean;
  send: boolean;
  delete: boolean;
}

export interface AssistantHostRef {
  documentId?: string;
  tab?: string;
  connectionIds: string[];
  /** A data page: which page. The server reads the page's table from the page. */
  pageId?: string;
  /** What that page is showing: what "these" means in a question. */
  view?: AssistantPageView;
  /** A screen with no context of its own: the router's route id, and the app's key over a framed staff side. */
  route?: string;
  app?: string;
  /** One of an add-on's own screens: its key, and the screen's ref. */
  addOn?: string;
  addOnPage?: string;
}

/** A data page's state, in the list route's own spellings. */
export interface AssistantPageView {
  q?: string;
  order?: string;
  /** The filter the grid sent, as JSON text, link filters already resolved into it. */
  where?: string;
  /** The rows the person ticked, by key. */
  selectedIds?: string[];
  /** The record the person has open, by key. */
  recordId?: string;
}

export interface AssistantSessionView {
  id: string;
  context: AssistantContext;
  status: 'open' | 'closed';
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: number;
}

/**
 * What the header draws, measured per page by the server.
 *
 * `values` is NUMBERS AND NAMES, never a sentence: the page's own copy words
 * them (`contexts.ts`), because a sentence composed on the server would be
 * English on the wire and no locale could translate it.
 */
export interface AssistantFacts {
  values: {
    templates?: number;
    campaigns?: number;
    invoices?: number;
    reports?: number;
    rules?: number;
    tables?: number;
    connection?: string;
    pattern?: string;
    write?: boolean;
    /**
     * And whatever else a page measures. The list is open on the server: a
     * new page's fact arrives here without this file changing, and the copy
     * that names it reads it by key.
     */
    [fact: string]: string | number | boolean | undefined;
  };
  /** The scope chip: the page's own collection, plus how much else is readable. */
  scope: { primary: string; extra: number };
}

export interface AssistantSessionReply {
  session: AssistantSessionView;
  facts: AssistantFacts;
  nextTurnTokens: number;
}

export type AssistantStepState = 'started' | 'done' | 'failed';

export interface AssistantStepView {
  id: string;
  state: string;
  icon: string;
  label: string;
  detail: string;
  /** `connection.table` names this step read. */
  tables: string[];
  /**
   * Set on the ONE step the server writes itself — the page it read before
   * asking anything. `label` and `detail` are then empty, and this page's own
   * copy words the row: a sentence composed on the server would be English on
   * the wire, like the blurb and the detail rows before it.
   */
  facts?: Record<string, string | number | boolean>;
}

export type AssistantTurnStatus =
  | 'queued'
  | 'running'
  | 'awaiting_picks'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface AssistantTurnView {
  id: string;
  sessionId: string;
  seq: number;
  status: AssistantTurnStatus;
  jobId: string | null;
  askText: string | null;
  say: string | null;
  steps: AssistantStepView[];
  ask: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: number;
  finishedAt: number | null;
  /** The page the question was asked on. */
  context: AssistantContext;
  /** What the turn ended with besides its words and its draft: what was read, what was suggested. */
  answer: Record<string, unknown> | null;
  /** Where it was asked, beyond the context: the data page (with its title now) or the open document. */
  on?: {
    pageId: string | null;
    documentId: string | null;
    title: string | null;
    scope?: { kind: 'selection' | 'record' | 'page'; count: number | null } | null;
    /** It drafted for a document that has been deleted since. */
    gone?: boolean;
  };
}

/** `GET /assistant/sessions/current`: the person's open conversation, or none. */
export interface AssistantCurrentReply {
  session: AssistantSessionView | null;
  turns: AssistantTurnView[];
  /** Earlier turns the conversation holds that are not in `turns`. */
  earlier: number;
  /** No conversation because the last one was closed for its age, lately. */
  aged?: boolean;
}

/** `POST /assistant/facts`: what the header says of one page. */
export interface AssistantFactsReply {
  facts: AssistantFacts;
  nextTurnTokens: number;
  /** Questions an installed add-on offers on this page of its own. Absent from an older server. */
  starters?: AssistantStarter[] | undefined;
}

/** A question an add-on offers on one of its pages, in the reader's language, with whose it is. */
export interface AssistantStarter {
  key: string;
  text: string;
  addOn: string;
}

export interface AssistantTurnReply {
  turn: AssistantTurnView;
  jobId: string;
  nextTurnTokens: number;
}

/**
 * What a result card can do. `editor` is the save flow on a manager and a
 * client-only apply in an editor, so it has no wire verb of its own.
 */
export type AssistantActionKind = 'save' | 'test-send' | 'sample' | 'language.add';

export interface AssistantActionBody {
  action: AssistantActionKind;
  /** The page the person is on when they press: a draft is usable only where it was made. */
  on?: { context: AssistantContext; documentId?: string };
  open?: boolean;
  name?: string;
  locale?: string;
}

export interface AssistantActionReply {
  /** A FACT, not a sentence: the words are this app's (the server is not localised). */
  echo: Record<string, unknown>;
  created: { id: string; kind: string; name: string } | null;
  sample: { artefact: Record<string, unknown>; label: string } | null;
}

// ─── A proposal ──────────────────────────────────────────────────────────────

/** Where a proposal stands. `unchecked`: the server has not tried it yet, and nothing of it is known here. */
export type AssistantProposalState = 'unchecked' | 'open' | 'refused' | 'superseded' | 'expired' | 'applying' | 'applied' | 'interrupted';

/** What the person is shown of one action before they confirm it, built by the server from what THEY may read. */
export type AssistantProposalPreview =
  | { kind: 'create'; after: Record<string, unknown> }
  | { kind: 'change'; before: Record<string, unknown>; after: Record<string, unknown> }
  | { kind: 'delete'; row: Record<string, unknown>; references: { table: string; count: number }[] }
  | { kind: 'doc.save'; what: string; name: string }
  | { kind: 'doc.change'; what: string; id: string; name: string; switchesOff: boolean }
  | { kind: 'doc.delete'; what: string; id: string; name: string }
  | { kind: 'send.template'; id: string; name: string; subject: string; roles: { id: string; name: string }[]; total: number; skipped: number };

export interface AssistantProposalAction {
  do: string;
  /** A row's table and key, when the action is about a row. */
  table: string | null;
  id: string | null;
  preview: AssistantProposalPreview | null;
  /** Why it cannot be done. `message` is the server route's own sentence. */
  refused: { code: string; message: string } | null;
}

export interface AssistantProposalOutcome {
  done: { index: number; id: string | null }[];
  failed: { index: number; code: string; message: string }[];
  notTried: number[];
  /** The one being written when the server stopped: done or not is not known. */
  unsure: number[];
}

export interface AssistantProposal {
  state: AssistantProposalState;
  title: string;
  /** Empty before the check, and once the proposal is let go. */
  actions: AssistantProposalAction[];
  /** How many actions it had, when they are no longer listed. */
  count: number;
  hash: string | null;
  expiresAt: number | null;
  /** Why the whole of it cannot be confirmed. */
  refusal: { code: string; count: number | null; cap: number | null } | null;
  picked: number[];
  outcome: AssistantProposalOutcome | null;
}

/** What a confirmation answers once and the server keeps nowhere. */
export interface AssistantApplyReply {
  proposal: Record<string, unknown>;
  undo?: { index: number; token: string }[];
  once?: unknown[];
}

function readPreview(raw: unknown): AssistantProposalPreview | null {
  const preview = record(raw);
  if (preview === null) return null;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  switch (preview.kind) {
    case 'create':
      return { kind: 'create', after: record(preview.after) ?? {} };
    case 'change':
      return { kind: 'change', before: record(preview.before) ?? {}, after: record(preview.after) ?? {} };
    case 'delete': {
      const references: { table: string; count: number }[] = [];
      for (const entry of Array.isArray(preview.references) ? preview.references : []) {
        const reference = record(entry);
        if (reference !== null && typeof reference.table === 'string' && typeof reference.count === 'number') references.push({ table: reference.table, count: reference.count });
      }
      return { kind: 'delete', row: record(preview.row) ?? {}, references };
    }
    case 'doc.save':
      return { kind: 'doc.save', what: text(preview.what), name: text(preview.name) };
    case 'doc.change':
      return { kind: 'doc.change', what: text(preview.what), id: text(preview.id), name: text(preview.name), switchesOff: preview.switchesOff === true };
    case 'doc.delete':
      return { kind: 'doc.delete', what: text(preview.what), id: text(preview.id), name: text(preview.name) };
    case 'send.template': {
      const roles: { id: string; name: string }[] = [];
      for (const entry of Array.isArray(preview.roles) ? preview.roles : []) {
        const role = record(entry);
        if (role !== null && typeof role.id === 'string' && typeof role.name === 'string') roles.push({ id: role.id, name: role.name });
      }
      return { kind: 'send.template', id: text(preview.id), name: text(preview.name), subject: text(preview.subject), roles, total: typeof preview.total === 'number' ? preview.total : 0, skipped: typeof preview.skipped === 'number' ? preview.skipped : 0 };
    }
    default:
      return null;
  }
}

const PROPOSAL_STATES: readonly AssistantProposalState[] = ['unchecked', 'open', 'refused', 'superseded', 'expired', 'applying', 'applied', 'interrupted'];

/** Narrow a proposal as the server sends it. Anything that does not read is no proposal. */
export function readProposal(raw: unknown): AssistantProposal | null {
  const proposal = record(raw);
  if (proposal === null || !PROPOSAL_STATES.includes(proposal.state as AssistantProposalState)) return null;
  const actions: AssistantProposalAction[] = [];
  for (const entry of Array.isArray(proposal.actions) ? proposal.actions : []) {
    const action = record(entry);
    // Kept in its place, as something that cannot be done: the ticks and the outcome go by index.
    if (action === null || typeof action.do !== 'string') {
      actions.push({ do: '', table: null, id: null, preview: null, refused: { code: 'NOT_OFFERED', message: '' } });
      continue;
    }
    const refused = record(action.refused);
    actions.push({
      do: action.do,
      table: typeof action.table === 'string' ? action.table : null,
      id: typeof action.id === 'string' ? action.id : null,
      preview: readPreview(action.preview),
      refused: refused === null ? null : { code: typeof refused.code === 'string' ? refused.code : '', message: typeof refused.message === 'string' ? refused.message : '' },
    });
  }
  const refusal = record(proposal.refusal);
  const outcome = record(proposal.outcome);
  const indexes = (value: unknown): number[] => (Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : []);
  const done: AssistantProposalOutcome['done'] = [];
  const failed: AssistantProposalOutcome['failed'] = [];
  for (const entry of Array.isArray(outcome?.done) ? outcome.done : []) {
    const row = record(entry);
    if (row !== null && typeof row.index === 'number') done.push({ index: row.index, id: typeof row.id === 'string' ? row.id : null });
  }
  for (const entry of Array.isArray(outcome?.failed) ? outcome.failed : []) {
    const row = record(entry);
    if (row !== null && typeof row.index === 'number') failed.push({ index: row.index, code: typeof row.code === 'string' ? row.code : '', message: typeof row.message === 'string' ? row.message : '' });
  }
  return {
    state: proposal.state as AssistantProposalState,
    title: typeof proposal.title === 'string' ? proposal.title : '',
    actions,
    count: typeof proposal.count === 'number' ? proposal.count : actions.length,
    hash: typeof proposal.hash === 'string' ? proposal.hash : null,
    expiresAt: typeof proposal.expiresAt === 'number' ? proposal.expiresAt : null,
    refusal: refusal === null ? null : { code: typeof refusal.code === 'string' ? refusal.code : '', count: count(refusal.count), cap: count(refusal.cap) },
    picked: indexes(proposal.picked),
    outcome: outcome === null ? null : { done, failed, notTried: indexes(outcome.notTried), unsure: indexes(outcome.unsure) },
  };
}

// ─── Readers for the loose columns ───────────────────────────────────────────

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** One pick group of a question back. */
export interface AssistantAskGroup {
  key: string;
  title: string;
  options: { key: string; label: string; detail: string }[];
}

export interface AssistantAsk {
  groups: AssistantAskGroup[];
  readyLabel: string | null;
  goLabel: string | null;
}

/** Narrow a stored `ask`; a shape that no longer fits renders as no question. */
export function readAsk(raw: Record<string, unknown> | null): AssistantAsk | null {
  if (raw === null) return null;
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  const read = groups
    .map((entry) => record(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      key: str(entry.key),
      title: str(entry.title),
      options: (Array.isArray(entry.options) ? entry.options : [])
        .map((option) => record(option))
        .filter((option): option is Record<string, unknown> => option !== null)
        .map((option) => ({ key: str(option.key), label: str(option.label), detail: str(option.detail) })),
    }))
    .filter((group) => group.key !== '' && group.options.length > 0);
  if (read.length === 0) return null;
  return {
    groups: read,
    readyLabel: typeof raw.readyLabel === 'string' ? raw.readyLabel : null,
    goLabel: typeof raw.goLabel === 'string' ? raw.goLabel : null,
  };
}

export interface AssistantDiffLine {
  sign: '+' | '-' | ' ';
  text: string;
}

/**
 * One row of the details tab, as a KIND rather than a sentence.
 *
 * The page chose the row and measured what it reads; this app owns both the
 * label and the wording. A kind this build does not know renders as nothing,
 * which is better than a raw key on the screen.
 */
export interface AssistantDetail {
  kind: string;
  args: Record<string, string | number>;
}

export interface AssistantResult {
  title: string;
  meta: string;
  workTitle: string | null;
  basedOn: string | null;
  /** The drafted document, in the host page's own format. */
  /** Served without its document (an older turn): read the turn whole before using it. */
  light: boolean;
  artefact: Record<string, unknown>;
  warning: string | null;
  /** The page's own rows. */
  details: AssistantDetail[];
  /** What the model added, in its own words. */
  modelDetails: { label: string; value: string }[];
  checks: string[];
  /** What was asked and the draft does not do, each with why. */
  leftOut: { what: string; why: string }[];
  followups: string[];
  /** `connection.table` names the turn read. */
  sources: string[];
  /** The document this draft was already saved as, when the server recorded one. */
  saved: { id: string; kind: string; name: string } | null;
  diff: { against: string | null; adds: number; dels: number; lines: AssistantDiffLine[]; truncated: boolean };
}

/** `result.saved`, when it reads; anything else means "not saved yet". */
function savedOf(raw: unknown): { id: string; kind: string; name: string } | null {
  const saved = record(raw);
  if (saved === null || typeof saved.id !== 'string' || saved.id === '') return null;
  return { id: saved.id, kind: str(saved.kind), name: str(saved.name) };
}

/** Narrow a stored `result`; anything unreadable means "no draft to show". */
export function readResult(raw: Record<string, unknown> | null): AssistantResult | null {
  if (raw === null) return null;
  // An older turn of a long conversation is served LIGHT: its card's words without its document.
  // It is still a draft, drawn by its title; to use it the turn is read whole.
  const light = raw.light === true;
  const artefact = record(raw.artefact) ?? (light ? {} : null);
  if (artefact === null) return null;
  const diff = record(raw.diff);
  const lines = Array.isArray(diff?.lines) ? diff.lines : [];
  return {
    title: str(raw.title),
    meta: str(raw.meta),
    workTitle: typeof raw.workTitle === 'string' ? raw.workTitle : null,
    basedOn: typeof raw.basedOn === 'string' ? raw.basedOn : null,
    light,
    artefact,
    warning: typeof raw.warning === 'string' && raw.warning !== '' ? raw.warning : null,
    details: (Array.isArray(raw.details) ? raw.details : [])
      .map((entry) => record(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => ({ kind: str(entry.kind), args: argsOf(entry.args) })),
    modelDetails: (Array.isArray(raw.modelDetails) ? raw.modelDetails : [])
      .map((entry) => record(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => ({ label: str(entry.label), value: str(entry.value) })),
    checks: (Array.isArray(raw.checks) ? raw.checks : []).filter((entry): entry is string => typeof entry === 'string'),
    leftOut: (Array.isArray(raw.leftOut) ? raw.leftOut : [])
      .map((entry) => record(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => ({ what: str(entry.what), why: str(entry.why) }))
      .filter((entry) => entry.what !== ''),
    followups: (Array.isArray(raw.followups) ? raw.followups : []).filter(
      (entry): entry is string => typeof entry === 'string',
    ),
    sources: (Array.isArray(raw.sources) ? raw.sources : []).filter((entry): entry is string => typeof entry === 'string'),
    saved: savedOf(raw.saved),
    diff: {
      against: typeof diff?.against === 'string' ? diff.against : null,
      adds: num(diff?.adds),
      dels: num(diff?.dels),
      lines: lines
        .map((entry) => record(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((entry) => ({ sign: signOf(entry.sign), text: str(entry.text) })),
      truncated: diff?.truncated === true,
    },
  };
}

/** A row's interpolation arguments: strings and numbers only. */
function argsOf(value: unknown): Record<string, string | number> {
  const raw = record(value);
  if (raw === null) return {};
  const out: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry === 'string' || typeof entry === 'number') out[key] = entry;
  }
  return out;
}

function signOf(value: unknown): '+' | '-' | ' ' {
  return value === '+' || value === '-' ? value : ' ';
}

/** One table a turn read, as the server recorded it. */
export interface AssistantAnswerRead {
  table: string;
  returned: number | null;
  total: number | null;
  /** The rows were asked for in an order: the first few are "the top few", not a part. */
  sorted: boolean;
}

/** An add-on the answer points at, in this server's own words for it. */
export interface AssistantSuggestion {
  key: string;
  name: string;
  line: string;
  /** Whether THIS person may install it: the card offers the way in only then. */
  mayInstall: boolean;
}

/** What a turn ended with besides its words and its draft. */
export interface AssistantAnswer {
  /** The tables its tools read, each once, as `connection.schema.table`. */
  sources: string[];
  reads: AssistantAnswerRead[];
  /** Earlier messages the model was not sent at all. */
  forgot: number;
  /** What the person might ask next, after an answer in words. */
  followups: string[];
  suggest: AssistantSuggestion[];
  /** What the answer asked the person to confirm, when it asked. */
  proposal: AssistantProposal | null;
}

const strings = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string' && entry !== '') : []);
const count = (raw: unknown): number | null => (typeof raw === 'number' && Number.isFinite(raw) ? raw : null);

/** Narrow a stored `answer`. A turn from before answers had one reads as `null`: nothing is claimed about it. */
export function readAnswer(raw: Record<string, unknown> | null | undefined): AssistantAnswer | null {
  // `undefined` is a server from before turns had the field.
  if (raw === null || raw === undefined) return null;
  const reads: AssistantAnswerRead[] = [];
  for (const entry of Array.isArray(raw.reads) ? raw.reads : []) {
    const read = record(entry);
    if (read === null || typeof read.table !== 'string') continue;
    reads.push({ table: read.table, returned: count(read.returned), total: count(read.total), sorted: read.sorted === true });
  }
  const suggest: AssistantSuggestion[] = [];
  for (const entry of Array.isArray(raw.suggest) ? raw.suggest : []) {
    const card = record(entry);
    if (card === null || typeof card.key !== 'string' || typeof card.name !== 'string') continue;
    suggest.push({ key: card.key, name: card.name, line: typeof card.line === 'string' ? card.line : '', mayInstall: card.mayInstall === true });
  }
  return { sources: strings(raw.sources), reads, forgot: count(raw.forgot) ?? 0, followups: strings(raw.followups), suggest, proposal: readProposal(raw.proposal) };
}

/**
 * Why a turn failed, as one sentence.
 *
 * The column holds more than one shape — a provider transport failure, a list
 * of validation errors, a conversation that outgrew the model — so this reads
 * whichever it is and answers `null` when it is none of them, which the card
 * renders as its own generic sentence.
 */
export function readErrorMessage(raw: Record<string, unknown> | null): string | null {
  if (raw === null) return null;
  if (typeof raw.message === 'string' && raw.message !== '') return raw.message;
  const errors = Array.isArray(raw.errors) ? raw.errors : [];
  for (const entry of errors) {
    const error = record(entry);
    if (error !== null && typeof error.message === 'string' && error.message !== '') return error.message;
  }
  return null;
}

/**
 * The failures this app words itself, by the KIND the server reports. Each is
 * advice to a person, so each is a message key and not the server's English.
 */
export type AssistantErrorKind = 'too-long' | 'model-format' | 'setup' | 'budget';

export function readErrorKind(raw: Record<string, unknown> | null): AssistantErrorKind | null {
  const kind = raw === null ? null : raw.kind;
  return kind === 'too-long' || kind === 'model-format' || kind === 'setup' || kind === 'budget' ? kind : null;
}

/**
 * When a used-up day starts again, read from wherever the server said so: a
 * failed turn's error, the mark beside the answer that used the last of the
 * day, or the refusal of a new question. `null` when none of them says it.
 */
export function readResetsAt(raw: unknown): number | null {
  const source = record(raw);
  if (source === null) return null;
  const nested = record(source.budget);
  const value = nested === null ? source.resetsAt : nested.resetsAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** True when the turn failed because the conversation no longer fits the model. */
export function isTooLong(raw: Record<string, unknown> | null): boolean {
  return raw !== null && raw.kind === 'too-long';
}

// ─── The client ──────────────────────────────────────────────────────────────

function sessionPath(id: string): string {
  return `${BASE}/sessions/${encodeURIComponent(id)}`;
}

export const assistantApi = {
  availability: (context: AssistantContext) =>
    api.get<AssistantAvailability>(`${BASE}/availability?context=${encodeURIComponent(context)}`),
  openSession: (body: { context: AssistantContext; host: AssistantHostRef; draft?: unknown; kind?: 'modal' | 'panel' }) =>
    api.post<AssistantSessionReply>(`${BASE}/sessions`, body),
  /** The person's one open panel conversation, with its last turns; `session: null` when there is none. */
  currentSession: () => api.get<AssistantCurrentReply>(`${BASE}/sessions/current`),
  /** What the assistant would be told of a page, without asking it anything. */
  pageFacts: (body: { context: AssistantContext; host: AssistantHostRef }) => api.post<AssistantFactsReply>(`${BASE}/facts`, body),
  createTurn: (
    sessionId: string,
    body: {
      text?: string;
      picks?: Record<string, string>;
      /** The page the question is asked on, when it is not the one the session was opened on. */
      context?: AssistantContext;
      host?: AssistantHostRef;
      draft?: unknown;
    },
  ) =>
    api.post<AssistantTurnReply>(`${sessionPath(sessionId)}/turns`, body),
  turn: (sessionId: string, turnId: string) =>
    api.get<AssistantTurnView>(`${sessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}`),
  cancelTurn: (sessionId: string, turnId: string) =>
    api.post<null>(`${sessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/cancel`),
  action: (sessionId: string, turnId: string, body: AssistantActionBody) =>
    api.post<AssistantActionReply>(`${sessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/actions`, body),
  /** Have the server try a turn's proposal as this person, and say what they would see. */
  checkProposal: (sessionId: string, turnId: string) =>
    api.post<{ proposal: Record<string, unknown> }>(`${sessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/actions`, { action: 'check' }),
  /** Confirm it: `hash` is the one the card showed, `pick` the actions left ticked. */
  applyProposal: (sessionId: string, turnId: string, body: { hash: string; pick: number[] }) =>
    api.post<AssistantApplyReply>(`${sessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/actions`, { action: 'apply', ...body }),
  closeSession: (sessionId: string) => api.post<null>(`${sessionPath(sessionId)}/close`),
};
