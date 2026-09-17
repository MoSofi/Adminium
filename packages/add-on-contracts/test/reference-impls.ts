// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reference implementations of the three wave-4 contracts, and the fixtures
 * that drive them.
 *
 * These exist so `@adminium/add-on-contracts/testing` is EXECUTED somewhere.
 * The conformance suites are the load-bearing half of the "the next carrier is
 * this repo with one file replaced" claim, and until now nothing in this repo
 * ever ran them: `ab6314e` added two cases to `describeShippingCarrier` that no
 * test anywhere had executed. A suite that is only ever run in fleet repos is a
 * suite whose own bugs surface fifteen repos away from the commit that wrote
 * them.
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
  DOCUMENT_LOCALE_IDS,
  type Address,
  type ArtworkRef,
  type ArtworkSource,
  type AvailabilityVerdict,
  type DocumentError,
  type DocumentKind,
  type DocumentOutline,
  type DocumentRenderer,
  type FileRef,
  type JobSpec,
  type LocalizedText,
  type RenderInput,
  type RenderedDocument,
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
 * ("Determinism").
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
 * portable as the half of the package that forbids `node:` imports — an add-on
 * author copying it as a starting point should not inherit a Node dependency
 * the storefront cannot load.
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
 * end of the route, which is the rule made executable: a label needs a
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

// -- document-render@1 -------------------------------------------------------

/**
 * A reference `DocumentRenderer` — four kinds, deliberately DIFFERENT from one
 * another, because each shape a real provider can take sends the suite down a
 * branch no other shape reaches.
 *
 *   · `note` is `winansi` and renders both formats, so it exercises the
 *     drawing branch for `é ß ø €` and the refusal branch for Arabic and Han;
 *   · `ticket` is `ascii` and PDF-only, so it exercises the refusal branch for
 *     `é ß ø €` — the case a WinAnsi-only reference could never reach, and the
 * one `barcode-labels` actually is; · `receipt` is HTML-only with no free-text
 *     slot and every required slot defaulted, so the PDF, glyph and
 *     missing-slot cases have nothing to assert — and a line it carries has an
 *     empty cell, and a collection it declares arrives with no rows, which the
 *     money law has to step over; · `badge` is PDF-only with no free-text
 *     slot, so the escaping and coverage cases skip it while its
 *     cross-reference table is still walked.
 *
 * It earns its passes the way the other three references do. The PDF is built
 * over BYTE buffers with the cross-reference offsets collected from the buffer
 * itself, so `parseXrefBack` walking to each object is a property of the
 * writer rather than of a recorded answer — and a writer that computed offsets
 * from `String.length` (trap 8) fails it on the first accented character.
 * Coverage is checked BEFORE the writer runs, so a glyph it cannot draw is a
 * typed refusal and never a hole in the page.
 */

const WINANSI_HIGH: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

/** The byte WinAnsiEncoding gives this character, or `null` when it draws none. */
function winAnsiByte(ch: string): number | null {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  const high = WINANSI_HIGH[ch];
  return high ?? null;
}

/** Every distinct character of `text` the encoding cannot draw, in order of first appearance. */
function undrawable(text: string, coverage: 'ascii' | 'winansi' | 'all'): string[] {
  if (coverage === 'all') return [];
  const dropped: string[] = [];
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    const code = ch.codePointAt(0) ?? 0;
    const ok = coverage === 'ascii' ? code >= 0x20 && code <= 0x7e : winAnsiByte(ch) !== null;
    if (!ok && !dropped.includes(ch)) dropped.push(ch);
  }
  return dropped;
}

/** A PDF string literal's bytes, WinAnsi-encoded, with `(`, `)` and `\` escaped. */
function pdfLiteralBytes(text: string): number[] {
  const out: number[] = [0x28];
  for (const ch of text) {
    const byte = winAnsiByte(ch);
    if (byte === null) continue;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c);
    out.push(byte);
  }
  out.push(0x29);
  return out;
}

const ASCII = (text: string): number[] => Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

/**
 * One page of left-aligned Helvetica, written straight into a byte array.
 *
 * The offsets in the cross-reference table are the LENGTH OF THE BUFFER at the
 * moment each object starts, which is the only definition that stays true once
 * a single character encodes to a byte outside ASCII.
 */
