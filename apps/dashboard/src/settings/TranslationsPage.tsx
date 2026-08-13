/**
 * `/settings/translations` — the runtime translation editor
 * (23-runtime-translations.md §7).
 *
 * Two panels: a key browser for editing any of the ~2,800 authored messages
 * per locale, and a locale manager for choosing which languages are offered
 * and adding new ones.
 *
 * Navigation is by the FIRST KEY SEGMENT (`widgets`, `templates`, `nav`, …),
 * not by namespace. The namespace axis is badly unbalanced in practice —
 * `common` and `ui` hold effectively every key while `studio` and `generated`
 * hold a handful each — so it is a poor primary axis and a fine secondary
 * filter.
 *
 * Client-side gate: super-admin only; direct access by anyone else renders
 * the 403 system state. The server enforces `system:settings:manage`
 * regardless — this gate is UX, not the security boundary.
 */
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Globe2, Languages, RotateCcw, Search } from 'lucide-react';
import { availableLocales, localeEntry } from '@adminium/i18n/registry';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  IconTile,
  Input,
  Select,
  Textarea,
  cn,
} from '@adminium/ui';

import {
  createLocale,
  deleteLocale,
  fetchKeys,
  fetchManifest,
  patchLocale,
  putKey,
  resetKey,
  type KeyRow,
  type KeyStateFilter,
  type LocaleManifestEntry,
} from '../api/i18n.js';
import { bootstrapQuery } from '../app/bootstrap.js';
import { resyncOverrides } from '../i18n/setup.js';
import { t } from '../i18n/t.js';
import { useAppToasts } from '../pages/toasts.js';
import { StatePage } from '../states/StatePage.js';

const SUPER_ADMIN_ROLE = 'super-admin';
const PAGE_SIZE = 25;

const MANIFEST_KEY = ['i18n', 'manifest'] as const;

function useManifest() {
  return useQuery({ queryKey: MANIFEST_KEY, queryFn: fetchManifest, staleTime: 30_000 });
}

// --- key browser -------------------------------------------------------------

