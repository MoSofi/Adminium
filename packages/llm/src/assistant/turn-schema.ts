// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's turn contract: what ONE provider reply must look like.
 *
 * The assistant runs on the same `complete()` verb every provider client
 * already speaks — no native tool-calling wire format, because the four
 * self-host providers support those unevenly and one JSON contract behaves the
 * same on all of them. So a reply is a single JSON object that says something
 * (`say`) and makes at most ONE move:
 *
 * - `calls`  — read tools to run; each carries the step row the UI shows while
 *              it runs;
 * - `ask`    — pick groups the operator must answer before work continues;
 * - `result`  — the drafted artefact, in the host page's own document format;
 * - `propose` — changes for the person to confirm, on a page where the
 *               workspace allows them and the person holds the right;
 * - none      — a plain answer.
 *
 * Nothing here writes. A proposal is a list the person is shown and may
 * confirm; the server checks it as that person and runs it only then.
 *
 * Every string is bounded here and rendered as TEXT by the dashboard, so a
 * reply can neither grow the page without limit nor smuggle markup into it.
 *
 * Browser-safe: Zod plus this package's own pure helpers.
 */
import { z } from 'zod';

import { formatJsonPath, type LlmValidationError, makeError } from '../response/errors.js';
import { extractJsonObject } from '../response/extract.js';

export const ASSISTANT_SCHEMA_VERSION = 'adminium.assistant/v1';

/** Versions a reply may declare. One today; a list so a second can be accepted during a rollout. */
export const SUPPORTED_ASSISTANT_VERSIONS: readonly string[] = [ASSISTANT_SCHEMA_VERSION];

/** The pages the assistant can be opened from. The context is the HOST's, never the model's. */
export const ASSISTANT_CONTEXTS = ['email', 'invoice-template', 'invoices', 'report', 'automation', 'data', 'general'] as const;
export type AssistantContext = (typeof ASSISTANT_CONTEXTS)[number];
export const assistantContextSchema = z.enum(ASSISTANT_CONTEXTS);

// ─── Caps ────────────────────────────────────────────────────────────────────

/** Tool calls one turn may make in total, across every round. */
export const ASSISTANT_MAX_CALLS_PER_TURN = 12;
/**
 * Provider round-trips one turn may spend before it is stopped.
 *
 * Sized FROM the call budget, not beside it: a model that makes one call a
 * round has to be able to spend every call it is allowed and still have a
 * round to answer in, with one to spare for a reply that needed repairing. At
 * six, such a model gathered everything it needed and then had no round left
 * to write the draft. What bounds the cost is the call cap and the context
 * window; this only stops a turn that is going nowhere.
 */
export const ASSISTANT_MAX_ROUNDS = ASSISTANT_MAX_CALLS_PER_TURN + 2;
/** Tool calls one reply may request. */
export const ASSISTANT_MAX_CALLS_PER_REPLY = 8;
/** Add-ons one reply may point the person at. */
export const ASSISTANT_MAX_SUGGESTIONS = 3;
/** The most parts of a request a draft may say it left out. */
export const ASSISTANT_MAX_LEFT_OUT = 4;
/** The longest add-on key a reply may name. */
export const ASSISTANT_SUGGEST_KEY_MAX = 80;
/** Rows one `read_rows` / `aggregate` call may return. */
export const ASSISTANT_MAX_ROWS_PER_CALL = 50;

// ─── Step icons ──────────────────────────────────────────────────────────────

/**
 * The closed list a step row may draw. A name outside it falls back to
 * {@link ASSISTANT_STEP_ICON_FALLBACK} instead of failing the reply: an icon is
 * decoration, and spending a whole repair round-trip on one would be a bad
 * trade for the operator who is waiting.
 */
export const ASSISTANT_STEP_ICONS = [
  'file-search',
  'shapes',
  'pen-line',
  'shield-check',
  'landmark',
  'layout-template',
  'building-2',
  'clock',
  'layers',
  'database',
  'git-branch',
  'table-2',
  'search',
  'calculator',
] as const;
export type AssistantStepIcon = (typeof ASSISTANT_STEP_ICONS)[number];
export const ASSISTANT_STEP_ICON_FALLBACK: AssistantStepIcon = 'search';

