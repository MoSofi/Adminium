// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `card-terminal@1` conformance suite.
 *
 * Every card reader service runs it against itself: the demo reader in this
 * package, and each real one in its own add-on (against the service's
 * sandbox or simulated reader). A DRIVER plays the counter, because only the
 * service's own test tools can tap a card on a reader. A driver that cannot
 * do something leaves it out, and the cases that need it are skipped — by
 * name, so a skipped case is visible rather than passed.
 *
 * What it holds a service to:
 *   - every answer parses with the contract's schema, and a refusal is data;
 *   - an unknown charge is `NOT_FOUND`, never a throw;
 *   - the same idempotency key gives the same charge;
 *   - a card taken says what was taken (the tip apart), the card's last four
 *     and the payment's reference, and a refund of it is answered;
 *   - a cancel after the card was taken answers `succeeded`: a payment;
 *   - an amount is converted exactly or refused, never rounded;
 *   - no credential value appears in any answer.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { CARD_TERMINAL_ANSWER_SCHEMAS, type CardTerminal, type CardTerminalCall, type ReaderChargeState } from '../card-terminal.js';
import { sameAmount } from '../payment-money.js';
import { isProviderError, providerErrorSchema, type PaymentCredentials, type ProviderError } from '../payment-provider.js';

/** The counter, as far as this service's test tools reach. */
export interface CardTerminalConformanceDriver {
  /** A reader the suite may charge on, paired already (the service's own id). Required for every charge case. */
  readerId?: string;
  /** The customer taps a card that succeeds (with a tip, where the service tips) or is declined. */
  tap?(readerId: string, chargeRef: string, outcome: 'succeeds' | 'declined', tip?: string): Promise<void>;
  /** A reader where an amount stays until it is taken off (a sandbox's offline test reader); `readerId` when left out. */
  idleReaderId?: string;
  /** False when the service's test tools cannot decline a card: the decline case is skipped, by name. */
  declines?: boolean;
}

export interface CardTerminalConformanceOptions {
  name: string;
  /** Builds the service for one operation, as the engine does. */
  make: () => CardTerminal;
  credentials: PaymentCredentials;
  driver: CardTerminalConformanceDriver;
  /** An amount and currency the service takes on its readers. */
  amount: string;
  currency: string;
  /** Whether the service's readers take a tip on top (its driver's `tap` then passes one). */
  tips: boolean;
  /** How long to wait for a charge to settle after a tap, in ms (a sandbox answers in its own time). */
  settleMs?: number;
  /** Runs once before the cases: pairs or finds the reader the driver names. */
  before?: () => Promise<void>;
}

let sequence = 0;
function freshKey(label: string): string {
  sequence += 1;
  return `conformance-${label}-${Date.now().toString(36)}-${sequence}`;
}