function referencePdf(lines: readonly string[], widthPt: number, heightPt: number): Uint8Array {
  const stream: number[] = [];
  stream.push(...ASCII('BT\n/F1 11 Tf\n12 TL\n'));
  stream.push(...ASCII(`1 0 0 1 36 ${String(heightPt - 48)} Tm\n`));
  for (const line of lines) {
    stream.push(...pdfLiteralBytes(line));
    stream.push(...ASCII(' Tj T*\n'));
  }
  stream.push(...ASCII('ET\n'));

  /*
   * THE CONTENT STREAM IS OBJECT 4 AND THE FONT IS OBJECT 5, IN THAT ORDER,
   * AND THE ORDER IS LOAD-BEARING FOR THE CONFORMANCE SUITE.
   *
   * A PDF's objects may be written in any order — that is what the
   * cross-reference table is for — and real writers routinely emit resources
   * after the content that uses them. Here it also gives
   * `describeDocumentRenderer`'s xref assertion its teeth: with the drawn text
   * in the LAST object, every offset in the table precedes the first non-ASCII
   * byte, so a writer that computed its offsets from `String.length` produces
   * a table that is still, by luck, entirely correct. Measured on 2026-09-10:
   * a deliberate `String.length` mutation passed the suite until an object was
   * moved after the stream. Any multi-page document has this property for
   * free; a one-page reference has to be arranged to have it.
   */
  const objects: number[][] = [
    ASCII('<</Type/Catalog/Pages 2 0 R>>'),
    ASCII('<</Type/Pages/Kids[3 0 R]/Count 1>>'),
    ASCII(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${String(widthPt)} ${String(heightPt)}]` +
        '/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    ),
    [
      ...ASCII(`<</Length ${String(stream.length)}>>\nstream\n`),
      ...stream,
      ...ASCII('\nendstream'),
    ],
    ASCII('<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>'),
  ];

  const bytes: number[] = [...ASCII('%PDF-1.4\n')];
  const offsets: number[] = [];
  objects.forEach((body, at) => {
    offsets.push(bytes.length);
    bytes.push(...ASCII(`${String(at + 1)} 0 obj\n`), ...body, ...ASCII('\nendobj\n'));
  });

  const xref = bytes.length;
  bytes.push(...ASCII(`xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`));
  for (const offset of offsets) {
    bytes.push(...ASCII(`${String(offset).padStart(10, '0')} 00000 n \n`));
  }
  bytes.push(
    ...ASCII(
      `trailer\n<</Size ${String(objects.length + 1)}/Root 1 0 R>>\n` +
        `startxref\n${String(xref)}\n%%EOF\n`,
    ),
  );
  return Uint8Array.from(bytes);
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

/** The same eight-locale word in all eight locales — a reference, not a translation exercise. */
function everyLocale(text: string): LocalizedText {
  return Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, text])) as LocalizedText;
}

const REFERENCE_KINDS: readonly DocumentKind[] = [
  {
    id: 'note',
    label: everyLocale('Note'),
    formats: ['html', 'pdf'],
    paper: ['a4', 'letter'],
    coverage: 'winansi',
  },
  {
    id: 'ticket',
    label: everyLocale('Ticket'),
    formats: ['pdf'],
    paper: ['receipt-80mm'],
    coverage: 'ascii',
  },
  {
    // HTML is UTF-8, so a kind that only ever writes HTML draws every glyph.
    id: 'receipt',
    label: everyLocale('Receipt'),
    formats: ['html'],
    paper: ['receipt-80mm'],
    coverage: 'all',
  },
  {
    id: 'badge',
    label: everyLocale('Badge'),
    formats: ['pdf'],
    paper: ['a4'],
    coverage: 'winansi',
  },
];

const REFERENCE_OUTLINES: Readonly<Record<string, DocumentOutline>> = {
  note: {
    slots: [
      { id: 'title', label: everyLocale('Title'), type: 'text', required: true },
      {
        id: 'issuedAt',
        label: everyLocale('Issued'),
        help: everyLocale('Left empty, the moment the document is made is used.'),
        type: 'date',
        required: true,
        default: 'now',
      },
      { id: 'recipientLines', label: everyLocale('Recipient'), type: 'text[]', required: false },
      { id: 'amount', label: everyLocale('Amount'), type: 'money', required: false },
      { id: 'rate', label: everyLocale('Rate'), type: 'percent', required: false },
      {
        id: 'lines',
        label: everyLocale('Lines'),
        type: 'collection',
        required: false,
        columns: [
          { id: 'description', label: everyLocale('Description'), type: 'text', required: true },
          { id: 'total', label: everyLocale('Total'), type: 'money', required: true },
        ],
      },
    ],
  },
  ticket: {
    slots: [
      { id: 'title', label: everyLocale('Title'), type: 'text', required: true },
      { id: 'reference', label: everyLocale('Reference'), type: 'text', required: true },
    ],
  },
  receipt: {
    slots: [
      { id: 'issuedAt', label: everyLocale('Issued'), type: 'date', required: true, default: 'now' },
      { id: 'paid', label: everyLocale('Paid'), type: 'money', required: false },
      {
        id: 'payments',
        label: everyLocale('Payments'),
        type: 'collection',
        required: false,
        columns: [
          { id: 'method', label: everyLocale('Method'), type: 'text', required: true },
          { id: 'amount', label: everyLocale('Amount'), type: 'money', required: true },
          { id: 'tip', label: everyLocale('Tip'), type: 'money', required: false },
        ],
      },
      {
        id: 'refunds',
        label: everyLocale('Refunds'),
        type: 'collection',
        required: false,
        columns: [{ id: 'amount', label: everyLocale('Amount'), type: 'money', required: true }],
      },
    ],
  },
  badge: {
    slots: [
      { id: 'seat', label: everyLocale('Seat'), type: 'number', required: true },
      { id: 'issuedAt', label: everyLocale('Issued'), type: 'date', required: true, default: 'now' },
    ],
  },
};

const PAPER_PT: Readonly<Record<string, { width: number; height: number }>> = {
  a4: { width: 595, height: 842 },
  letter: { width: 612, height: 792 },
  'receipt-80mm': { width: 227, height: 600 },
};

export class ReferenceDocumentRenderer implements DocumentRenderer {
  readonly key = 'reference-documents';

  kinds(): readonly DocumentKind[] {
    return REFERENCE_KINDS;
  }

  describe(kind: string): DocumentOutline {
    const outline = REFERENCE_OUTLINES[kind];
    if (outline === undefined) throw new Error(`unknown document kind: ${kind}`);
    return outline;
  }

  async render(input: RenderInput): Promise<readonly RenderedDocument[] | DocumentError> {
    const kind = REFERENCE_KINDS.find((k) => k.id === input.kind);
    if (kind === undefined) {
      return { code: 'UNSUPPORTED_KIND', detail: `this add-on has no kind '${input.kind}'` };
    }
    const outline = this.describe(kind.id);

    for (const slot of outline.slots) {
      if (!slot.required || slot.default !== undefined) continue;
      const value = input.subject.fields[slot.id];
      if (value === undefined || value === null || value === '') {
        return { code: 'MISSING_SLOT', detail: `'${slot.id}' has no value` };
      }
    }

    const lines = this.#lines(outline, input);

    const documents: RenderedDocument[] = [];
    for (const format of input.formats) {
      if (!kind.formats.includes(format)) continue;
      if (format === 'html') {
        const html =
          '<!doctype html><html><head><meta charset="utf-8">' +
          `<title>${escapeHtml(lines[0] ?? kind.id)}</title></head><body>` +
          lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('') +
          '</body></html>';
        documents.push({
          format: 'html',
          filename: `${kind.id}.html`,
          mediaType: 'text/html; charset=utf-8',
          bytes: new TextEncoder().encode(html),
          locale: input.subject.locale,
          warnings: [],
        });
        continue;
      }

      // Coverage is checked before the writer, never inside it: a refusal has
      // to name the glyphs, and by the time a byte has been dropped it cannot.
      const dropped = undrawable(lines.join('\n'), kind.coverage);
      if (dropped.length > 0) {
        return {
          code: 'LATIN_ONLY',
          detail: `kind '${kind.id}' draws ${kind.coverage} only`,
          dropped,
        };
      }
      const paper = PAPER_PT[input.paper] ?? PAPER_PT.a4!;
      documents.push({
        format: 'pdf',
        filename: `${kind.id}.pdf`,
        mediaType: 'application/pdf',
        bytes: referencePdf(lines, paper.width, paper.height),
        locale: input.subject.locale,
        warnings: [],
      });
    }
    return documents;
  }

  /** Every drawn line, in one place, so HTML and PDF cannot drift apart. */
  #lines(outline: DocumentOutline, input: RenderInput): string[] {
    const { subject } = input;
    const lines: string[] = [];
    for (const slot of outline.slots) {
      if (slot.type === 'collection') {
        for (const row of subject.collections[slot.id] ?? []) {
          const cells = (slot.columns ?? []).map((c) => String(row[c.id] ?? ''));
          lines.push(`  ${cells.join('  ')}`);
        }
        continue;
      }
      const raw = slot.id === 'issuedAt' ? (subject.fields[slot.id] ?? subject.now.iso) : subject.fields[slot.id];
      if (raw === undefined || raw === null) continue;
      lines.push(`${slot.label['en-US']}: ${Array.isArray(raw) ? raw.join(', ') : String(raw)}`);
    }
    if (subject.number !== null) lines.push(`No. ${subject.number}`);
    lines.push(subject.business.name, ...subject.business.lines);
    return lines;
  }
}