const stepIconSchema = z.enum(ASSISTANT_STEP_ICONS).catch(ASSISTANT_STEP_ICON_FALLBACK);

// ─── The reply ───────────────────────────────────────────────────────────────

export const assistantStepSchema = z.object({
  icon: stepIconSchema,
  label: z.string().min(1).max(60),
  detail: z.string().max(160),
});
export type AssistantStep = z.infer<typeof assistantStepSchema>;

export const assistantToolCallSchema = z.object({
  /** The model's own handle for the call; results come back under it. */
  id: z.string().min(1).max(24),
  /** Must name a catalogue entry; the runner answers an unknown name with a tool error. */
  tool: z.string().min(1).max(40),
  args: z.record(z.string(), z.unknown()),
  step: assistantStepSchema,
});
export type AssistantToolCall = z.infer<typeof assistantToolCallSchema>;

export const assistantAskOptionSchema = z.object({
  key: z.string().min(1).max(24),
  label: z.string().min(1).max(60),
  detail: z.string().max(80),
});

export const assistantAskGroupSchema = z.object({
  key: z.string().min(1).max(24),
  title: z.string().min(1).max(40),
  options: z.array(assistantAskOptionSchema).min(2).max(6),
});
export type AssistantAskGroup = z.infer<typeof assistantAskGroupSchema>;

export const assistantAskSchema = z.object({
  groups: z.array(assistantAskGroupSchema).min(1).max(3),
  /** The go row's sentence once every group has a pick. */
  readyLabel: z.string().max(60).optional(),
  /** The go button's label once every group has a pick. */
  goLabel: z.string().max(40).optional(),
});
export type AssistantAsk = z.infer<typeof assistantAskSchema>;

export const assistantDetailSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().max(300),
});

export const assistantResultSchema = z.object({
  title: z.string().min(1).max(80),
  meta: z.string().max(120),
  /** The steps card's title once the work is done. */
  workTitle: z.string().max(60).optional(),
  /** An existing document in this page's collection the draft is compared with. */
  basedOn: z.string().max(64).nullable().optional(),
  /**
   * The draft. Open here on purpose: each page owns its document format, and
   * the runner validates this with the SAME function the page's own save runs,
   * so a draft that is accepted is a draft the editor can open.
   */
  artefact: z.record(z.string(), z.unknown()),
  warning: z.string().max(300).optional(),
  details: z.array(assistantDetailSchema).max(6).optional(),
  /** Checks the model says it made. Shown labelled as the model's own. */
  checks: z.array(z.string().max(120)).max(4).optional(),
  /**
   * What the person asked for that the draft does NOT do, each with why. A
   * fixed part of the result, drawn as its own row: a draft that quietly does
   * less than was asked reads as one that does all of it.
   */
  leftOut: z
    .array(z.object({ what: z.string().min(1).max(120), why: z.string().min(1).max(200) }))
    .max(ASSISTANT_MAX_LEFT_OUT)
    .optional()
    .describe('Every part of the request this draft does NOT do, each with why ("what": "The discount code", "why": "Nothing installed here can issue one."). Say it here, not only in "say". Leave it out when the draft does everything asked.'),
  /**
   * Shown as buttons; a click sends the text back AS THE PERSON'S NEXT
   * MESSAGE. So each one is written the way they would ask for it — the
   * description says so, because a model left to itself writes "Would you
   * like…?", and a person who clicks that has asked the model its own question.
   */
  followups: z
    .array(z.string().min(1).max(80))
    .max(3)
    .optional()
    .describe(
      'Up to 3 next steps, shown as buttons. A click sends the text to you as the person\'s next message, so write each as THEIR instruction to you ("Add the total order value per customer") — never as a question to them ("Would you like to see…?").',
    ),
});
export type AssistantResult = z.infer<typeof assistantResultSchema>;

// ─── A proposal ──────────────────────────────────────────────────────────────

/** Actions one proposal may carry. The workspace's own cap is lower or equal and is the server's to check. */
export const ASSISTANT_MAX_ACTIONS_PER_PROPOSAL = 50;
/** Columns one proposed row may set. */
export const ASSISTANT_MAX_VALUES_PER_ACTION = 60;

