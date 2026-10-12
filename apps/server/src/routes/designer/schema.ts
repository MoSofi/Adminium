// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `/api/v1/designer/*`.
 *
 * SYNC NOTE: the dashboard's mirror is `apps/dashboard/src/designer/api.ts`, a
 * type-only copy (the dashboard may not import server code). The replies are
 * un-enveloped, like the assistant's.
 */
import { RUN_EFFORTS } from '@adminium/llm';
import { z } from 'zod';

const target = z.enum(['auto', 'dashboard', 'web', 'mobile']);

export const designerSession = z.object({
  id: z.string(),
  appKey: z.string(),
  title: z.string(),
  target,
  connectionId: z.string(),
  model: z.string(),
  /** How hard the model is asked to work; absent at the model's own default. */
  effort: z.enum(RUN_EFFORTS).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  turns: z.number().int(),
  version: z.number().int().nullable(),
  createdApp: z.boolean(),
  tokens: z.object({ in: z.number().int(), out: z.number().int() }),
});

/** A card as the page draws it. Its fields depend on its type. */
export const designerCard = z.object({ id: z.string(), type: z.enum(['question', 'package', 'needs', 'pictures', 'add-on', 'rows', 'removal']) }).passthrough();

/** An event as the page reads it. Its fields depend on its kind. */
export const designerEvent = z.object({ seq: z.number().int(), turn: z.number().int(), at: z.number(), kind: z.string() }).passthrough();

export const designerSessionParams = z.object({ id: z.string().regex(/^ds_[0-9a-z]{24}$/) });

export const designerStateReply = z.object({
  mode: z.enum(['local', 'live']),
  /** The folder's name, for the page's title. */
  project: z.string(),
  limits: z.object({ maxSteps: z.number().int(), turnTokens: z.number().int(), sessionTokens: z.number().int() }),
  active: z.object({ sessionId: z.string(), turn: z.number().int() }).nullable(),
  /** Whether the person asking is the owner `design` made, still with no password: the dashboard then offers to set one. */
  ownerNeedsPassword: z.boolean(),
  /** Names in the project's `.env` or config that were not obeyed, because the host decides them. Empty on a terminal. */
  ignoredEnv: z.array(z.string()),
});

export const designerOwnerPasswordBody = z.object({ email: z.string().min(3).max(254), password: z.string().min(1).max(1024) });
export const designerOwnerPasswordReply = z.object({ email: z.string() });

export const designerAppsReply = z.object({
  apps: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      /** The newest version of its newest session, or null. */
      version: z.number().int().nullable(),
      editedAt: z.number().nullable(),
      sessionId: z.string().nullable(),
      /** Every session on this app, newest first (the newest fifty): an earlier chat stays readable after a new session. */
      sessions: z.array(z.object({ id: z.string(), title: z.string(), updatedAt: z.number(), turns: z.number().int() })),
    }),
  ),
});

export const designerSessionCreateBody = z.object({
  appKey: z.string().max(80).optional(),
  name: z.string().max(80).optional(),
  /** The session's title until the Designer names the app: the first words of the request. */
  title: z.string().max(80).optional(),
  target: target.default('auto'),
  connectionId: z.string().max(64),
  model: z.string().min(1).max(200),
  effort: z.enum(RUN_EFFORTS).optional(),
  /** A style picked at the start, a design skill's key; left out to let the Designer choose. */
  style: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).optional(),
  /** The first message. Without it the session opens with no turn: "Continue" on an app no session built. */
  text: z.string().min(1).max(20_000).optional(),
  /** With a first message: the page that sends it will show the preview, and say what it sees of each build. */
  sees: z.boolean().optional(),
});

const styleKey = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);
const swatch = z.object({ bg: z.string(), text: z.string(), accent: z.string() });
/** A look as the page is told it. `earlier`: kept before styles, drawn as it was until a style is picked. */
const publicLook = z.object({ skill: z.string(), title: z.string(), origin: z.enum(['built-in', 'project', 'earlier']), accent: z.string().optional(), swatch: swatch.optional() });

export const designerSessionReply = z.object({
  session: designerSession,
  waiting: z.array(designerCard),
  active: z.boolean(),
  /** The look of the app's own screens, when it can be changed from the page; null for an app with no screens, or a copy of a published one. */
  look: publicLook.nullable(),
});

