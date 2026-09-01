// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Conformance suites — part of the contract, not a courtesy (24 §5.5, D9).
 *
 * Every provider implementation runs the suite for the contract it claims, in
 * its own repo, against its own transport. The claim "the next carrier is a
 * copy of this one" rests entirely on `describeShippingCarrier` existing and
 * passing against both the demo and the real transport; without it the claim is
 * an assertion in a document.
 *
 * This is the ONLY entry point in the package that may import vitest — the
 * types-and-validators half stays free of test and `node:` imports so the
 * storefront, the SPAs and Electron can all use it (01 §3).
 */

import { describe, expect, it } from 'vitest';

import { artworkRefSchema, type ArtworkSource, type JobSpec } from '../artwork-source.js';
import {
  personalizationSchema,
  type Personalization,
  type ProductPersonalizer,
  type ProductRef,
  type Template,
} from '../product-personalizer.js';
import {
  CarrierError,
  rateSchema,
  shipmentSchema,
  trackEventSchema,
  type Address,
  type OrderRef,
  type Parcel,
  type ShippingCarrier,
} from '../shipping-carrier.js';

// ── artwork-source@1 ─────────────────────────────────────────────────────────

export interface ArtworkSourceFixtures {
  /** A job the source can serve. */
  job: JobSpec;
  /** A job it cannot — it must decline WITH A REASON rather than throw. */
  unavailableJob?: JobSpec;
  /**
   * Drives `start()` to its cancel path. Implementations that cannot be
   * cancelled headlessly may omit it; the cancel assertion is then skipped.
   */
  cancel?: () => void;
}