/**
 * Everything a proposal may ask for. Every id in an action is the MODEL'S
 * text: the server resolves each against what the person can see before it
 * is used anywhere, and never builds an address from one.
 */
export const ASSISTANT_ACTION_KINDS = [
  'row.create',
  'row.change',
  'row.delete',
  'doc.save',
  'doc.change',
  'doc.delete',
  'send.document',
  'send.template',
] as const;
export type AssistantActionKind = (typeof ASSISTANT_ACTION_KINDS)[number];

/** The two actions that are about the reply's own draft, and so travel with a `result`. */
export const ASSISTANT_DRAFT_ACTION_KINDS: readonly AssistantActionKind[] = ['doc.save', 'doc.change'];

const actionValues = z
  .record(z.string().min(1).max(200), z.unknown())
  .refine((values) => Object.keys(values).length >= 1 && Object.keys(values).length <= ASSISTANT_MAX_VALUES_PER_ACTION, {
    message: `Set between 1 and ${ASSISTANT_MAX_VALUES_PER_ACTION} columns.`,
  });
const actionConnection = z.string().min(1).max(64);
const actionTable = z.string().min(1).max(200);
const actionRecordId = z.string().min(1).max(200);

const ACTION_SCHEMAS = {
  'row.create': z.object({ do: z.literal('row.create'), connectionId: actionConnection, table: actionTable, values: actionValues }),
  'row.change': z.object({
    do: z.literal('row.change'),
    connectionId: actionConnection,
    table: actionTable,
    id: actionRecordId,
    values: actionValues.describe('Only the columns that change, with their new values.'),
  }),
  'row.delete': z.object({ do: z.literal('row.delete'), connectionId: actionConnection, table: actionTable, id: actionRecordId }),
  'doc.save': z.object({ do: z.literal('doc.save') }).describe('Save the draft in "result" of this same reply as a new document.'),
  'doc.change': z
    .object({ do: z.literal('doc.change') })
    .describe('Save the draft in "result" of this same reply over the document that is open on this page.'),
  'doc.delete': z.object({ do: z.literal('doc.delete'), kind: z.enum(['email', 'report', 'rule']), id: z.string().min(1).max(64) }),
  'send.document': z.object({ do: z.literal('send.document'), id: z.string().min(1).max(64) }),
  'send.template': z.object({
    do: z.literal('send.template'),
    templateId: z.string().min(1).max(64),
    roles: z.array(z.string().min(1).max(80)).min(1).max(20),
  }),
} as const satisfies Record<AssistantActionKind, z.ZodType>;

/** One action of any kind: what is stored, and what the server checks a stored proposal against. */
export const assistantActionSchema = z.discriminatedUnion('do', [
  ACTION_SCHEMAS['row.create'],
  ACTION_SCHEMAS['row.change'],
  ACTION_SCHEMAS['row.delete'],
  ACTION_SCHEMAS['doc.save'],
  ACTION_SCHEMAS['doc.change'],
  ACTION_SCHEMAS['doc.delete'],
  ACTION_SCHEMAS['send.document'],
  ACTION_SCHEMAS['send.template'],
]);
export type AssistantAction = z.infer<typeof assistantActionSchema>;

export const assistantProposalSchema = z.object({
  title: z.string().min(1).max(80),
  actions: z.array(assistantActionSchema).min(1).max(ASSISTANT_MAX_ACTIONS_PER_PROPOSAL),
});
export type AssistantProposal = z.infer<typeof assistantProposalSchema>;

/** A proposal that may hold only the kinds one page offers. The list is never empty. */
function proposalSchemaOf(kinds: readonly AssistantActionKind[]): z.ZodType {
  const options = kinds.map((kind) => ACTION_SCHEMAS[kind]);
  const action = options.length === 1 ? (options[0] as z.ZodType) : z.discriminatedUnion('do', options as never);
  return z.object({
    title: z.string().min(1).max(80),
    actions: z.array(action).min(1).max(ASSISTANT_MAX_ACTIONS_PER_PROPOSAL),
  });
}

