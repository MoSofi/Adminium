/**
 * Server-side translator wiring (23-runtime-translations.md §9).
 *
 * `@adminium/i18n/server` builds the instance; this module is what reaches
 * the meta store for the override rows and resolves a recipient's locale.
 *
 * SEQUENCING NOTE: no email is SENT in this build — there is no SMTP
 * transport (see `routes/email-templates/index.ts`). So the deliverable here
 * is the renderer path, exercised by snapshot tests, not delivery. When a
 * transport lands it consumes this unchanged.
 */
import { NAMESPACES, type Namespace, type OverrideMap } from '@adminium/i18n';
import { createServerI18n, type I18nInstance } from '@adminium/i18n/server';
import { translationsRepo, userPrefsRepo, type MetaDb } from '@adminium/meta';

/** Every override row for one locale, in the shape the override layer wants. */
export async function loadOverrideMap(meta: MetaDb, locale: string): Promise<OverrideMap> {
  const translations = translationsRepo(meta);
  const map: Record<string, Partial<Record<Namespace, Record<string, string>>>> = {};

  // en-US too: it is the fallback text, so an override on it must be present
  // or a key this locale does not translate renders the compiled English
  // instead of the operator's wording.
  for (const id of new Set([locale, 'en_US'])) {
    const rows = await translations.listLocale(id);
    if (rows.length === 0) continue;
    const tag = id.replaceAll('_', '-');
    for (const row of rows) {
      if (!(NAMESPACES as readonly string[]).includes(row.namespace)) continue;
      const byNs = (map[tag] ??= {});
      const ns = row.namespace as Namespace;
      (byNs[ns] ??= {})[row.key] = row.value;
    }
  }
  return map;
}

/**
 * The locale a message to `userId` should render in: their own preference,
 * else the workspace default, else `en_US` (10 §7.6).
 */
export async function recipientLocale(meta: MetaDb, userId: string | null): Promise<string> {
  const resolved = await userPrefsRepo(meta).resolve(userId);
  return resolved.locale;
}

/** Translator for one recipient, overrides included. */
export async function translatorFor(meta: MetaDb, userId: string | null): Promise<I18nInstance> {
  const locale = await recipientLocale(meta, userId);
  return createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
}
