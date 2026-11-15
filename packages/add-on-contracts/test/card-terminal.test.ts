// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `card-terminal@1` against its demo reader: every answer passes the
 * contract's own schemas; pairing runs in two steps; a charge sent twice with
 * one key is one charge; a card tapped before a cancel is a payment; a reader
 * off the network says so; a tip is taken on top of what was asked.
 */
import { describe, expect, it } from 'vitest';

import { CARD_TERMINAL_ANSWER_SCHEMAS, createDemoTerminalBackend, isProviderError, type CardTerminal, type ReaderChargeState } from '../src/index.js';
import { cardTerminalConformance, type CardTerminalConformanceDriver } from '../src/testing/index.js';

const parse = <K extends keyof typeof CARD_TERMINAL_ANSWER_SCHEMAS>(call: K, answer: unknown) => CARD_TERMINAL_ANSWER_SCHEMAS[call].parse(answer);

async function paired(terminal: CardTerminal, backend: ReturnType<typeof createDemoTerminalBackend>): Promise<string> {
  const started = parse('startPairing', await terminal.startPairing({ label: 'Front counter', locationId: 'loc_demo' }));
  expect(started).toMatchObject({ way: 'enter', code: null });
  // A wrong code is refused; the one on the reader pairs it.
  expect(isProviderError(await terminal.finishPairing({ pairing: started.pairing, code: '000000' }))).toBe(true);
  const finished = parse('finishPairing', await terminal.finishPairing({ pairing: started.pairing, code: backend.codeOn(started.pairing) }));
  if (finished.state !== 'paired') throw new Error('not paired');
  expect(finished.reader).toMatchObject({ label: 'Front counter', locationId: 'loc_demo', online: true });
  return finished.reader.id;
}

describe('the demo card reader', () => {
  it('pairs in two steps, and lists the reader under its location', async () => {
    const backend = createDemoTerminalBackend();
    const terminal = backend.terminal('test');
    const readerId = await paired(terminal, backend);
    expect(parse('listReaders', await terminal.listReaders('loc_demo')).readers.map((reader) => reader.id)).toEqual([readerId]);
    expect(parse('listLocations', await terminal.listLocations()).locations).toEqual([{ id: 'loc_demo', name: 'Demo shop' }]);
    parse('unpairReader', await terminal.unpairReader(readerId));
    expect(parse('listReaders', await terminal.listReaders()).readers).toEqual([]);
  });

  it('takes a card once per key, with the tip on top, and says the card', async () => {
    const backend = createDemoTerminalBackend();
    const terminal = backend.terminal('test');
    const readerId = await paired(terminal, backend);
    const input = { readerId, amount: '12.50', currency: 'EUR', attemptId: 'pat_1', idempotencyKey: 'pat_1:send', tipping: true };
    const sent = parse('sendToReader', await terminal.sendToReader(input));
    expect(sent.status).toBe('on_reader');
    // The same key again (a lost answer): the same charge, never a second.
    expect(parse('sendToReader', await terminal.sendToReader(input)).ref).toBe(sent.ref);
    expect(backend.chargesFor('pat_1:send')).toBe(1);
    // Another charge on a busy reader is refused.
    expect(await terminal.sendToReader({ ...input, attemptId: 'pat_2', idempotencyKey: 'pat_2:send' })).toMatchObject({ code: 'READER_BUSY', retryable: true });
    backend.tap(readerId, 'succeeds', '2.00');
    const taken = parse('readerStatus', await terminal.readerStatus(sent.ref)) as ReaderChargeState;
    expect(taken).toMatchObject({ status: 'succeeded', amount: '14.50', tip: '2.00', brand: 'Visa', last4: '4242', approvalCode: 'DEMO01', interac: false });
    expect(taken.paymentRef).not.toBeNull();
    // A cancel after the card was taken answers what happened: a payment.
    expect(parse('cancelOnReader', await terminal.cancelOnReader(sent.ref)).status).toBe('succeeded');
    const refund = parse('refund', await terminal.refund({ paymentRef: taken.paymentRef!, amount: '14.50', currency: 'EUR', reason: 'requested_by_customer', idempotencyKey: 'rk_1' }));
    expect(parse('refundStatus', await terminal.refundStatus(refund.ref)).status).toBe('succeeded');
  });

  it('cancels an amount still on the reader, says a decline, and an offline reader', async () => {
    const backend = createDemoTerminalBackend();
    const terminal = backend.terminal('test');
    const readerId = await paired(terminal, backend);
    const first = parse('sendToReader', await terminal.sendToReader({ readerId, amount: '5.00', currency: 'EUR', attemptId: 'pat_3', idempotencyKey: 'pat_3:send', tipping: false }));
    expect(parse('cancelOnReader', await terminal.cancelOnReader(first.ref)).status).toBe('cancelled');
    const second = parse('sendToReader', await terminal.sendToReader({ readerId, amount: '5.00', currency: 'EUR', attemptId: 'pat_4', idempotencyKey: 'pat_4:send', tipping: false }));
    backend.setOnline(readerId, false);
    expect(parse('readerStatus', await terminal.readerStatus(second.ref)).status).toBe('offline');
    backend.setOnline(readerId, true);
    backend.tap(readerId, 'declined');
    expect(parse('readerStatus', await terminal.readerStatus(second.ref))).toMatchObject({ status: 'declined', failureMessage: 'The card was declined.' });
    backend.setOnline(readerId, false);
    expect(await terminal.sendToReader({ readerId, amount: '5.00', currency: 'EUR', attemptId: 'pat_5', idempotencyKey: 'pat_5:send', tipping: false })).toMatchObject({ code: 'READER_OFFLINE' });
  });

  it('works in test mode only', async () => {
    const terminal = createDemoTerminalBackend().terminal('live');
    expect(await terminal.checkCredentials()).toMatchObject({ code: 'CREDENTIALS_REFUSED' });
    parse('checkCredentials', await createDemoTerminalBackend().terminal('test').checkCredentials());
  });
});

describe('the demo card reader against the conformance suite', () => {
  const backend = createDemoTerminalBackend();
  const make = () => backend.terminal('test');
  let readerId = '';
  // Paired once, before the suite's cases run.
  const pair = async (): Promise<void> => {
    const started = await make().startPairing({ label: 'Conformance', locationId: null });
    if (!('pairing' in started)) throw new Error('no pairing');
    const finished = await make().finishPairing({ pairing: started.pairing, code: backend.codeOn(started.pairing) });
    if (!('state' in finished) || finished.state !== 'paired') throw new Error('not paired');
    readerId = finished.reader.id;
  };
  const driver: CardTerminalConformanceDriver = {
    get readerId() {
      return readerId;
    },
    tap: async (reader, _ref, outcome, tip) => backend.tap(reader, outcome, tip),
  };
  cardTerminalConformance({ name: 'demo reader', make, credentials: {}, driver, amount: '12.50', currency: 'EUR', tips: true, before: pair });
});
