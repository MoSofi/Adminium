// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The demo card reader: `card-terminal@1` in process, for tests and demos.
 * Pretend money in test mode only. Its readers pair the way Stripe's do (the
 * reader shows a code; the person types it in), and a test drives what the
 * customer does at the counter: tap a card that succeeds or is declined, add
 * a tip, walk away, or the reader drops off the network.
 *
 * A charge sent twice with the same key is one charge; a cancel after the card
 * was taken answers `succeeded`; a reader that goes offline answers `offline`
 * until it comes back.
 */
import type { CredentialCheck, PaymentMode, ProviderError, RefundInput, RefundState } from './payment-provider.js';
import { decimalToMinor, isoExponent, minorToDecimal } from './payment-money.js';
import { providerError } from './payment-provider.js';
import type { CardTerminal, PairingFinished, PairingStarted, Reader, ReaderChargeInput, ReaderChargeState, ReaderList, ReaderLocations, ReaderUnpaired, TerminalEvents } from './card-terminal.js';

export const DEMO_TERMINAL_KEY = 'demo-reader';

/** What happens at the counter. */
export const DEMO_TAPS = ['succeeds', 'declined'] as const;
export type DemoTap = (typeof DEMO_TAPS)[number];

interface DemoCharge {
  ref: string;
  key: string;
  attemptId: string;
  readerId: string;
  amount: string;
  currency: string;
  state: ReaderChargeState['status'];
  tip: string;
  paymentRef: string | null;
  refunded: string;
}

export interface DemoTerminalBackend {
  /** The card the customer taps: `succeeds` (with a tip, when given) or `declined`. */
  tap(readerId: string, card: DemoTap, tip?: string): void;
  /** The reader drops off the network, or comes back. */
  setOnline(readerId: string, online: boolean): void;
  /** The code a reader shows while pairing (what the person types in Studio). */
  codeOn(pairing: string): string | null;
  /** A charge by its ref, for a test. */
  charge(ref: string): Readonly<DemoCharge> | null;
  /** How many charges were made for a key (sent twice with one key: still one). */
  chargesFor(key: string): number;
  terminal(mode: PaymentMode): CardTerminal;
}

let counter = 0;
const id = (prefix: string): string => `${prefix}_${(++counter).toString(36).padStart(6, '0')}${Math.random().toString(36).slice(2, 8)}`;

function addDecimal(a: string, b: string): string {
  const scale = Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length, 2);
  const factor = 10 ** scale;
  return (Math.round(Number(a) * factor + Number(b) * factor) / factor).toFixed(scale);
}