/** `direction` is the name this took before styles: read as the style of that name. */
export const designerLookBody = z
  .object({ skill: styleKey.optional(), direction: z.enum(['clean', 'warm', 'bold', 'calm']).optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })
  .refine((body) => body.skill !== undefined || body.direction !== undefined, { message: 'Give a style.' });
export const designerLookReply = z.object({
  look: publicLook,
  version: z.object({ n: z.number().int(), name: z.string() }).nullable(),
  applied: z.boolean(),
});

export const designerStyleUploadQuery = z.object({ filename: z.string().min(1).max(300) });
export const designerStyleAddedReply = z.object({ key: z.string(), left: z.array(z.string()) });
export const designerStyleParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/) });
export const designerStyleRemovedReply = z.object({ removed: z.literal(true) });
export const designerStylesReply = z.object({
  styles: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      description: z.string(),
      origin: z.enum(['built-in', 'project']),
      /** False for a style of words alone: applying it takes a turn. */
      hasTheme: z.boolean(),
      hasPreview: z.boolean(),
      swatch: swatch.optional(),
      /** Why it cannot be used, in a sentence. */
      problem: z.string().optional(),
    }),
  ),
});

export const designerSessionCreateReply = z.object({ session: designerSession, turn: z.number().int().nullable() });

export const designerSessionPatchBody = z.object({
  title: z.string().min(1).max(80).optional(),
  connectionId: z.string().max(64).optional(),
  model: z.string().min(1).max(200).optional(),
  /** `null` goes back to the model's own default. */
  effort: z.enum(RUN_EFFORTS).nullable().optional(),
});

export const designerTurnBody = z.object({
  text: z.string().min(1).max(20_000),
  /** Files already uploaded to this session, by the ids the upload answered with. */
  attachments: z.array(z.string().regex(/^att_[0-9a-f]{20}$/)).max(8).optional(),
  /** The page that sends this shows the preview, and will say what it sees of each build. */
  sees: z.boolean().optional(),
  /** The element of the preview the person pointed at, as the screen said it. The server holds each value to its shape, and refuses what is no element. */
  picked: z
    .object({
      side: z.enum(['staff', 'customer']),
      path: z.string().max(1000),
      page: z.number().nullable().optional(),
      part: z.string().max(300),
      text: z.string().max(400).optional(),
      label: z.string().max(400).optional(),
      within: z.array(z.string().max(200)).max(8).optional(),
      nth: z.number().optional(),
      of: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
});

/** What the preview saw of the app's screen: what is measurably broken on it, and a picture of it as a JPEG data address. */
export const designerSightBody = z.object({
  side: z.enum(['staff', 'customer']),
  width: z.number().int().min(200).max(6000),
  /** What was measured: each a kind from a closed list with a few values. Anything else is left out by the server. */
  faults: z.array(z.record(z.string(), z.union([z.string().max(200), z.number()]))).max(40),
  picture: z.string().max(1_000_000).optional(),
  /** The page's own path on that side, as the screen said it. The server tidies it, and reads anything that is no path as the first page. */
  path: z.string().max(1000).optional(),
});
export const designerSightReply = z.object({ kept: z.boolean() });

export const designerAttachment = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['image', 'csv', 'font']),
  mediaType: z.string(),
  bytes: z.number().int(),
  rows: z.number().int().optional(),
  columns: z.array(z.string()).optional(),
});
export const designerAttachmentQuery = z.object({
  filename: z.string().min(1).max(300),
  /** A part of a tall picture this session holds, as the page cut it for a model to read: the picture's id, which part (from 1, the top), and how many. */
  part_of: z.string().regex(/^att_[0-9a-f]{20}$/).optional(),
  part: z.coerce.number().int().min(1).max(8).optional(),
  parts: z.coerce.number().int().min(2).max(8).optional(),
  /** A picture's colours as the page read them: `rrggbb:share` (share in thousandths), the most first. */
  palette: z
    .string()
    .regex(/^[0-9a-f]{6}:\d{1,4}(,[0-9a-f]{6}:\d{1,4}){0,15}$/)
    .optional(),
});
export const designerAttachmentParams = z.object({ id: z.string().regex(/^ds_[0-9a-z]{24}$/), attachment: z.string().regex(/^att_[0-9a-f]{20}$/) });
export const designerPictureThumbParams = z.object({ id: z.string().regex(/^ds_[0-9a-z]{24}$/), shelf: z.string().regex(/^shelf_[0-9a-f]{16}$/), picture: z.string().regex(/^pic_[0-9a-f]{12}$/) });
export const designerAttachmentReply = z.object({ attachment: designerAttachment });
export const designerReadsImagesBody = z.object({ connectionId: z.string().min(1).max(200), model: z.string().min(1).max(200) });
export const designerReadsImagesReply = z.object({ readsImages: z.boolean().nullable() });
export const designerTurnReply = z.object({ turn: z.number().int() });
export const designerStopReply = z.object({ stopped: z.boolean() });
export const designerAnswerBody = z.object({ cardId: z.string().max(64), value: z.unknown() });
export const designerAnswerReply = z.object({ answered: z.literal(true) });

