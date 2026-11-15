// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `card-terminal@1` — a card reader on the shop's counter, driven by a cloud
 * API (Stripe Terminal, Square Terminal). The till asks the engine; the engine
 * asks the reader through this contract, outbound only (it polls; no webhook
 * is needed, so a server on the shop's own computer works).
 *
 * The flow: `sendToReader` puts the amount on the reader (with the attempt's
 * own idempotency key: sent twice, it is one charge), `readerStatus` is asked
 * until the card is taken, declined or the charge cancelled, `cancelOnReader`
 * takes an amount off the reader. A charge is never given up blind: a send
 * whose answer was lost is sent again with the same key, and a cancel is
 * followed by a status read, because a card tapped a moment before the cancel
 * is a payment.
 *
 * Pairing runs in two steps, because the two services pair the other way
 * round: Stripe shows a code on the reader that the admin types into Studio;
 * Square makes a code the admin types on the reader. `startPairing` answers
 * which (`enter`: the person types the reader's code into `finishPairing`;
 * `show`: the person types this code on the reader, and `finishPairing` waits
 * for it).
 *
 * Refunds of a reader payment go back the same way as a pay page's
 * (`refund`, `refundStatus`); disputes and refunds made in the service's own
 * dashboard are read with `listEvents` (polling). An Interac payment (Canada)
 * can only be refunded on the reader with the card, which this contract does
 * not do: its refund is refused `REFUND_REFUSED`, and the shop refunds in cash
 * or store credit.
 *
 * Every method may return a `ProviderError` instead of its answer; none throws
 * for an ordinary refusal. Every answer is parsed with
 * {@link CARD_TERMINAL_ANSWER_SCHEMAS}; one that fails is treated as the
 * service being unavailable.
 */
import { z } from 'zod';

import {
  credentialCheckSchema,
  currencyCodeSchema,
  decimalAmountSchema,
  paymentEventSchema,
  refundStateSchema,
  type CredentialCheck,
  type MinorAmount,
  type PaymentEvent,
  type PaymentMode,
  type PaymentProviderContext,
  type ProviderError,
  type RefundInput,
  type RefundState,
} from './payment-provider.js';

export const CARD_TERMINAL_CONTRACT = 'card-terminal';
export const CARD_TERMINAL_VERSION = 1;
/** The server half's export an add-on providing the contract names. */
export const CARD_TERMINAL_FACTORY = 'createCardTerminal';

/** Where a charge on a reader stands. */
export const READER_CHARGE_STATUSES = ['waiting', 'on_reader', 'succeeded', 'declined', 'cancelled', 'offline'] as const;
export type ReaderChargeStatus = (typeof READER_CHARGE_STATUSES)[number];

/** A location the service keeps readers under (a shop, a counter). */
export interface ReaderLocation {
  readonly id: string;
  readonly name: string;
}
const locationSchema = z.object({ id: z.string().min(1).max(255), name: z.string().min(1).max(255) }).strict();

export interface ReaderLocations {
  readonly ok: true;
  readonly locations: readonly ReaderLocation[];
}
export const readerLocationsSchema = z.object({ ok: z.literal(true), locations: z.array(locationSchema).max(500) }).strict();

/** A reader the account holds. */
export interface Reader {
  readonly id: string;
  /** The name staff gave it ("Front counter"). */
  readonly label: string;
  readonly locationId: string | null;
  /** The model as the service names it ("BBPOS WisePOS E"). */
  readonly model: string | null;
  readonly online: boolean;
  /** When the service last heard from it, epoch ms, or null. */
  readonly lastSeenAt: number | null;
}
const readerSchema = z
  .object({
    id: z.string().min(1).max(255),
    label: z.string().max(255),
    locationId: z.string().max(255).nullable(),
    model: z.string().max(120).nullable(),
    online: z.boolean(),
    lastSeenAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

export interface ReaderList {
  readonly ok: true;
  readonly readers: readonly Reader[];
}
export const readerListSchema = z.object({ ok: z.literal(true), readers: z.array(readerSchema).max(500) }).strict();

/** The first step of pairing: which way it runs, and the code when the person types it on the reader. */
export interface PairingStarted {
  readonly ok: true;
  /** `enter`: the reader shows a code the person types into Studio; `show`: the person types `code` on the reader. */
  readonly way: 'enter' | 'show';
  /** The code to type on the reader (`show`); null for `enter`. */
  readonly code: string | null;
  /** Passed back to `finishPairing`. */
  readonly pairing: string;
  /** Until when the pairing waits, epoch ms. */
  readonly expiresAt: number;
}
export const pairingStartedSchema = z
  .object({
    ok: z.literal(true),
    way: z.enum(['enter', 'show']),
    code: z.string().min(1).max(64).nullable(),
    pairing: z.string().min(1).max(512),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();

/** The second step: the reader paired, or still waiting for the person (`show`). */
export type PairingFinished = { readonly ok: true; readonly state: 'paired'; readonly reader: Reader } | { readonly ok: true; readonly state: 'waiting' };
export const pairingFinishedSchema = z.union([
  z.object({ ok: z.literal(true), state: z.literal('paired'), reader: readerSchema }).strict(),
  z.object({ ok: z.literal(true), state: z.literal('waiting') }).strict(),
]);

export interface ReaderUnpaired {
  readonly ok: true;
}
export const readerUnpairedSchema = z.object({ ok: z.literal(true) }).strict();

/** An amount put on a reader. */
export interface ReaderChargeInput {
  readonly readerId: string;
  /** What is asked, the tip excluded. */
  readonly amount: string;
  readonly currency: string;
  /** Adminium's attempt id: the charge carries it, so a lost answer can be found again. */
  readonly attemptId: string;
  /** The same key for the same charge: sent again, it is one charge. */
  readonly idempotencyKey: string;
  /** Whether the reader offers a tip before the card. */
  readonly tipping: boolean;
}

/** Where a charge stands, as the reader says it. */
export interface ReaderChargeState {
  readonly ok: true;
  /** The service's own id for the charge: passed to `readerStatus` and `cancelOnReader`. */
  readonly ref: string;
  readonly status: ReaderChargeStatus;
  /** Taken in all, the tip included, once `succeeded`; null before. */
  readonly amount: string | null;
  /** The tip, once `succeeded`; "0" with none. */
  readonly tip: string | null;
  readonly currency: string;
  /** The payment's reference at the service once taken: what a refund names. */
  readonly paymentRef: string | null;
  /** The card's brand ("Visa"), its last four, and the bank's approval code, once taken. */
  readonly brand: string | null;
  readonly last4: string | null;
  readonly approvalCode: string | null;
  /** Whether the card was Interac (refunded only on the reader). */
  readonly interac: boolean;
  /** The service's words for a decline, or null. */
  readonly failureMessage: string | null;
}
export const readerChargeStateSchema = z
  .object({
    ok: z.literal(true),
    ref: z.string().min(1).max(255),
    status: z.enum(READER_CHARGE_STATUSES),
    amount: decimalAmountSchema.nullable(),
    tip: decimalAmountSchema.nullable(),
    currency: currencyCodeSchema,
    paymentRef: z.string().min(1).max(255).nullable(),
    brand: z.string().max(40).nullable(),
    last4: z.string().regex(/^\d{4}$/).nullable(),
    approvalCode: z.string().max(32).nullable(),
    interac: z.boolean(),
    failureMessage: z.string().max(2000).nullable(),
  })
  .strict();

/** Disputes and refunds made at the service, by polling (a reader payment has no webhook). */
export interface TerminalEvents {
  readonly ok: true;
  readonly events: readonly PaymentEvent[];
  readonly cursor: string | null;
  readonly more: boolean;
}
export const terminalEventsSchema = z
  .object({ ok: z.literal(true), events: z.array(paymentEventSchema).max(500), cursor: z.string().max(1024).nullable(), more: z.boolean() })
  .strict();

/** One card-reader service. */
export interface CardTerminal {
  readonly key: string;
  readonly mode: PaymentMode;
  checkCredentials(): Promise<CredentialCheck | ProviderError>;
  listLocations(): Promise<ReaderLocations | ProviderError>;
  listReaders(locationId?: string | null): Promise<ReaderList | ProviderError>;
  startPairing(input: { label: string; locationId: string | null }): Promise<PairingStarted | ProviderError>;
  finishPairing(input: { pairing: string; code: string | null }): Promise<PairingFinished | ProviderError>;
  unpairReader(readerId: string): Promise<ReaderUnpaired | ProviderError>;
  /** Puts the amount on the reader. Sent again with the same key, it answers the same charge. */
  sendToReader(input: ReaderChargeInput): Promise<ReaderChargeState | ProviderError>;
  /** An unknown ref is `NOT_FOUND`, never a throw. */
  readerStatus(ref: string): Promise<ReaderChargeState | ProviderError>;
  /** Takes the amount off the reader. A card taken first answers `succeeded`: that is a payment. */
  cancelOnReader(ref: string): Promise<ReaderChargeState | ProviderError>;
  refund(input: RefundInput): Promise<RefundState | ProviderError>;
  refundStatus(ref: string): Promise<RefundState | ProviderError>;
  listEvents(cursor: string | null): Promise<TerminalEvents | ProviderError>;
  toMinor(amount: string, currency: string): MinorAmount | ProviderError;
  fromMinor(minor: string, currency: string): string | ProviderError;
}

export type CreateCardTerminal = (context: PaymentProviderContext) => CardTerminal;

/** The schema each answer must pass, by call. */
export const CARD_TERMINAL_ANSWER_SCHEMAS = {
  checkCredentials: credentialCheckSchema,
  listLocations: readerLocationsSchema,
  listReaders: readerListSchema,
  startPairing: pairingStartedSchema,
  finishPairing: pairingFinishedSchema,
  unpairReader: readerUnpairedSchema,
  sendToReader: readerChargeStateSchema,
  readerStatus: readerChargeStateSchema,
  cancelOnReader: readerChargeStateSchema,
  refund: refundStateSchema,
  refundStatus: refundStateSchema,
  listEvents: terminalEventsSchema,
} as const;

export type CardTerminalCall = keyof typeof CARD_TERMINAL_ANSWER_SCHEMAS;
