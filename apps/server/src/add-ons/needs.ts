// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which installed apps need an add-on, and how — read from the APPS' own
 * manifests (`addOns.requires / suggests / features`).
 *
 * This is the read behind every guard that stops an add-on being taken from
 * under an app (`DELETE /add-ons/:key`, switching it off for an app, an
 * upgrade that leaves an app's range) and behind the "Used by" list the
 * Add-ons page shows before anyone clicks.
 *
 * ─── Every app row counts, whatever its status ─────────────────────────────
 *
 * The rows are read straight off `adminium_manifests`, never from the served
 * registry, which leaves out a switched-off app and an install that stopped
 * part way. A DISABLED app still holds its requirement — switching it back on
 * must find its add-on there — and an `installing` one is an install "Try
 * again" will finish, which would otherwise quietly install the add-on again
 * (or fail) after someone removed it in between. Only uninstalling releases a
 * requirement.
 *
 * ─── A manifest this server cannot fully read still holds its keys ─────────
 *
 * An app row's document is parsed leniently: when the `addOns` block does not
 * parse as a whole (a server rolled back under a newer app), the keys it lists
 * under `requires` are still read as required. Guessing "requires nothing"
 * there would let an add-on be removed from under an app that plainly names
 * it.
 */
import { addOnsSchema, type AddOnNeeds } from '@adminium/manifest';
import { readJson } from '@adminium/meta';
import type { MetaDb } from '@adminium/meta';

/** How an app names an add-on: required, needed only for a feature, or suggested. */
export type NeedKind = 'requires' | 'feature' | 'suggests';

/** A feature an add-on makes work, with its label in every language the app speaks. */
export interface FeatureNeed {
  id: string;
  label: Readonly<Record<string, string>>;
}

/** One app's need of one add-on. */
export interface AppNeed {
  app: string;
  /** The manifest's own name. */
  appName: string;
  appVersion: string;
  status: string;
  need: NeedKind;
  /** The add-on versions the app works with, or null when the entry could not be read. */
  range: string | null;
  /** The app's features that stop working without this add-on. */
  features: FeatureNeed[];
}

/** The `addOns` block of an app document, read leniently (see the header). */
export function needsOfDocument(document: unknown): AddOnNeeds | undefined {
  const raw = typeof document === 'object' && document !== null ? (document as { addOns?: unknown }).addOns : undefined;
  if (raw === undefined) return undefined;
  const parsed = addOnsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Only the required keys survive a block that does not parse: they are the
  // ones a guard must not lose.
  const requires = (raw as { requires?: unknown }).requires;
  if (!Array.isArray(requires)) return undefined;
  const keys = requires
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { key?: unknown }).key : undefined))
    .filter((key): key is string => typeof key === 'string');
  return keys.length === 0 ? undefined : { requires: keys.map((key) => ({ key, range: '*', reason: { 'en-US': key } })) };
}

/** How `needs` names `key`, or null when it does not. */
export function needKindOf(needs: AddOnNeeds | undefined, key: string): NeedKind | null {
  if ((needs?.requires ?? []).some((need) => need.key === key)) return 'requires';
  if ((needs?.features ?? []).some((feature) => feature.requires.includes(key))) return 'feature';
  if ((needs?.suggests ?? []).some((need) => need.key === key)) return 'suggests';
  return null;
}

/** The range an app gives for `key`, from whichever list names it. */
export function rangeOf(needs: AddOnNeeds | undefined, key: string): string | null {
  return [...(needs?.requires ?? []), ...(needs?.suggests ?? [])].find((need) => need.key === key)?.range ?? null;
}

/** The features of `needs` that name `key`. */
export function featuresNeeding(needs: AddOnNeeds | undefined, key: string): FeatureNeed[] {
  return (needs?.features ?? [])
    .filter((feature) => feature.requires.includes(key))
    .map((feature) => ({ id: feature.id, label: feature.label }));
}

/** Every app row, any status, with its parsed needs. */
export async function appNeedRows(
  meta: MetaDb,
): Promise<{ app: string; appName: string; appVersion: string; status: string; needs: AddOnNeeds | undefined }[]> {
  const rows = await meta.db
    .selectFrom('adminium_manifests')
    .select(['manifestKey', 'version', 'status', 'manifest'])
    .where('kind', '=', 'app')
    .orderBy('manifestKey', 'asc')
    .execute();
  return rows.map((row) => {
    const document = readJson<unknown>(row.manifest);
    const name = typeof document === 'object' && document !== null ? (document as { name?: unknown }).name : undefined;
    return {
      app: row.manifestKey,
      appName: typeof name === 'string' ? name : row.manifestKey,
      appVersion: row.version,
      status: row.status,
      needs: needsOfDocument(document),
    };
  });
}

/** Every app that names `key`, and how. */
export async function needsOf(meta: MetaDb, key: string): Promise<AppNeed[]> {
  const out: AppNeed[] = [];
  for (const row of await appNeedRows(meta)) {
    const need = needKindOf(row.needs, key);
    if (need === null) continue;
    out.push({
      app: row.app,
      appName: row.appName,
      appVersion: row.appVersion,
      status: row.status,
      need,
      range: rangeOf(row.needs, key),
      features: featuresNeeding(row.needs, key),
    });
  }
  return out;
}

/** Every add-on key → the apps that name it; one read for a whole list. */
export async function needsByAddOn(meta: MetaDb): Promise<Map<string, AppNeed[]>> {
  const out = new Map<string, AppNeed[]>();
  for (const row of await appNeedRows(meta)) {
    const keys = new Set([
      ...(row.needs?.requires ?? []).map((need) => need.key),
      ...(row.needs?.suggests ?? []).map((need) => need.key),
    ]);
    for (const key of keys) {
      const need = needKindOf(row.needs, key);
      if (need === null) continue;
      out.set(key, [
        ...(out.get(key) ?? []),
        {
          app: row.app,
          appName: row.appName,
          appVersion: row.appVersion,
          status: row.status,
          need,
          range: rangeOf(row.needs, key),
          features: featuresNeeding(row.needs, key),
        },
      ]);
    }
  }
  return out;
}
