/**
 * The BOOT-PATH slice of the i18n client (23-runtime-translations.md §4.7).
 *
 * Split out from `./i18n.ts` deliberately. The override layer runs before the
 * first paint, so whatever it imports lands in the dashboard's entry chunk —
 * and `check-entry-budget.mjs` is a ratchet that may not be raised to make a
 * build green. Keeping the editor's calls (key search, locale CRUD,
 * import/export, the error sink) in the sibling module means the entry pays
 * only for what booting actually needs: the manifest and the override
 * bundles.
 *
 * SYNC NOTE: types mirror `apps/server/src/routes/i18n/schema.ts`.
 */
import type { Namespace, OverrideMap } from '@adminium/i18n';

import { api } from '../app/api.js';

export interface LocaleManifestEntry {
  locale: string;
  tag: string;
  english: string;
  native: string;
  dir: 'ltr' | 'rtl';
  fontHint: 'latin' | 'arabic' | 'cjk';
  intlTag: string;
  pluralCategories: string[];
  builtin: boolean;
  enabled: boolean;
  sortOrder: number;
  overrideCount: number;
}

export interface I18nManifest {
  version: number;
  locales: LocaleManifestEntry[];
}

export interface I18nBundle {
  locale: string;
  namespace: string;
  version: number;
  /** Flat dotted key → message. OVERRIDES only, never the compiled bundle. */
  overrides: Record<string, string>;
}

/** Namespaces the boot path fetches — the ones that must never be async. */
export const EAGER_NAMESPACES: readonly Namespace[] = ['common', 'ui', 'errors'];

export async function fetchManifest(): Promise<I18nManifest> {
  return api.get<I18nManifest>('/api/v1/i18n/manifest');
}

export async function fetchBundle(locale: string, namespace: Namespace): Promise<I18nBundle> {
  return api.get<I18nBundle>(`/api/v1/i18n/bundle/${encodeURIComponent(locale)}/${namespace}`);
}

/**
 * Every eager namespace for one locale, plus en-US when it is not the active
 * locale — en-US is the fallback text, so an override on it has to be present
 * or a key the active locale does not translate would render the compiled
 * English instead of the admin's.
 */
export async function fetchOverrides(locale: string): Promise<OverrideMap> {
  const tags = new Set([locale, 'en_US']);
  const map: Record<string, Partial<Record<Namespace, Record<string, string>>>> = {};
  await Promise.all(
    [...tags].flatMap((id) =>
      EAGER_NAMESPACES.map(async (ns) => {
        const bundle = await fetchBundle(id, ns);
        if (Object.keys(bundle.overrides).length === 0) return;
        const tag = id.replaceAll('_', '-');
        (map[tag] ??= {})[ns] = bundle.overrides;
      }),
    ),
  );
  return map;
}
