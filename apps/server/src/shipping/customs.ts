// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PARCEL THAT LEAVES THE SHOP'S COUNTRY, and what is declared for it.
 *
 *  - Refused by default. A shop delivers abroad only once its owner has listed
 *    countries here AND its app says where an order's goods are.
 *  - Quantities, values and the order's currency come from the order, read
 *    again at purchase. A person may correct a description, an HS code or a
 *    manufacturer code, and nothing else.
 *  - The named signer is chosen by the owner and must still hold the customs
 *    right. Who actually ticked the box is recorded separately.
 *  - No code is ever filled in for a person. A code the destination asks for
 *    and the order lacks is a warning they can act on, and the carrier has the
 *    final word.
 *  - A value is an exact decimal, and no exchange rate is guessed.
 */
import { CUSTOMS_TAX_ID_TYPES, customsExporterSchema, type Address, type CustomsDeclaration, type CustomsExporter, type CustomsItem } from '@adminium/add-on-contracts';
import type { ShippingOrder } from '@adminium/manifest';
import { usersRepo, type InstalledManifest, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { grantKeyOf } from '../installs/resolve.js';
import type { PayableSources } from '../payments/payables.js';
import { appShippingPermission, PERMISSIONS } from '../rbac/permissions.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { ShippingRefusal } from './refusals.js';

export type CustomsColumns = NonNullable<ShippingOrder['customs']>;

const ISO_COUNTRY = /^[A-Z]{2}$/;
const MAX_COUNTRIES = 120;
const MAX_PRODUCTS = 500;
export const MAX_CUSTOMS_LINES = 100;
const MAX_QUANTITY = 1_000_000;
const MAX_VALUE_WIDTH = 24;
const MAX_VALUE_PLACES = 6;

/** The EU's member states: the destinations that ask for product codes. */
export const EU_COUNTRIES: ReadonlySet<string> = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

const OFFICIAL_CODE_LISTS: Readonly<Record<string, string>> = {
  GB: 'https://www.trade-tariff.service.gov.uk/find_commodity',
  US: 'https://hts.usitc.gov/',
};

/** The official code list for a shop's own country, where one is known. No link beats a wrong one. */
export function codeListUrlOf(country: string | null | undefined): string | null {
  return country === null || country === undefined ? null : (OFFICIAL_CODE_LISTS[country] ?? null);
}

/** An HS code as a person types it: 6 to 10 digits, with spaces or dots if they copied them. Blank is allowed. */
const hsText = z
  .string()
  .trim()
  .max(24)
  .refine((value) => value === '' || /^\d{6,10}$/.test(hsDigits(value)), 'An HS code is 6 to 10 digits.');

export function hsDigits(value: string): string {
  return value.replace(/[\s.]/g, '');
}

const countryText = z.string().trim().toUpperCase().regex(ISO_COUNTRY, 'a two-letter country code');
const codeText = z.string().trim().min(1).max(64);

/** A number as a person pastes it: spaces out, capitals in. Blank means the shop has none. */
const numberText = (pattern: RegExp, message: string) =>
  z
    .string()
    .max(40)
    .transform((value) => value.replace(/\s/g, '').toUpperCase())
    .refine((value) => value === '' || pattern.test(value), message);

const exporterBody = z
  .object({
    eori: numberText(/^[A-Z]{2}[A-Z0-9]{6,17}$/, 'An EORI number is a two-letter country code and 6 to 17 letters or digits.').optional(),
    ioss: numberText(/^IM\d{10}$/, 'An IOSS number is IM and 10 digits.').optional(),
    taxId: z.object({ type: z.enum(CUSTOMS_TAX_ID_TYPES), number: numberText(/^[A-Z0-9-]{1,15}$/, 'A tax number is up to 15 letters, digits or dashes.') }).strict().optional(),
  })
  .strict();

const productBody = z
  .object({
    sku: codeText,
    hsCode: hsText.optional(),
    originCountry: countryText.optional(),
    manufacturerCode: codeText.optional(),
  })
  .strict();

/** What the owner saves. Listing no country is how a shop goes back to its own. */
export const internationalBody = z
  .object({
    countries: z.array(countryText).max(MAX_COUNTRIES),
    currency: z.string().regex(/^[A-Z]{3}$/),
    originCountry: countryText,
    description: z.string().trim().max(200).optional(),
    hsCode: hsText.optional(),
    /** The person named on every declaration. Left out, it stays as it was, or is whoever saves this. */
    signerId: z.string().min(1).max(64).optional(),
    products: z
      .array(productBody)
      .max(MAX_PRODUCTS)
      .refine((rows) => new Set(rows.map((row) => row.sku)).size === rows.length, 'A product is listed once.')
      .optional(),
    /** The shop's export numbers. Left out, they stay as they were. A blank removes one. */
    exporter: exporterBody.optional(),
  })
  .strict();

const storedProduct = z
  .object({
    sku: z.string().min(1),
    hsCode: z.string().regex(/^\d{6,10}$/).optional(),
    originCountry: z.string().regex(ISO_COUNTRY).optional(),
    manufacturerCode: z.string().min(1).optional(),
  })
  .strict();

const internationalSchema = z
  .object({
    countries: z.array(z.string().regex(ISO_COUNTRY)),
    currency: z.string().regex(/^[A-Z]{3}$/),
    originCountry: z.string().regex(ISO_COUNTRY),
    description: z.string().min(1).optional(),
    hsCode: z.string().regex(/^\d{6,10}$/).optional(),
    signerId: z.string().min(1),
    products: z.array(storedProduct),
    exporter: customsExporterSchema.optional(),
  })
  .strict();

export type InternationalSettings = z.infer<typeof internationalSchema>;

/** The shop's international settings as read, or nothing when what is stored is not one. */
export function readInternational(stored: unknown): InternationalSettings | null {
  const parsed = internationalSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

/** A form's values as stored: blanks out, codes as bare digits, countries once each. */
export function cleanInternational(body: z.infer<typeof internationalBody>, signerId: string, before: InternationalSettings | null = null): InternationalSettings {
  const hs = hsDigits(body.hsCode ?? '');
  const exporter = body.exporter === undefined ? before?.exporter : cleanExporter(body.exporter);
  return internationalSchema.parse({
    countries: [...new Set(body.countries)].sort(),
    currency: body.currency,
    originCountry: body.originCountry,
    ...(body.description === undefined || body.description === '' ? {} : { description: body.description }),
    ...(hs === '' ? {} : { hsCode: hs }),
    signerId,
    products: (body.products ?? []).map(({ sku, hsCode, originCountry, manufacturerCode }) => {
      const own = hsDigits(hsCode ?? '');
      return { sku, ...(own === '' ? {} : { hsCode: own }), ...(originCountry === undefined ? {} : { originCountry }), ...(manufacturerCode === undefined ? {} : { manufacturerCode }) };
    }),
    ...(exporter === undefined ? {} : { exporter }),
  });
}

/** The numbers a form holds, with the blanks gone. Nothing at all when none is left. */
function cleanExporter(body: z.infer<typeof exporterBody>): CustomsExporter | undefined {
  const out: CustomsExporter = {
    ...(body.eori === undefined || body.eori === '' ? {} : { eori: body.eori }),
    ...(body.ioss === undefined || body.ioss === '' ? {} : { ioss: body.ioss }),
    ...(body.taxId === undefined || body.taxId.number === '' ? {} : { taxId: body.taxId }),
  };
  return Object.keys(out).length === 0 ? undefined : out;
}

/** The countries an order may go to: none, unless the shop listed some and its app says where the goods are. */
export function deliversTo(columns: CustomsColumns | undefined, settings: InternationalSettings | null): readonly string[] {
  return columns === undefined || settings === null ? [] : settings.countries;
}

const lineEdit = z
  .object({
    line: z.string().min(1).max(64),
    description: z.string().trim().min(1).max(200).optional(),
    hsCode: hsText.optional(),
    manufacturerCode: codeText.optional(),
  })
  .strict();

/** The tick, with the corrections a person made. Quantities and values are not among them. */
export const customsQuoteBody = z
  .object({
    certified: z.literal(true),
    lines: z.array(lineEdit).max(MAX_CUSTOMS_LINES).optional(),
  })
  .strict();

const customsChoiceSchema = z
  .object({
    certifiedBy: z.string().min(1),
    edits: z.array(lineEdit).max(MAX_CUSTOMS_LINES),
  })
  .strict();

/** What a quote keeps of the declaration: who ticked it and what they corrected. */
export type CustomsChoice = z.infer<typeof customsChoiceSchema>;

export function readCustomsChoice(stored: unknown): CustomsChoice | null {
  const parsed = customsChoiceSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

/** A value as an exact decimal above zero, or null. A float from a database is cut to what a price can hold. */
function valueText(value: unknown): string | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(Number(value.toFixed(MAX_VALUE_PLACES)));
  } else if (typeof value === 'string' || typeof value === 'bigint') {
    text = String(value).trim();
  } else {
    return null;
  }
  if (text.length > MAX_VALUE_WIDTH || !/^\d+(\.\d+)?$/.test(text) || !/[1-9]/.test(text)) return null;
  return (text.split('.')[1]?.length ?? 0) > MAX_VALUE_PLACES ? null : text;
}

/** One unit's value from what the whole line cost, exact to six places, half up. Too small to state is no value. */
export function unitValueOf(total: unknown, quantity: number | null): string | null {
  const text = valueText(total);
  if (text === null || quantity === null) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  const millionths = BigInt(`${whole}${fraction.padEnd(MAX_VALUE_PLACES, '0')}`);
  const count = BigInt(quantity);
  const unit = (millionths * 2n + count) / (count * 2n);
  if (unit === 0n) return null;
  const digits = unit.toString().padStart(MAX_VALUE_PLACES + 1, '0');
  const cut = digits.length - MAX_VALUE_PLACES;
  return `${digits.slice(0, cut)}.${digits.slice(cut)}`.replace(/\.?0+$/, '');
}

function quantityOf(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : typeof value === 'bigint' ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 1 && number <= MAX_QUANTITY ? number : null;
}

function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

function weightKgOf(value: unknown, unit: 'g' | 'kg' | undefined): number | null {
  if (unit === undefined || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Number((unit === 'g' ? number / 1000 : number).toFixed(6));
}

export interface GoodsLine {
  key: string;
  description: string | null;
  quantity: number | null;
  unitValue: string | null;
  sku?: string;
  /** One unit's net weight, when the app keeps it. */
  unitWeightKg: number | null;
}

/** The order's goods as its app keeps them, in a steady order. */
export async function readGoods(
  input: { sources: Pick<PayableSources, 'table'>; tableOf: (ref: string) => Promise<ResolvedTable>; connectionId: string; columns: CustomsColumns; order: Row; orderTable: Pick<ResolvedTable, 'primaryKey'> },
): Promise<GoodsLine[]> {
  const { sources, tableOf, connectionId, columns, order, orderTable } = input;
  const notMapped = () => new ShippingRefusal('CUSTOMS_NOT_DECLARED', 'This app does not say where an order\'s goods are.');
  const { lines } = columns;
  const lineTable = await tableOf(lines.table);
  const lineKey = lineTable.primaryKey[0];
  const orderKey = orderTable.primaryKey[0];
  if (lineKey === undefined || lineTable.primaryKey.length !== 1 || orderKey === undefined || orderTable.primaryKey.length !== 1) throw notMapped();
  const found = await sources.table(connectionId, lineTable.id);
  if (found === null) throw notMapped();
  const { db } = found.target;
  const valueColumn = lines.unitValue ?? lines.lineTotal;
  if (valueColumn === undefined) throw notMapped();
  const wanted = [...new Set([lineKey, lines.quantity, valueColumn, lines.description, ...(lines.sku === undefined ? [] : [lines.sku]), ...(lines.unitWeight === undefined ? [] : [lines.unitWeight]), ...(lines.product === undefined ? [] : [lines.product.column])])];
  const rows = (await db
    .selectFrom(lineTable.id)
    .select(wanted.map((column) => db.dynamic.ref<string>(column)))
    .where((eb) => eb(db.dynamic.ref(lines.order), '=', order[orderKey]))
    .$if(lines.unlessSet !== undefined, (query) => query.where((eb) => eb(db.dynamic.ref(lines.unlessSet!), 'is', null)))
    .orderBy(db.dynamic.ref(lineKey))
    .limit(MAX_CUSTOMS_LINES + 1)
    .execute()) as Row[];
  if (rows.length > MAX_CUSTOMS_LINES) throw new ShippingRefusal('CUSTOMS_INCOMPLETE', 'This order has too many lines for one customs declaration.', { problems: [{ field: 'lines' }] });

  const skuByProduct = new Map<string, string>();
  if (lines.product !== undefined && lines.sku === undefined) {
    const { column, table, sku } = lines.product;
    const productTable = await tableOf(table);
    const productKey = productTable.primaryKey[0];
    const products = await sources.table(connectionId, productTable.id);
    if (productKey === undefined || productTable.primaryKey.length !== 1 || products === null) throw notMapped();
    const ids = [...new Set(rows.map((row) => row[column]).filter((id) => id !== null && id !== undefined))];
    if (ids.length > 0) {
      const productDb = products.target.db;
      const found = (await productDb
        .selectFrom(productTable.id)
        .select([productDb.dynamic.ref<string>(productKey), productDb.dynamic.ref<string>(sku)])
        .where((eb) => eb(productDb.dynamic.ref(productKey), 'in', ids as never[]))
        .execute()) as Row[];
      for (const row of found) {
        const code = textOf(row[sku]);
        if (code !== undefined) skuByProduct.set(String(row[productKey]), code);
      }
    }
  }

  return rows.map((row) => {
    const sku = lines.sku === undefined ? (lines.product === undefined ? undefined : skuByProduct.get(String(row[lines.product.column]))) : textOf(row[lines.sku]);
    const quantity = quantityOf(row[lines.quantity]);
    return {
      key: String(row[lineKey]),
      description: textOf(row[lines.description]) ?? null,
      quantity,
      unitValue: lines.unitValue === undefined ? unitValueOf(row[valueColumn], quantity) : valueText(row[valueColumn]),
      ...(sku === undefined ? {} : { sku }),
      unitWeightKg: lines.unitWeight === undefined ? null : weightKgOf(row[lines.unitWeight], lines.weightUnit),
    };
  });
}

export interface CustomsProblem {
  line?: string;
  field: 'lines' | 'description' | 'quantity' | 'unitValue' | 'currency' | 'originCountry' | 'weight';
}

export interface CustomsWarning {
  line: string;
  field: 'hsCode' | 'skuCode' | 'manufacturerCode';
}

export interface DeclaredLine {
  line: string;
  description: string | null;
  quantity: number | null;
  unitValue: string | null;
  originCountry: string;
  hsCode?: string;
  skuCode?: string;
  manufacturerCode?: string;
  unitWeightKg: number | null;
}

export interface CustomsDraft {
  currency: string | null;
  lines: DeclaredLine[];
  problems: CustomsProblem[];
  warnings: CustomsWarning[];
}

/**
 * The order's goods with the shop's defaults and a person's corrections on
 * them. A product's own code beats the shop's, and a correction beats both.
 */
export function draftOf(goods: readonly GoodsLine[], settings: InternationalSettings, orderCurrency: unknown, to: Pick<Address, 'country'>, edits: CustomsChoice['edits'] = []): CustomsDraft {
  const stated = textOf(orderCurrency)?.toUpperCase();
  const currency = stated === undefined ? settings.currency : /^[A-Z]{3}$/.test(stated) ? stated : null;
  const problems: CustomsProblem[] = currency === null ? [{ field: 'currency' }] : [];
  const warnings: CustomsWarning[] = [];
  if (goods.length === 0) problems.push({ field: 'lines' });
  const known = new Set(goods.map((line) => line.key));
  for (const edit of edits) if (!known.has(edit.line)) problems.push({ line: edit.line, field: 'lines' });
  const lines = goods.map((good): DeclaredLine => {
    const edit = edits.find((one) => one.line === good.key);
    const product = good.sku === undefined ? undefined : settings.products.find((one) => one.sku === good.sku);
    // The line's own name first: a shop-wide default over it would declare one product as another on a single tick.
    const description = edit?.description ?? good.description ?? settings.description ?? null;
    const editedHs = edit?.hsCode === undefined ? '' : hsDigits(edit.hsCode);
    const hsCode = editedHs !== '' ? editedHs : (product?.hsCode ?? settings.hsCode);
    const manufacturerCode = edit?.manufacturerCode ?? product?.manufacturerCode;
    const originCountry = product?.originCountry ?? settings.originCountry;
    if (description === null) problems.push({ line: good.key, field: 'description' });
    if (good.quantity === null) problems.push({ line: good.key, field: 'quantity' });
    if (good.unitValue === null) problems.push({ line: good.key, field: 'unitValue' });
    if (hsCode === undefined) warnings.push({ line: good.key, field: 'hsCode' });
    // Goods made outside the EU and sold into it: both codes, by the rule carriers now apply.
    if (EU_COUNTRIES.has(to.country) && !EU_COUNTRIES.has(originCountry)) {
      if (good.sku === undefined) warnings.push({ line: good.key, field: 'skuCode' });
      if (manufacturerCode === undefined) warnings.push({ line: good.key, field: 'manufacturerCode' });
    }
    return {
      line: good.key,
      description,
      quantity: good.quantity,
      unitValue: good.unitValue,
      originCountry,
      ...(hsCode === undefined ? {} : { hsCode }),
      ...(good.sku === undefined ? {} : { skuCode: good.sku }),
      ...(manufacturerCode === undefined ? {} : { manufacturerCode }),
      unitWeightKg: good.unitWeightKg,
    };
  });
  return { currency, lines, problems, warnings };
}

/**
 * Each unit's net weight in kg. Where the app keeps none, the parcel's weight
 * is shared across its units, rounded down so the lines never add up to more
 * than the parcel. A parcel lighter than its goods is a wrong weight, and is
 * refused rather than declared.
 */
function unitWeights(lines: readonly DeclaredLine[], parcelKg: number): number[] | null {
  const units = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  if (units <= 0) return null;
  if (lines.every((line) => line.unitWeightKg !== null)) {
    const total = lines.reduce((sum, line) => sum + line.unitWeightKg! * line.quantity!, 0);
    return total > parcelKg + 1e-6 ? null : lines.map((line) => line.unitWeightKg!);
  }
  const each = Math.floor((parcelKg / units) * 1000) / 1000;
  return each < 0.001 ? null : lines.map(() => each);
}

/** The most an IOSS number may cover, in euros, with six decimal places. */
const IOSS_CEILING = 150_000_000n;

/** The goods' total in millionths of the currency, or null if a line has no value yet. */
function totalMillionths(lines: readonly DeclaredLine[]): bigint | null {
  let total = 0n;
  for (const line of lines) {
    if (line.quantity === null || line.unitValue === null) return null;
    const [whole = '0', fraction = ''] = line.unitValue.split('.');
    total += BigInt(`${whole}${fraction.padEnd(MAX_VALUE_PLACES, '0')}`) * BigInt(line.quantity);
  }
  return total;
}

/**
 * The shop's numbers that belong on this parcel. An IOSS number covers goods
 * sold into the EU, up to 150 euros, so it stays off any other parcel and off
 * one in euros above that. No exchange rate is guessed for another currency.
 */
export function exporterFor(settings: InternationalSettings, to: Pick<Address, 'country'>, draft: CustomsDraft): CustomsExporter | undefined {
  if (settings.exporter === undefined) return undefined;
  const { eori, ioss, taxId } = settings.exporter;
  const total = draft.currency === 'EUR' ? totalMillionths(draft.lines) : null;
  const iossFits = ioss !== undefined && EU_COUNTRIES.has(to.country) && (draft.currency !== 'EUR' || (total !== null && total <= IOSS_CEILING));
  const out: CustomsExporter = { ...(eori === undefined ? {} : { eori }), ...(iossFits ? { ioss } : {}), ...(taxId === undefined ? {} : { taxId }) };
  return Object.keys(out).length === 0 ? undefined : out;
}

/** The declaration a carrier is given, or a refusal saying which lines stop it. */
export function declarationOf(draft: CustomsDraft, signer: string, parcelKg: number, exporter?: CustomsExporter): CustomsDeclaration {
  const refuse = (problems: readonly CustomsProblem[]) => new ShippingRefusal('CUSTOMS_INCOMPLETE', 'The customs details for this order are not complete.', { problems });
  if (draft.problems.length > 0 || draft.currency === null) throw refuse(draft.problems);
  const weights = unitWeights(draft.lines, parcelKg);
  if (weights === null) throw refuse([{ field: 'weight' }]);
  const currency = draft.currency;
  const items = draft.lines.map((line, index): CustomsItem => ({
    description: line.description!,
    quantity: line.quantity!,
    unitValue: line.unitValue!,
    currency,
    unitWeightKg: weights[index]!,
    originCountry: line.originCountry,
    ...(line.hsCode === undefined ? {} : { hsCode: line.hsCode }),
    ...(line.skuCode === undefined ? {} : { skuCode: line.skuCode }),
    ...(line.manufacturerCode === undefined ? {} : { manufacturerCode: line.manufacturerCode }),
  }));
  // A shop's order is a sale, and undelivered goods come back to it.
  return { contents: 'merchandise', signer, certified: true, nonDelivery: 'return', items, ...(exporter === undefined ? {} : { exporter }) };
}

/** A person's name, while they may still sign for this install. Asked of their real grants, never of a role's name. */
export async function signerName(meta: MetaDb, install: InstalledManifest, signerId: string): Promise<string | null> {
  const user = await usersRepo(meta).findById(signerId);
  if (user === null || user.status !== 'active' || user.name.trim() === '') return null;
  const set = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.name });
  const may = permissionSetAllows(set, PERMISSIONS.shippingManage) || permissionSetAllows(set, appShippingPermission(grantKeyOf(install.row), 'customs'));
  return may ? user.name : null;
}

/** How many people a shop's signer list looks through. */
const SIGNER_SCAN = 500;

/** The people who may be named on a declaration: those holding the customs right, and no one else. */
export async function customsSigners(meta: MetaDb, install: InstalledManifest): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const user of await usersRepo(meta).list({ status: 'active', limit: SIGNER_SCAN })) {
    const name = await signerName(meta, install, user.id);
    if (name !== null) out.push({ id: user.id, name });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
}
