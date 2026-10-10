// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `/api/v1/assistant/*`.
 *
 * SYNC NOTE: the client-side mirror of these shapes is
 * `apps/dashboard/src/assistant/api.ts` (a type-only copy — the dashboard may
 * not import server runtime code). Change both together. The replies are
 * un-enveloped, the email/invoice/report clients' style.
 *
 * WHY THE JSON COLUMNS ARE PARSED AND NOT CAST HERE. `steps`, `ask`, `result`
 * and `error` are stored documents: a row written by a newer server, or by a
 * shape that has since moved on, is exactly what a reply has to survive. The
 * response is validated on the way out, so a cast that turned out to be wrong
 * would 500 the one route that explains a failure — which is why the detail
 * reply below is permissive about what those fields hold and the route parses
 * before it answers.
 */
import { assistantContextSchema, assistantTurnStatusSchema } from '@adminium/meta';
import { z } from 'zod';

import { MAX_IN_VALUES, MAX_WHERE_BYTES } from '../../crud/filters.js';

/** The four switches on what the assistant may do beyond reading. */
export const assistantAbilities = z.object({ create: z.boolean(), change: z.boolean(), send: z.boolean(), delete: z.boolean() }).strict();
/** The most rows one confirmation may be allowed to write: each is its own full write, and 50 is what has been measured. */
export const ASSISTANT_MAX_ROWS_CEILING = 50;

/** The page a session was opened from, and what it was showing. */
export const assistantHostBody = z.object({
  documentId: z.string().max(64).optional(),
  tab: z.string().max(40).optional(),
  connectionIds: z.array(z.string().max(64)).max(20).default([]),
  /** A data page: which page. Its table is read from the page, by the server. */
  pageId: z.string().max(64).optional(),
  /** What that page is showing, in the list route's own spellings. Bounded as that route bounds them. */
  view: z
    .object({
      q: z.string().max(200).optional(),
      order: z.string().max(200).optional(),
      where: z.string().max(MAX_WHERE_BYTES).optional(),
      selectedIds: z.array(z.string().max(200)).max(MAX_IN_VALUES).optional(),
      recordId: z.string().max(200).optional(),
    })
    .optional(),
  /** A screen with no context of its own: the router's route id, and the app's key over a framed staff side. */
  route: z.string().max(120).optional(),
  app: z.string().max(64).optional(),
  /** One of an add-on's own screens: its key, and the screen's ref. */
  addOn: z.string().max(64).optional(),
  addOnPage: z.string().max(120).optional(),
});

export const assistantAvailabilityQuery = z.object({
  context: assistantContextSchema.optional(),
});

/**
 * Why the modal cannot work, when it cannot. `forbidden` never reaches a
 * client that got this far — the route guard answers first — but it is in the
 * vocabulary because the modal renders the same bar for it.
 */
export const assistantUnavailableReason = z.enum(['no-provider', 'network-disabled', 'forbidden']);

export const assistantAvailabilityReply = z.object({
  enabled: z.boolean(),
  reason: assistantUnavailableReason.nullable(),
  /** What the assistant is called here. */
  name: z.string(),
  /** Whether its tools may read rows at all. */
  rowData: z.boolean(),
  /** Whether this session may save what it drafts. */
  canWrite: z.boolean(),
  /** Whether it may reach Settings → AI, which is what the unavailable bar links to. */
  canConfigure: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /**
   * What the workspace lets the assistant do beyond reading. A switch that is
   * on is not a grant: the person still needs their own on the table or page.
   */
  abilities: assistantAbilities,
  /** The most rows one confirmation may write. */
  maxRows: z.number(),
  /**
   * Voice. `input`: how a recording becomes text here: by the workspace's own
   * model service (`provider`: the recording goes there, through this
   * server), by the browser's own speech service (`browser`: this server never
   * sees it; the page checks whether its browser has one), or not at all.
   * `to` names the service for the one-time notice. `output`: whether replies
   * may be read aloud (by the browser's own voice).
   */
  voice: z.object({ input: z.enum(['provider', 'browser', 'none']), to: z.string().nullable(), output: z.boolean(), maxSeconds: z.number() }),
  /** The asking person's allowance for the UTC day. `limit` 0 means there is none. */
  budget: z.object({
    limit: z.number(),
    used: z.number(),
    /** The instant the day's use starts again from nothing (epoch ms). */
    resetsAt: z.number(),
    left: z.boolean(),
  }),
});

export const assistantSessionView = z.object({
  id: z.string(),
  context: assistantContextSchema,
  status: z.enum(['open', 'closed']),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  createdAt: z.number(),
  /** One window on one page (`modal`), or the conversation that stays open across pages (`panel`). */
  kind: z.enum(['modal', 'panel']),
});

