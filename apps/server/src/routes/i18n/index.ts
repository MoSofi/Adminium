// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runtime-translations routes (23-runtime-translations.md §6), mounted under
 * `/api/v1/i18n`.
 *
 *   GET    /i18n/manifest              — version stamp + the locale registry
 *   GET    /i18n/bundle/:locale/:ns    — this locale's OVERRIDES (not the bundle)
 *   GET    /i18n/keys                  — paged key browser for the editor
 *   PUT    /i18n/keys                  — upsert one override
 *   DELETE /i18n/keys                  — reset one key to the built-in
 *   POST   /i18n/keys/bulk             — batch upsert, item-wise rejection
 *   GET    /i18n/format-errors         — ICU failures observed at render time
 *   GET/POST/PATCH/DELETE /i18n/locales — the locale registry
 *
 * Reads need a session; writes are guarded by `system:settings:manage`,
 * exactly as email templates are (`json-payloads.ts`: "Email templates
 * deliberately add NO key: PUT rides the existing settings.manage"). A
 * dedicated `translations.manage` key is deliberately NOT added — there is no
 * roles UI to grant it to anyone yet, so it would cost a closed-set change and
 * a role-row migration and buy nothing (23 Open decision 3).
 *
 * NOTHING here is anonymous. `GET /bootstrap` is session-bound, so an
 * unauthenticated i18n route would be the first unauthenticated DB-backed
 * admin-authored-content route in the API — on public marketplace demo
 * instances that is an unbounded anonymous read (23 §6.1).
 *
 * Key SEARCH runs in-process over the compiled en-US index; the database is
 * only ever asked for an `(namespace, key) IN (…)` slice. A portable
 * `LIKE '%q%'` scan over a table that grows with every override is the thing
 * this avoids.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  LOCALES,
  NAMESPACES,
  formatFailures,
  isBuiltinLocaleId,
  loadLocaleBundle,
  localeEntry,
  pluralCategoriesForLocale,
  setRuntimeLocales,
  tagFromLocaleId,
  type Namespace,
  type RuntimeLocaleEntry,
} from '@adminium/i18n';
import {
  flattenBundle,
  isA11yCriticalKey,
  keyGroup,
  sourceIndex,
  sourceMessage,
  validateMessage,
} from '@adminium/i18n/editing';
import {
  emailTemplatesRepo,
  localesRepo,
  readI18nVersion,
  settingsRepo,
  translationsRepo,
  userPrefsRepo,
  type LocaleRow,
  type MetaDb,
} from '@adminium/meta';