export const designerVersionsReply = z.object({
  /** False when git is not on this machine: the page says versions are off. */
  available: z.boolean(),
  versions: z.array(z.object({ n: z.number().int(), name: z.string(), at: z.number(), current: z.boolean() })),
});
export const designerVersionParams = designerSessionParams.extend({ n: z.coerce.number().int().min(0).max(100_000) });
export const designerRestoreBody = z.object({ record: z.boolean().default(true) });
export const designerRestoreReply = z.object({
  version: z.object({ n: z.number().int(), name: z.string() }).nullable(),
  applied: z.boolean(),
});

/** What has the app's folder: a turn, or something a person does from the page. */
const designerBusy = z.enum(['turn', 'save', 'style', 'restore', 'start']);
const designerFileHash = z.string().regex(/^[0-9a-f]{64}$/);
/** A file's path in the project. Held against the server's own list, as a string; its shape is not what lets it in. */
const designerFilePath = z.string().min(1).max(300);

/** The files of an app a person may open and save by hand, in the groups the page draws. */
export const designerFilesReply = z.object({
  groups: z.array(
    z.object({
      key: z.enum(['customer', 'staff', 'mobile', 'dashboard', 'settings']),
      files: z.array(z.object({ path: z.string(), label: z.string(), hash: designerFileHash, size: z.number().int(), note: z.enum(['brief']).optional() })),
    }),
  ),
  busy: designerBusy.nullable(),
  version: z.number().int().nullable(),
});
export const designerFileQuery = z.object({ path: designerFilePath });
export const designerFileReply = z.object({ path: z.string(), content: z.string(), hash: designerFileHash });
/** A search of those files: the words as they are (no pattern), and how they are held against the text. */
export const designerFileSearchQuery = z.object({ q: z.string().min(1).max(200), case: z.enum(['1']).optional(), word: z.enum(['1']).optional() });
export const designerFileSearchReply = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      hash: designerFileHash,
      hits: z.array(z.object({ line: z.number().int(), col: z.number().int(), len: z.number().int(), text: z.string(), at: z.number().int() })),
    }),
  ),
  more: z.boolean(),
});
/** A hand save: each file whole, with the hash it had when the person opened it. */
export const designerFilesSaveBody = z.object({
  files: z
    .array(z.object({ path: designerFilePath, content: z.string().max(262_144), base: designerFileHash }))
    .min(1)
    .max(40),
});
export const designerFilesSaveReply = z.object({
  applied: z.boolean(),
  version: z.object({ n: z.number().int(), name: z.string() }).nullable(),
  files: z.array(z.object({ path: z.string(), hash: designerFileHash })),
  problems: z.object({ stage: z.enum(['check', 'build', 'apply']), lines: z.array(z.string()) }).optional(),
});