/** What the modal's header and read-only bar draw, computed per page. */
export const assistantFactsView = z.object({
  /**
   * The named facts the page's own sentence interpolates — numbers and names,
   * never a sentence. A sentence composed here would be English on the wire,
   * and no locale can translate that.
   */
  values: z
    .record(z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/), z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((values) => Object.keys(values).length <= 24, { message: 'A page names at most 24 facts.' }),
  scope: z.object({ primary: z.string(), extra: z.number() }),
});

export const assistantSessionCreateBody = z.object({
  context: assistantContextSchema,
  host: assistantHostBody,
  /** The editor page's on-screen, unsaved document. */
  draft: z.record(z.string(), z.unknown()).optional(),
  /**
   * `panel` asks for the person's ONE conversation that stays open across
   * pages: when they already have one open, that one is answered and no
   * second is made. Left out, a session is one window's, as it always was.
   */
  kind: z.enum(['modal', 'panel']).optional(),
});

export const assistantSessionCreateReply = z.object({
  session: assistantSessionView,
  facts: assistantFactsView,
  /** The server's estimate of what the next request will cost. */
  nextTurnTokens: z.number(),
});

/** One step row as the modal draws it. Open-ish on purpose — see the header. */
export const assistantStepView = z.object({
  id: z.string(),
  state: z.string(),
  icon: z.string(),
  label: z.string(),
  detail: z.string(),
  tables: z.array(z.string()),
  /**
   * The page-read step's named facts. It is the one step the server writes
   * itself, and it carries no sentence: the numbers travel, and the dashboard
   * words them in the operator's language. Dropping this key here would leave
   * a blank row on every reloaded turn.
   */
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const assistantTurnView = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number(),
  status: assistantTurnStatusSchema,
  jobId: z.string().nullable(),
  askText: z.string().nullable(),
  say: z.string().nullable(),
  steps: z.array(assistantStepView),
  ask: z.record(z.string(), z.unknown()).nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
  /** The page the question was asked on. */
  context: assistantContextSchema,
  /** What the turn ended with besides its words and its draft: what was read, what was suggested. */
  answer: z.record(z.string(), z.unknown()).nullable(),
  /**
   * Where it was asked, beyond the context: the data page (and its title, a
   * NAME, as it is now) or the document that was open. The thread says "on
   * Customers" from it, and a draft is live only where these match the page
   * the person is on.
   */
  on: z.object({
    pageId: z.string().nullable(),
    documentId: z.string().nullable(),
    title: z.string().nullable(),
    /**
     * What "these" meant when it was asked: the ticked rows (and how many), the
     * open record, or a grid that was showing a part of its table. Null when
     * the page was showing everything, or was not a page of rows.
     */
    scope: z.object({ kind: z.enum(['selection', 'record', 'page']), count: z.number().nullable() }).nullable(),
    /** The turn drafted for a document that is no longer there: its draft has no home to be used in. */
    gone: z.boolean(),
  }),
});
export type AssistantTurnView = z.infer<typeof assistantTurnView>;