const ONE_MOVE_MESSAGE = 'Use at most one of calls, ask and result in a single reply.';

/**
 * The reply's fields, with no rule across them yet.
 *
 * Kept apart from {@link assistantTurnV1} because a page that drafts nothing
 * is shown, and checked against, a contract WITHOUT `result`, and zod refuses
 * to `omit()` from an object that already carries a refinement. Each variant
 * is built from this and given its own rule.
 */
const assistantTurnFields = z.object({
  schema_version: z.literal(ASSISTANT_SCHEMA_VERSION),
  say: z.string().max(2000),
  calls: z.array(assistantToolCallSchema).min(1).max(ASSISTANT_MAX_CALLS_PER_REPLY).optional(),
  ask: assistantAskSchema.optional(),
  result: assistantResultSchema.optional(),
  propose: assistantProposalSchema.optional(),
  /**
   * Not a move: add-ons that would give what was asked. KEYS only; the server
   * checks each against its own list and draws the card from that list, so a
   * name or a promise the model writes never reaches the person.
   */
  suggest: z
    .array(z.string().min(1).max(ASSISTANT_SUGGEST_KEY_MAX))
    .max(ASSISTANT_MAX_SUGGESTIONS)
    .optional()
    .describe('Keys from list_add_ons of add-ons that are NOT installed and would give what the person asked for. Only when relevant; three at most.'),
  /**
   * Not a move: what the person might ask next, after an answer in words.
   * Drawn as buttons under the answer; a click sends the text as THEIR next
   * message, so each is written as their question. A draft carries its own
   * (`result.followups`).
   */
  followups: z
    .array(z.string().min(1).max(80))
    .max(3)
    .optional()
    .describe('With an answer in words only: up to 3 questions the person might ask next, shown as buttons. A click sends the text to you as their next message, so write each as THEIR question to you ("Who comes next?"), never as yours to them. Only ones you can answer with your tools.'),
});

/** The reply with every key it can ever carry: the type the runner reads, whatever the page offered. */
export type AssistantTurnV1 = z.infer<typeof assistantTurnFields>;

/** Which contract a page's replies are shown and checked against. */
export interface AssistantTurnVariant {
  /** Whether the page has a document, and so whether a reply may carry `result`. */
  document: boolean;
  /**
   * The actions a reply may propose here: the kinds the workspace has
   * switched on AND this person holds a right for. Absent or empty, the
   * contract has no `propose` at all.
   */
  propose?: readonly AssistantActionKind[];
}

/** The variant every page had before a page could be without a document. */
export const ASSISTANT_DOCUMENT_VARIANT: AssistantTurnVariant = Object.freeze({ document: true });

/**
 * The kinds one variant really offers, in the catalogue's order. The two
 * draft actions need a draft, so a page without a document never offers them.
 */
export function assistantProposableKinds(variant: AssistantTurnVariant): AssistantActionKind[] {
  const asked = new Set(variant.propose ?? []);
  return ASSISTANT_ACTION_KINDS.filter(
    (kind) => asked.has(kind) && (variant.document || !ASSISTANT_DRAFT_ACTION_KINDS.includes(kind)),
  );
}

const ONE_MOVE_PLAIN_MESSAGE = 'Use at most one of calls and ask in a single reply.';
const ONE_MOVE_PROPOSE_MESSAGE = 'Use at most one of calls, ask, result and propose in a single reply.';
const ONE_MOVE_PROPOSE_PLAIN_MESSAGE = 'Use at most one of calls, ask and propose in a single reply.';
/** Said when a draft and a proposal travel together and the proposal is about something else. */
export const ASSISTANT_DRAFT_WITH_PROPOSAL_MESSAGE =
  'A reply that carries "result" may propose only ONE action, "doc.save" or "doc.change", which saves that draft. Propose anything else in a reply of its own.';
/** Said when a proposal is about a draft the reply does not carry. */
export const ASSISTANT_PROPOSAL_NEEDS_DRAFT_MESSAGE =
  '"doc.save" and "doc.change" save the draft in "result" of the SAME reply. Send the draft with it, or leave the action out.';

/** Said when a send travels with anything else. */
export const ASSISTANT_SEND_ALONE_MESSAGE = 'A send is proposed by itself: ONE "send.template" action and nothing else in that proposal.';

