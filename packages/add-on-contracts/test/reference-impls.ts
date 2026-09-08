// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reference implementations of the three wave-4 contracts, and the fixtures
 * that drive them.
 *
 * These exist so `@adminium/add-on-contracts/testing` is EXECUTED somewhere.
 * The conformance suites are the load-bearing half of the "the next carrier is
 * this repo with one file replaced" claim (24 §5.5, D9), and until now nothing
 * in this repo ever ran them: `ab6314e` added two cases to
 * `describeShippingCarrier` that no test anywhere had executed. A suite that is
 * only ever run in fleet repos is a suite whose own bugs surface fifteen repos
 * away from the commit that wrote them.
 *
 * They are REFERENCE implementations, not stubs shaped to the assertions. Each
 * one earns its passes honestly:
 *
 *   - `quote` is a pure function of parcel and route, so "side-effect free" is
 *     a property of the code rather than of a recorded answer;
 *   - `book` is idempotent because it keys a map on `OrderRef.reference`, which
 *     is the mechanism a real carrier integration uses;
 *   - `render` digests its inputs, so determinism and value-sensitivity are the
 *     same one line rather than two hardcoded returns.
 *
 * That distinction is the whole point. A stub that returns `[rate]` twice
 * proves nothing about the contract; one that would BREAK if the contract were
 * self-contradictory is a canary for the next amendment.
 */

import {
  CarrierError,
  type Address,
  type ArtworkRef,
  type ArtworkSource,
  type AvailabilityVerdict,
  type FileRef,
  type JobSpec,
  type OrderRef,
  type Parcel,
  type Personalization,
  type PreviewRef,
  type ProductPersonalizer,
  type ProductRef,
  type Rate,
  type Shipment,
  type ShippingCarrier,
  type Template,
  type TrackEvent,
  type Verdict,
} from '../src/index.js';

/**
 * A fixed day, not `Date.now()`. `quote` is asserted to be side-effect free by
 * calling it twice and comparing — with a live clock that assertion passes
 * every day of the year except across a midnight boundary, which is the worst
 * kind of flake because it is the kind CI finds and a dev box never does
 * (15-quality.md §1, "Determinism").
 */
const BASE_DAY_UTC = Date.UTC(2026, 0, 5);
const DAY_MS = 86_400_000;

function isoDatePlus(days: number): string {
  return new Date(BASE_DAY_UTC + days * DAY_MS).toISOString().slice(0, 10);
}

function isoTimePlus(hours: number): string {
  return new Date(BASE_DAY_UTC + hours * 3_600_000).toISOString();
}

/**
 * FNV-1a. A hand-rolled hash rather than `node:crypto` so this file stays as
 * portable as the half of the package that forbids `node:` imports (01 §3) — an
 * add-on author copying it as a starting point should not inherit a Node
 * dependency the storefront cannot load.
 */