/** One app of the adminium.dev list, as a card draws it. */
export const designerCatalogApp = z.object({
  key: z.string(),
  version: z.string(),
  name: z.string(),
  tagline: z.string(),
  category: z.string().nullable(),
  sides: z.array(z.enum(['staff', 'customer'])),
  iconTint: z.string().nullable(),
  iconPaths: z.array(z.string()),
  monogram: z.string().nullable(),
  /** Whether the list says where its source is: only then can it be copied. */
  copyable: z.boolean(),
});
/** "Start with an app": the key a copy would take, checked as it is typed, with the build it would be given. */
export const designerStartCheckQuery = z.object({ newKey: z.string().max(80) });
export const designerStartCheckReply = z.object({
  problem: z.string().nullable(),
  build: z.object({ install: z.string(), command: z.string(), output: z.string(), fingerprint: z.string() }).nullable(),
});
export const designerStartBody = z.object({
  key: z.string().max(80),
  newKey: z.string().max(80),
  name: z.string().min(1).max(80),
  /** The fingerprint of the build the person read and approved. */
  approve: z.string().max(100),
  connectionId: z.string().max(64),
  model: z.string().min(1).max(200),
});
export const designerStartJob = z.object({
  id: z.string(),
  key: z.string(),
  newKey: z.string(),
  name: z.string(),
  state: z.enum(['running', 'done', 'failed']),
  steps: z.array(z.object({ id: z.enum(['get', 'make', 'build']), state: z.enum(['waiting', 'running', 'done', 'failed']), detail: z.string().optional() })),
  sessionId: z.string().nullable(),
});
export const designerStartParams = z.object({ jobId: z.string().max(80) });

export const designerAppsListReply = z.object({
  /** `off`: network features or the online app list are switched off. `unreachable`: adminium.dev did not answer. */
  state: z.enum(['ok', 'off', 'unreachable']),
  apps: z.array(designerCatalogApp),
});

export const designerModelsReply = z.object({
  connections: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      source: z.enum(['database', 'environment']),
      /** `unreachable`: listing its models failed; the other connections still list. */
      state: z.enum(['ok', 'unreachable']),
      models: z.array(z.object({ id: z.string(), label: z.string(), /** The effort levels the model takes, the least first; absent when it takes none. */ efforts: z.array(z.enum(RUN_EFFORTS)).optional() })),
    }),
  ),
  /** The model a new session uses: the environment's selected one, else the saved setting's. */
  selected: z.object({ connectionId: z.string(), model: z.string() }).nullable(),
  /** What this process knows about which models can build. A model not listed was not tested yet. */
  verdicts: z.array(z.object({ connectionId: z.string(), model: z.string(), canBuild: z.boolean(), message: z.string().nullable() })),
  /** Whether a model can be added here (a project .env to keep it in). */
  canAdd: z.boolean(),
  /** Inside the desktop app: keys are kept by the app, by the system's key store or (where there is none) in plain text. `null` elsewhere. */
  kept: z.enum(['key-store', 'plain']).nullable(),
  /** Inside the desktop app: model names this project's `.env` sets, which are not used there. */
  ignoredEnv: z.array(z.string()),
});

export const designerModelCheckBody = z.object({ connectionId: z.string().max(64), model: z.string().min(1).max(200) });
/** `canBuild: null`: the model could not be asked (a refused key, no answer); `message` says why. */
export const designerModelCheckReply = z.object({ canBuild: z.boolean().nullable(), message: z.string().nullable() });

export const designerPreviewBody = z.object({ to: z.string().min(1).max(500) });
export const designerPreviewReply = z.object({
  url: z.string(),
  origin: z.string(),
  /** The names of the roles the preview's user holds: whom the preview is seen as. */
  seenAs: z.array(z.string()),
});

export const designerEventsQuery = z.object({ after: z.coerce.number().int().min(0).default(0) });
export const designerEventsReply = z.object({ events: z.array(designerEvent), last: z.number().int(), more: z.boolean() });

