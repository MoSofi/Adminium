// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PII detection and masking defaults — 05-introspection-engine.md §7.2.
 *
 * PII is a flag layer INDEPENDENT of the primary semantic: it runs after the
 * §7.1 rule pipeline and can flag any column regardless of which primary tag
 * won. Masking is a display/export transform applied downstream by the
 * server serialization layer (08-server-api.md) — this module only decides
 * `pii` kind and `maskedByDefault`.
 */
import type { ColumnModel, PiiKind, SemanticTag } from '../schema-model.js';
import { normalizeName } from './names.js';

/** §7.2 name triggers that are independent of the §7.1 primary tag. */
const ADDRESS_RE = /(^|_)(address|street|city|zip|postal_code|postcode)(_|$)/;
const DOB_RE = /(^|_)(birth(date|day)?|dob|date_of_birth)(_|$)/;
/**
 * Anchored for the same reason as PAYMENT_ID_RE below — and this one was
 * shipping the bug that comment describes. Unanchored, `vat` matches as a
 * substring of ordinary words: `avatar_url` is "a-VAT-ar", so every avatar
 * column in every generated app was flagged as a government ID and masked by
 * default. `private`, `reservation`, `activation`, `observation`, `elevation`,
 * `conservation` and `derivative` all contain it too. Token boundaries make
 * `vat_number` redundant — bare `vat` already covers `vat_number`/`vat_id`.
 */
const GOV_ID_RE =
  /(^|_)(ssn|social_security|tax_id|vat|passport|national_id|driver_licen[cs]e)(_|$)/;
/**
 * §7.2 lists this unanchored, but short tokens (`pan`, `bic`) then match as
 * substrings of ordinary words — `company_name` contains "pan". We anchor
 * every alternative on token boundaries to avoid that false positive.
 */
const PAYMENT_ID_RE =
  /(^|_)(card_number|pan|iban|account_number|routing_number|bic|swift)(_|$)/;

export interface PiiResult {
  pii: PiiKind | null;
  maskedByDefault: boolean;
  reasons: string[];
}

export interface PiiContext {
  /** People-shaped table per the §8 directory trigger (see tables.ts). */
  peopleish: boolean;
  /** Set when the column is half of a classified geo lat/lng pair. */
  isGeoPointPair: boolean;
}

const TEXTISH = new Set(['text', 'varchar', 'unknown']);

/**
 * §7.2 kinds and triggers. Rules 17/18/26 (email/phone/ip) arrive as the
 * already-decided primary tag; person-name PII only applies to
 * first/last/full name columns on people-shaped tables; geo-precise only to
 * lat/lng pairs on people-shaped tables.
 */
export function detectPii(
  column: ColumnModel,
  primary: SemanticTag,
  ctx: PiiContext,
): PiiResult {
  const name = normalizeName(column.name);

  if (primary === 'email') {
    return pii('email', 'primary semantic is email (§7.1 rule 17)');
  }
  if (primary === 'phone') {
    return pii('phone', 'primary semantic is phone (§7.1 rule 18)');
  }
  if (primary === 'ip-address') {
    return pii('ip', 'primary semantic is ip-address (§7.1 rule 26)');
  }
  if (
    primary === 'person-name' &&
    ctx.peopleish &&
    /^(first_name|last_name|full_name)$/.test(name)
  ) {
    return pii('person-name', 'first/last/full name on a people-shaped table (§7.2)');
  }
  if (primary === 'geo-point' && ctx.peopleish && ctx.isGeoPointPair) {
    return pii('geo-precise', 'lat/lng pair on a people-shaped table (§7.2)');
  }
  if (GOV_ID_RE.test(name)) {
    return pii('gov-id', `name matches gov-id pattern (§7.2)`);
  }
  if (PAYMENT_ID_RE.test(name)) {
    return pii('payment-id', `name matches payment-id pattern (§7.2)`);
  }
  if (DOB_RE.test(name)) {
    return pii('dob', `name matches date-of-birth pattern (§7.2)`);
  }
  if (ADDRESS_RE.test(name) && TEXTISH.has(column.logicalType)) {
    return pii('address', `name matches address pattern (§7.2)`);
  }
  return { pii: null, maskedByDefault: false, reasons: [] };
}

function pii(kind: PiiKind, reason: string): PiiResult {
  return { pii: kind, maskedByDefault: true, reasons: [`pii:${kind} — ${reason}`] };
}