export function describeArtworkSource(
  impl: ArtworkSource,
  fixtures: ArtworkSourceFixtures,
): void {
  describe(`artwork-source@1 conformance — ${impl.key}`, () => {
    it('has a non-empty key', () => {
      expect(impl.key).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it('labels itself for a job without throwing', () => {
      const label = impl.label(fixtures.job);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    });

    it('reports availability as data, never as an exception', () => {
      const verdict = impl.available(fixtures.job);
      expect(verdict.ok).toBe(true);
    });

    it('declines an unservable job WITH a reason', () => {
      if (fixtures.unavailableJob === undefined) return;
      const verdict = impl.available(fixtures.unavailableJob);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason.trim().length).toBeGreaterThan(0);
    });

    it('returns an ArtworkRef whose shape the host can check', async () => {
      const ref = await impl.start(fixtures.job);
      expect(ref).not.toBeNull();
      const parsed = artworkRefSchema.safeParse(ref);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it('stamps the ref with its own key, so the host can trace the source', async () => {
      const ref = await impl.start(fixtures.job);
      expect(ref?.source).toBe(impl.key);
    });

    it('resolves to null when the customer backs out', async () => {
      if (fixtures.cancel === undefined) return;
      const pending = impl.start(fixtures.job);
      fixtures.cancel();
      await expect(pending).resolves.toBeNull();
    });
  });
}

// ── shipping-carrier@1 ───────────────────────────────────────────────────────

export interface ShippingCarrierFixtures {
  parcel: Parcel;
  from: Address;
  to: Address;
  /** An address the carrier refuses — the failure path must be demonstrable. */
  rejectedTo: Address;
  order: OrderRef;
}

export function describeShippingCarrier(
  impl: ShippingCarrier,
  fixtures: ShippingCarrierFixtures,
): void {
  describe(`shipping-carrier@1 conformance — ${impl.key}`, () => {
    it('has a non-empty key', () => {
      expect(impl.key).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it('quotes at least one rate, each of the declared shape', async () => {
      const rates = await impl.quote(fixtures.parcel, fixtures.from, fixtures.to);
      expect(rates.length).toBeGreaterThan(0);
      for (const rate of rates) {
        const parsed = rateSchema.safeParse(rate);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      }
    });

    it('quote is side-effect free — the same call twice gives the same rates', async () => {
      const a = await impl.quote(fixtures.parcel, fixtures.from, fixtures.to);
      const b = await impl.quote(fixtures.parcel, fixtures.from, fixtures.to);
      expect(b).toEqual(a);
    });

    it('surfaces a refusal as a typed CarrierError carrying the carrier’s own message', async () => {
      await expect(
        impl.quote(fixtures.parcel, fixtures.from, fixtures.rejectedTo),
      ).rejects.toBeInstanceOf(CarrierError);

      try {
        await impl.quote(fixtures.parcel, fixtures.from, fixtures.rejectedTo);
        expect.unreachable('the rejected address should not have quoted');
      } catch (err) {
        expect(err).toBeInstanceOf(CarrierError);
        const carrier = err as CarrierError;
        expect(carrier.carrierMessage.trim().length).toBeGreaterThan(0);
        expect(carrier.code.trim().length).toBeGreaterThan(0);
      }
    });

    /*
     * ── THE INBOUND DIRECTION (31 O4, ruled 2026-09-01) ─────────────────────
     *
     * The contract is direction-agnostic and these two cases are what that
     * sentence means executably. A RETURN — a customer sending a parcel back to
     * the business — is the same contract with the route reversed: `quote(parcel,
     * from, to)` takes two addresses and has no opinion about which one is the
     * shop; `book` buys a prepaid label the SENDER applies, whoever the sender
     * is; `track` follows the parcel toward whoever is receiving it. No member
     * changes shape, which is why this is a conformance amendment and not a
     * version bump.
     *
     * The refusal is symmetric too, and that is a rule rather than a
     * convenience: a label must carry a resolvable address at BOTH ends, so a
     * carrier that would refuse an address as a recipient refuses it as a
     * sender. The case reuses `rejectedTo` deliberately — the fixture is "an
     * address the carrier refuses", and which end it sits at is not part of
     * what makes it refusable.
     */
    it('quote is direction-symmetric — the same route reversed still quotes', async () => {
      const rates = await impl.quote(fixtures.parcel, fixtures.to, fixtures.from);
      expect(rates.length).toBeGreaterThan(0);
      for (const rate of rates) {
        const parsed = rateSchema.safeParse(rate);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      }
    });

    it('refuses an unserviceable sender exactly as it refuses a recipient', async () => {
      await expect(
        impl.quote(fixtures.parcel, fixtures.rejectedTo, fixtures.to),
      ).rejects.toBeInstanceOf(CarrierError);
    });

    it('books a shipment of the declared shape', async () => {
      const [rate] = await impl.quote(fixtures.parcel, fixtures.from, fixtures.to);
      expect(rate).toBeDefined();
      const shipment = await impl.book(rate!, fixtures.order);
      const parsed = shipmentSchema.safeParse(shipment);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it('book is idempotent for one OrderRef', async () => {
      const [rate] = await impl.quote(fixtures.parcel, fixtures.from, fixtures.to);
      const first = await impl.book(rate!, fixtures.order);
      const second = await impl.book(rate!, fixtures.order);
      expect(second.id).toBe(first.id);
      expect(second.tracking).toBe(first.tracking);
    });

    it('tracks a booked shipment with events of the declared shape', async () => {
      const [rate] = await impl.quote(fixtures.parcel, fixtures.from, fixtures.to);
      const shipment = await impl.book(rate!, fixtures.order);
      const events = await impl.track(shipment.tracking);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        const parsed = trackEventSchema.safeParse(event);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      }
    });

    it('returns empty rather than throwing for an unknown tracking reference', async () => {
      await expect(impl.track('no-such-reference-0000')).resolves.toEqual([]);
    });

    it('produces a label file for a booked shipment', async () => {
      const [rate] = await impl.quote(fixtures.parcel, fixtures.from, fixtures.to);
      const shipment = await impl.book(rate!, fixtures.order);
      const file = await impl.label(shipment.id);
      expect(file.fileId.length).toBeGreaterThan(0);
      expect(file.bytes).toBeGreaterThan(0);
    });

    it('cancels a booked shipment without throwing', async () => {
      const [rate] = await impl.quote(fixtures.parcel, fixtures.from, fixtures.to);
      const shipment = await impl.book(rate!, fixtures.order);
      await expect(impl.cancel(shipment.id)).resolves.toBeUndefined();
    });
  });
}

// ── product-personalizer@1 ───────────────────────────────────────────────────

export interface ProductPersonalizerFixtures {
  product: ProductRef;
  template: Template;
  /** Values that fit every zone. */
  valid: Personalization;
  /** Values that overrun at least one zone — must yield a numbered remedy. */
  overrun: Personalization;
  angle: string;
}

export function describeProductPersonalizer(
  impl: ProductPersonalizer,
  fixtures: ProductPersonalizerFixtures,
): void {
  describe(`product-personalizer@1 conformance — ${impl.key}`, () => {
    it('has a non-empty key', () => {
      expect(impl.key).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    it('reports availability as data', () => {
      expect(impl.available(fixtures.product).ok).toBe(true);
    });

    it('accepts a personalization of the declared shape', () => {
      const parsed = personalizationSchema.safeParse(fixtures.valid);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it('passes every zone for values that fit', () => {
      const verdicts = impl.validate(fixtures.valid, fixtures.template);
      expect(verdicts.every((v) => v.ok)).toBe(true);
    });

    it('every failing verdict carries at least one remedy WITH a number', () => {
      const verdicts = impl.validate(fixtures.overrun, fixtures.template);
      const failures = verdicts.filter((v) => !v.ok);
      expect(failures.length).toBeGreaterThan(0);
      for (const failure of failures) {
        if (failure.ok) continue;
        expect(failure.reason.trim().length).toBeGreaterThan(0);
        const { setSizeMm, shortenToChars } = failure.remedies;
        expect(
          typeof setSizeMm === 'number' || typeof shortenToChars === 'number',
        ).toBe(true);
      }
    });

    it('render is deterministic — same values and angle give the same picture', async () => {
      const a = await impl.render(fixtures.valid, { angle: fixtures.angle, widthPx: 480 });
      const b = await impl.render(fixtures.valid, { angle: fixtures.angle, widthPx: 480 });
      expect(b.digest).toBe(a.digest);
      expect(b.fileId).toBe(a.fileId);
    });

    it('render distinguishes different values', async () => {
      const a = await impl.render(fixtures.valid, { angle: fixtures.angle, widthPx: 480 });
      const b = await impl.render(fixtures.overrun, { angle: fixtures.angle, widthPx: 480 });
      expect(b.digest).not.toBe(a.digest);
    });

    it('the production file carries outlines, never a font reference', async () => {
      const file = await impl.productionFile(fixtures.valid);
      expect(file.bytes).toBeGreaterThan(0);
      expect(file.filename).not.toMatch(/\.(ttf|otf|woff2?)$/i);
    });
  });
}
