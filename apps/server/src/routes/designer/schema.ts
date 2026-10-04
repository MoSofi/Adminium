// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `/api/v1/designer/*`.
 *
 * SYNC NOTE: the dashboard's mirror is `apps/dashboard/src/designer/api.ts`, a
 * type-only copy (the dashboard may not import server code). The replies are
 * un-enveloped, like the assistant's.
 */
import { z } from 'zod';

const target = z.enum(['auto', 'dashboard', 'web']);

export const designerSession = z.object({
  id: z.string(),
  appKey: z.string(),
  title: z.string(),
  target,
  connectionId: z.string(),
  model: z.string(),
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
  /** A style picked at the start, a design skill's key; left out to let the Designer choose. */
  style: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).optional(),
  /** The first message. Without it the session opens with no turn: "Continue" on an app no session built. */
  text: z.string().min(1).max(20_000).optional(),
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
});

export const designerTurnBody = z.object({
  text: z.string().min(1).max(20_000),
  /** Files already uploaded to this session, by the ids the upload answered with. */
  attachments: z.array(z.string().regex(/^att_[0-9a-f]{20}$/)).max(4).optional(),
});

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
      models: z.array(z.object({ id: z.string(), label: z.string() })),
    }),
  ),
  /** The model a new session uses: the environment's selected one, else the saved setting's. */
  selected: z.object({ connectionId: z.string(), model: z.string() }).nullable(),
  /** What this process knows about which models can build. A model not listed was not tested yet. */
  verdicts: z.array(z.object({ connectionId: z.string(), model: z.string(), canBuild: z.boolean(), message: z.string().nullable() })),
  /** Whether a model can be added here (a project .env to keep it in). */
  canAdd: z.boolean(),
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
