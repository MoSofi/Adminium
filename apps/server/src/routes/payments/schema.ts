// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wire shapes of Studio → Payments: what the setup page reads and what
 * each of its saves sends. Nothing here carries a key: a saved field comes
 * back as a hint (`rk_test_…a1B2`) and the date it was saved.
 */
import { PAYMENT_MODES } from '@adminium/add-on-contracts';
import { z } from 'zod';

import { PASTE_REFUSALS } from '../../payments/paste-checks.js';
import { REACHABILITY_STATES } from '../../payments/reachability.js';
import { CHECKLIST_STEPS } from '../../payments/services.js';

const message = z.object({ key: z.string(), fallback: z.string() });

export const serviceKeyParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) });
export const serviceModeParams = serviceKeyParams.extend({ mode: z.enum(PAYMENT_MODES) });
export const serviceFieldParams = serviceModeParams.extend({ field: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64) });

export const saveFieldBody = z.object({ value: z.string().max(4096) });
export const pathBody = z.object({ path: z.enum(['app', 'by-hand']) });
export const stoppedBody = z.object({ stopped: z.boolean() });

const fieldView = z.object({
  key: z.string(),
  label: message.nullable(),
  help: message.nullable(),
  /** Part of the webhook step rather than the key. */
  webhook: z.boolean(),
  set: z.boolean(),
  hint: z.string().nullable(),
  setAt: z.number().nullable(),
});

const checkView = z.object({
  at: z.number(),
  ok: z.boolean(),
  code: z.string().nullable(),
  message: z.string().nullable(),
  missing: z.array(z.string()),
});

const modeView = z.object({
  fields: z.array(fieldView),
  check: checkView.nullable(),
  accountId: z.string().nullable(),
  /** Where the provider sends this mode's webhooks, once this server has a public address. */
  webhookUrl: z.string().nullable(),
  firstEventAt: z.number().nullable(),
  firstPaymentAt: z.number().nullable(),
});

export const serviceView = z.object({
  key: z.string(),
  name: z.string(),
  description: message,
  /** `installed`, `disabled`, … as the add-on row says. */
  status: z.string(),
  /** Its server half loaded (a payment provider loads only from a package Adminium vouches for). */
  loaded: z.boolean(),
  hasPaths: z.boolean(),
  path: z.enum(['app', 'by-hand']).nullable(),
  stopped: z.boolean(),
  liveOn: z.boolean(),
  test: modeView,
  live: modeView,
  checklist: z.array(z.object({ step: z.enum(CHECKLIST_STEPS), done: z.boolean() })),
});
export type ServiceView = z.infer<typeof serviceView>;

export const setupReply = z.object({
  data: z.object({
    reachability: z.object({
      state: z.enum(REACHABILITY_STATES),
      origin: z.string().nullable(),
      notPort443: z.boolean(),
    }),
    /** May this person change anything here, or only read it. */
    canManage: z.boolean(),
    services: z.array(serviceView),
  }),
});
export type SetupReply = z.infer<typeof setupReply>;

export const serviceReply = z.object({ data: serviceView });

/** A paste refused before anything was saved: the dashboard words each `reason`. */
export const pasteRefusalDetails = z.object({ reason: z.enum(PASTE_REFUSALS), field: z.string() });