function parsesAs(call: CardTerminalCall, answer: unknown): string[] {
  if (isProviderError(answer)) {
    const parsed = providerErrorSchema.safeParse(answer);
    return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  }
  const parsed = CARD_TERMINAL_ANSWER_SCHEMAS[call].safeParse(answer);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

function ok<T>(answer: T | ProviderError, what: string): T {
  if (isProviderError(answer)) throw new Error(`${what} was refused: ${answer.code} ${answer.providerMessage}`);
  return answer;
}

/** Registers the suite's tests for one card reader service. Call it inside a test file. */
export function cardTerminalConformance(options: CardTerminalConformanceOptions): void {
  const { driver } = options;
  const secrets = Object.values(options.credentials).filter((value) => value.length >= 6);
  const leaks = (answer: unknown): string[] => secrets.filter((secret) => JSON.stringify(answer).includes(secret)).map(() => 'a credential value appears in an answer');
  const canCharge = driver.readerId !== undefined;
  const canTap = canCharge && driver.tap !== undefined;
  const canDecline = canTap && driver.declines !== false;

  async function settled(ref: string, until: (state: ReaderChargeState) => boolean): Promise<ReaderChargeState> {
    const deadline = Date.now() + (options.settleMs ?? 5_000);
    for (;;) {
      const state = ok(await options.make().readerStatus(ref), 'readerStatus');
      if (until(state) || Date.now() > deadline) return state;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function sent(label: string): Promise<ReaderChargeState> {
    return ok(
      await options.make().sendToReader({ readerId: driver.readerId!, amount: options.amount, currency: options.currency, attemptId: freshKey(`attempt-${label}`), idempotencyKey: freshKey(label), tipping: options.tips }),
      'sendToReader',
    );
  }

  describe(`card-terminal@1 conformance: ${options.name}`, () => {
    if (options.before !== undefined) beforeAll(options.before, 120_000);
    it('answers the credentials, its locations and its readers in the contract shape', async () => {
      for (const [call, answer] of [
        ['checkCredentials', await options.make().checkCredentials()],
        ['listLocations', await options.make().listLocations()],
        ['listReaders', await options.make().listReaders(null)],
      ] as const) {
        expect(parsesAs(call, answer), call).toEqual([]);
        expect(leaks(answer)).toEqual([]);
      }
    });

    it('answers an unknown charge NOT_FOUND, never a throw', async () => {
      const answer = await options.make().readerStatus('nope_unknown_charge_ref');
      expect(isProviderError(answer) && answer.code).toBe('NOT_FOUND');
    });

    it.skipIf(!canCharge)('puts an amount on the reader once per key, and takes it off again', async () => {
      const key = freshKey('same');
      const input = { readerId: driver.idleReaderId ?? driver.readerId!, amount: options.amount, currency: options.currency, attemptId: freshKey('attempt-same'), idempotencyKey: key, tipping: options.tips };
      const first = await options.make().sendToReader(input);
      expect(parsesAs('sendToReader', first)).toEqual([]);
      const charge = ok(first, 'sendToReader');
      const again = ok(await options.make().sendToReader(input), 'sendToReader again');
      expect(again.ref).toBe(charge.ref);
      const cancelled = await options.make().cancelOnReader(charge.ref);
      expect(parsesAs('cancelOnReader', cancelled)).toEqual([]);
      const after = await settled(charge.ref, (state) => state.status === 'cancelled');
      expect(after.status).toBe('cancelled');
    });

    it.skipIf(!canTap)('says what a tapped card took, the tip apart, and refunds it', async () => {
      const charge = await sent('taken');
      const tip = options.tips ? '1.00' : undefined;
      await driver.tap!(driver.readerId!, charge.ref, 'succeeds', tip);
      const taken = await settled(charge.ref, (state) => state.status === 'succeeded');
      expect(parsesAs('readerStatus', taken)).toEqual([]);
      expect(taken.status).toBe('succeeded');
      expect(taken.paymentRef).not.toBeNull();
      expect(taken.last4).toMatch(/^\d{4}$/);
      expect(leaks(taken)).toEqual([]);
      if (tip !== undefined && taken.tip !== null && taken.tip !== '0' && taken.amount !== null) {
        expect(sameAmount(taken.tip, tip)).toBe(true);
      }
      // A cancel after the card was taken is a payment.
      expect(ok(await options.make().cancelOnReader(charge.ref), 'cancelOnReader').status).toBe('succeeded');
      const refund = await options.make().refund({ paymentRef: taken.paymentRef!, amount: options.amount, currency: options.currency, reason: 'requested_by_customer', idempotencyKey: freshKey('refund') });
      expect(parsesAs('refund', refund)).toEqual([]);
      const made = ok(refund, 'refund');
      expect(parsesAs('refundStatus', await options.make().refundStatus(made.ref))).toEqual([]);
    });

    it.skipIf(!canDecline)('says a declined card, and frees the reader', async () => {
      const charge = await sent('declined');
      await driver.tap!(driver.readerId!, charge.ref, 'declined');
      const declined = await settled(charge.ref, (state) => state.status === 'declined' || state.status === 'cancelled');
      expect(declined.status).toBe('declined');
      expect(ok(await options.make().cancelOnReader(charge.ref), 'cancelOnReader').status).not.toBe('succeeded');
    });

    it('converts an amount exactly, or refuses it', () => {
      const exact = options.make().toMinor(options.amount, options.currency);
      expect(isProviderError(exact)).toBe(false);
      if (!isProviderError(exact)) expect(sameAmount(String(options.make().fromMinor(exact.minor, options.currency)), options.amount)).toBe(true);
      expect(isProviderError(options.make().toMinor(`${options.amount}5`, options.currency))).toBe(true);
    });
  });
}
