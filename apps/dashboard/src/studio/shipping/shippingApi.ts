// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard side of Studio → Shipping.
 *
 * Mirrors `apps/server/src/routes/shipping/schema.ts` and `tracking.ts`.
 *
 * A KEY IS NEVER KEPT HERE. `saveCarrierKey` is a plain call, not a react-query
 * mutation, because a mutation keeps its variables in the cache for minutes. No
 * reply holds a key: the server sends a hint and what the carrier said of it.
 *
 * WHICH APPS. The apps list needs `manifests.manage`, which someone who only
 * sets up shipping does not hold. The add-ons list is open to every signed-in
 * person and names each carrier's attachments, so the page reads the apps that
 * ship from there and uses the apps list only for a nicer name when it may.
 *
 * WHAT A KEY IS MADE OF comes from the same list: the carrier's `secret`
 * settings, which is what `keyFieldsOf` reads on the server. If the list cannot
 * say, the `KEY_FIELDS` refusal's `expected` does.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, ApiError, installOptions } from '../../app/api.js';
import type { AddOnDto, AddOnSettingDeclaration } from '../add-ons/addOnsApi.js';
import type { InstalledApp } from '../apps/appsApi.js';

/** `SHIPPING_CARRIER_CONTRACT` in `@adminium/add-on-contracts`. */
const CARRIER_CONTRACT = 'shipping-carrier';

export type KeyMode = 'live' | 'test';
export type LabelSize = 'a4' | 'a6' | '4x6';
export const LABEL_SIZES: readonly LabelSize[] = ['a4', 'a6', '4x6'];

export interface CarrierAccount {
  mode: KeyMode;
  keyHint: string;
  state: 'ok' | 'refused';
  /** Display names, ready to show. */
  carriers: string[];
  checkedAt: number;
}

export interface CarrierView {
  key: string;
  name: string;
  locked: boolean;
  on: boolean;
  connected: boolean;
  account: CarrierAccount | null;
  /** Bookings on this key with no final answer yet, with up to 20 order references. While any is open the key cannot change. */
  openBookings: KeyInUse;
}

export interface ShippingStatus {
  appUpdated: boolean;
  carriers: CarrierView[];
  activeCarrier: string | null;
  shipFrom: { country: string } | null;
  shipFromMissing: string[];
  international: false;
  labelSize: LabelSize;
  limits: {
    perLabel: { amount: string; currency: string } | null;
    dailyLabels: number | null;
    packersAbroad: boolean;
    usedToday: number;
  };
}

export type KeyCheck =
  | { outcome: 'ok'; mode: KeyMode; carriers: string[]; country: string | null }
  | { outcome: 'refused'; carrierMessage?: string }
  | { outcome: 'unreachable' };

export interface TrackingView {
  carrier: string;
  webhook: {
    supported: boolean;
    /** The address with its token masked. The full one is shown once, when made. */
    address: string | null;
    made: boolean;
    /** An address was made and its key was then replaced or removed: the carrier must be given a new one. */
    ended: boolean;
    /** Whether this server has a public https address a carrier could call. */
    publicAddress: boolean;
    /** Null unless an address is live. */
    madeAt: number | null;
    firstAt: number | null;
    /** The last webhook accepted. A person's Refresh never sets this. */
    lastAt: number | null;
    lastBadAt: number | null;
  };
  parcels: { open: number; neverChecked: number; oldestCheckedAt: number | null; quiet: number };
  polling: { allowed: boolean; on: boolean };
}

/** One app install that has a carrier attached. */
export interface ShippingApp {
  key: string;
  installId: string;
  connectionId: string | null;
  connectionName: string | null;
  name: string;
}

// ─── Which apps ship ────────────────────────────────────────────────────────

/** `print-shop` as "Print shop": for someone who may not read the apps list. */
function readableKey(key: string): string {
  const words = key.replace(/[-_]+/g, ' ').trim();
  return words === '' ? key : words.charAt(0).toUpperCase() + words.slice(1);
}

