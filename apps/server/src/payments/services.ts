// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What Studio knows about each payment service, without ever reading a key.
 *
 * The keys themselves live in the add-on's encrypted credential envelope
 * (`credentials.ts`) and are decrypted only by server code about to make a
 * call. Everything a person needs to SEE lives here instead, in a small
 * settings document per add-on (`service:<key>`): a hint of each saved field
 * (`rk_test_…a1B2`, never more), when it was saved, the last Check and what it
 * found, the provider account the key belongs to, and the setup checklist's
 * progress, so a shop owner can leave setup for days and come back to where
 * they were.
 *
 * A change of account id is the alarm case: money would start going to a
 * different account. `recordCheck` reports it, and the caller audits and
 * emails it.
 */
import { PAYMENT_MODES, type CredentialCheck, type PaymentMode, type ProviderError } from '@adminium/add-on-contracts';
import { z } from 'zod';

/** The settings document's name for one add-on. */
export function serviceDocName(addOnKey: string): string {
  return `service:${addOnKey}`;
}

const fieldStateSchema = z
  .object({
    /** What the dashboard shows of the value: its prefix and last four, never more. */
    hint: z.string().max(40),
    setAt: z.number().int().nonnegative(),
  })
  .strict();

const checkStateSchema = z
  .object({
    at: z.number().int().nonnegative(),
    ok: z.boolean(),
    /** The refusal code when not ok. */
    code: z.string().max(40).nullable(),
    /** The provider's own words for a refusal (already scrubbed by the provider half). */
    message: z.string().max(2000).nullable(),
    /** Each missing permission, in the provider's dashboard words. */
    missing: z.array(z.string().max(200)).max(50),
  })
  .strict();

const modeStateSchema = z
  .object({
    fields: z.record(z.string().min(1).max(64), fieldStateSchema),
    check: checkStateSchema.nullable(),
    /** The account the key belongs to, once a Check has said. */
    accountId: z.string().max(255).nullable(),
    /** The first verified webhook for this mode (the webhook step is done). */
    firstEventAt: z.number().int().nonnegative().nullable(),
    /** The first payment that succeeded in this mode. */
    firstPaymentAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const serviceStateSchema = z
  .object({
    v: z.literal(1),
    /** How the admin chose to make the key, for providers that offer more than one way. */
    path: z.enum(['app', 'by-hand']).nullable(),
    test: modeStateSchema,
    live: modeStateSchema,
    /** Stop new payments: no new attempt starts; the key stays for re-reads and refunds. */
    stopped: z.boolean(),
    /** Whether live payments are switched on. */
    liveOn: z.boolean(),
  })
  .strict();

export type ServiceState = z.infer<typeof serviceStateSchema>;
export type ModeState = z.infer<typeof modeStateSchema>;

const emptyMode = (): ModeState => ({ fields: {}, check: null, accountId: null, firstEventAt: null, firstPaymentAt: null });

export function emptyServiceState(): ServiceState {
  return { v: 1, path: null, test: emptyMode(), live: emptyMode(), stopped: false, liveOn: false };
}

/**
 * The part of a secret a person may see again: a recognisable prefix
 * (`rk_test_`, `whsec_`) and the last four characters. A value too short to
 * keep four back shows nothing of itself.
 */
export function hintOf(value: string): string {
  const prefix = /^[a-z]{2,6}_(?:(?:test|live)_)?/.exec(value)?.[0] ?? '';
  const last = value.length > prefix.length + 8 ? value.slice(-4) : '';
  return last === '' ? `${prefix}…` : `${prefix}…${last}`;
}

/** The state with one field saved (or removed, with `value: null`). */
export function withSavedField(state: ServiceState, mode: PaymentMode, field: string, value: string | null, at: number): ServiceState {
  const fields = { ...state[mode].fields };
  if (value === null) delete fields[field];
  else fields[field] = { hint: hintOf(value), setAt: at };
  // A replaced field makes the last Check stale: it was about the old value.
  return { ...state, [mode]: { ...state[mode], fields, check: null } };
}

export interface CheckOutcome {
  state: ServiceState;
  /** The account the key now belongs to changed from a known one: audit it and tell every manager. */
  accountChanged: { from: string; to: string } | null;
}

/** Records what a Check found. */
/** A refusal from the provider, or from the engine before a provider could be asked (not installed, not loaded). */
export type CheckRefusal = Pick<ProviderError, 'ok' | 'providerMessage'> & { code: string };

export function recordCheck(state: ServiceState, mode: PaymentMode, answer: CredentialCheck | CheckRefusal, at: number): CheckOutcome {
  const before = state[mode].accountId;
  const check =
    answer.ok === true
      ? { at, ok: true, code: null, message: null, missing: [...answer.missing] }
      : { at, ok: false, code: answer.code, message: answer.providerMessage, missing: [] };
  const accountId = answer.ok === true ? answer.accountId : before;
  const accountChanged = answer.ok === true && before !== null && before !== answer.accountId ? { from: before, to: answer.accountId } : null;
  return { state: { ...state, [mode]: { ...state[mode], check, accountId } }, accountChanged };
}

/** The steps of a provider's setup checklist, in order, and whether each is done. */
export const CHECKLIST_STEPS = ['path', 'test-key', 'test-webhook', 'test-payment', 'live-key', 'live-webhook', 'live-payment'] as const;
export type ChecklistStep = (typeof CHECKLIST_STEPS)[number];

export interface ChecklistInput {
  state: ServiceState;
  /** The manifest's secret fields that make the key (Stripe `secret_key`; PayPal `client_id`, `client_secret`). */
  keyFields: readonly string[];
  /** The fields the webhook step needs (Stripe `webhook_secret`; PayPal `webhook_id`). */
  webhookFields: readonly string[];
  /** Whether this provider offers more than one way to make the key (Stripe: the app or by hand). */
  hasPaths: boolean;
}

function keyDone(mode: ModeState, fields: readonly string[]): boolean {
  return fields.every((field) => mode.fields[field] !== undefined) && mode.check?.ok === true && mode.check.missing.length === 0;
}

function webhookDone(mode: ModeState, fields: readonly string[]): boolean {
  return fields.every((field) => mode.fields[field] !== undefined) && mode.firstEventAt !== null;
}

/** Each step, done or not. A provider with one way to make a key has no `path` step. */
export function checklist(input: ChecklistInput): { step: ChecklistStep; done: boolean }[] {
  const { state } = input;
  const done: Record<ChecklistStep, boolean> = {
    path: state.path !== null,
    'test-key': keyDone(state.test, input.keyFields),
    'test-webhook': webhookDone(state.test, input.webhookFields),
    'test-payment': state.test.firstPaymentAt !== null,
    'live-key': keyDone(state.live, input.keyFields),
    'live-webhook': webhookDone(state.live, input.webhookFields),
    'live-payment': state.live.firstPaymentAt !== null,
  };
  return CHECKLIST_STEPS.filter((step) => step !== 'path' || input.hasPaths).map((step) => ({ step, done: done[step] }));
}

/** Every mode, in the order Studio shows them. */
export const SERVICE_MODES: readonly PaymentMode[] = PAYMENT_MODES;
