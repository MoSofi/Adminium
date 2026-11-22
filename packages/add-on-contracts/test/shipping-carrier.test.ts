// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  BOOK_OUTCOME_UNKNOWN,
  CARRIER_REFUSALS,
  CarrierError,
  addressSchema,
  cancelResultSchema,
  carrierCredentialCheckSchema,
  classifyBookFailure,
  customsDeclarationSchema,
  orderRefSchema,
  rateSchema,
  recoveryResultSchema,
  shipmentDocumentFileSchema,
  shipmentSchema,
  trackEventSchema,
  type CustomsDeclaration,
  type Rate,
  type Shipment,
} from '../src/index.js';
import { ReferencePurchaseCarrier } from './reference-impls.js';

const RELEASED_RATE: Rate = {
  code: 'exp',
  service: 'Express',
  amount: 12.4,
  currency: 'GBP',
  estimatedDelivery: '2026-08-20',
};

const RELEASED_SHIPMENT: Shipment = {
  id: 'SHP-1',
  tracking: '00340012345678901',
  labelFileId: 'file-1',
  collectionFrom: '2026-08-18T09:00:00Z',
  collectionTo: '2026-08-18T17:00:00Z',
  rate: RELEASED_RATE,
};

const CUSTOMS: CustomsDeclaration = {
  contents: 'merchandise',
  signer: 'Ada Marlow',
  certified: true,
  nonDelivery: 'return',
  items: [
    {
      description: 'Printed cotton tote bag',
      quantity: 2,
      unitValue: '32.00',
      currency: 'GBP',
      unitWeightKg: 0.2,
      originCountry: 'GB',
      hsCode: '420222',
      skuCode: 'TOTE-01',
      manufacturerCode: 'GBMARPRE1LON',
    },
  ],
};

describe('classifyBookFailure: only a clear no proves nothing was bought', () => {
  it.each([
    ['a timeout', new Error('The operation was aborted')],
    ['a thrown string', 'socket hang up'],
    ['nothing at all', undefined],
    ['a null', null],
  ])('reads %s as unknown and repeats none of its words', (_name, thrown) => {
    expect(classifyBookFailure(thrown)).toEqual({
      outcome: 'unknown',
      code: BOOK_OUTCOME_UNKNOWN,
      retryable: false,
    });
  });

  it('reads a carrier error that does not say as unknown, even when it calls itself retryable', () => {
    const failure = classifyBookFailure(
      new CarrierError({ code: 'UPSTREAM_500', carrierMessage: 'Internal error', retryable: true }),
    );
    expect(failure).toEqual({
      outcome: 'unknown',
      code: 'UPSTREAM_500',
      carrierMessage: 'Internal error',
      retryable: false,
    });
  });

  it('keeps unknown when the carrier error says unknown', () => {
    const err = new CarrierError({ code: 'TIMEOUT', carrierMessage: 'No answer', outcome: 'unknown' });
    expect(classifyBookFailure(err).outcome).toBe('unknown');
    expect(classifyBookFailure(err).retryable).toBe(false);
  });

  it('takes an explicit refusal at its word, with what it was about', () => {
    const err = new CarrierError({
      code: 'ADDRESS_INVALID',
      carrierMessage: 'Postcode unknown.',
      retryable: false,
      outcome: 'refused',
      reason: 'address',
    });
    expect(classifyBookFailure(err)).toEqual({
      outcome: 'refused',
      code: 'ADDRESS_INVALID',
      carrierMessage: 'Postcode unknown.',
      reason: 'address',
      retryable: false,
    });
  });

  it('recognises a refusal from another bundle by its shape', () => {
    class CarrierErrorFromABundle extends Error {
      override readonly name = 'CarrierError';
      readonly code = 'PAYMENT_REQUIRED';
      readonly carrierMessage = 'Add a payment method.';
      readonly retryable = true;
      readonly outcome = 'refused';
      readonly reason = 'payment';
    }
    const thrown = new CarrierErrorFromABundle();
    expect(thrown).not.toBeInstanceOf(CarrierError);
    expect(classifyBookFailure(thrown)).toMatchObject({ outcome: 'refused', reason: 'payment', retryable: true });
  });

  it('does not trust a look-alike with no carrier fields', () => {
    expect(classifyBookFailure({ name: 'CarrierError', outcome: 'refused' }).outcome).toBe('unknown');
  });

  it('drops a reason outside the list instead of showing the wrong card', () => {
    const failure = classifyBookFailure({
      name: 'CarrierError',
      code: 'X',
      carrierMessage: 'No.',
      outcome: 'refused',
      reason: 'made-up',
    });
    expect(failure.outcome).toBe('refused');
    expect(failure).not.toHaveProperty('reason');
  });

  it('names the six refusals the booking screen has a card for', () => {
    expect(CARRIER_REFUSALS).toEqual(['address', 'customs', 'payment', 'credentials', 'rate-expired', 'unavailable']);
  });
});

