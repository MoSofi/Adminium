// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two addresses of a parcel: the shop's Ship from, kept per app install,
 * and the order's, read from the columns its app declared.
 *
 * Ship from may be saved half filled, so an owner keeps what they typed while
 * they find the rest. A missing field stops a quote, never a save.
 *
 * A country is compared as an upper-case ISO-2 code and is never guessed: not
 * from a currency, a phone prefix or a postcode's shape. One that is empty or
 * is not such a code is `COUNTRY_NOT_RECORDED`.
 */
import type { Address } from '@adminium/add-on-contracts';
import type { ShippingAddressColumns } from '@adminium/manifest';
import { z } from 'zod';

import type { Row } from '../crud/mask.js';
import { ShippingRefusal } from './refusals.js';

const ISO_COUNTRY = /^[A-Z]{2}$/;

const blankable = (max: number) => z.string().trim().max(max).optional();

/** What the Ship from form sends. Every field may be blank; none may be anything but what it is. */
export const shipFromBodySchema = z
  .object({
    name: blankable(120),
    lines: z.array(z.string().trim().max(120)).max(3).optional(),
    city: blankable(120),
    region: blankable(120),
    postcode: blankable(32),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .refine((value) => value === '' || ISO_COUNTRY.test(value), 'a two-letter country code')
      .optional(),
    phone: blankable(40),
    company: blankable(120),
    email: blankable(254),
  })
  .strict();

/** Ship from as stored: only the fields that hold something. */
export const shipFromSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    lines: z.array(z.string().min(1).max(120)).min(1).max(3).optional(),
    city: z.string().min(1).max(120).optional(),
    region: z.string().min(1).max(120).optional(),
    postcode: z.string().min(1).max(32).optional(),
    country: z.string().regex(ISO_COUNTRY).optional(),
    phone: z.string().min(1).max(40).optional(),
    company: z.string().min(1).max(120).optional(),
    email: z.string().min(1).max(254).optional(),
  })
  .strict();

export type ShipFrom = z.infer<typeof shipFromSchema>;

export const SHIP_FROM_REQUIRED = ['name', 'lines', 'city', 'postcode', 'country', 'phone'] as const;

/** What a form sent, with the blanks taken out. */
export function cleanShipFrom(body: z.infer<typeof shipFromBodySchema>): ShipFrom {
  const lines = (body.lines ?? []).filter((line) => line !== '');
  const out: Record<string, unknown> = {};
  for (const field of ['name', 'city', 'region', 'postcode', 'country', 'phone', 'company', 'email'] as const) {
    const value = body[field];
    if (value !== undefined && value !== '') out[field] = value;
  }
  if (lines.length > 0) out['lines'] = lines;
  return shipFromSchema.parse(out);
}

/** Ship from as read, or nothing when what is stored is not one. */
export function readShipFrom(stored: unknown): ShipFrom | null {
  const parsed = shipFromSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

export function shipFromMissing(shipFrom: ShipFrom | null): string[] {
  return SHIP_FROM_REQUIRED.filter((field) => shipFrom?.[field] === undefined);
}

/** The names of the fields that differ: what an audit row says, never the values. */
export function shipFromChanges(before: ShipFrom | null, after: ShipFrom): string[] {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  const changed = [...fields].filter((field) => JSON.stringify(before?.[field as keyof ShipFrom]) !== JSON.stringify(after[field as keyof ShipFrom]));
  return changed.sort();
}

/** The shop's address for a carrier, or a refusal naming what is missing. */
export function shipFromAddress(shipFrom: ShipFrom | null): Address {
  const missing = shipFromMissing(shipFrom);
  if (shipFrom === null || missing.length > 0) {
    throw new ShippingRefusal('SHIP_FROM_INCOMPLETE', 'The Ship from address is not complete.', { fields: missing });
  }
  return {
    name: shipFrom.name!,
    lines: shipFrom.lines!,
    city: shipFrom.city!,
    postcode: shipFrom.postcode!,
    country: shipFrom.country!,
    phone: shipFrom.phone!,
    ...(shipFrom.region === undefined ? {} : { region: shipFrom.region }),
    ...(shipFrom.company === undefined ? {} : { company: shipFrom.company }),
    ...(shipFrom.email === undefined ? {} : { email: shipFrom.email }),
  };
}

/** A column's value as address text, or nothing. A number is text here: a house number or a postcode kept as one. */
function text(row: Row, column: string | undefined): string | undefined {
  if (column === undefined) return undefined;
  const value = row[column];
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The order's delivery address, from the mapped columns and nowhere else.
 *
 * The country is asked first, because an order abroad cannot be sent however
 * its other fields are filled in, and the owner should hear that before being
 * asked to fix a phone number. `abroad` is the shop's own list of countries,
 * empty until its owner sets one up.
 */
export function orderAddress(row: Row, columns: ShippingAddressColumns, sender: Address, abroad: readonly string[] = []): Address {
  const raw = text(row, columns.country)?.toUpperCase();
  if (raw === undefined || !ISO_COUNTRY.test(raw)) {
    throw new ShippingRefusal('COUNTRY_NOT_RECORDED', 'This order has no two-letter country code.', { field: 'country' });
  }
  if (raw !== sender.country && !abroad.includes(raw)) {
    if (abroad.length > 0) throw new ShippingRefusal('COUNTRY_NOT_OFFERED', 'This shop does not deliver to that country.', { from: sender.country, to: raw });
    throw new ShippingRefusal('OUTSIDE_OWN_COUNTRY', 'This order is going to another country, and shipping abroad is not available yet.', { from: sender.country, to: raw });
  }
  const name = text(row, columns.name);
  const lines = columns.lines.flatMap((column) => text(row, column) ?? []);
  const city = text(row, columns.city);
  const postcode = text(row, columns.postcode);
  const missing = [...(name === undefined ? ['name'] : []), ...(lines.length === 0 ? ['lines'] : []), ...(city === undefined ? ['city'] : []), ...(postcode === undefined ? ['postcode'] : [])];
  if (name === undefined || city === undefined || postcode === undefined || lines.length === 0) {
    throw new ShippingRefusal('ADDRESS_INCOMPLETE', "This order's delivery address is not complete.", { fields: missing });
  }
  const region = text(row, columns.region);
  const phone = text(row, columns.phone);
  const email = text(row, columns.email);
  const company = text(row, columns.company);
  return {
    name,
    lines,
    city,
    postcode,
    country: raw,
    ...(region === undefined ? {} : { region }),
    ...(phone === undefined ? {} : { phone }),
    ...(email === undefined ? {} : { email }),
    ...(company === undefined ? {} : { company }),
  };
}

/** The order's country as a two-letter code, or null when it has none. */
export function orderCountry(row: Row, columns: ShippingAddressColumns): string | null {
  const raw = text(row, columns.country)?.toUpperCase();
  return raw !== undefined && ISO_COUNTRY.test(raw) ? raw : null;
}

/**
 * The recipient as a rate needs them. A price depends on where a parcel goes,
 * so a customer's phone and email stay here until a label needs them.
 */
export function recipientForRates(to: Address): Address {
  const { phone: _phone, email: _email, ...rest } = to;
  return rest;
}

/** The recipient of a parcel going abroad: carriers need a phone to clear it. The email stays here. */
export function recipientAbroad(to: Address): Address {
  const { email: _email, ...rest } = to;
  return rest;
}
