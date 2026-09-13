// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The conformance suites, run against reference implementations.
 *
 * `@adminium/add-on-contracts/testing` is the package's own product: every
 * provider in the fleet runs it, and 24 §5.5 D9 makes it "part of the contract,
 * not a courtesy". It was nonetheless the one thing here nothing executed. That
 * is not merely an untested file — it inverts the signal. `ab6314e` added two
 * cases to `describeShippingCarrier` and DROPPED measured coverage from 70% to
 * 65.85%, below this package's own floor: writing more conformance made the
 * package look worse, and the only way to make the number go up was to write
 * less of the thing the package exists to ship.
 *
 * Running the suites here fixes both halves at once. Every `it()` body executes,
 * and a contract amendment that is self-contradictory, references a fixture
 * field that does not exist, or asserts something no honest implementation can
 * satisfy fails in THIS repo, in the commit that wrote it, rather than in
 * fifteen fleet repos on their next dependency bump.
 */
import { describe, expect, it } from 'vitest';

import {
  describeArtworkSource,
  describeDocumentRenderer,
  describeProductPersonalizer,
  describeShippingCarrier,
  type DocumentRendererFixtures,
} from '../src/testing/index.js';
import {
  CarrierError,
  DOCUMENT_LOCALE_IDS,
  isDocumentError,
  jobSpecSchema,
  localizedTextSchema,
  outlineSlotSchema,
  templateSchema,
} from '../src/index.js';
import type {
  Address,
  DocumentSubject,
  JobSpec,
  Parcel,
  Personalization,
  RenderInput,
  Template,
} from '../src/index.js';
import {
  ReferenceArtworkSource,
  ReferenceDocumentRenderer,
  ReferenceProductPersonalizer,
  ReferenceShippingCarrier,
} from './reference-impls.js';

// -- artwork-source@1 --------------------------------------------------------

const BUSINESS_CARDS: JobSpec = {
  productKey: 'business-cards',
  productLabel: 'Business cards',
  trimWidthMm: 85,
  trimHeightMm: 55,
  bleedMm: 3,
  sides: 1,
  quantity: 250,
};

const DOUBLE_SIDED: JobSpec = { ...BUSINESS_CARDS, sides: 2 };

const artworkSource = new ReferenceArtworkSource();

describeArtworkSource(artworkSource, {
  job: BUSINESS_CARDS,
  unavailableJob: DOUBLE_SIDED,
  cancel: () => artworkSource.cancelOpenEditors(),
});

/*
 * The same source with the two OPTIONAL fixtures withheld. `ArtworkSourceFixtures`
 * documents both as omittable — "implementations that cannot be cancelled
 * headlessly may omit it" — and a promise like that is only true if someone
 * takes it up. Without this run the skip arms are dead code that would break
 * the first fleet repo to rely on them, and this repo would not know.
 */
describeArtworkSource(new ReferenceArtworkSource('reference-source-minimal'), {
  job: BUSINESS_CARDS,
});

// -- shipping-carrier@1 ------------------------------------------------------

const PARCEL: Parcel = {
  weightKg: 1.4,
  lengthCm: 30,
  widthCm: 22,
  heightCm: 8,
  contents: '250 business cards',
};

const BERLIN: Address = {
  name: 'Reference Print Works',
  lines: ['Chausseestrasse 12'],
  city: 'Berlin',
  postcode: '10115',
  country: 'DE',
};

const LYON: Address = {
  name: 'Ava Reyes',
  lines: ['14 Rue de la Republique'],
  city: 'Lyon',
  postcode: '69002',
  country: 'FR',
};

/** Outside the network at either end — see `SERVED_COUNTRIES`. */
const MCMURDO: Address = {
  name: 'Ross Island Station',
  lines: ['Building 155'],
  city: 'McMurdo',
  postcode: '0000',
  country: 'AQ',
};