type TurnShape = z.infer<typeof assistantTurnFields>;

function isDraftAction(action: { do: string }): boolean {
  return (ASSISTANT_DRAFT_ACTION_KINDS as readonly string[]).includes(action.do);
}

/**
 * The rule across a reply's moves. One move, with one pair allowed: a draft
 * and the single action that saves it.
 */
function checkMoves(turn: Partial<TurnShape>, context: z.RefinementCtx, message: string): void {
  const moves = [turn.calls, turn.ask, turn.result, turn.propose].filter((move) => move !== undefined).length;
  const actions = turn.propose?.actions ?? [];
  if (turn.result !== undefined && turn.propose !== undefined) {
    if (moves > 2) context.addIssue({ code: 'custom', message });
    if (actions.length !== 1 || !actions.every(isDraftAction)) {
      context.addIssue({ code: 'custom', path: ['propose', 'actions'], message: ASSISTANT_DRAFT_WITH_PROPOSAL_MESSAGE });
    }
    return;
  }
  if (moves > 1) context.addIssue({ code: 'custom', message });
  // A mail to people is confirmed by itself: one card, one mail, who gets it.
  if (actions.length > 1 && actions.some((action) => action.do === 'send.template' || action.do === 'send.document')) {
    context.addIssue({ code: 'custom', path: ['propose', 'actions'], message: ASSISTANT_SEND_ALONE_MESSAGE });
  }
  if (turn.result === undefined && actions.some(isDraftAction)) {
    context.addIssue({ code: 'custom', path: ['propose', 'actions'], message: ASSISTANT_PROPOSAL_NEEDS_DRAFT_MESSAGE });
  }
}

/** The reply on a page that has a document and offers nothing to propose. */
export const assistantTurnV1 = assistantTurnFields
  .omit({ propose: true })
  .superRefine((turn, context) => checkMoves(turn, context, ONE_MOVE_MESSAGE));

/**
 * The reply on a page that has no document: the same contract without
 * `result`. {@link parseAssistantTurn} refuses that one key by name on such a
 * page: left to this shape it would be dropped, and the draft read as a plain
 * answer with nothing in it.
 */
export const assistantTurnPlainV1 = assistantTurnFields
  .omit({ result: true, propose: true })
  .superRefine((turn, context) => checkMoves(turn, context, ONE_MOVE_PLAIN_MESSAGE));

const proposingSchemas = new Map<string, z.ZodType>();

/** The zod schema one variant's replies are checked against. */
export function assistantTurnSchemaFor(variant: AssistantTurnVariant): z.ZodType {
  const kinds = assistantProposableKinds(variant);
  if (kinds.length === 0) return variant.document ? assistantTurnV1 : assistantTurnPlainV1;
  const key = `${variant.document ? 'document' : 'plain'}:${kinds.join(',')}`;
  const cached = proposingSchemas.get(key);
  if (cached !== undefined) return cached;
  const fields = assistantTurnFields.omit({ propose: true }).extend({ propose: proposalSchemaOf(kinds).optional() });
  const built: z.ZodType = variant.document
    ? fields.superRefine((turn, context) => checkMoves(turn as Partial<TurnShape>, context, ONE_MOVE_PROPOSE_MESSAGE))
    : fields
        .omit({ result: true })
        .superRefine((turn, context) => checkMoves(turn as Partial<TurnShape>, context, ONE_MOVE_PROPOSE_PLAIN_MESSAGE));
  proposingSchemas.set(key, built);
  return built;
}

/** Said back to a model that drafted on a page with nothing to draft. */
export const ASSISTANT_NO_DOCUMENT_MESSAGE = 'This page has no document, so "result" is not a move here. Answer in "say".';

/** Said back to a model that proposed where nothing may be proposed. */
export const ASSISTANT_NO_PROPOSE_MESSAGE = 'Nothing can be changed from here, so "propose" is not a move. Say so in "say".';

/** Which move a valid reply made. */
export type AssistantMove = 'calls' | 'ask' | 'result' | 'propose' | 'answer';

