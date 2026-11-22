// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How many segments a text will cost. An ESTIMATE: the provider's own count is
 * what is billed, and carriers differ.
 *
 * Counted on the finished text, because one customer's name can move a whole
 * message from GSM-7 to UCS-2. The capacity comes from a table per destination:
 *
 *                               GSM-7 alone / split    UCS-2 alone / split
 *   everywhere                       160 / 153              70 / 67
 *   Canada, from a long code         136 / 136              70 / 67
 *   US and Canada, toll-free         160 / 152              70 / 66
 *
 * A GSM escape character takes two places and an astral character two UTF-16
 * units. Neither is cut across a segment, so segments are packed one character
 * at a time rather than by dividing.
 */
import { parsePhone } from '../../phone/index.js';
import type { SmsSender } from '../types.js';

/** The most segments one text may run to: about 900 GSM-7 or 400 UCS-2 characters. */
export const TEXT_MAX_SEGMENTS = 6;

const GSM_BASIC: ReadonlySet<string> = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM_ESCAPED: ReadonlySet<string> = new Set('^{}\\[~]|€\f');

export interface LengthLimits {
  gsm: { alone: number; split: number };
  ucs2: { alone: number; split: number };
}

const STANDARD: LengthLimits = { gsm: { alone: 160, split: 153 }, ucs2: { alone: 70, split: 67 } };
const CANADA_LONG_CODE: LengthLimits = { gsm: { alone: 136, split: 136 }, ucs2: { alone: 70, split: 67 } };
const NORTH_AMERICA_TOLL_FREE: LengthLimits = { gsm: { alone: 160, split: 152 }, ucs2: { alone: 70, split: 66 } };

/** The table for this sender and destination. A pool can hold any number, so it is counted at the tighter one. */
export function limitsFor(destinationCountry: string, sender: SmsSender): LengthLimits {
  if (destinationCountry !== 'US' && destinationCountry !== 'CA') return STANDARD;
  const parsed = sender.kind === 'number' ? parsePhone(sender.value, null) : null;
  const tollFree = parsed?.ok === true && parsed.kind === 'toll-free';
  if (tollFree) return NORTH_AMERICA_TOLL_FREE;
  if (destinationCountry === 'CA') return CANADA_LONG_CODE;
  return sender.kind === 'pool' ? NORTH_AMERICA_TOLL_FREE : STANDARD;
}

export interface TextEstimate {
  encoding: 'gsm-7' | 'ucs-2';
  /** Septets for GSM-7, UTF-16 units for UCS-2. */
  units: number;
  segments: number;
}

function packed(widths: readonly number[], limit: { alone: number; split: number }): { units: number; segments: number } {
  const units = widths.reduce((sum, width) => sum + width, 0);
  if (units === 0) return { units, segments: 0 };
  if (units <= limit.alone) return { units, segments: 1 };
  let segments = 1;
  let room = limit.split;
  for (const width of widths) {
    if (width > room) {
      segments += 1;
      room = limit.split;
    }
    room -= width;
  }
  return { units, segments };
}

export function estimateLength(body: string, limits: LengthLimits): TextEstimate {
  const characters = Array.from(body);
  if (characters.every((one) => GSM_BASIC.has(one) || GSM_ESCAPED.has(one))) {
    return { encoding: 'gsm-7', ...packed(characters.map((one) => (GSM_ESCAPED.has(one) ? 2 : 1)), limits.gsm) };
  }
  return { encoding: 'ucs-2', ...packed(characters.map((one) => one.length), limits.ucs2) };
}