describeShippingCarrier(new ReferenceShippingCarrier(), {
  parcel: PARCEL,
  from: BERLIN,
  to: LYON,
  rejectedTo: MCMURDO,
  order: { reference: 'MP-4118' },
});

// -- product-personalizer@1 --------------------------------------------------

const TEMPLATE: Template = {
  productKey: 'engraved-pen',
  angles: [
    { id: 'front', label: 'Front', fileId: 'file-angle-front' },
    { id: 'clip', label: 'Clip', fileId: 'file-angle-clip' },
  ],
  zones: [
    {
      id: 'barrel',
      name: 'Barrel',
      kind: 'text-line',
      shape: { type: 'rect', xMm: 12, yMm: 4, wMm: 60, hMm: 6 },
      constraints: { maxChars: 18, fonts: ['Inter'], minSizeMm: 3, maxSizeMm: 8 },
      finish: 'engraved',
      perAngle: { front: { xPct: 0.12, yPct: 0.42, wPct: 0.7, hPct: 0.1 } },
    },
    {
      id: 'clip-mark',
      name: 'Clip mark',
      kind: 'text-line',
      shape: { type: 'rect', xMm: 2, yMm: 2, wMm: 14, hMm: 4 },
      constraints: { maxChars: 6, minSizeMm: 2 },
      finish: 'engraved',
      perAngle: { clip: { xPct: 0.4, yPct: 0.1, wPct: 0.2, hPct: 0.06, skewDeg: 4 } },
    },
  ],
};

const FITS: Personalization = {
  templateId: 'engraved-pen',
  values: { barrel: 'Ava Reyes', 'clip-mark': 'AR' },
  font: 'Inter',
  sizeMm: 5,
};

/** Overruns the barrel (38 > 18) and the clip mark (9 > 6). */
const OVERRUNS: Personalization = {
  templateId: 'engraved-pen',
  values: { barrel: 'Augusta Ada King, Countess of Lovelace', 'clip-mark': 'A.A.K.L.C' },
  font: 'Inter',
  sizeMm: 5,
};

describeProductPersonalizer(new ReferenceProductPersonalizer(TEMPLATE), {
  product: { productKey: 'engraved-pen', quantity: 1 },
  template: TEMPLATE,
  valid: FITS,
  overrun: OVERRUNS,
  angle: 'front',
});

// -- the fixtures themselves -------------------------------------------------

