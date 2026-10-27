// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/privacy` — Privacy & public pages (comp `Privacy And Public
 * Pages.dc.html`, boards 2, 4a/4b, 7a-7d and 8).
 *
 * This release's three tabs, each with its own address (`?tab=`):
 *
 *  - Privacy notice: the business's name and its privacy notice's address
 *    (https only, checked as typed and again by the server on save).
 *  - A person's data: find everything kept about one address, download it,
 *    erase it (`PersonDataTab.tsx`).
 *  - How long we keep things: the two rows this release has, both fixed.
 *
 * "Your websites" and "Visitor counting" come with the public forms and the
 * chat; they are not drawn, not even switched off.
 *
 * Only a holder of `privacy.manage` reaches this page (the Super Admin,
 * unless granted on purpose): the route's guard says so, and so does every
 * route behind it.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Lock, TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Card, FormField, Input, Skeleton, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { PRIVACY_NOTICE_QUERY_KEY, keepingQuery, privacyNoticeQuery, putPrivacyNotice } from './privacyApi.js';
import { noticeUrlError } from './privacyWords.js';

// The person tab (find, download, erase and its dialog) loads when it is first opened.
const PersonDataTabLazy = lazy(async () => {
  const mod = await import('./PersonDataTab.js');
  return { default: mod.PersonDataTab };
});

const PRIVACY_TABS = ['notice', 'person', 'keeping'] as const;
type PrivacyTab = (typeof PRIVACY_TABS)[number];

function tabOf(value: unknown): PrivacyTab {
  return PRIVACY_TABS.includes(value as PrivacyTab) ? (value as PrivacyTab) : 'notice';
}

/** The comp's tab: 13/700, 10×14, accent when on; 44 high on a phone. */
const TAB = 'whitespace-nowrap px-3.5 pb-2.5 pt-2.5 font-bold data-[state=active]:text-accent max-sm:min-h-11 max-sm:px-3';

export function PrivacyPage(): ReactNode {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: unknown };
  const tab = tabOf(search.tab);
  const notice = useQuery(privacyNoticeQuery());

  return (
    <>
      <PageActions title={t('studio:privacy.title', 'Privacy & public pages')} backTo="/studio/settings" {...(notice.data === undefined || notice.data.shownName === '' ? {} : { subtitle: notice.data.shownName })} />
      <PageSurface width="full" className="mx-auto flex w-full max-w-[976px] flex-col gap-3.5 leading-[normal]" testId="privacy-page">
        <Tabs value={tab} onValueChange={(next) => void navigate({ to: '/studio/privacy', search: { tab: next } as never, replace: true })}>
          <TabsList aria-label={t('studio:privacy.title', 'Privacy & public pages')} className="gap-1 overflow-x-auto overflow-y-hidden max-sm:-mx-4 max-sm:gap-0.5 max-sm:px-2">
            <TabsTrigger value="notice" className={TAB}>
              {t('studio:privacy.tab.notice', 'Privacy notice')}
            </TabsTrigger>
            <TabsTrigger value="person" className={TAB}>
              {t('studio:privacy.tab.person', 'A person’s data')}
            </TabsTrigger>
            <TabsTrigger value="keeping" className={TAB}>
              {t('studio:privacy.tab.keeping', 'How long we keep things')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="notice" className="pt-3.5">
            <NoticeTab />
          </TabsContent>
          <TabsContent value="person" className="pt-3.5">
            <Suspense
              fallback={
                <div className="flex justify-center p-10">
                  <Spinner size="md" />
                </div>
              }
            >
              <PersonDataTabLazy />
            </Suspense>
          </TabsContent>
          <TabsContent value="keeping" className="pt-3.5">
            <KeepingTab />
          </TabsContent>
        </Tabs>
      </PageSurface>
    </>
  );
}

// --- Privacy notice (comp 4a set, 4b empty) -------------------------------------

function NoticeTab(): ReactNode {
  const notice = useQuery(privacyNoticeQuery());
  if (notice.isError) return <Alert tone="danger" title={t('studio:privacy.notice.loadFailed', 'The privacy settings could not be loaded. Try again.')} />;
  if (notice.data === undefined) return <Skeleton className="h-[220px] w-full" />;
  return <NoticeForm name={notice.data.businessName ?? ''} url={notice.data.noticeUrl ?? ''} />;
}

function NoticeForm({ name: savedName, url: savedUrl }: { name: string; url: string }): ReactNode {
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const [name, setName] = useState(savedName);
  const [url, setUrl] = useState(savedUrl);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setServerError(null), [url]);

  const urlError = noticeUrlError(url) ?? serverError;
  const blank = name.trim() === '' || url.trim() === '';
  const changed = name.trim() !== savedName || url.trim() !== savedUrl;
  // As the comp: Save is off while either field is blank, and while the address is not https.
  const canSave = !blank && urlError === null && changed && !busy;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const next = await putPrivacyNotice({ businessName: name.trim(), noticeUrl: url.trim() });
      queryClient.setQueryData(PRIVACY_NOTICE_QUERY_KEY, next);
      toasts.push({ variant: 'success', title: t('studio:privacy.notice.saved', 'Saved') });
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setServerError(t('studio:privacy.notice.httpsOnly', 'Use an https:// address, such as https://www.example.com/privacy.'));
      else toasts.push({ variant: 'error', title: t('studio:privacy.notice.saveFailed', 'The privacy notice was not saved. Try again.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {savedName === '' || savedUrl === '' ? (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3.5" data-testid="privacy-notice-unset">
          <TriangleAlert aria-hidden className="mt-px size-[18px] shrink-0 text-warn" />
          <p className="text-body font-bold text-fg">
            {t('studio:privacy.notice.unset', 'Set both: they’re shown on every form, the chat and the cookie banner once they arrive.')}
          </p>
        </div>
      ) : null}
      <Card padded={false}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) void save();
          }}
        >
          <div className="border-b border-border p-[var(--card-pad)]">
            <h2 className="text-section text-fg">{t('studio:privacy.notice.heading', 'Privacy notice')}</h2>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4 px-[var(--card-pad)] pb-2 pt-[var(--card-pad)]">
            <FormField label={t('studio:privacy.notice.name', 'Business name')}>
              <Input
                value={name}
                maxLength={120}
                placeholder={t('studio:privacy.notice.namePlaceholder', 'Your company’s legal name')}
                onChange={(event) => setName(event.target.value)}
                className="bg-surface-2"
                aria-describedby="privacy-notice-help"
                data-testid="privacy-notice-name"
              />
            </FormField>
            <FormField label={t('studio:privacy.notice.url', 'Privacy notice address')} error={urlError ?? undefined}>
              <Input
                value={url}
                maxLength={500}
                dir="ltr"
                mono
                type="url"
                inputMode="url"
                placeholder="https://"
                onChange={(event) => setUrl(event.target.value)}
                className="bg-surface-2 text-[12.5px]"
                data-testid="privacy-notice-url"
              />
            </FormField>
          </div>
          <p id="privacy-notice-help" className="px-[var(--card-pad)] pb-[var(--card-pad)] text-caption text-fg-subtle">
            {t('studio:privacy.notice.help', 'Shown on every form, the chat and the cookie banner.')}
          </p>
          <div className="flex justify-end rounded-b-lg border-t border-border bg-surface-2 px-[var(--card-pad)] py-3">
            <Button type="submit" disabled={!canSave} loading={busy} data-testid="privacy-notice-save">
              {t('studio:privacy.notice.save', 'Save')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// --- How long we keep things (comp 8; this release: the two fixed rows) ---------

const KEEPING_WORDS: Record<string, () => { what: string; kept: string; why: string }> = {
  'consent-history': () => ({
    what: t('studio:privacy.keeping.consentHistory', 'Consent history'),
    kept: t('studio:privacy.keeping.untilErased', 'Kept until the person is erased'),
    why: t('studio:privacy.keeping.consentWhy', 'Kept, because it proves what a person agreed to or asked'),
  }),
  'do-not-email': () => ({
    what: t('studio:privacy.keeping.doNotEmail', 'Do-not-email list'),
    kept: t('studio:privacy.keeping.forGood', 'Kept for good'),
    why: t('studio:privacy.keeping.doNotEmailWhy', 'Kept as a code once the person is erased, so they’re never e-mailed again'),
  }),
};

function KeepingTab(): ReactNode {
  const keeping = useQuery(keepingQuery());
  if (keeping.isError) return <Alert tone="danger" title={t('studio:privacy.keeping.loadFailed', 'How long things are kept could not be loaded. Try again.')} />;
  if (keeping.data === undefined) return <Skeleton className="h-[180px] w-full" />;
  // Only the rows this screen knows how to word: a later server's new row waits for a later screen.
  const rows = keeping.data.filter((row) => KEEPING_WORDS[row.key] !== undefined);
  const cell = 'border-b border-border px-[var(--card-pad)] py-[var(--row-py,13px)] text-start align-top';
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="border-b border-border p-[var(--card-pad)]">
        <h2 className="text-section text-fg">{t('studio:privacy.keeping.heading', 'How long we keep things')}</h2>
        <p className="mt-0.5 text-body-sm text-fg-muted">{t('studio:privacy.keeping.sub', 'After this, each item is erased.')}</p>
      </div>
      <table className="w-full border-collapse text-[length:var(--cell-fs,13px)]" data-testid="privacy-keeping">
        <thead>
          <tr className="bg-surface-2">
            <th scope="col" className="border-b border-border px-[var(--card-pad)] py-[9px] text-start text-micro uppercase text-fg-subtle">
              {t('studio:privacy.keeping.what', 'What')}
            </th>
            <th scope="col" className="border-b border-border px-[var(--card-pad)] py-[9px] text-start text-micro uppercase text-fg-subtle">
              {t('studio:privacy.keeping.keptFor', 'Kept for')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const words = KEEPING_WORDS[row.key]!();
            return (
              <tr key={row.key}>
                <th scope="row" className={`${cell} font-semibold`}>
                  {words.what}
                </th>
                <td className={cell}>
                  <div className="flex items-center gap-[7px] font-semibold">
                    <Lock aria-hidden className="size-[13px] shrink-0 text-fg-subtle" />
                    {words.kept}
                  </div>
                  <div className="mt-0.5 text-caption text-fg-subtle">{words.why}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