function KeyEditor(props: {
  locale: string;
  row: KeyRow;
  onSaved: () => void;
}): ReactNode {
  const { locale, row } = props;
  const toasts = useAppToasts();
  const [draft, setDraft] = useState(row.override ?? row.builtin ?? row.source);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => putKey({ locale, namespace: row.namespace, key: row.key, value: draft }),
    onSuccess: () => {
      setError(null);
      toasts.push({ variant: 'success', title: t('settings.translations.saved', 'Translation saved') });
      props.onSaved();
    },
    onError: (err: unknown) => {
      // The validator's message is written for an admin, not a developer —
      // show it verbatim rather than a generic failure (23 §6.3).
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const reset = useMutation({
    mutationFn: () => resetKey({ locale, namespace: row.namespace, key: row.key }),
    onSuccess: () => {
      setDraft(row.builtin ?? row.source);
      setError(null);
      toasts.push({
        variant: 'success',
        title: t('settings.translations.reset', 'Reset to the built-in text'),
      });
      props.onSaved();
    },
  });

  const dirty = draft !== (row.override ?? row.builtin ?? row.source);

  return (
    <div className="flex flex-col gap-2 border-t border-border py-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-body-sm text-fg-muted">{`${row.namespace}:${row.key}`}</code>
        {row.override !== null ? (
          <Badge tone="accent">{t('settings.translations.badge.custom', 'Customised')}</Badge>
        ) : null}
        {row.stale ? (
          <Badge tone="warn">{t('settings.translations.badge.stale', 'English changed')}</Badge>
        ) : null}
        {row.a11yCritical ? (
          <Badge tone="info">{t('settings.translations.badge.a11y', 'Accessible name')}</Badge>
        ) : null}
      </div>

      <p className="text-body-sm text-fg-muted">
        {t('settings.translations.sourceLabel', 'English source')}: {row.source}
      </p>

      <Textarea
        aria-label={t('settings.translations.valueLabel', 'Translation')}
        value={draft}
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
      />

      {error !== null ? (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {t('settings.translations.save', 'Save')}
        </Button>
        {row.override !== null ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={reset.isPending}
            onClick={() => reset.mutate()}
          >
            <RotateCcw aria-hidden />
            {t('settings.translations.resetAction', 'Reset to built-in')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function KeyBrowser({ locales }: { locales: LocaleManifestEntry[] }): ReactNode {
  const queryClient = useQueryClient();
  const [locale, setLocale] = useState<string>(locales[0]?.locale ?? 'en_US');
  const [group, setGroup] = useState<string>('');
  const [q, setQ] = useState('');
  const [state, setState] = useState<KeyStateFilter>('all');
  const [page, setPage] = useState(0);

  const keys = useQuery({
    queryKey: ['i18n', 'keys', locale, group, q, state, page],
    queryFn: () =>
      fetchKeys({
        locale,
        ...(group === '' ? {} : { group }),
        ...(q === '' ? {} : { q }),
        state,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
  });

  const onSaved = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['i18n'] });
    // Repaint this tab immediately rather than waiting for the socket to come
    // back around — the admin should see their own edit at once. Resyncs the
    // locale being READ, not the one being edited: editing ar_EG from an en_US
    // session must not install Arabic overrides into that session, and when the
    // two do coincide this picks the edit up anyway.
    void resyncOverrides();
  };

  const total = keys.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<Languages />} />
        <h3 className="text-section text-fg">
          {t('settings.translations.editor.heading', 'Edit translations')}
        </h3>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-fg-muted">
              {t('settings.translations.localeLabel', 'Language')}
            </span>
            <Select
              value={locale}
              onChange={(event) => {
                setLocale(event.target.value);
                setPage(0);
              }}
            >
              {locales.map((entry) => (
                <option key={entry.locale} value={entry.locale}>
                  {entry.native} — {entry.english}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-fg-muted">
              {t('settings.translations.groupLabel', 'Area')}
            </span>
            <Select
              value={group}
              onChange={(event) => {
                setGroup(event.target.value);
                setPage(0);
              }}
            >
              <option value="">{t('settings.translations.allAreas', 'All areas')}</option>
              {(keys.data?.groups ?? []).map((entry) => (
                <option key={entry.group} value={entry.group}>
                  {entry.group} ({entry.count})
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-fg-muted">
              {t('settings.translations.stateLabel', 'Show')}
            </span>
            <Select
              value={state}
              onChange={(event) => {
                setState(event.target.value as KeyStateFilter);
                setPage(0);
              }}
            >
              <option value="all">{t('settings.translations.state.all', 'Everything')}</option>
              <option value="overridden">
                {t('settings.translations.state.overridden', 'Customised only')}
              </option>
              <option value="untranslated">
                {t('settings.translations.state.untranslated', 'Untranslated only')}
              </option>
              <option value="stale">
                {t('settings.translations.state.stale', 'English changed since')}
              </option>
            </Select>
          </label>

          <label className="flex min-w-56 flex-1 flex-col gap-1">
            <span className="text-body-sm text-fg-muted">
              {t('settings.translations.searchLabel', 'Search')}
            </span>
            <Input
              value={q}
              placeholder={t('settings.translations.searchPlaceholder', 'Key or English text')}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>

        {keys.isLoading ? (
          <p className="text-body-sm text-fg-muted">
            {t('settings.translations.loading', 'Loading strings…')}
          </p>
        ) : (keys.data?.items.length ?? 0) === 0 ? (
          <div className="flex items-center gap-2 py-6 text-fg-muted">
            <Search aria-hidden />
            <span>{t('settings.translations.noMatches', 'No strings match those filters.')}</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {(keys.data?.items ?? []).map((row) => (
              <KeyEditor
                key={`${row.namespace}:${row.key}`}
                locale={locale}
                row={row}
                onSaved={onSaved}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-body-sm text-fg-muted">
            {t('settings.translations.count', '{total, plural, one {# string} other {# strings}}', {
              total,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {t('settings.translations.prev', 'Previous')}
            </Button>
            <span className="text-body-sm text-fg-muted">
              {t('settings.translations.page', 'Page {page} of {pages}', {
                page: String(page + 1),
                pages: String(pages),
              })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('settings.translations.next', 'Next')}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// --- locale manager ----------------------------------------------------------

function AddLocaleForm({ onDone }: { onDone: () => void }): ReactNode {
  const toasts = useAppToasts();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    locale: '',
    english: '',
    native: '',
    dir: 'ltr' as 'ltr' | 'rtl',
    fontHint: 'latin' as 'latin' | 'arabic' | 'cjk',
    intlTag: '',
  });

  const create = useMutation({
    mutationFn: () => createLocale(form),
    onSuccess: () => {
      setError(null);
      setOpen(false);
      toasts.push({
        variant: 'success',
        title: t('settings.translations.locale.added', 'Language added'),
      });
      onDone();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t('settings.translations.locale.add', 'Add a language')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-fg-muted">
            {t('settings.translations.locale.id', 'Language code')}
          </span>
          <Input
            value={form.locale}
            placeholder="sw_KE"
            onChange={(event) => setForm({ ...form, locale: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-fg-muted">
            {t('settings.translations.locale.intlTag', 'Formatting rules from')}
          </span>
          <Input
            value={form.intlTag}
            placeholder="sw-KE"
            onChange={(event) => setForm({ ...form, intlTag: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-fg-muted">
            {t('settings.translations.locale.native', 'Name in the language itself')}
          </span>
          <Input
            value={form.native}
            onChange={(event) => setForm({ ...form, native: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-fg-muted">
            {t('settings.translations.locale.english', 'Name in English')}
          </span>
          <Input
            value={form.english}
            onChange={(event) => setForm({ ...form, english: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-fg-muted">
            {t('settings.translations.locale.dir', 'Text direction')}
          </span>
          <Select
            value={form.dir}
            onChange={(event) => setForm({ ...form, dir: event.target.value as 'ltr' | 'rtl' })}
          >
            <option value="ltr">{t('settings.translations.locale.ltr', 'Left to right')}</option>
            <option value="rtl">{t('settings.translations.locale.rtl', 'Right to left')}</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-fg-muted">
            {t('settings.translations.locale.font', 'Script')}
          </span>
          <Select
            value={form.fontHint}
            onChange={(event) =>
              setForm({ ...form, fontHint: event.target.value as 'latin' | 'arabic' | 'cjk' })
            }
          >
            <option value="latin">{t('settings.translations.locale.latin', 'Latin')}</option>
            <option value="arabic">{t('settings.translations.locale.arabic', 'Arabic')}</option>
            <option value="cjk">{t('settings.translations.locale.cjk', 'Chinese / Japanese / Korean')}</option>
          </Select>
        </label>
      </div>

      <p className="text-body-sm text-fg-muted">
        {t(
          'settings.translations.locale.intlHelp',
          'Formatting rules decide how numbers, dates and plurals behave. Pick the closest language that already has them — it does not have to match your language code.',
        )}
      </p>

      {error !== null ? (
        <p className="text-body-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          {t('settings.translations.locale.create', 'Add language')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('action.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}

function LocaleManager({ locales, onChanged }: { locales: LocaleManifestEntry[]; onChanged: () => void }): ReactNode {
  const toasts = useAppToasts();

  const toggle = useMutation({
    mutationFn: (input: { locale: string; enabled: boolean }) =>
      patchLocale(input.locale, { enabled: input.enabled }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: (locale: string) => deleteLocale(locale, 'inherit'),
    onSuccess: (result) => {
      toasts.push({
        variant: 'success',
        title: t('settings.translations.locale.deleted', 'Language removed'),
        description: t(
          'settings.translations.locale.deletedDetail',
          '{users, plural, one {# person} other {# people}} moved back to the workspace default; {strings, plural, one {# translation} other {# translations}} deleted.',
          { users: result.reassignedUsers, strings: result.deletedOverrides },
        ),
      });
      onChanged();
    },
    onError: (err: unknown) =>
      toasts.push({
        variant: 'error',
        title: t('settings.translations.locale.deleteFailed', 'Could not remove that language'),
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<Globe2 />} />
        <h3 className="text-section text-fg">
          {t('settings.translations.locales.heading', 'Available languages')}
        </h3>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-body-sm text-fg-muted">
          {t(
            'settings.translations.locales.help',
            'Turn a language off to remove it from every language picker. Anyone already using it keeps it until they choose another.',
          )}
        </p>

        <div className="flex flex-col">
          {locales.map((entry) => (
            <div
              key={entry.locale}
              className="flex flex-wrap items-center gap-2 border-t border-border py-2"
            >
              <span className="min-w-40 text-body text-fg">{entry.native}</span>
              <span className="min-w-32 text-body-sm text-fg-muted">{entry.english}</span>
              <code className="text-body-sm text-fg-muted">{entry.locale}</code>
              {entry.builtin ? (
                <Badge tone="neutral">{t('settings.translations.locale.builtin', 'Built in')}</Badge>
              ) : (
                <Badge tone="accent">{t('settings.translations.locale.custom', 'Custom')}</Badge>
              )}
              {entry.dir === 'rtl' ? <Badge tone="info">RTL</Badge> : null}
              <span className="text-body-sm text-fg-muted">
                {t(
                  'settings.translations.locale.overrides',
                  '{count, plural, =0 {no custom text} one {# custom string} other {# custom strings}}',
                  { count: entry.overrideCount },
                )}
              </span>

              <div className={cn('ms-auto flex items-center gap-2')}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ locale: entry.locale, enabled: !entry.enabled })}
                >
                  {entry.enabled
                    ? t('settings.translations.locale.disable', 'Turn off')
                    : t('settings.translations.locale.enable', 'Turn on')}
                </Button>
                {entry.builtin ? null : (
                  <Button
                    size="sm"
                    variant="destructiveSoft"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(entry.locale)}
                  >
                    {t('action.delete', 'Delete')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <AddLocaleForm onDone={onChanged} />
      </CardBody>
    </Card>
  );
}

// --- page --------------------------------------------------------------------

export function TranslationsPage(): ReactNode {
  const queryClient = useQueryClient();
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const manifest = useManifest();

  if (!bootstrap.roles.includes(SUPER_ADMIN_ROLE)) {
    return <StatePage stateId="forbidden" />;
  }

  const onChanged = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['i18n'] });
    void resyncOverrides();
  };

  const locales = manifest.data?.locales ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-section text-fg">
          {t('settings.translations.title', 'Languages & translations')}
        </h2>
        <p className="text-body-sm text-fg-muted">
          {t(
            'settings.translations.subtitle',
            'Change any wording in Adminium, choose which languages people can pick, and add languages of your own.',
          )}
        </p>
      </header>

      <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 p-3">
        <AlertTriangle aria-hidden className="mt-0.5 text-warning" />
        <p className="text-body-sm text-fg-muted">
          {t(
            'settings.translations.warning',
            'Error messages and sign-in text are editable too. Those are what people read when something goes wrong, so change them carefully.',
          )}
        </p>
      </div>

      <LocaleManager locales={locales} onChanged={onChanged} />
      {locales.length > 0 ? <KeyBrowser locales={locales} /> : null}
    </div>
  );
}

/** Exported for the route module and tests. */
export { availableLocales, localeEntry };