describe('conformance fixtures', () => {
  /*
   * The suites take the fixtures on trust — `describeArtworkSource` never
   * validates the `JobSpec` it is handed. So a fixture that does not satisfy
   * the package's own schema would still drive a green run, and every
   * assertion in that run would be about a shape no host would ever pass. The
   * schemas are right here; using them costs two cases.
   */
  it('drives the artwork source with a JobSpec the package would accept', () => {
    for (const job of [BUSINESS_CARDS, DOUBLE_SIDED]) {
      const parsed = jobSpecSchema.safeParse(job);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('drives the personalizer with a Template the package would accept', () => {
    const parsed = templateSchema.safeParse(TEMPLATE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('offers the personalizer an overrun that actually overruns every zone', () => {
    // Otherwise "every failing verdict carries a remedy" could pass while
    // testing one zone, or none.
    for (const zone of TEMPLATE.zones) {
      const value = OVERRUNS.values[zone.id];
      expect(value, zone.id).toBeDefined();
      expect(value!.length, zone.id).toBeGreaterThan(zone.constraints.maxChars!);
    }
  });
});

// -- CarrierError ------------------------------------------------------------

describe('CarrierError', () => {
  /*
   * The conformance suite reaches this class but only ever asserts that `code`
   * and `carrierMessage` are non-empty. `retryable` is the member the works
   * actually branches on — a rejected postcode must not be re-queued, a carrier
   * timeout must be — and its default is the half a caller gets by omission,
   * so it is the half most likely to be silently changed.
   */
  it('defaults to retryable, because the common refusal is a transient one', () => {
    const err = new CarrierError({ code: 'UPSTREAM_TIMEOUT', carrierMessage: 'Try again shortly.' });
    expect(err.retryable).toBe(true);
  });

  it('takes a permanent refusal at its word', () => {
    const err = new CarrierError({
      code: 'COUNTRY_NOT_SERVED',
      carrierMessage: 'We do not deliver to AQ.',
      retryable: false,
    });
    expect(err.retryable).toBe(false);
  });

  it('is an Error, so an unhandled one still carries a stack and a message', () => {
    const err = new CarrierError({ code: 'ADDRESS_INVALID', carrierMessage: 'Postcode unknown.' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CarrierError');
    // `message` is the carrier's own words: a log line quoting `err.message`
    // and a UI quoting `err.carrierMessage` must not diverge.
    expect(err.message).toBe('Postcode unknown.');
    expect(err.carrierMessage).toBe('Postcode unknown.');
  });
});

// -- document-render@1 -------------------------------------------------------

/**
 * A pinned clock, in the subject where it belongs. The suite renders twice and
 * requires identical bytes; with the provider reading its own `Date.now()`
 * that assertion would still pass here — the two calls are microseconds apart
 * — and fail nowhere until a real invoice printed the wrong minute. Putting
 * the clock in the fixture is what makes the assertion mean what it says.
 */
const DOCUMENT_NOW = { iso: '2026-09-10T09:15:00.000Z', timezone: 'Europe/Lisbon' };

const BUSINESS = { name: 'Northwind Studio', lines: ['18 Harbour Road', 'Lisbon'] };

/** One subject per reference kind, built fresh on every call. */
const DOCUMENT_SUBJECTS: Readonly<Record<string, () => DocumentSubject>> = {
  ticket: () => ({
    now: DOCUMENT_NOW,
    locale: 'en-US',
    currency: 'EUR',
    business: BUSINESS,
    entity: null,
    number: 'TK-0007',
    fields: { title: 'Collection ticket', reference: 'ORD-4118' },
    collections: {},
  }),
  note: () => ({
    now: DOCUMENT_NOW,
    locale: 'en-US',
    currency: 'EUR',
    business: BUSINESS,
    entity: {
      connectionId: 'conn_1',
      table: 'public.orders',
      pk: { id: 4118 },
      label: 'Order 4118',
    },
    number: 'NB-1042',
    // Money in integer minor units, percent in basis points — the wire
    // law the suite asserts on this very object.
    fields: {
      title: 'Design system audit',
      recipientLines: ['Acme Corporation', '400 Market Street'],
      amount: 214_500,
      rate: 2000,
    },
    collections: {
      lines: [
        { description: 'Audit', total: 120_000 },
        { description: 'Report', total: 94_500 },
      ],
    },
  }),
  receipt: () => ({
    now: DOCUMENT_NOW,
    locale: 'en-US',
    currency: 'EUR',
    business: BUSINESS,
    entity: null,
    number: null,
    fields: { paid: 1_400 },
    // A cash payment carries no tip, and nothing was refunded: an empty cell
    // and an absent collection are both ordinary, and the money law must step
    // over them rather than read them as a decimal.
    collections: {
      payments: [
        { method: 'Card', amount: 1_150, tip: 100 },
        { method: 'Cash', amount: 250 },
      ],
    },
  }),
  badge: () => ({
    now: DOCUMENT_NOW,
    locale: 'en-US',
    currency: 'EUR',
    business: BUSINESS,
    entity: null,
    number: 'BD-0031',
    fields: { seat: 14 },
    collections: {},
  }),
};

const REFERENCE_DOCUMENT_FIXTURES: DocumentRendererFixtures = {
  settings: { footer: 'Thank you' },
  subject: (kind) => {
    const build = DOCUMENT_SUBJECTS[kind.id];
    if (build === undefined) throw new Error(`no reference subject for kind '${kind.id}'`);
    return build();
  },
};

describeDocumentRenderer(new ReferenceDocumentRenderer(), REFERENCE_DOCUMENT_FIXTURES);

/**
 * The suite again, through the two OPTIONAL fixture hooks — and a check that
 * they reach the provider.
 *
 * Run only without them, neither path executes here: `body` is how a provider
 * that renders an authored composition is fed one (34 D54, the invoices
 * add-on), and `textSlot` is how a provider whose first text slot is not the
 * one it prints points the escaping and coverage cases elsewhere
 * (`barcode-labels`, 34-T06). A hook that stopped arriving would otherwise
 * pass unnoticed in this repo and fail in the one that relies on it.
 */
class RecordingDocumentRenderer extends ReferenceDocumentRenderer {
  readonly renders: { kind: string; body: RenderInput['body'] }[] = [];

  override async render(input: RenderInput) {
    this.renders.push({ kind: input.kind, body: input.body });
    return super.render(input);
  }
}

describe('document-render@1 — through the body and textSlot hooks', () => {
  const recording = new RecordingDocumentRenderer();
  const drawn: Readonly<Record<string, string>> = { note: 'title', ticket: 'reference' };

  describeDocumentRenderer(recording, {
    ...REFERENCE_DOCUMENT_FIXTURES,
    body: (kind) => ({ blocks: [{ type: 'heading', text: kind.id }] }),
    textSlot: (kind) => drawn[kind.id],
  });

  it('hands the composed body to every render of a kind the provider lists', () => {
    const listed = new Set(recording.kinds().map((kind) => kind.id));
    const ofListedKinds = recording.renders.filter((render) => listed.has(render.kind));
    expect(ofListedKinds.length).toBeGreaterThan(0);
    for (const render of ofListedKinds) {
      expect(render.body).toEqual({ blocks: [{ type: 'heading', text: render.kind }] });
    }
  });
});

describe('document-render@1 — the suite fails what it promises to fail', () => {
  /*
   * 34-T04's done-when: green against a conforming provider AND RED against
   * one missing a locale. A conformance suite nobody has watched fail is a
   * suite whose assertions might all be vacuous — `describeShippingCarrier`
   * spent a release in exactly that state (`ab6314e`, see this file's header).
   * So the negative case is executed here rather than asserted in prose: the
   * eight-locale rule is exercised against a label with seven.
   */
  it('rejects a kind label missing one of the eight locales', () => {
    const sevenOfEight = Object.fromEntries(
      DOCUMENT_LOCALE_IDS.filter((id) => id !== 'cs-CZ').map((id) => [id, 'Note']),
    );
    const parsed = localizedTextSchema.safeParse(sevenOfEight);
    expect(parsed.success).toBe(false);
  });

  it('rejects a ninth locale a provider invented', () => {
    const nine = {
      ...Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, 'Note'])),
      'es-ES': 'Nota',
    };
    expect(localizedTextSchema.safeParse(nine).success).toBe(false);
  });

  it('rejects a collection nested inside a collection', () => {
    const nested = {
      id: 'lines',
      label: Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, 'Lines'])),
      type: 'collection',
      required: false,
      columns: [
        {
          id: 'inner',
          label: Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, 'Inner'])),
          type: 'collection',
          required: false,
          columns: [],
        },
      ],
    };
    expect(outlineSlotSchema.safeParse(nested).success).toBe(false);
  });

  it('narrows a refusal without a `code in x` incantation', async () => {
    const outcome = await new ReferenceDocumentRenderer().render({
      kind: 'no-such-kind',
      subject: REFERENCE_DOCUMENT_FIXTURES.subject(
        new ReferenceDocumentRenderer().kinds()[0]!,
      ),
      formats: ['html'],
      paper: 'a4',
      settings: {},
    });
    expect(isDocumentError(outcome)).toBe(true);
  });
});