const provider = z.enum(['anthropic', 'openai', 'openai-compatible', 'ollama']);
export const designerConnectionDraft = z.object({
  provider,
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().url().max(500).optional(),
  model: z.string().min(1).max(200).optional(),
});
export const designerConnectionTestReply = z.object({
  ok: z.boolean(),
  models: z.array(z.object({ id: z.string(), label: z.string() })),
  canBuild: z
    .union([
      z.object({ canBuild: z.literal(true), reportsUsage: z.boolean() }),
      z.object({ canBuild: z.literal(false), reason: z.enum(['no-tool-call', 'refused-result']), message: z.string() }),
    ])
    .nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export const designerConnectionSaveBody = designerConnectionDraft.extend({ model: z.string().min(1).max(200) });
export const designerConnectionReply = z.object({
  id: z.string(),
  provider: z.string(),
  source: z.enum(['database', 'environment']),
  baseUrl: z.string().nullable(),
  hasKey: z.boolean(),
  model: z.string().nullable(),
});

const cell = z.enum(['read', 'write', 'none']);
/** How an app fits together (`designer/architecture.ts`). */
export const designerArchitectureReply = z.object({
  name: z.string(),
  applied: z.boolean(),
  people: z.array(z.object({ id: z.string(), kind: z.enum(['role', 'customers']), label: z.string() })),
  uses: z.array(z.object({ id: z.enum(['dashboard', 'staff', 'customer']), label: z.string(), count: z.number().int() })),
  tables: z.array(
    z.object({
      id: z.string(),
      ref: z.string(),
      name: z.string(),
      rows: z.number().int().nullable(),
      columns: z.array(z.object({ name: z.string(), type: z.string() })),
      relations: z.array(z.object({ to: z.string(), column: z.string() })),
      posts: z.array(z.object({ addOn: z.string(), ledger: z.string(), action: z.string() })).optional(),
    }),
  ),
  addOns: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      need: z.enum(['required', 'suggested']),
      state: z.enum(['installed', 'not-installed']),
      version: z.string().nullable(),
      reason: z.string(),
    }),
  ),
  builtIn: z.array(z.enum(['sign-in', 'files', 'automations', 'import-export', 'reports', 'api'])),
  emails: z.array(z.object({ id: z.string(), key: z.string(), name: z.string(), when: z.string() })),
  edges: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      kind: z.enum(['session', 'customer-key', 'uses', 'relation', 'add-on', 'email']),
      reads: z.number().int().optional(),
      writes: z.number().int().optional(),
      does: z.enum(['posts', 'prices']).optional(),
    }),
  ),
  lists: z.object({
    pages: z.array(z.object({ ref: z.string(), name: z.string(), kind: z.string(), shows: z.string() })),
    roles: z.object({
      tables: z.array(z.string()),
      rows: z.array(z.object({ id: z.string(), role: z.string(), cells: z.array(cell), notes: z.array(z.string().nullable()) })),
    }),
    access: z.array(z.string()),
    screens: z.array(z.object({ id: z.string(), name: z.string(), side: z.enum(['staff', 'customer']) })),
  }),
  pending: z.array(z.object({ part: z.string(), node: z.string().nullable() })),
});

// ── the phone side ───────────────────────────────────────────────────────────

/** How an app's phone side stands: one of these, with the engine's words where there is something to say. */
const designerPhoneStanding = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }),
  z.object({ state: z.literal('shape'), words: z.string() }),
  z.object({ state: z.literal('unapproved'), words: z.string(), packages: z.array(z.string()) }),
  z.object({ state: z.literal('no-packages'), words: z.string() }),
  z.object({ state: z.literal('failed'), words: z.string() }),
  z.object({ state: z.literal('built'), build: z.string() }),
  z.object({ state: z.literal('working'), step: z.enum(['adding', 'installing', 'building']) }),
]);

/** The door a real phone comes through. `url` carries the code: it is for the page that draws it, and is never logged. */
const designerPhoneDoor = z.discriminatedUnion('state', [
  z.object({ state: z.literal('off') }),
  z.object({ state: z.literal('starting'), app: z.string() }),
  z.object({
    state: z.literal('open'),
    app: z.string(),
    url: z.string(),
    qr: z.string(),
    address: z.string(),
    sdk: z.string().nullable(),
    connected: z.boolean(),
    phoneSdk: z.string().nullable(),
    lastSeen: z.number().nullable(),
  }),
  z.object({ state: z.literal('closed'), app: z.string(), why: z.enum(['stopped', 'idle', 'network', 'failed']), words: z.string() }),
]);

export const designerPhoneReply = z.object({
  phone: designerPhoneStanding,
  door: designerPhoneDoor,
  /** This computer's addresses a phone on the same network could reach, the likeliest first. */
  addresses: z.array(z.object({ address: z.string(), name: z.string() })),
});

export const designerPhoneOpenBody = z.object({ address: z.string().min(7).max(15) }).strict();