export function shippingAppsOf(addOns: readonly AddOnDto[], installed: readonly InstalledApp[]): ShippingApp[] {
  const known = new Map(installed.flatMap((app) => (app.installId === undefined ? [] : [[app.installId, app] as const])));
  const out = new Map<string, ShippingApp>();
  for (const addOn of addOns) {
    if (!addOn.provides.some((entry) => entry.contract === CARRIER_CONTRACT)) continue;
    for (const attachment of addOn.attachments) {
      const installId = attachment.hostInstall ?? '';
      // No host install: the app it names is not installed.
      if (installId === '' || out.has(installId)) continue;
      const app = known.get(installId);
      out.set(installId, {
        key: attachment.attachedTo,
        installId,
        connectionId: app?.connectionId ?? attachment.connectionId ?? null,
        connectionName: app?.connectionName ?? addOn.connectionName ?? null,
        name: app?.name ?? readableKey(attachment.attachedTo),
      });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.installId.localeCompare(b.installId));
}

/** The secret fields a carrier's key is made of, from this database's copy of the add-on. */
export function keyFieldsFor(addOns: readonly AddOnDto[], carrier: string, connectionId: string | null): AddOnSettingDeclaration[] {
  const copies = addOns.filter((addOn) => addOn.key === carrier);
  const copy = copies.find((addOn) => addOn.connectionId === connectionId) ?? copies.find((addOn) => addOn.connectionId === null) ?? copies[0];
  return (copy?.settings ?? []).filter((setting) => setting.secret);
}

// ─── Reads ──────────────────────────────────────────────────────────────────

const base = (app: ShippingApp) => `/api/v1/apps/${encodeURIComponent(app.key)}/shipping`;
const carrierBase = (app: ShippingApp, carrier: string) => `${base(app)}/carriers/${encodeURIComponent(carrier)}`;
const scoped = (app: ShippingApp) => installOptions(app.installId);

export const SHIPPING_QUERY_KEY = ['studio-shipping'] as const;
export const shippingStatusKey = (app: ShippingApp) => [...SHIPPING_QUERY_KEY, 'status', app.installId] as const;
export const shippingTrackingKey = (app: ShippingApp, carrier: string) => [...SHIPPING_QUERY_KEY, 'tracking', app.installId, carrier] as const;

export function shippingStatusQuery(app: ShippingApp) {
  return queryOptions({
    queryKey: shippingStatusKey(app),
    queryFn: async () => (await api.get<{ data: ShippingStatus }>(base(app), scoped(app))).data,
  });
}

export function shippingTrackingQuery(app: ShippingApp, carrier: string) {
  return queryOptions({
    queryKey: shippingTrackingKey(app, carrier),
    queryFn: async () => (await api.get<{ data: TrackingView }>(`${carrierBase(app, carrier)}/tracking`, scoped(app))).data,
  });
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export async function setActiveCarrier(app: ShippingApp, carrier: string): Promise<ShippingStatus> {
  return (await api.put<{ data: ShippingStatus }>(`${base(app)}/active-carrier`, { carrier }, scoped(app))).data;
}

/** Checked with the carrier before it is saved. The values go out once, and the caller drops them. */
export async function saveCarrierKey(app: ShippingApp, carrier: string, fields: Readonly<Record<string, string>>, confirmAccountChange: boolean): Promise<ShippingStatus> {
  const body = confirmAccountChange ? { fields, confirmAccountChange: true } : { fields };
  return (await api.put<{ data: ShippingStatus }>(`${carrierBase(app, carrier)}/key`, body, scoped(app))).data;
}

export async function checkCarrier(app: ShippingApp, carrier: string): Promise<KeyCheck> {
  return (await api.post<{ data: KeyCheck }>(`${carrierBase(app, carrier)}/check`, undefined, scoped(app))).data;
}

export async function saveLabelSize(app: ShippingApp, size: LabelSize): Promise<LabelSize> {
  return (await api.put<{ data: { labelSize: LabelSize } }>(`${base(app)}/label-size`, { size }, scoped(app))).data.labelSize;
}

export interface LimitsBody {
  perLabel: { amount: string; currency: string } | null;
  dailyLabels: number | null;
}

export async function saveLimits(app: ShippingApp, body: LimitsBody): Promise<ShippingStatus> {
  return (await api.put<{ data: ShippingStatus }>(`${base(app)}/limits`, body, scoped(app))).data;
}

/** Makes the address. The reply is the only time the full one exists outside the carrier. */
export async function makeWebhook(app: ShippingApp, carrier: string): Promise<{ address: string; madeAt: number }> {
  return (await api.post<{ data: { address: string; madeAt: number } }>(`${carrierBase(app, carrier)}/webhook`, undefined, scoped(app))).data;
}

// ─── Refusals: read by their stable code, never by their sentence ───────────

export function refusalCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

function detailsOf(error: unknown): Record<string, unknown> {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || error.details === null) return {};
  return error.details as Record<string, unknown>;
}

export interface KeyInUse {
  count: number;
  orders: string[];
}

export function keyInUseOf(error: unknown): KeyInUse | null {
  if (refusalCode(error) !== 'KEY_IN_USE') return null;
  const details = detailsOf(error);
  const orders = Array.isArray(details['orders']) ? details['orders'].filter((one): one is string => typeof one === 'string') : [];
  return { count: typeof details['count'] === 'number' ? details['count'] : orders.length, orders };
}

export interface OtherAccount {
  fromMode: KeyMode | null;
  fromHint: string | null;
  toMode: KeyMode | null;
}

const modeOf = (value: unknown): KeyMode | null => (value === 'live' || value === 'test' ? value : null);

export function otherAccountOf(error: unknown): OtherAccount | null {
  if (refusalCode(error) !== 'KEY_OTHER_ACCOUNT') return null;
  const details = detailsOf(error);
  const from = (details['from'] ?? {}) as { mode?: unknown; keyHint?: unknown };
  const to = (details['to'] ?? {}) as { mode?: unknown };
  return { fromMode: modeOf(from.mode), fromHint: typeof from.keyHint === 'string' ? from.keyHint : null, toMode: modeOf(to.mode) };
}

/** The field names a `KEY_FIELDS` refusal says the key is made of. */
export function expectedFieldsOf(error: unknown): string[] | null {
  if (refusalCode(error) !== 'KEY_FIELDS') return null;
  const expected = detailsOf(error)['expected'];
  return Array.isArray(expected) ? expected.filter((one): one is string => typeof one === 'string') : null;
}

/** The server is set to work offline: a different fix from a carrier that did not answer. */
export function isNetworkOff(error: unknown): boolean {
  return refusalCode(error) === 'CARRIER_UNAVAILABLE' && detailsOf(error)['reason'] === 'network-off';
}