/**
 * A draft that travels with the action that saves it is a `result`: the
 * runner checks the draft first and reads `propose` beside it.
 */
export function assistantMoveOf(turn: AssistantTurnV1): AssistantMove {
  if (turn.calls !== undefined) return 'calls';
  if (turn.ask !== undefined) return 'ask';
  if (turn.result !== undefined) return 'result';
  if (turn.propose !== undefined) return 'propose';
  return 'answer';
}

// ─── Reading a reply ─────────────────────────────────────────────────────────

export type AssistantTurnParse =
  | { ok: true; turn: AssistantTurnV1 }
  | { ok: false; errors: LlmValidationError[] };

const VERSION_HINT = `Reply with "schema_version": "${ASSISTANT_SCHEMA_VERSION}".`;

/**
 * Read one raw provider reply: recover the JSON object (fences and prose
 * stripped, truncation told apart from a parse failure), parse it, check the
 * declared version, notice a model that declined, then validate the shape.
 *
 * Every failure is fatal for the ROUND — the runner hands the errors to the
 * repair message and asks again — and is reported in the shape the rest of this
 * package uses, so one repair-message builder serves both contracts. Never
 * throws.
 */
export function parseAssistantTurn(
  rawText: string,
  supportedVersions: readonly string[] = SUPPORTED_ASSISTANT_VERSIONS,
  /** The contract the model was shown; a reply is checked against that one and no other. */
  variant: AssistantTurnVariant = ASSISTANT_DOCUMENT_VARIANT,
): AssistantTurnParse {
  const extracted = extractJsonObject(rawText);
  if (!extracted.ok) return { ok: false, errors: [extracted.error] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.json);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [makeError('LLM_JSON_PARSE', '', `The reply is not valid JSON: ${reason}`)] };
  }

  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};

  // A model that refuses says so in `error`, usually without the rest of the
  // contract around it — so this is read BEFORE the version, or a refusal would
  // be reported as a version problem and repaired instead of shown.
  if (typeof record.error === 'string' && record.error.length > 0) {
    return { ok: false, errors: [makeError('LLM_MODEL_DECLINED', 'error', record.error.slice(0, 300))] };
  }

  const version = record.schema_version;
  if (typeof version !== 'string' || !supportedVersions.includes(version)) {
    const found = typeof version === 'string' ? `"${version}"` : 'a missing or non-string schema_version';
    return {
      ok: false,
      errors: [
        makeError('LLM_VERSION_MISMATCH', 'schema_version', `Unsupported schema_version (${found}).`, {
          hint: VERSION_HINT,
        }),
      ],
    };
  }

  // Refused by name, before the shape: left to the shape, an unknown key is
  // dropped and the draft would read as a plain answer with nothing in it.
  if (!variant.document && record.result !== undefined && record.result !== null) {
    return { ok: false, errors: [makeError('LLM_SCHEMA_INVALID', 'result', ASSISTANT_NO_DOCUMENT_MESSAGE)] };
  }

  // The same for a proposal where none is offered, and for a kind this page does not offer.
  const offered = assistantProposableKinds(variant);
  if (record.propose !== undefined && record.propose !== null) {
    if (offered.length === 0) {
      return { ok: false, errors: [makeError('LLM_SCHEMA_INVALID', 'propose', ASSISTANT_NO_PROPOSE_MESSAGE)] };
    }
    const actions = (record.propose as { actions?: unknown }).actions;
    const refused = (Array.isArray(actions) ? actions : []).flatMap((action, index) => {
      const kind = typeof action === 'object' && action !== null ? (action as { do?: unknown }).do : undefined;
      return typeof kind === 'string' && (ASSISTANT_ACTION_KINDS as readonly string[]).includes(kind) && !offered.includes(kind as AssistantActionKind)
        ? [makeError('LLM_SCHEMA_INVALID', `propose.actions[${index}].do`, `"${kind}" cannot be proposed here. What can: ${offered.join(', ')}.`)]
        : [];
    });
    if (refused.length > 0) return { ok: false, errors: refused };
  }

  const checked = assistantTurnSchemaFor(variant).safeParse(parsed);
  if (!checked.success) {
    return {
      ok: false,
      errors: checked.error.issues.map((issue) =>
        makeError('LLM_SCHEMA_INVALID', formatJsonPath(issue.path), issue.message),
      ),
    };
  }
  return { ok: true, turn: checked.data as AssistantTurnV1 };
}