import { AppError, ForbiddenError, NotFoundError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { buildExport, parseImport } from './transfer.js';
import {
  bundleParams,
  bulkKeysBody,
  bulkKeysReply,
  createLocaleBody,
  deleteKeyQuery,
  deleteLocaleQuery,
  deleteLocaleReply,
  formatFailuresReply,
  importQuery,
  translationExportReply,
  translationImportBody,
  translationImportReply,
  i18nBundleReply,
  i18nManifestReply,
  keysQuery,
  keysReply,
  localeMutationReply,
  localeParams,
  patchLocaleBody,
  upsertKeyBody,
  writeKeyReply,
  type KeyRowView,
  type LocaleManifestEntry,
} from './schema.js';

/** Realtime event type carried on the `config-changed` channel. */
export const I18N_CHANGED = 'i18n.changed';

/**
 * Namespaces a browser downloads overrides for — what the budget in §6.4 is
 * measured over.
 *
 * `studio` joined the list in 10-T06 without changing what the number means.
 * Its 975 messages used to live under `common.studio.*` and were counted
 * here; they are their own namespace now, fetched when the Studio opens
 * rather than at boot. LATER is not FREE — the bytes still cross the wire to
 * the same browser — so dropping them out of the cap would have quietly
 * doubled what one locale can be made to carry.
 *
 * `generated` is still out, and correctly: nothing fetches overrides for it.
 */
const BUDGETED_NAMESPACES: readonly Namespace[] = ['common', 'ui', 'errors', 'studio'];

/**
 * 256 KiB per locale across the budgeted namespaces. Measured, not guessed:
 * the whole en-US surface those namespaces cover is ~163 KB / 2,770 keys, so
 * this is ~1.5x a complete re-authoring and only ever fires on abuse.
 */
const MAX_OVERRIDE_BYTES_PER_LOCALE = 256 * 1024;

export interface I18nRoutesDeps {
  meta: MetaDb;
}

/** Compiled translations per (tag, ns), loaded once and cached per process. */
const compiledCache = new Map<string, ReadonlyMap<string, string>>();

async function compiledBundle(tag: string, ns: Namespace): Promise<ReadonlyMap<string, string>> {
  const cacheKey = `${tag}/${ns}`;
  const hit = compiledCache.get(cacheKey);
  if (hit !== undefined) return hit;
  const mod = await loadLocaleBundle(tag, ns);
  const flat = mod === null ? new Map<string, string>() : flattenBundle(mod.default);
  compiledCache.set(cacheKey, flat);
  return flat;
}

/** Merge the compiled registry with DB rows into the manifest shape. */
function toManifest(rows: readonly LocaleRow[], counts: ReadonlyMap<string, number>): LocaleManifestEntry[] {
  const byLocale = new Map(rows.map((r) => [r.locale, r]));
  const out: LocaleManifestEntry[] = [];

  for (const compiled of LOCALES) {
    const row = byLocale.get(compiled.id);
    out.push({
      locale: compiled.id,
      tag: compiled.tag,
      english: compiled.english,
      native: compiled.native,
      dir: compiled.dir,
      fontHint: compiled.fontHint,
      intlTag: compiled.tag,
      pluralCategories: [...new Intl.PluralRules(compiled.tag).resolvedOptions().pluralCategories],
      builtin: true,
      // A built-in row may only carry these two — everything else above comes
      // from the compiled registry (23 §3.1 field lock).
      enabled: row?.enabled ?? true,
      sortOrder: row?.sortOrder ?? 0,
      overrideCount: counts.get(compiled.id) ?? 0,
    });
  }

  for (const row of rows) {
    if (row.isBuiltin || isBuiltinLocaleId(row.locale)) continue;
    out.push({
      locale: row.locale,
      tag: tagFromLocaleId(row.locale),
      english: row.english ?? row.locale,
      native: row.native ?? row.locale,
      dir: row.dir ?? 'ltr',
      fontHint: row.fontHint ?? 'latin',
      intlTag: row.intlTag ?? tagFromLocaleId(row.locale),
      pluralCategories: row.pluralCategories ?? ['other'],
      builtin: false,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      overrideCount: counts.get(row.locale) ?? 0,
    });
  }

  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.locale.localeCompare(b.locale));
}

/** Manifest entries → the shape `@adminium/i18n`'s runtime registry wants. */
function toRuntimeEntries(entries: readonly LocaleManifestEntry[]): RuntimeLocaleEntry[] {
  return entries.map((e) => ({
    id: e.locale,
    tag: e.tag,
    english: e.english,
    native: e.native,
    dir: e.dir,
    fontHint: e.fontHint,
    builtin: e.builtin,
    enabled: e.enabled,
    sortOrder: e.sortOrder,
    intlTag: e.intlTag,
    pluralCategories: e.pluralCategories,
  }));
}