export const assistantTurnCreateBody = z
  .object({
    text: z.string().min(1).max(4000).optional(),
    /** The answer to the previous turn's question: one option key per group. */
    picks: z.record(z.string().max(24), z.string().max(24)).optional(),
    /**
     * The page this question is asked on, when it is not the one the session
     * was opened on: a conversation that goes on while the person walks from
     * page to page asks each question somewhere. Left out, the turn is asked
     * on the session's page.
     */
    context: assistantContextSchema.optional(),
    /** What that page is showing. Read only together with `context`. */
    host: assistantHostBody.optional(),
    /** That page's on-screen, unsaved document, when it is an editor. Read only together with `context`. */
    draft: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => body.text !== undefined || body.picks !== undefined, {
    message: 'A turn needs either text or picks.',
  });

export const assistantTurnCreateReply = z.object({
  turn: assistantTurnView,
  jobId: z.string(),
  nextTurnTokens: z.number(),
});

export const assistantSessionParams = z.object({ id: z.string().min(1).max(36) });
export const assistantTurnParams = z.object({
  id: z.string().min(1).max(36),
  turnId: z.string().min(1).max(36),
});

export const assistantActionBody = z.object({
  action: z.enum(['save', 'test-send', 'sample', 'language.add', 'check', 'apply']),
  /**
   * The page the person is on when they press the button, and the document
   * open there. A draft belongs to the page and the document it was made
   * for: pressed anywhere else, the action is refused. Left out by a window
   * that is one page's by construction.
   */
  on: z.object({ context: assistantContextSchema, documentId: z.string().max(64).optional() }).optional(),
  /** `save` only: create the row and open it in the editor. */
  open: z.boolean().optional(),
  name: z.string().min(1).max(120).optional(),
  /** `language.add` only. */
  locale: z.string().min(2).max(10).optional(),
  /** `apply` only: the hash of the proposal as the person was shown it. */
  hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** `apply` only: the actions they left ticked, by index. Left out: every one that can be done. */
  pick: z.array(z.number().int().min(0).max(49)).min(1).max(50).optional(),
});

const assistantDraftActionReply = z.object({
  echo: z.record(z.string(), z.unknown()),
  created: z.object({ id: z.string(), kind: z.string(), name: z.string() }).nullable(),
  sample: z
    .object({ artefact: z.record(z.string(), z.unknown()), label: z.string() })
    .nullable(),
});

/**
 * `check` answers the turn's proposal as it now stands: tried as the person,
 * with what they would see, or let go. Its own shape, so a reply of one kind
 * is never read as the other.
 */
const assistantCheckReply = z.object({
  proposal: z.record(z.string(), z.unknown()),
  /**
   * `apply` only, and only in this one reply: the route's own undo token for
   * each row that has one, and the one-time codes a new row answered. Neither
   * is stored with the conversation.
   */
  undo: z.array(z.object({ index: z.number(), token: z.string() })).optional(),
  once: z.array(z.unknown()).optional(),
});

export const assistantActionReply = z.union([assistantDraftActionReply, assistantCheckReply]);

// ─── What an owner sets, and what was used today ─────────────────────────────

/**
 * `GET` / `PUT /assistant/settings` — the assistant's own settings that are
 * not the model's: how much a person may use in a day, with today's use
 * beside it. Behind `system:settings:manage`, not the model's permission:
 * choosing a model and deciding what the assistant costs are two people's
 * decisions on many teams.
 */
export const assistantSettingsReply = z.object({
  /** Tokens a person may use in a UTC day; 0 means no limit. */
  dailyTokens: z.number(),
  /** What the assistant may do beyond reading; all off on a new workspace. */
  abilities: assistantAbilities,
  /** The most rows one confirmation may write, and the most this field may be set to. */
  maxRows: z.number(),
  maxRowsCeiling: z.number(),
  /** Whether the assistant's button is put on an app's own staff address, for people who may use the assistant. */
  staffAddresses: z.boolean(),
  /** Voice: whether people may speak to the assistant, the minutes a person may in a UTC day (0 = no limit), and whether replies may be read aloud. */
  voice: z.object({ input: z.boolean(), dailyMinutes: z.number(), output: z.boolean() }),
  today: z.object({
    /** The UTC day, `YYYY-MM-DD`. */
    day: z.string(),
    /** The instant the day's use starts again from nothing (epoch ms). */
    resetsAt: z.number(),
    /** Everybody who used the assistant today, most first. */
    people: z.array(z.object({ userId: z.string(), name: z.string(), tokens: z.number(), turns: z.number() })),
  }),
  /** The roles that may use the assistant (the role matrix is where that is set). */
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
});

/** Each field is its own decision: what is left out is left as it is. */
export const assistantSettingsPutBody = z
  .object({
    dailyTokens: z.number().int().min(0).max(1_000_000_000).optional(),
    abilities: assistantAbilities.partial().optional(),
    maxRows: z.number().int().min(1).max(ASSISTANT_MAX_ROWS_CEILING).optional(),
    staffAddresses: z.boolean().optional(),
    voice: z.object({ input: z.boolean(), dailyMinutes: z.number().int().min(0).max(1_440), output: z.boolean() }).partial().strict().optional(),
  })
  .strict();

/**
 * `GET /assistant/sessions/current` — the person's open panel conversation,
 * so a reload or a second window finds it again. `session: null` when they
 * have none. The newest turns come whole; older ones without their drafts'
 * documents, which are the heavy part and are asked for a turn at a time.
 */
export const assistantCurrentReply = z.object({
  session: assistantSessionView.nullable(),
  turns: z.array(assistantTurnView),
  /** How many earlier turns the conversation holds that are not in `turns`. */
  earlier: z.number(),
  /**
   * There is no open conversation because the last one was closed for its
   * age, in the last few days: said once, so a person who comes back to an
   * empty panel knows it was not lost by a fault.
   */
  aged: z.boolean(),
});

/** `POST /assistant/facts` — what the header says of ONE page, for a conversation that has walked to it. */
export const assistantFactsBody = z.object({ context: assistantContextSchema, host: assistantHostBody });
/** A question an installed add-on offers on the page, in the reader's language, with the add-on's name. */
export const assistantStarterView = z.object({ key: z.string(), text: z.string(), addOn: z.string() });

export const assistantFactsReply = z.object({ facts: assistantFactsView, nextTurnTokens: z.number(), starters: z.array(assistantStarterView) });

/** `POST /assistant/transcribe?language=de&seconds=14` — the recording is the body. */
export const assistantTranscribeQuery = z.object({
  /** The language spoken, as the person's locale (`de_DE`) or two letters. */
  language: z.string().min(2).max(10).optional(),
  /** How long the browser says the recording lasted; counted, never trusted alone. */
  seconds: z.coerce.number().min(0).max(600).optional(),
});
export const assistantTranscribeReply = z.object({
  text: z.string(),
  /** What the recording was counted as, and what is left of the day. */
  seconds: z.number(),
  allowance: z.object({ limitSeconds: z.number(), usedSeconds: z.number(), resetsAt: z.number() }),
});