// ─── What the runner writes back as `user` messages ──────────────────────────

/** A tool failure is DATA the model can recover from in its next reply, never an exception. */
export interface AssistantToolError {
  code: string;
  message: string;
}

export type AssistantToolResult =
  | { id: string; tool: string; ok: true; result: unknown }
  | { id: string; tool: string; ok: false; error: AssistantToolError };

export function assistantToolResultsMessage(results: readonly AssistantToolResult[]): string {
  return JSON.stringify({ tool_results: results });
}

/** The operator's answer to an `ask`: the picked option key per group, with the labels they saw. */
export function assistantPicksMessage(picks: Record<string, string>, labels: Record<string, string>): string {
  return JSON.stringify({ picks, labels });
}

const OPEN_DOCUMENT_NOTE = 'This is the document currently open in the editor; it is unsaved.';

/** An editor host's on-screen draft, sent once before the first request of a session. */
export function assistantOpenDocumentMessage(document: unknown): string {
  return JSON.stringify({ open_document: document, note: OPEN_DOCUMENT_NOTE });
}

/** One way a drafted artefact failed the host page's own validator. */
export interface AssistantArtefactError {
  /** Path inside the artefact, e.g. `blocks[3].block`. */
  path: string;
  code: string;
  message: string;
}

/** How many artefact errors one correction message carries; the rest are counted, not listed. */
export const ASSISTANT_MAX_ARTEFACT_ERRORS = 20;

const ARTEFACT_INSTRUCTION = 'Return the corrected COMPLETE turn with a valid artefact.';

/**
 * The correction sent when a `result` parsed but its artefact did not validate.
 * Counts as one repair, like any other invalid reply.
 */
export function assistantArtefactErrorsMessage(errors: readonly AssistantArtefactError[]): string {
  const listed = errors.slice(0, ASSISTANT_MAX_ARTEFACT_ERRORS);
  const omitted = errors.length - listed.length;
  return JSON.stringify({
    artefact_errors: listed,
    ...(omitted > 0 ? { omitted } : {}),
    instruction: ARTEFACT_INSTRUCTION,
  });
}

// ─── Step events ─────────────────────────────────────────────────────────────

export const ASSISTANT_STEP_STATES = ['started', 'done', 'failed'] as const;
export type AssistantStepState = (typeof ASSISTANT_STEP_STATES)[number];

/**
 * One step row's progress, published on the turn's job channel as the JSON
 * `message` of a progress event. `note` is a small closed vocabulary rather
 * than free text because the dashboard translates it.
 */
export const assistantStepEventSchema = z.object({
  kind: z.literal('step'),
  id: z.string().min(1).max(24),
  state: z.enum(ASSISTANT_STEP_STATES),
  icon: stepIconSchema,
  label: z.string().max(60),
  detail: z.string().max(160),
  /** `connection.table` names the step touched, drawn as chips. */
  tables: z.array(z.string().max(200)).max(12),
  /**
   * Present on the ONE step the runner writes itself — the page it read
   * before asking anything. It carries the page's named facts, never a
   * sentence: the label and the detail are the dashboard's, in the operator's
   * own language, for the same reason the blurb and the detail rows are.
   * `label` and `detail` are empty when this is set.
   */
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  note: z
    .union([z.object({ kind: z.literal('ready') }), z.object({ kind: z.literal('warnings'), count: z.number().int().min(1) })])
    .nullable(),
});
export type AssistantStepEvent = z.infer<typeof assistantStepEventSchema>;

/** Serialize a step event for a progress message. */
export function assistantStepEventMessage(event: AssistantStepEvent): string {
  return JSON.stringify(event);
}

/** Read a progress message back; `null` for anything that is not a well-formed step event. */
export function readAssistantStepEvent(message: string | undefined): AssistantStepEvent | null {
  if (message === undefined || message === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  const checked = assistantStepEventSchema.safeParse(parsed);
  return checked.success ? checked.data : null;
}
