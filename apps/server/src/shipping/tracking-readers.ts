// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A CARRIER'S WEBHOOK SAID, read into the few fields Adminium keeps.
 *
 * The shipping contract has no webhook method yet, so the one carrier with a
 * webhook is read here. Shippo's payload also carries both addresses, the
 * label's signed link and the customer's details: none of those leave this
 * file. Its field names follow Shippo's documentation and are confirmed
 * against a real delivery in T11.
 *
 * **Live must be said.** Test tracking numbers repeat across accounts, so an
 * event that does not plainly say `test: false` is treated as a test event and
 * touches no booking.
 */
import { SHIPPING_CARRIER_TEXT_WIDTH, SHIPPING_URL_WIDTH, type ShippingTrackStatus } from '@adminium/meta';

export type HeardEvent =
  | { kind: 'ignored' }
  | { kind: 'track'; live: boolean; tracking: string; transactionId: string | null; status: ShippingTrackStatus; at: number }
  | { kind: 'transaction'; live: boolean; transactionId: string; tracking: string | null; status: string; at: number | null; rateRef: string | null; trackingUrl: string | null };

/** Answers null for a body that is not the carrier's event at all. */
export type TrackingReader = (body: unknown) => HeardEvent | null;

const ALIASES: Readonly<Record<string, ShippingTrackStatus>> = {
  UNKNOWN: 'UNKNOWN',
  PRE_TRANSIT: 'PRE_TRANSIT',
  TRANSIT: 'TRANSIT',
  IN_TRANSIT: 'TRANSIT',
  OUT_FOR_DELIVERY: 'TRANSIT',
  DELIVERED: 'DELIVERED',
  RETURNED: 'RETURNED',
  FAILURE: 'FAILURE',
  FAILED: 'FAILURE',
};

/** A carrier's status as one of six words. Anything else is UNKNOWN, which never replaces a real status. */
export function trackStatusOf(text: string): ShippingTrackStatus {
  return ALIASES[text.trim().toUpperCase().replace(/[\s-]+/g, '_')] ?? 'UNKNOWN';
}

const BLOCKED_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/i;

/**
 * A carrier's tracking page, if it can be put in front of a customer: `https`,
 * on the default port, with no credentials, on a public name and not a bare
 * address. Anything else is no link at all, and the screen shows the number.
 */
export function safeTrackingUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > SHIPPING_URL_WIDTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  const host = url.hostname.replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /^0x/i.test(host) || BLOCKED_HOST.test(host)) return null;
  return url.toString();
}

/** A new link for a label that already has one must stay on the same host: a claim cannot send customers elsewhere. */
export function sameHostUrl(next: string | null, current: string | null): string | null {
  if (next === null || current === null) return null;
  try {
    return new URL(next).hostname === new URL(current).hostname ? next : null;
  } catch {
    return null;
  }
}

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** A short id or number, or null. A value too long for its column is no value. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > SHIPPING_CARRIER_TEXT_WIDTH ? null : trimmed;
}

function when(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

const readShippo: TrackingReader = (body) => {
  const doc = record(body);
  if (doc === null || typeof doc['event'] !== 'string') return null;
  const event = doc['event'];
  if (event !== 'track_updated' && event !== 'transaction_created' && event !== 'transaction_updated') return { kind: 'ignored' };
  const data = record(doc['data']);
  if (data === null) return null;
  // Exactly `false` wherever it is present, and present at least once.
  const flags = [doc['test'], data['test']].filter((flag) => flag !== undefined);
  const live = flags.length > 0 && flags.every((flag) => flag === false);

  if (event === 'track_updated') {
    const tracking = text(data['tracking_number']);
    if (tracking === null) return null;
    const status = record(data['tracking_status']);
    // Shippo sends a number it has no scan for yet with no status: nothing to apply.
    if (status === null || typeof status['status'] !== 'string') return { kind: 'ignored' };
    const at = when(status['status_date']);
    if (at === null) return { kind: 'ignored' };
    return { kind: 'track', live, tracking, transactionId: text(data['transaction']), status: trackStatusOf(status['status']), at };
  }

  const transactionId = text(data['object_id']);
  if (transactionId === null) return null;
  const status = typeof data['status'] === 'string' ? data['status'].trim().toUpperCase().slice(0, 16) : '';
  if (status === '') return { kind: 'ignored' };
  const rate = data['rate'];
  return {
    kind: 'transaction',
    live,
    transactionId,
    tracking: text(data['tracking_number']),
    status,
    at: when(data['object_updated']),
    rateRef: text(typeof rate === 'string' ? rate : record(rate)?.['object_id']),
    trackingUrl: safeTrackingUrl(data['tracking_url_provider']),
  };
};

const READERS: Readonly<Record<string, TrackingReader>> = { 'shipping-shippo': readShippo };

/** The reader for this carrier's webhook, or null for a carrier that has none. */
export const trackingReaderFor = (carrierKey: string): TrackingReader | null => (Object.hasOwn(READERS, carrierKey) ? READERS[carrierKey]! : null);