export function createDemoTerminalBackend(): DemoTerminalBackend {
  const readers = new Map<string, Reader>();
  const pairings = new Map<string, { code: string; label: string; locationId: string | null; expiresAt: number }>();
  const charges = new Map<string, DemoCharge>();
  const byKey = new Map<string, string>();
  const refunds = new Map<string, RefundState>();

  const stateOf = (charge: DemoCharge): ReaderChargeState => {
    const online = readers.get(charge.readerId)?.online ?? false;
    const status = !online && (charge.state === 'waiting' || charge.state === 'on_reader') ? 'offline' : charge.state;
    const taken = status === 'succeeded';
    return {
      ok: true,
      ref: charge.ref,
      status,
      amount: taken ? addDecimal(charge.amount, charge.tip) : null,
      tip: taken ? charge.tip : null,
      currency: charge.currency,
      paymentRef: charge.paymentRef,
      brand: taken ? 'Visa' : null,
      last4: taken ? '4242' : null,
      approvalCode: taken ? 'DEMO01' : null,
      interac: false,
      failureMessage: status === 'declined' ? 'The card was declined.' : null,
    };
  };

  const terminal = (mode: PaymentMode): CardTerminal => {
    const testOnly = (): ProviderError | null => (mode === 'test' ? null : providerError('CREDENTIALS_REFUSED', 'The demo card reader works in test mode only.'));
    return {
      key: DEMO_TERMINAL_KEY,
      mode,
      async checkCredentials(): Promise<CredentialCheck | ProviderError> {
        return testOnly() ?? { ok: true, accountId: 'demo_terminal', livemode: false, missing: [] };
      },
      async listLocations(): Promise<ReaderLocations | ProviderError> {
        return testOnly() ?? { ok: true, locations: [{ id: 'loc_demo', name: 'Demo shop' }] };
      },
      async listReaders(locationId?: string | null): Promise<ReaderList | ProviderError> {
        return testOnly() ?? { ok: true, readers: [...readers.values()].filter((reader) => locationId == null || reader.locationId === locationId) };
      },
      async startPairing(input): Promise<PairingStarted | ProviderError> {
        const refused = testOnly();
        if (refused !== null) return refused;
        const pairing = id('pair');
        const code = String(100_000 + Math.floor(Math.random() * 900_000));
        const expiresAt = Date.now() + 10 * 60_000;
        pairings.set(pairing, { code, label: input.label, locationId: input.locationId, expiresAt });
        return { ok: true, way: 'enter', code: null, pairing, expiresAt };
      },
      async finishPairing(input): Promise<PairingFinished | ProviderError> {
        const held = pairings.get(input.pairing);
        if (held === undefined || held.expiresAt < Date.now()) return providerError('NOT_FOUND', 'This pairing has ended. Start again.');
        if (input.code !== held.code) return providerError('INVALID_REQUEST', 'That is not the code on the reader.');
        pairings.delete(input.pairing);
        const reader: Reader = { id: id('tmr'), label: held.label, locationId: held.locationId, model: 'Demo reader', online: true, lastSeenAt: Date.now() };
        readers.set(reader.id, reader);
        return { ok: true, state: 'paired', reader };
      },
      async unpairReader(readerId): Promise<ReaderUnpaired | ProviderError> {
        if (!readers.delete(readerId)) return providerError('NOT_FOUND', 'No such reader.');
        return { ok: true };
      },
      async sendToReader(input: ReaderChargeInput): Promise<ReaderChargeState | ProviderError> {
        const refused = testOnly();
        if (refused !== null) return refused;
        const known = byKey.get(input.idempotencyKey);
        if (known !== undefined) return stateOf(charges.get(known)!);
        const reader = readers.get(input.readerId);
        if (reader === undefined) return providerError('NOT_FOUND', 'No such reader.');
        if (!reader.online) return providerError('READER_OFFLINE', 'The reader is offline.', true);
        if ([...charges.values()].some((one) => one.readerId === input.readerId && (one.state === 'waiting' || one.state === 'on_reader'))) {
          return providerError('READER_BUSY', 'The reader is taking another payment.', true);
        }
        const charge: DemoCharge = { ref: id('tmc'), key: input.idempotencyKey, attemptId: input.attemptId, readerId: input.readerId, amount: input.amount, currency: input.currency, state: 'on_reader', tip: '0', paymentRef: null, refunded: '0' };
        charges.set(charge.ref, charge);
        byKey.set(input.idempotencyKey, charge.ref);
        return stateOf(charge);
      },
      async readerStatus(ref): Promise<ReaderChargeState | ProviderError> {
        const charge = charges.get(ref);
        return charge === undefined ? providerError('NOT_FOUND', 'No such charge.') : stateOf(charge);
      },
      async cancelOnReader(ref): Promise<ReaderChargeState | ProviderError> {
        const charge = charges.get(ref);
        if (charge === undefined) return providerError('NOT_FOUND', 'No such charge.');
        // A reader off the network cannot be told: the amount stays on it until it comes back.
        if (!(readers.get(charge.readerId)?.online ?? false) && (charge.state === 'waiting' || charge.state === 'on_reader')) {
          return providerError('READER_OFFLINE', 'The reader is offline.', true);
        }
        // A card taken a moment before the cancel is a payment: answered as it stands.
        if (charge.state === 'waiting' || charge.state === 'on_reader') charge.state = 'cancelled';
        return stateOf(charge);
      },
      async refund(input: RefundInput): Promise<RefundState | ProviderError> {
        const charge = [...charges.values()].find((one) => one.paymentRef === input.paymentRef);
        if (charge === undefined) return providerError('NOT_FOUND', 'No such payment.');
        const known = refunds.get(input.idempotencyKey);
        if (known !== undefined) return known;
        const state: RefundState = { ok: true, ref: id('tmrf'), paymentRef: input.paymentRef, status: 'succeeded', amount: input.amount, currency: input.currency, failureMessage: null };
        charge.refunded = addDecimal(charge.refunded, input.amount);
        refunds.set(input.idempotencyKey, state);
        refunds.set(state.ref, state);
        return state;
      },
      async refundStatus(ref): Promise<RefundState | ProviderError> {
        return refunds.get(ref) ?? providerError('NOT_FOUND', 'No such refund.');
      },
      async listEvents(): Promise<TerminalEvents | ProviderError> {
        return { ok: true, events: [], cursor: null, more: false };
      },
      toMinor(amount, currency) {
        // Exact in the currency's own decimals, or refused: never rounded.
        const exponent = isoExponent(currency);
        const minor = exponent === null ? null : decimalToMinor(amount, exponent);
        return minor === null ? providerError('AMOUNT_UNREPRESENTABLE', `${amount} ${currency} cannot be taken exactly.`) : { minor, currency };
      },
      fromMinor(minor, currency) {
        const exponent = isoExponent(currency);
        const amount = exponent === null ? null : minorToDecimal(minor, exponent);
        return amount ?? providerError('AMOUNT_UNREPRESENTABLE', `${minor} cannot be read in ${currency}.`);
      },
    };
  };

  return {
    tap(readerId, card, tip = '0') {
      const charge = [...charges.values()].find((one) => one.readerId === readerId && one.state === 'on_reader');
      if (charge === undefined) throw new Error(`The demo reader ${readerId} has no amount on it.`);
      if (card === 'declined') charge.state = 'declined';
      else {
        charge.state = 'succeeded';
        charge.tip = tip;
        charge.paymentRef = id('tmp');
      }
    },
    setOnline(readerId, online) {
      const reader = readers.get(readerId);
      if (reader !== undefined) readers.set(readerId, { ...reader, online, lastSeenAt: online ? Date.now() : reader.lastSeenAt });
    },
    codeOn(pairing) {
      return pairings.get(pairing)?.code ?? null;
    },
    charge(ref) {
      return charges.get(ref) ?? null;
    },
    chargesFor(key) {
      return byKey.has(key) ? 1 : 0;
    },
    terminal,
  };
}
