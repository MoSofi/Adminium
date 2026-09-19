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
export type AssistantContext = 'email' | 'invoice-template' | 'invoices' | 'report';

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
}

export interface AssistantHostRef {
  documentId?: string;
  tab?: string;
  connectionIds: string[];
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
    tables?: number;
    connection?: string;
    pattern?: string;
    write?: boolean;
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
  artefact: Record<string, unknown>;
  warning: string | null;
  /** The page's own rows. */
  details: AssistantDetail[];
  /** What the model added, in its own words. */
  modelDetails: { label: string; value: string }[];
  checks: string[];
  followups: string[];
  /** `connection.table` names the turn read. */
  sources: string[];
  diff: { against: string | null; adds: number; dels: number; lines: AssistantDiffLine[]; truncated: boolean };
}

/** Narrow a stored `result`; anything unreadable means "no draft to show". */
export function readResult(raw: Record<string, unknown> | null): AssistantResult | null {
  if (raw === null) return null;
  const artefact = record(raw.artefact);
  if (artefact === null) return null;
  const diff = record(raw.diff);
  const lines = Array.isArray(diff?.lines) ? diff.lines : [];
  return {
    title: str(raw.title),
    meta: str(raw.meta),
    workTitle: typeof raw.workTitle === 'string' ? raw.workTitle : null,
    basedOn: typeof raw.basedOn === 'string' ? raw.basedOn : null,
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
    followups: (Array.isArray(raw.followups) ? raw.followups : []).filter(
      (entry): entry is string => typeof entry === 'string',
    ),
    sources: (Array.isArray(raw.sources) ? raw.sources : []).filter((entry): entry is string => typeof entry === 'string'),
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
  openSession: (body: { context: AssistantContext; host: AssistantHostRef; draft?: unknown }) =>
    api.post<AssistantSessionReply>(`${BASE}/sessions`, body),
  createTurn: (sessionId: string, body: { text?: string; picks?: Record<string, string> }) =>
    api.post<AssistantTurnReply>(`${sessionPath(sessionId)}/turns`, body),
  turn: (sessionId: string, turnId: string) =>
    api.get<AssistantTurnView>(`${sessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}`),
  cancelTurn: (sessionId: string, turnId: string) =>
    api.post<null>(`${sessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/cancel`),
  action: (sessionId: string, turnId: string, body: AssistantActionBody) =>
    api.post<AssistantActionReply>(`${sessionPath(sessionId)}/turns/${encodeURIComponent(turnId)}/actions`, body),
  closeSession: (sessionId: string) => api.post<null>(`${sessionPath(sessionId)}/close`),
};