function digestOf(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// -- artwork-source@1 --------------------------------------------------------

interface PendingStart {
  cancelled: boolean;
}

/**
 * A source that opens an editor, returns artwork built at the finished size
 * with the bleed already on it, and resolves to null if the customer closes it.
 */
export class ReferenceArtworkSource implements ArtworkSource {
  readonly key: string;

  readonly #pending = new Set<PendingStart>();
  #issued = 0;

  /**
   * The key is a parameter only so the same source can be registered twice
   * under distinct names — the suite titles itself with `impl.key`, and two
   * runs sharing a title are two runs nobody can tell apart in the output.
   */
  constructor(key = 'reference-source') {
    this.key = key;
  }

  label(job: JobSpec): string {
    return `Design your ${job.productLabel} here`;
  }

  available(job: JobSpec): AvailabilityVerdict {
    /*
     * A real refusal, not a flag: this editor lays out one face, so a job that
     * needs a second one is outside what it can serve. The host renders the
     * reason next to the greyed-out option, which is why it is a sentence.
     */
    if (job.sides === 2) {
      return { ok: false, reason: 'This editor produces single-sided artwork only.' };
    }
    return { ok: true };
  }

  start(job: JobSpec): Promise<ArtworkRef | null> {
    return new Promise((resolve) => {
      const entry: PendingStart = { cancelled: false };
      this.#pending.add(entry);
      /*
       * A microtask rather than a timer: `cancel()` is called synchronously
       * after `start()` in the conformance suite, so the editor must still be
       * open at that moment — which is exactly the real sequence (the dialog is
       * up, the customer hits Escape). A `setTimeout` would work too but would
       * make the suite wait on a real clock.
       */
      queueMicrotask(() => {
        this.#pending.delete(entry);
        if (entry.cancelled) {
          resolve(null);
          return;
        }
        this.#issued += 1;
        resolve({
          fileId: `file-artwork-${this.#issued}`,
          source: this.key,
          // Bleed on every edge, so the returned size is the trim plus two of it.
          widthMm: job.trimWidthMm + job.bleedMm * 2,
          heightMm: job.trimHeightMm + job.bleedMm * 2,
          bleedMm: job.bleedMm,
          dpi: 300,
          pages: job.sides,
          previewFileId: `file-preview-${this.#issued}`,
        });
      });
    });
  }

  /** The customer closed the editor. */
  cancelOpenEditors(): void {
    for (const entry of this.#pending) entry.cancelled = true;
  }
}

// -- shipping-carrier@1 ------------------------------------------------------

/**
 * The countries this carrier flies to. `quote` refuses anything else at EITHER
 * end of the route, which is the rule 31 O4 made executable: a label needs a
 * resolvable address at both ends, so an address refused as a recipient is
 * refused as a sender.
 */
const SERVED_COUNTRIES = new Set(['DE', 'FR', 'NL', 'BE']);

const SERVICES = [
  { code: 'std', service: 'Standard', days: 3, multiplier: 1 },
  { code: 'exp', service: 'Express', days: 1, multiplier: 2.2 },
] as const;

export class ReferenceShippingCarrier implements ShippingCarrier {
  readonly key = 'reference-carrier';

  readonly #byOrder = new Map<string, Shipment>();
  readonly #byTracking = new Map<string, Shipment>();
  readonly #cancelled = new Set<string>();

  quote(parcel: Parcel, from: Address, to: Address): Promise<Rate[]> {
    for (const [end, address] of [
      ['sender', from],
      ['recipient', to],
    ] as const) {
      if (!SERVED_COUNTRIES.has(address.country)) {
        /*
         * `retryable: false` because it is not: the postcode will still be
         * outside the network tomorrow. The default is `true` — see the direct
         * CarrierError test, which is where that branch is pinned, since every
         * refusal this carrier raises is a permanent one.
         */
        return Promise.reject(
          new CarrierError({
            code: 'COUNTRY_NOT_SERVED',
            carrierMessage: `We do not collect from or deliver to ${address.country} (${end}).`,
            retryable: false,
          }),
        );
      }
    }

    /*
     * Priced from the parcel and the route only — no clock, no counter, no
     * stored state. That is what makes the "same call twice gives the same
     * rates" case a statement about the implementation rather than a lucky run.
     * The zone surcharge sorts the country pair, so the reversed route prices
     * identically: a return leg costs what the outbound leg cost.
     */
    const volumetricKg = (parcel.lengthCm * parcel.widthCm * parcel.heightCm) / 5000;
    const chargeableKg = Math.max(parcel.weightKg, volumetricKg);
    const zone = [from.country, to.country].sort().join('-');
    const zoneSurcharge = [...zone].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 7;

    return Promise.resolve(
      SERVICES.map((svc) => ({
        code: svc.code,
        service: svc.service,
        amount: Math.round((chargeableKg * 3.5 * svc.multiplier + zoneSurcharge) * 100) / 100,
        currency: 'EUR',
        estimatedDelivery: isoDatePlus(svc.days),
      })),
    );
  }

  book(rate: Rate, order: OrderRef): Promise<Shipment> {
    /*
     * Idempotency keyed on the HOST's reference, which is the only identifier
     * both sides agree on before a shipment exists. A retried POST after a
     * timeout must not buy a second label — that is the failure this case
     * exists to catch, and a map is how a real integration avoids it.
     */
    const existing = this.#byOrder.get(order.reference);
    if (existing !== undefined) return Promise.resolve(existing);

    const seq = this.#byOrder.size + 1;
    const shipment: Shipment = {
      id: `SHP-${String(seq).padStart(4, '0')}`,
      tracking: `RC${String(seq).padStart(9, '0')}DE`,
      labelFileId: `file-label-${seq}`,
      collectionFrom: isoTimePlus(9),
      collectionTo: isoTimePlus(17),
      rate,
    };
    this.#byOrder.set(order.reference, shipment);
    this.#byTracking.set(shipment.tracking, shipment);
    return Promise.resolve(shipment);
  }

  track(tracking: string): Promise<TrackEvent[]> {
    const shipment = this.#byTracking.get(tracking);
    // Never a throw: "we have not heard of that reference" is an ordinary
    // answer, and the works polls this on a timer.
    if (shipment === undefined) return Promise.resolve([]);

    const events: TrackEvent[] = [
      {
        at: isoTimePlus(10),
        place: 'Berlin',
        status: 'collected',
        description: 'Parcel collected from sender.',
      },
      {
        at: isoTimePlus(26),
        place: 'Cologne',
        status: 'in-transit',
        description: 'Arrived at sorting centre.',
      },
    ];
    if (this.#cancelled.has(shipment.id)) {
      events.push({
        at: isoTimePlus(30),
        place: 'Cologne',
        status: 'cancelled',
        description: 'Shipment cancelled by sender; label void.',
      });
    }
    return Promise.resolve(events);
  }

  label(shipmentId: string): Promise<FileRef> {
    const shipment = [...this.#byOrder.values()].find((s) => s.id === shipmentId);
    if (shipment === undefined) {
      return Promise.reject(
        new CarrierError({
          code: 'SHIPMENT_UNKNOWN',
          carrierMessage: `No shipment ${shipmentId}.`,
          retryable: false,
        }),
      );
    }
    return Promise.resolve({
      fileId: shipment.labelFileId,
      filename: `${shipment.tracking}.pdf`,
      mediaType: 'application/pdf',
      bytes: 12_480,
    });
  }

  cancel(shipmentId: string): Promise<void> {
    /*
     * Marked, not deleted. A cancelled shipment still has a tracking history a
     * customer can ask about, and voiding a label is not the same act as
     * forgetting it ever existed.
     */
    this.#cancelled.add(shipmentId);
    return Promise.resolve();
  }
}

// -- product-personalizer@1 --------------------------------------------------

const DEFAULT_SIZE_MM = 5;

export class ReferenceProductPersonalizer implements ProductPersonalizer {
  readonly key = 'reference-personalizer';

  readonly #template: Template;

  constructor(template: Template) {
    this.#template = template;
  }

  available(product: ProductRef): { ok: true } | { ok: false; reason: string } {
    if (product.productKey !== this.#template.productKey) {
      return { ok: false, reason: `No template for ${product.productKey}.` };
    }
    return { ok: true };
  }

  open(product: ProductRef, initial?: Personalization): Promise<Personalization | null> {
    if (!this.available(product).ok) return Promise.resolve(null);
    return Promise.resolve(
      initial ?? { templateId: this.#template.productKey, values: {}, sizeMm: DEFAULT_SIZE_MM },
    );
  }

  validate(p: Personalization, t: Template): Verdict[] {
    return t.zones.map((zone): Verdict => {
      const value = p.values[zone.id];
      const { maxChars, minSizeMm } = zone.constraints;
      if (value === undefined || maxChars === undefined || value.length <= maxChars) {
        return { zone: zone.id, ok: true };
      }
      /*
       * BOTH remedies with their numbers, because the UI renders them as
       * buttons and a button needs a value to apply. "Doesn't fit" with no
       * number is the contract violation this shape exists to prevent.
       *
       * The size remedy is the honest one: shrink in proportion to the overrun,
       * then refuse to go below the zone's own legibility floor. Where that
       * floor makes the text still not fit, only `shortenToChars` is offered —
       * which is the truth, not a hedge.
       */
      const current = p.sizeMm ?? DEFAULT_SIZE_MM;
      const scaled = Math.floor(((current * maxChars) / value.length) * 10) / 10;
      const floor = minSizeMm ?? 0;
      const remedies: { setSizeMm?: number; shortenToChars?: number } = {
        shortenToChars: maxChars,
      };
      if (scaled >= floor) remedies.setSizeMm = scaled;
      return {
        zone: zone.id,
        ok: false,
        reason: `"${zone.name}" holds ${maxChars} characters; this is ${value.length}.`,
        remedies,
      };
    });
  }

  render(p: Personalization, opts: { angle: string; widthPx: number }): Promise<PreviewRef> {
    const digest = this.#digest(p, opts);
    return Promise.resolve({
      fileId: `file-preview-${digest}`,
      angle: opts.angle,
      widthPx: opts.widthPx,
      digest,
    });
  }

  productionFile(p: Personalization): Promise<FileRef> {
    const digest = this.#digest(p, { angle: 'production', widthPx: 0 });
    return Promise.resolve({
      fileId: `file-production-${digest}`,
      // `.pdf`, never `.ttf`: the machine gets outlines. A font reference here
      // means the engraver renders with whatever it happens to have installed.
      filename: `personalization-${digest}.pdf`,
      mediaType: 'application/pdf',
      bytes: 4096 + Object.values(p.values).join('').length * 128,
    });
  }

  /**
   * Every input that changes the picture, and nothing that does not. Sorting
   * the value keys is what stops two equal personalizations built in a
   * different order digesting differently.
   */
  #digest(p: Personalization, opts: { angle: string; widthPx: number }): string {
    const values = Object.keys(p.values)
      .sort()
      .map((k) => `${k}=${p.values[k] ?? ''}`)
      .join(' ');
    return digestOf(
      [
        values,
        p.font ?? '',
        p.sizeMm ?? DEFAULT_SIZE_MM,
        p.finish ?? '',
        opts.angle,
        opts.widthPx,
      ].join('|'),
    );
  }
}