describe('CarrierError stays compatible', () => {
  it('leaves outcome and reason unset when a released transport does not pass them', () => {
    const err = new CarrierError({ code: 'X', carrierMessage: 'No.' });
    expect(err.outcome).toBeUndefined();
    expect(err.reason).toBeUndefined();
  });
});

describe('the validators', () => {
  it('still accepts what a released transport answers', () => {
    expect(rateSchema.safeParse(RELEASED_RATE).success).toBe(true);
    expect(shipmentSchema.safeParse(RELEASED_SHIPMENT).success).toBe(true);
    expect(
      trackEventSchema.safeParse({ at: '2026-08-18', place: 'Leeds', status: 'in-transit', description: 'Sorted' })
        .success,
    ).toBe(true);
  });

  it('accepts a real carrier that states no arrival, window or place', () => {
    const { estimatedDelivery: _date, ...rate } = RELEASED_RATE;
    const { collectionFrom: _from, collectionTo: _to, ...shipment } = RELEASED_SHIPMENT;
    expect(rateSchema.safeParse(rate).success).toBe(true);
    expect(shipmentSchema.safeParse({ ...shipment, rate }).success).toBe(true);
    expect(trackEventSchema.safeParse({ at: '2026-08-18', status: 'unknown', description: 'Scanned' }).success).toBe(
      true,
    );
  });

  it('refuses half a collection window', () => {
    const { collectionTo: _to, ...half } = RELEASED_SHIPMENT;
    expect(shipmentSchema.safeParse(half).success).toBe(false);
  });

  it('carries the address fields a carrier needs, and still refuses an unknown one', () => {
    const address = { name: 'Ines Duarte', lines: ['558 Spruce St'], city: 'Denver', postcode: '80205', country: 'US' };
    expect(
      addressSchema.safeParse({
        ...address,
        region: 'CO',
        company: 'Northline',
        phone: '+13035550100',
        email: 'ines@example.test',
      }).success,
    ).toBe(true);
    expect(addressSchema.safeParse({ ...address, fax: '123' }).success).toBe(false);
  });

  it('keeps money as an exact decimal string', () => {
    expect(rateSchema.safeParse({ ...RELEASED_RATE, amountDecimal: '12.40' }).success).toBe(true);
    for (const bad of ['12,40', '-1.00', '1e3', '£12.40', '']) {
      expect(rateSchema.safeParse({ ...RELEASED_RATE, amountDecimal: bad }).success, bad).toBe(false);
    }
  });

  it('refuses a handover word outside the list', () => {
    expect(rateSchema.safeParse({ ...RELEASED_RATE, handover: 'carrier-collects' }).success).toBe(true);
    expect(rateSchema.safeParse({ ...RELEASED_RATE, handover: 'van' }).success).toBe(false);
  });

  it('only keeps an https tracking page', () => {
    const page = 'https://track.example.test/1';
    expect(shipmentSchema.safeParse({ ...RELEASED_SHIPMENT, trackingUrl: page }).success).toBe(true);
    for (const bad of ['http://track.example.test/1', 'javascript:alert(1)']) {
      expect(shipmentSchema.safeParse({ ...RELEASED_SHIPMENT, trackingUrl: bad }).success, bad).toBe(false);
    }
  });

  it('keeps a document list free of download addresses', () => {
    const documents = [{ kind: 'label', url: 'https://deliver.example.test/signed' }];
    expect(shipmentSchema.safeParse({ ...RELEASED_SHIPMENT, documents }).success).toBe(false);
  });

  it('refuses an empty document file', () => {
    const file = { kind: 'label', mediaType: 'application/pdf', bytes: new Uint8Array() };
    expect(shipmentDocumentFileSchema.safeParse(file).success).toBe(false);
  });

  it('takes an order reference with a purpose and a parcel number from 1', () => {
    expect(orderRefSchema.safeParse({ reference: 'NL-1059', purpose: 'return', parcel: 2 }).success).toBe(true);
    expect(orderRefSchema.safeParse({ reference: 'NL-1059', parcel: 0 }).success).toBe(false);
  });

  it('carries the EU customs codes', () => {
    expect(customsDeclarationSchema.safeParse(CUSTOMS).success).toBe(true);
  });

  it('cannot express a customs declaration nobody confirmed', () => {
    expect(customsDeclarationSchema.safeParse({ ...CUSTOMS, certified: false }).success).toBe(false);
    const { certified: _certified, ...unsigned } = CUSTOMS;
    expect(customsDeclarationSchema.safeParse(unsigned).success).toBe(false);
  });

  it('refuses customs with no items, a float value or a country name', () => {
    const [item] = CUSTOMS.items;
    for (const bad of [
      { ...CUSTOMS, items: [] },
      { ...CUSTOMS, items: [{ ...item, unitValue: 32 }] },
      { ...CUSTOMS, items: [{ ...item, originCountry: 'United Kingdom' }] },
      { ...CUSTOMS, items: [{ ...item, quantity: 1.5 }] },
    ]) {
      expect(customsDeclarationSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('has a state for every step of a refund', () => {
    for (const state of ['requested', 'pending', 'refunded', 'refused']) {
      expect(cancelResultSchema.safeParse({ state }).success, state).toBe(true);
    }
    expect(cancelResultSchema.safeParse({ state: 'cancelled' }).success).toBe(false);
  });

  it('reads a credential check that finds no carriers as a real answer', () => {
    expect(carrierCredentialCheckSchema.safeParse({ outcome: 'ok', mode: 'live', carriers: [] }).success).toBe(true);
    expect(carrierCredentialCheckSchema.safeParse({ outcome: 'ok', carriers: [] }).success).toBe(false);
  });

  it('will not call a look-up found without a valid shipment', () => {
    expect(recoveryResultSchema.safeParse({ outcome: 'found', shipment: RELEASED_SHIPMENT }).success).toBe(true);
    expect(recoveryResultSchema.safeParse({ outcome: 'found' }).success).toBe(false);
    expect(recoveryResultSchema.safeParse({ outcome: 'found', shipment: { id: 'x' } }).success).toBe(false);
  });
});

describe('a real-shaped carrier', () => {
  it('really does buy twice, which is why the booking ledger must stop it', async () => {
    const carrier = new ReferencePurchaseCarrier();
    const address = { name: 'A', lines: ['1 St'], city: 'Berlin', postcode: '10115', country: 'DE' };
    const parcel = { weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, contents: 'Books' };
    const [rate] = await carrier.quote(parcel, address, address);
    const first = await carrier.book(rate!);
    const second = await carrier.book(rate!);
    expect(second.tracking).not.toBe(first.tracking);
  });
});
