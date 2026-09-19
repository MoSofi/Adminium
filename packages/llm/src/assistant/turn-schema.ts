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
 * - `result` — the drafted artefact, in the host page's own document format;
 * - none     — a plain answer.
 *
 * There is deliberately no write move. The model proposes; a person saves.
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
export const ASSISTANT_CONTEXTS = ['email', 'invoice-template', 'invoices', 'report'] as const;
export type AssistantContext = (typeof ASSISTANT_CONTEXTS)[number];
export const assistantContextSchema = z.enum(ASSISTANT_CONTEXTS);

// ─── Caps ────────────────────────────────────────────────────────────────────

/** Provider round-trips one turn may spend before it is stopped. */
export const ASSISTANT_MAX_ROUNDS = 6;
/** Tool calls one turn may make in total, across every round. */
export const ASSISTANT_MAX_CALLS_PER_TURN = 12;
/** Tool calls one reply may request. */
export const ASSISTANT_MAX_CALLS_PER_REPLY = 8;
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
  followups: z.array(z.string().min(1).max(80)).max(3).optional(),
});
export type AssistantResult = z.infer<typeof assistantResultSchema>;

const ONE_MOVE_MESSAGE = 'Use at most one of calls, ask and result in a single reply.';

export const assistantTurnV1 = z
  .object({
    schema_version: z.literal(ASSISTANT_SCHEMA_VERSION),
    say: z.string().max(2000),
    calls: z.array(assistantToolCallSchema).min(1).max(ASSISTANT_MAX_CALLS_PER_REPLY).optional(),
    ask: assistantAskSchema.optional(),
    result: assistantResultSchema.optional(),
  })
  .refine((turn) => [turn.calls, turn.ask, turn.result].filter((move) => move !== undefined).length <= 1, {
    message: ONE_MOVE_MESSAGE,
  });
export type AssistantTurnV1 = z.infer<typeof assistantTurnV1>;

/** Which move a valid reply made. */
export type AssistantMove = 'calls' | 'ask' | 'result' | 'answer';

export function assistantMoveOf(turn: AssistantTurnV1): AssistantMove {
  if (turn.calls !== undefined) return 'calls';
  if (turn.ask !== undefined) return 'ask';
  if (turn.result !== undefined) return 'result';
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

  const checked = assistantTurnV1.safeParse(parsed);
  if (!checked.success) {
    return {
      ok: false,
      errors: checked.error.issues.map((issue) =>
        makeError('LLM_SCHEMA_INVALID', formatJsonPath(issue.path), issue.message),
      ),
    };
  }
  return { ok: true, turn: checked.data };
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
