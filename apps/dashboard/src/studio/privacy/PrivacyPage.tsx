// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/privacy` — Privacy & public pages (comp `Privacy And Public
 * Pages.dc.html`, boards 2, 4a/4b, 7a-7d and 8).
 *
 * This release's five tabs, each with its own address (`?tab=`):
 *
 *  - Privacy notice: the business's name and its privacy notice's address
 *    (https only, checked as typed and again by the server on save).
 *  - Your websites: the sites that may show a form in a frame, and the
 *    loader line to put on them (`WebsitesTab.tsx`).
 *  - Visitor counting: Off, Counts only or Per visitor, the banner's words
 *    and when counting started (`CountingTab.tsx`).
 *  - A person's data: find everything kept about one address, download it,
 *    erase it (`PersonDataTab.tsx`).
 *  - How long we keep things: the fixed rows, the add-ons' own, and the
 *    counting rows (view counts, the pages a visitor saw), each a choice of
 *    months with a Save.
 *
 * The first two open on "Can visitors reach your public pages?"
 * (`PublicReach.tsx`).
 *
 * Only a holder of `privacy.manage` reaches this page (the Super Admin,
 * unless granted on purpose): the route's guard says so, and so does every
 * route behind it.
 */
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Clock, Lock, TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Card, FormField, Input, Select, Skeleton, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { bootstrapQuery, holdsSystemAction } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { PRIVACY_COUNTING_QUERY_KEY, PRIVACY_NOTICE_QUERY_KEY, keepingQuery, privacyNoticeQuery, putKeeping, putPrivacyNotice, type KeepingRow } from './privacyApi.js';
import { noticeUrlError } from './privacyWords.js';
import { PublicReach } from './PublicReach.js';

// The person tab (find, download, erase and its dialog) loads when it is first opened.
const PersonDataTabLazy = lazy(async () => {
  const mod = await import('./PersonDataTab.js');
  return { default: mod.PersonDataTab };
});

// The websites tab (the list, its checks and the loader line) loads when it is first opened, too.
const WebsitesTabLazy = lazy(async () => {
  const mod = await import('./WebsitesTab.js');
  return { default: mod.WebsitesTab };
});

// The counting tab (the levels, the banner's words and its preview) loads when it is first opened.
const CountingTabLazy = lazy(async () => {
  const mod = await import('./CountingTab.js');
  return { default: mod.CountingTab };
});

const PRIVACY_TABS = ['notice', 'websites', 'counting', 'person', 'keeping'] as const;
type PrivacyTab = (typeof PRIVACY_TABS)[number];

function tabOf(value: unknown): PrivacyTab {
  return PRIVACY_TABS.includes(value as PrivacyTab) ? (value as PrivacyTab) : 'notice';
}

/** The comp's tab: 13/700, 10×14, accent when on; 44 high on a phone. */
const TAB = 'whitespace-nowrap px-3.5 pb-2.5 pt-2.5 font-bold data-[state=active]:text-accent max-sm:min-h-11 max-sm:px-3';

export function PrivacyPage(): ReactNode {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: unknown };
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  /*
   * A person's data alone (`privacy.people`, as a shop's owner holds it through their app's role): that one tab, opened at
   * once, and nothing of the notice, the websites or the keeping, whose routes would refuse them.
   */
  const whole = holdsSystemAction(bootstrap, 'privacy.manage');
  const tab = whole ? tabOf(search.tab) : 'person';
  const notice = useQuery({ ...privacyNoticeQuery(), enabled: whole });

  return (
    <>
      <PageActions title={t('studio:privacy.title', 'Privacy & public pages')} backTo={whole ? '/studio/settings' : '/'} {...(notice.data === undefined || notice.data.shownName === '' ? {} : { subtitle: notice.data.shownName })} />
      <PageSurface width="full" className="mx-auto flex w-full max-w-[976px] flex-col gap-3.5 leading-[normal]" testId="privacy-page">
        <Tabs value={tab} onValueChange={(next) => void navigate({ to: '/studio/privacy', search: { tab: next } as never, replace: true })}>
          <TabsList aria-label={t('studio:privacy.title', 'Privacy & public pages')} className="gap-1 overflow-x-auto overflow-y-hidden max-sm:-mx-4 max-sm:gap-0.5 max-sm:px-2">
            {whole ? (
              <TabsTrigger value="notice" className={TAB}>
                {t('studio:privacy.tab.notice', 'Privacy notice')}
              </TabsTrigger>
            ) : null}
            {whole ? (
              <TabsTrigger value="websites" className={TAB}>
                {t('studio:privacy.websites.tab', 'Your websites')}
              </TabsTrigger>
            ) : null}
            {whole ? (
              <TabsTrigger value="counting" className={TAB}>
                {t('studio:privacy.counting.tab', 'Visitor counting')}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="person" className={TAB}>
              {t('studio:privacy.tab.person', 'A person’s data')}
            </TabsTrigger>
            {whole ? (
              <TabsTrigger value="keeping" className={TAB}>
                {t('studio:privacy.tab.keeping', 'How long we keep things')}
              </TabsTrigger>
            ) : null}
          </TabsList>
          {whole ? (
            <TabsContent value="notice" className="pt-3.5">
              <NoticeTab />
            </TabsContent>
          ) : null}
          <TabsContent value="websites" className="pt-3.5">
            <Suspense
              fallback={
                <div className="flex justify-center p-10">
                  <Spinner size="md" />
                </div>
              }
            >
              <WebsitesTabLazy />
            </Suspense>
          </TabsContent>
          {whole ? (
            <TabsContent value="counting" className="pt-3.5">
              <Suspense
                fallback={
                  <div className="flex justify-center p-10">
                    <Spinner size="md" />
                  </div>
                }
              >
                <CountingTabLazy />
              </Suspense>
            </TabsContent>
          ) : null}
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
          {whole ? (
            <TabsContent value="keeping" className="pt-3.5">
              <KeepingTab />
            </TabsContent>
          ) : null}
        </Tabs>
      </PageSurface>
    </>
  );
}

// --- Privacy notice (comp 4a set, 4b empty) -------------------------------------

function NoticeTab(): ReactNode {
  const notice = useQuery(privacyNoticeQuery());
  return (
    <div className="flex flex-col gap-3.5">
      <PublicReach />
      {notice.isError ? (
        <Alert tone="danger" title={t('studio:privacy.notice.loadFailed', 'The privacy settings could not be loaded. Try again.')} />
      ) : notice.data === undefined ? (
        <Skeleton className="h-[220px] w-full" />
      ) : (
        <NoticeForm name={notice.data.businessName ?? ''} url={notice.data.noticeUrl ?? ''} />
      )}
    </div>
  );
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
      if (error instanceof ApiError && error.status === 422) setServerError(t('studio:privacy.notice.httpsOnly', 'Use an address that starts with https, such as https://www.example.com/privacy.'));
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

/** A forms add-on's answers: how long its own settings keep them, worded for its row. */
function answersWords(row: KeepingRow): { what: string; kept: string; why: string } {
  const addOn = row.addOn?.name ?? '';
  return {
    what: t('studio:privacy.keeping.answers', 'Form answers — {addOn}', { addOn }),
    kept:
      typeof row.keptFor === 'number'
        ? t('studio:privacy.keeping.answersMonths', '{count, plural, one {Kept for # month} other {Kept for # months}}', { count: row.keptFor })
        : t('studio:privacy.keeping.answersUntilRemoved', 'Kept until someone removes them'),
    why: t('studio:privacy.keeping.answersWhy', 'Set in {addOn}’s settings. Older answers are deleted each night.', { addOn }),
  };
}

/** A chat add-on's conversations: how long its own settings keep them, worded for its row. */
function chatWords(row: KeepingRow): { what: string; kept: string; why: string } {
  const addOn = row.addOn?.name ?? '';
  return {
    what: t('studio:privacy.keeping.chatConversations', 'Chat conversations — {addOn}', { addOn }),
    kept:
      typeof row.keptFor === 'number'
        ? t('studio:privacy.keeping.chatMonths', '{count, plural, one {Kept for # month} other {Kept for # months}}', { count: row.keptFor })
        : t('studio:privacy.keeping.chatUntilRemoved', 'Kept until someone removes them'),
    why: t('studio:privacy.keeping.chatWhy', 'Set in {addOn}’s settings. Older conversations are deleted each night, with their messages.', { addOn }),
  };
}

/** The rows an add-on keeps, each worded by its own settings. */
const ADD_ON_KEEPING: Readonly<Record<string, (row: KeepingRow) => { what: string; kept: string; why: string }>> = {
  'form-answers': answersWords,
  'chat-conversations': chatWords,
};

/** The rows a person may change, each a choice of months: visitor counting's two. */
const CHANGEABLE_WORDS: Record<string, () => { what: string; why: string }> = {
  'visitor-pages': () => ({
    what: t('studio:privacy.keeping.visits', 'Pages a visitor saw'),
    why: t('studio:privacy.keeping.visitsWhy', 'At Per visitor, the pages one visitor saw. Older visits are deleted each night, and all of them with the person.'),
  }),
  'view-counts': () => ({
    what: t('studio:privacy.keeping.views', 'View counts'),
    why: t('studio:privacy.keeping.viewsWhy', 'Views of your landing pages and forms, per day. Older days are deleted each night.'),
  }),
};

function KeepingTab(): ReactNode {
  const keeping = useQuery(keepingQuery());
  if (keeping.isError) return <Alert tone="danger" title={t('studio:privacy.keeping.loadFailed', 'How long things are kept could not be loaded. Try again.')} />;
  if (keeping.data === undefined) return <Skeleton className="h-[180px] w-full" />;
  return <KeepingTable rows={keeping.data} />;
}

function KeepingTable({ rows: all }: { rows: KeepingRow[] }): ReactNode {
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const [months, setMonths] = useState<Record<string, number>>(() => Object.fromEntries(all.filter((row) => !row.fixed && typeof row.keptFor === 'number').map((row) => [row.key, row.keptFor as number])));
  const [busy, setBusy] = useState(false);
  // Only the rows this screen knows how to word: a later server's new row waits for a later screen.
  const rows = all.filter((row) => (row.fixed ? KEEPING_WORDS[row.key] !== undefined || ADD_ON_KEEPING[row.key] !== undefined : CHANGEABLE_WORDS[row.key] !== undefined));
  const changes = rows.filter((row) => !row.fixed && months[row.key] !== undefined && months[row.key] !== row.keptFor);
  const changeable = rows.some((row) => !row.fixed);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const next = await putKeeping(changes.map((row) => ({ key: row.key, months: months[row.key]! })));
      queryClient.setQueryData(keepingQuery().queryKey, next);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_COUNTING_QUERY_KEY });
      toasts.push({ variant: 'success', title: t('studio:privacy.keeping.viewsSaved', 'Saved') });
    } catch {
      toasts.push({ variant: 'error', title: t('studio:privacy.keeping.viewsSaveFailed', 'How long things are kept was not saved. Try again.') });
    } finally {
      setBusy(false);
    }
  }
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
            const own = CHANGEABLE_WORDS[row.key];
            if (!row.fixed && own !== undefined) {
              const words = own();
              return (
                <tr key={row.key}>
                  <th scope="row" className={`${cell} font-semibold`}>
                    {words.what}
                  </th>
                  <td className={cell}>
                    <Select
                      mono
                      wrapperClassName="w-auto min-w-[150px]"
                      className="text-[12.5px]"
                      value={String(months[row.key] ?? row.keptFor)}
                      aria-label={t('studio:privacy.keeping.viewsKeptFor', 'Kept for: {what}', { what: words.what })}
                      onChange={(event) => setMonths((all) => ({ ...all, [row.key]: Number(event.target.value) }))}
                      data-testid={`privacy-keeping-${row.key}`}
                    >
                      {row.options.map((option) => (
                        <option key={option} value={String(option)}>
                          {t('studio:privacy.keeping.viewsMonths', '{count, plural, one {# month} other {# months}}', { count: option })}
                        </option>
                      ))}
                    </Select>
                    <div className="mt-1 text-caption text-fg-subtle">{words.why}</div>
                  </td>
                </tr>
              );
            }
            const byAddOn = ADD_ON_KEEPING[row.key];
            const answers = byAddOn !== undefined;
            const words = byAddOn !== undefined ? byAddOn(row) : KEEPING_WORDS[row.key]!();
            return (
              <tr key={answers ? `${row.key}:${row.addOn?.key ?? ''}` : row.key}>
                <th scope="row" className={`${cell} font-semibold`}>
                  {words.what}
                </th>
                <td className={cell}>
                  <div className="flex items-center gap-[7px] font-semibold">
                    {answers ? <Clock aria-hidden className="size-[13px] shrink-0 text-fg-subtle" /> : <Lock aria-hidden className="size-[13px] shrink-0 text-fg-subtle" />}
                    {words.kept}
                  </div>
                  <div className="mt-0.5 text-caption text-fg-subtle">{words.why}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {changeable ? (
        <div className="flex justify-end rounded-b-lg bg-surface-2 px-[var(--card-pad)] py-3">
          <Button disabled={changes.length === 0 || busy} loading={busy} onClick={() => void save()} data-testid="privacy-keeping-save">
            {t('studio:privacy.keeping.viewsSave', 'Save')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
