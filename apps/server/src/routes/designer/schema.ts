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
export const designerCard = z.object({ id: z.string(), type: z.enum(['question', 'package', 'removal']) }).passthrough();

/** An event as the page reads it. Its fields depend on its kind. */
export const designerEvent = z.object({ seq: z.number().int(), turn: z.number().int(), at: z.number(), kind: z.string() }).passthrough();

export const designerSessionParams = z.object({ id: z.string().regex(/^ds_[0-9a-z]{24}$/) });

export const designerStateReply = z.object({
  mode: z.enum(['local', 'live']),
  /** The folder's name, for the page's title. */
  project: z.string(),
  limits: z.object({ maxSteps: z.number().int(), turnTokens: z.number().int(), sessionTokens: z.number().int() }),
  active: z.object({ sessionId: z.string(), turn: z.number().int() }).nullable(),
});

export const designerAppsReply = z.object({
  apps: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      /** The newest version of its newest session, or null. */
      version: z.number().int().nullable(),
      editedAt: z.number().nullable(),
      sessionId: z.string().nullable(),
    }),
  ),
});

export const designerSessionCreateBody = z.object({
  appKey: z.string().max(80).optional(),
  name: z.string().max(80).optional(),
  target: target.default('auto'),
  connectionId: z.string().max(64),
  model: z.string().min(1).max(200),
  /** The first message. Without it the session opens with no turn: "Continue" on an app no session built. */
  text: z.string().min(1).max(20_000).optional(),
});

export const designerSessionReply = z.object({
  session: designerSession,
  waiting: z.array(designerCard),
  active: z.boolean(),
});

export const designerSessionCreateReply = z.object({ session: designerSession, turn: z.number().int().nullable() });

export const designerSessionPatchBody = z.object({
  title: z.string().min(1).max(80).optional(),
  connectionId: z.string().max(64).optional(),
  model: z.string().min(1).max(200).optional(),
});

export const designerTurnBody = z.object({ text: z.string().min(1).max(20_000) });
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
});
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
export const designerPreviewReply = z.object({ url: z.string(), origin: z.string() });

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