export function i18nRoutes(deps: I18nRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const locales = localesRepo(meta);
  const translations = translationsRepo(meta);
  const settings = settingsRepo(meta);
  const prefs = userPrefsRepo(meta);
  const emailTemplates = emailTemplatesRepo(meta);

  async function manifest(): Promise<{ version: number; locales: LocaleManifestEntry[] }> {
    const [version, rows, counts] = await Promise.all([
      readI18nVersion(meta.db),
      locales.list(),
      translations.countsByLocale(),
    ]);
    const entries = toManifest(rows, counts);
    // Keep THIS process's registry current too: the server resolves label
    // locales, email locales and pref directions through the same helpers.
    setRuntimeLocales(toRuntimeEntries(entries));
    return { version, locales: entries };
  }

  async function requireManage(request: { can: (p: string) => Promise<boolean> }): Promise<void> {
    if (!(await request.can(PERMISSIONS.settingsManage))) {
      throw new ForbiddenError('You do not have permission to edit translations.', 'FORBIDDEN', {
        permission: PERMISSIONS.settingsManage,
      });
    }
  }

  /** Shared write validation (23 §6.3). Returns an error message or null. */
  async function rejectReason(input: {
    locale: string;
    namespace: Namespace;
    key: string;
    value: string;
  }): Promise<string | null> {
    const source = sourceMessage(input.namespace, input.key);
    if (source === null) return `Unknown key ${input.namespace}:${input.key}.`;

    if (input.value === '' && isA11yCriticalKey(input.namespace, input.key)) {
      // No CI gate in this repo can observe a blanked accessible name — the
      // axe ratchet only sees @adminium/ui stories, never a t() key, let alone
      // a database row (23 §3.3).
      return 'This string is an accessible name and cannot be left blank. Translate it instead.';
    }

    const result = validateMessage({
      candidate: input.value,
      source,
      locale: input.locale,
      allowEmpty: true,
    });
    return result.ok ? null : result.errors.map((e) => e.message).join(' ');
  }

  async function assertBudget(locale: string, addedBytes: number): Promise<void> {
    const current = await translations.byteSize(locale, BUDGETED_NAMESPACES);
    if (current + addedBytes > MAX_OVERRIDE_BYTES_PER_LOCALE) {
      throw new AppError(
        422,
        'ERR_I18N_BUDGET_EXCEEDED',
        `This locale's overrides would exceed the ${Math.round(MAX_OVERRIDE_BYTES_PER_LOCALE / 1024)} KiB budget.`,
      );
    }
  }

  return async (app) => {
    async function announce(at: number): Promise<number> {
      const version = await readI18nVersion(meta.db);
      app.realtime.publish('config-changed', I18N_CHANGED, { version }, at);
      return version;
    }

    // --- manifest + bundle (session) -----------------------------------------

    app.get('/i18n/manifest', { schema: { response: { 200: i18nManifestReply } } }, async () =>
      manifest(),
    );

    app.get(
      '/i18n/bundle/:locale/:namespace',
      {
        schema: {
          params: bundleParams,
          response: { 200: i18nBundleReply },
        },
      },
      async (request) => {
        const { locale, namespace } = request.params;
        const [rows, version] = await Promise.all([
          translations.listBundle(locale, namespace),
          readI18nVersion(meta.db),
        ]);
        const overrides: Record<string, string> = {};
        for (const row of rows) overrides[row.key] = row.value;
        return { locale, namespace, version, overrides };
      },
    );

    app.get('/i18n/format-errors', { schema: { response: { 200: formatFailuresReply } } }, async (request) => {
      await requireManage(request);
      return { items: [...formatFailures()] };
    });

    // --- key browser ----------------------------------------------------------

    app.get('/i18n/keys', { schema: { querystring: keysQuery, response: { 200: keysReply } } }, async (request) => {
      await requireManage(request);
      const { locale, namespace, group, q, state, offset, limit } = request.query;

      const index = sourceIndex();
      const namespaces = namespace === undefined ? NAMESPACES : [namespace];
      const needle = q?.trim().toLowerCase() ?? '';

      // 1. Candidate keys from the COMPILED index — in process, no DB scan.
      const candidates: { namespace: Namespace; key: string; source: string }[] = [];
      const groupCounts = new Map<string, number>();
      for (const ns of namespaces) {
        const bundle = index.get(ns);
        if (bundle === undefined) continue;
        for (const [key, source] of bundle) {
          const g = keyGroup(key);
          groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
          if (group !== undefined && g !== group) continue;
          if (
            needle !== '' &&
            !key.toLowerCase().includes(needle) &&
            !source.toLowerCase().includes(needle)
          ) {
            continue;
          }
          candidates.push({ namespace: ns, key, source });
        }
      }
      candidates.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.key.localeCompare(b.key));

      // 2. Override rows for exactly those keys.
      const byNs = new Map<Namespace, string[]>();
      for (const c of candidates) {
        const list = byNs.get(c.namespace) ?? [];
        list.push(c.key);
        byNs.set(c.namespace, list);
      }
      const overrides = new Map<string, { value: string; sourceText: string | null; updatedAt: number }>();
      for (const [ns, keys] of byNs) {
        // Chunked so a namespace-wide selection cannot build a 1,500-term IN.
        for (let i = 0; i < keys.length; i += 500) {
          const rows = await translations.listKeys(locale, ns, keys.slice(i, i + 500));
          for (const row of rows) {
            overrides.set(`${ns}:${row.key}`, {
              value: row.value,
              sourceText: row.sourceText,
              updatedAt: row.updatedAt,
            });
          }
        }
      }

      // 3. Compiled translations, for the "built-in" column.
      const tag = tagFromLocaleId(locale);
      const compiled = new Map<Namespace, ReadonlyMap<string, string>>();
      for (const ns of namespaces) compiled.set(ns, await compiledBundle(tag, ns));

      const rows: KeyRowView[] = candidates.map((c) => {
        const override = overrides.get(`${c.namespace}:${c.key}`);
        return {
          namespace: c.namespace,
          key: c.key,
          source: c.source,
          builtin: compiled.get(c.namespace)?.get(c.key) ?? null,
          override: override?.value ?? null,
          stale: override !== undefined && override.sourceText !== null && override.sourceText !== c.source,
          a11yCritical: isA11yCriticalKey(c.namespace, c.key),
          updatedAt: override?.updatedAt ?? null,
        };
      });

      const filtered = rows.filter((row) => {
        if (state === 'overridden') return row.override !== null;
        if (state === 'stale') return row.stale;
        if (state === 'untranslated') return row.override === null && row.builtin === null;
        return true;
      });

      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        groups: [...groupCounts.entries()]
          .map(([g, count]) => ({ group: g, count }))
          .sort((a, b) => a.group.localeCompare(b.group)),
        version: await readI18nVersion(meta.db),
      };
    });

    // --- writes ---------------------------------------------------------------

    app.put('/i18n/keys', { schema: { body: upsertKeyBody, response: { 200: writeKeyReply } } }, async (request) => {
      await requireManage(request);
      const { locale, namespace, key, value } = request.body;
      const reason = await rejectReason({ locale, namespace, key, value });
      if (reason !== null) throw new AppError(422, 'ERR_I18N_INVALID_MESSAGE', reason);
      await assertBudget(locale, Buffer.byteLength(value, 'utf8'));

      const at = Date.now();
      const source = sourceMessage(namespace, key);
      const row = await translations.upsert(
        { locale, namespace, key, value, sourceText: source },
        { updatedBy: request.user?.id ?? null, at },
      );
      await app.rbac.audit(request, {
        category: 'settings',
        action: 'i18n.key.update',
        changes: { after: { locale, namespace, key } },
      });
      const version = await announce(at);
      return {
        ok: true as const,
        version,
        row: {
          namespace,
          key,
          source: source ?? '',
          builtin: (await compiledBundle(tagFromLocaleId(locale), namespace)).get(key) ?? null,
          override: row.value,
          stale: false,
          a11yCritical: isA11yCriticalKey(namespace, key),
          updatedAt: row.updatedAt,
        },
      };
    });

    app.delete(
      '/i18n/keys',
      { schema: { querystring: deleteKeyQuery, response: { 200: writeKeyReply } } },
      async (request) => {
        await requireManage(request);
        const { locale, namespace, key } = request.query;
        const at = Date.now();
        // A hard DELETE — this is "reset to built-in", which is a different
        // operation from writing '' ("render nothing", 23 §3.3).
        const removed = await translations.remove({ locale, namespace, key }, { at });
        if (!removed) throw new NotFoundError('No override for that key.');
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'i18n.key.reset',
          changes: { before: { locale, namespace, key } },
        });
        return { ok: true as const, version: await announce(at), row: null };
      },
    );

    app.post(
      '/i18n/keys/bulk',
      { schema: { body: bulkKeysBody, response: { 200: bulkKeysReply } } },
      async (request) => {
        await requireManage(request);
        const at = Date.now();
        const accepted: typeof request.body.items = [];
        const rejected: { namespace: string; key: string; reason: string }[] = [];

        for (const item of request.body.items) {
          const reason = await rejectReason(item);
          if (reason === null) accepted.push(item);
          else rejected.push({ namespace: item.namespace, key: item.key, reason });
        }

        let written = 0;
        // Chunked, matching the copy-from job's transaction size.
        for (let i = 0; i < accepted.length; i += 100) {
          const chunk = accepted.slice(i, i + 100);
          await translations.upsertMany(
            chunk.map((item) => ({ ...item, sourceText: sourceMessage(item.namespace, item.key) })),
            { updatedBy: request.user?.id ?? null, at },
          );
          written += chunk.length;
        }

        if (written > 0) {
          await app.rbac.audit(request, {
            category: 'settings',
            action: 'i18n.keys.bulk',
            changes: { after: { written, rejected: rejected.length } },
          });
        }
        return { ok: true as const, version: await announce(at), written, rejected };
      },
    );

    // --- transfer (23 §3.6) ---------------------------------------------------

    app.get(
      '/i18n/export/:locale',
      { schema: { params: localeParams, response: { 200: translationExportReply } } },
      async (request) => {
        await requireManage(request);
        const rows = await translations.listLocale(request.params.locale);
        return buildExport(request.params.locale, rows);
      },
    );

    app.post(
      '/i18n/import/:locale',
      {
        schema: {
          params: localeParams,
          querystring: importQuery,
          body: translationImportBody,
          response: { 200: translationImportReply },
        },
      },
      async (request) => {
        await requireManage(request);
        const { locale } = request.params;
        const parsed = parseImport(request.body, {
          namespaces: NAMESPACES,
          includeSensitive: request.query.includeSensitive === true,
        });

        // Message-level validation on top of the envelope check, so an import
        // can never write something the editor would have refused.
        const accepted: { namespace: Namespace; key: string; value: string }[] = [];
        const rejected = [...parsed.rejected];
        for (const item of parsed.items) {
          const reason = await rejectReason({ locale, ...item });
          if (reason === null) accepted.push(item);
          else rejected.push({ namespace: item.namespace, key: item.key, reason });
        }

        const at = Date.now();
        let written = 0;
        for (let i = 0; i < accepted.length; i += 100) {
          const chunk = accepted.slice(i, i + 100);
          await translations.upsertMany(
            chunk.map((item) => ({
              locale,
              ...item,
              sourceText: sourceMessage(item.namespace, item.key),
            })),
            { updatedBy: request.user?.id ?? null, at },
          );
          written += chunk.length;
        }

        if (written > 0) {
          await app.rbac.audit(request, {
            category: 'settings',
            action: 'i18n.import',
            changes: { after: { locale, written, rejected: rejected.length } },
          });
        }
        return {
          ok: true as const,
          version: await announce(at),
          written,
          rejected,
          sensitiveCount: parsed.sensitiveCount,
        };
      },
    );

    // --- locale registry ------------------------------------------------------

    app.get('/i18n/locales', { schema: { response: { 200: i18nManifestReply } } }, async (request) => {
      await requireManage(request);
      return manifest();
    });

    app.post(
      '/i18n/locales',
      { schema: { body: createLocaleBody, response: { 200: localeMutationReply } } },
      async (request) => {
        await requireManage(request);
        const body = request.body;
        if (isBuiltinLocaleId(body.locale)) {
          throw new AppError(
            422,
            'ERR_I18N_BUILTIN_FIELD_LOCKED',
            `${body.locale} ships with Adminium — use PATCH to enable, disable or reorder it.`,
          );
        }
        if ((await locales.get(body.locale)) !== null) {
          throw new AppError(409, 'ERR_I18N_LOCALE_EXISTS', `${body.locale} already exists.`);
        }
        // The borrow tag must be real: it is what ICU formats plurals, numbers
        // and dates under (23 §5.6).
        let pluralCategories: string[];
        try {
          Intl.getCanonicalLocales(body.intlTag);
          pluralCategories = [...new Intl.PluralRules(body.intlTag).resolvedOptions().pluralCategories];
        } catch {
          throw new AppError(
            422,
            'ERR_I18N_BAD_INTL_TAG',
            `"${body.intlTag}" is not a language tag this system has formatting rules for.`,
          );
        }

        const at = Date.now();
        await locales.upsertCustom(
          body.locale,
          {
            english: body.english,
            native: body.native,
            dir: body.dir,
            fontHint: body.fontHint,
            intlTag: body.intlTag,
            // FROZEN at create time so client-side and server-side validation
            // cannot disagree for a tag one of them lacks data for.
            pluralCategories,
            enabled: body.enabled,
            sortOrder: body.sortOrder,
          },
          { updatedBy: request.user?.id ?? null, at },
        );

        if (body.copyFrom !== undefined) {
          const seed = await translations.listLocale(body.copyFrom);
          for (let i = 0; i < seed.length; i += 100) {
            await translations.upsertMany(
              seed.slice(i, i + 100).map((row) => ({
                locale: body.locale,
                namespace: row.namespace,
                key: row.key,
                value: row.value,
                sourceText: row.sourceText,
              })),
              { updatedBy: request.user?.id ?? null, at },
            );
          }
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'i18n.locale.create',
          changes: { after: { locale: body.locale, intlTag: body.intlTag } },
        });
        const version = await announce(at);
        const { locales: entries } = await manifest();
        return {
          ok: true as const,
          version,
          locale: entries.find((e) => e.locale === body.locale) ?? null,
        };
      },
    );

    app.patch(
      '/i18n/locales/:locale',
      { schema: { params: localeParams, body: patchLocaleBody, response: { 200: localeMutationReply } } },
      async (request) => {
        await requireManage(request);
        const { locale } = request.params;
        const body = request.body;
        const at = Date.now();

        if (isBuiltinLocaleId(locale)) {
          // Field lock (23 §3.1): a built-in carries `enabled`/`sortOrder`
          // only. Direction, names and fonts come from the compiled registry,
          // so an admin cannot flip ar_EG to ltr and corrupt its rendering.
          const forbidden = (['english', 'native', 'dir', 'fontHint', 'intlTag'] as const).filter(
            (field) => body[field] !== undefined,
          );
          if (forbidden.length > 0) {
            throw new AppError(
              422,
              'ERR_I18N_BUILTIN_FIELD_LOCKED',
              `${locale} ships with Adminium — ${forbidden.join(', ')} cannot be changed.`,
            );
          }
          await locales.upsertBuiltin(
            locale,
            { ...(body.enabled === undefined ? {} : { enabled: body.enabled }), ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }) },
            { updatedBy: request.user?.id ?? null, at },
          );
        } else {
          const existing = await locales.get(locale);
          if (existing === null) throw new NotFoundError(`Locale ${locale} not found.`);
          await locales.upsertCustom(
            locale,
            {
              english: body.english ?? existing.english ?? locale,
              native: body.native ?? existing.native ?? locale,
              dir: body.dir ?? existing.dir ?? 'ltr',
              fontHint: body.fontHint ?? existing.fontHint ?? 'latin',
              intlTag: body.intlTag ?? existing.intlTag ?? tagFromLocaleId(locale),
              pluralCategories:
                body.intlTag === undefined
                  ? (existing.pluralCategories ?? ['other'])
                  : [...new Intl.PluralRules(body.intlTag).resolvedOptions().pluralCategories],
              ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
              ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
            },
            { updatedBy: request.user?.id ?? null, at },
          );
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'i18n.locale.update',
          changes: { after: { locale, ...body } },
        });
        const version = await announce(at);
        const { locales: entries } = await manifest();
        return { ok: true as const, version, locale: entries.find((e) => e.locale === locale) ?? null };
      },
    );

    app.delete(
      '/i18n/locales/:locale',
      {
        schema: {
          params: localeParams,
          querystring: deleteLocaleQuery,
          response: { 200: deleteLocaleReply },
        },
      },
      async (request) => {
        await requireManage(request);
        const { locale } = request.params;
        const { reassignTo } = request.query;

        if (isBuiltinLocaleId(locale)) {
          throw new AppError(
            422,
            'ERR_I18N_BUILTIN_LOCALE',
            `${locale} ships with Adminium and cannot be deleted — disable it instead.`,
          );
        }

        const workspaceDefault = await settings.get('locale.default');
        if (workspaceDefault === locale) {
          throw new AppError(
            409,
            'ERR_I18N_LOCALE_IS_DEFAULT',
            'This is the workspace default language. Choose a different default first.',
          );
        }
        const { locales: entries } = await manifest();
        if (entries.filter((e) => e.enabled).length <= 1) {
          throw new AppError(409, 'ERR_I18N_LAST_LOCALE', 'At least one language must remain available.');
        }

        const at = Date.now();
        // Every store that holds a locale id (23 §5.7) — missing one leaves an
        // orphan that renders as a raw identifier or collides on a unique index.
        const affectedUsers = await meta.db
          .selectFrom('adminium_user_prefs')
          .select(['userId'])
          .where('locale', '=', locale)
          .execute();
        for (const row of affectedUsers) {
          await prefs.set(row.userId, { locale: reassignTo === 'inherit' ? null : reassignTo }, at);
        }

        const deletedOverrides = await translations.removeLocale(locale, { at });

        // email_templates is UNIQUE(key, locale); a naive reassign collides, so
        // the variants are deleted rather than moved.
        const templateRows = await emailTemplates.list();
        let deletedEmailTemplates = 0;
        for (const row of templateRows) {
          if (row.locale !== locale) continue;
          await emailTemplates.remove(row.key, row.locale);
          deletedEmailTemplates += 1;
        }

        await locales.remove(locale, { updatedBy: request.user?.id ?? null, at });

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'i18n.locale.delete',
          changes: {
            before: { locale },
            after: { reassignTo, reassignedUsers: affectedUsers.length, deletedOverrides },
          },
        });

        return {
          ok: true as const,
          version: await announce(at),
          reassignedUsers: affectedUsers.length,
          deletedOverrides,
          deletedEmailTemplates,
          workspaceDefaultReset: false,
        };
      },
    );
  };
}

/** Re-exported so composition can prime the registry at boot. */
export { localeEntry, pluralCategoriesForLocale };
