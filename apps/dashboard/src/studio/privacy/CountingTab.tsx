// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Visitor counting" — the Privacy page's counting tab (comp `Privacy And
 * Public Pages.dc.html`, boards 6a/6b, E2.7–E2.8).
 *
 *  - How visitors are counted: Off, Counts only (the default), Per visitor,
 *    three cards in one radio group. The lines say what is true: landing
 *    pages and forms are counted, the chat is not, known bots are left out,
 *    and when counting started.
 *  - Per visitor needs the privacy notice: while it is not set the card is
 *    off, with a line and a link to the notice tab.
 *  - The banner (at Per visitor): the owner's words per language over the
 *    engine's default (the placeholders), the language popover, and a live
 *    preview with two equal buttons.
 *  - A Save: a level never changes by a stray click. Going down from Per
 *    visitor asks first ("This deletes {n} visitors' page history now.") and
 *    says it was done.
 *
 * The comp's "On your own website" card (a consent line for the site's own
 * banner) is not drawn: a frame on the owner's website stores nothing at any
 * level, so there is nothing for such a line to switch on.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronDown, Clock, Languages, ShieldAlert } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, Card, FormField, Input, Modal, ModalFooter, ModalHeader, Popover, PopoverContent, PopoverTrigger, RadioCard, RadioGroup, Skeleton, Textarea, cn } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { BANNER_LOCALES, PRIVACY_COUNTING_QUERY_KEY, countingQuery, putCounting, type BannerLocale, type BannerWords, type CountingState, type TrackingLevel } from './privacyApi.js';

/** Each banner language: its code chip and its name in itself. */
const BANNER_LANGUAGES: Readonly<Record<BannerLocale, { code: string; native: string; dir: 'ltr' | 'rtl' }>> = {
  'en-US': { code: 'EN', native: 'English', dir: 'ltr' },
  'de-DE': { code: 'DE', native: 'Deutsch', dir: 'ltr' },
  'fr-FR': { code: 'FR', native: 'Français', dir: 'ltr' },
  'cs-CZ': { code: 'CS', native: 'Čeština', dir: 'ltr' },
  'da-DK': { code: 'DA', native: 'Dansk', dir: 'ltr' },
  'ar-EG': { code: 'AR', native: 'العربية', dir: 'rtl' },
  'zh-CN': { code: '简', native: '简体中文', dir: 'ltr' },
  'zh-TW': { code: '繁', native: '繁體中文', dir: 'ltr' },
};

type Fields = Required<BannerWords>;
const EMPTY: Fields = { title: '', text: '', yes: '', no: '' };
const FIELD_KEYS = ['title', 'text', 'yes', 'no'] as const;

/** The page's language as one of the banner's eight, else English. */
function staffBannerLocale(): BannerLocale {
  const tag = (getI18nInstance()?.language ?? 'en-US').replace('_', '-').toLowerCase();
  return BANNER_LOCALES.find((one) => one.toLowerCase() === tag) ?? BANNER_LOCALES.find((one) => one.slice(0, 2).toLowerCase() === tag.slice(0, 2)) ?? 'en-US';
}

function locale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

/** The owner's words as the fields hold them: '' for a field left to the default. */
function draftsOf(banner: CountingState['banner']): Record<BannerLocale, Fields> {
  return Object.fromEntries(BANNER_LOCALES.map((language) => [language, { ...EMPTY, ...(banner?.[language] ?? {}) }])) as Record<BannerLocale, Fields>;
}

/** The fields as the server keeps them: a language with nothing of its own left out, nothing at all null. */
function bannerOf(drafts: Record<BannerLocale, Fields>): CountingState['banner'] {
  const out: Partial<Record<BannerLocale, BannerWords>> = {};
  for (const language of BANNER_LOCALES) {
    const own: BannerWords = {};
    for (const key of FIELD_KEYS) {
      const value = drafts[language][key].trim();
      if (value !== '') own[key] = value;
    }
    if (Object.keys(own).length > 0) out[language] = own;
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function CountingTab(): ReactNode {
  const counting = useQuery(countingQuery());
  if (counting.isError) return <Alert tone="danger" title={t('studio:privacy.counting.loadFailed', 'Visitor counting could not be loaded. Try again.')} />;
  if (counting.data === undefined) return <Skeleton className="h-[320px] w-full" />;
  return <CountingForm saved={counting.data} />;
}

function CountingForm({ saved }: { saved: CountingState }): ReactNode {
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const headingId = useId();
  const bannerId = useId();
  const [level, setLevel] = useState<TrackingLevel>(saved.level);
  const [drafts, setDrafts] = useState(() => draftsOf(saved.banner));
  const [editing, setEditing] = useState<BannerLocale>(staffBannerLocale);
  const [menuOpen, setMenuOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  useEffect(() => {
    setLevel(saved.level);
    setDrafts(draftsOf(saved.banner));
  }, [saved]);

  const savedBanner = useMemo(() => JSON.stringify(saved.banner ?? null), [saved.banner]);
  const nextBanner = bannerOf(drafts);
  const bannerChanged = JSON.stringify(nextBanner) !== savedBanner;
  const changed = level !== saved.level || bannerChanged;
  // Per visitor needs the notice; a level already at Per visitor stays choosable.
  const visitorLocked = !saved.noticeReady && saved.level !== 'visitor';
  const goingDown = saved.level === 'visitor' && level !== 'visitor';

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await putCounting({ level, ...(bannerChanged ? { banner: nextBanner } : {}) });
      queryClient.setQueryData(PRIVACY_COUNTING_QUERY_KEY, next);
      const deleted = next.deleted?.visitors ?? null;
      const words =
        deleted !== null && deleted > 0
          ? t('studio:privacy.counting.downDone', '{count, plural, one {Saved. # visitor’s page history was deleted.} other {Saved. # visitors’ page history was deleted.}}', { count: deleted })
          : t('studio:privacy.counting.saved', 'Saved');
      setSaid(words);
      toasts.push({ variant: 'success', title: words });
      setAsking(false);
    } catch (failure) {
      const notice = failure instanceof ApiError && failure.status === 409;
      setError(notice ? t('studio:privacy.counting.needsNotice', 'Set your privacy notice first: the banner links to it.') : t('studio:privacy.counting.saveFailed', 'This could not be saved. Try again.'));
      setAsking(false);
    } finally {
      setBusy(false);
    }
  }

  function trySave(): void {
    if (!changed || busy) return;
    if (goingDown && saved.kept.visitors > 0) setAsking(true);
    else void save();
  }

  const keptLine =
    level === 'visitor'
      ? t('studio:privacy.counting.keptVisitor', 'Kept: view counts {counts, plural, one {# month} other {# months}}; one visitor’s pages {visits, plural, one {# month} other {# months}}; removed with the person.', {
          counts: saved.viewCountsMonths,
          visits: saved.visitsMonths,
        })
      : level === 'counts'
        ? t('studio:privacy.counting.keptCounts', 'Kept: view counts {counts, plural, one {# month} other {# months}}.', { counts: saved.viewCountsMonths })
        : null;
  const since =
    saved.level === 'off'
      ? t('studio:privacy.counting.offNow', 'Counting is off. What was counted stays until its time is up.')
      : saved.countingSince === null
        ? null
        : t('studio:privacy.counting.since', 'Counting started on {date}.', { date: new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(saved.countingSince) });

  const choices: { value: TrackingLevel; title: string; desc: string; isDefault?: true }[] = [
    { value: 'off', title: t('studio:privacy.counting.offTitle', 'Off'), desc: t('studio:privacy.counting.offDesc', 'Nothing is counted.') },
    {
      value: 'counts',
      title: t('studio:privacy.counting.countsTitle', 'Counts only'),
      desc: t('studio:privacy.counting.countsDesc', 'How many times each page and step was seen. No cookie, no banner. These are views, not people; known bots are left out.'),
      isDefault: true,
    },
    {
      value: 'visitor',
      title: t('studio:privacy.counting.visitorTitle', 'Per visitor'),
      desc: t('studio:privacy.counting.visitorDesc', 'Remembers which of your pages one visitor saw, and joins it to them if they send a form. Asks first with a banner; nothing is kept before they say yes.'),
    },
  ];

  const current = drafts[editing];
  const defaults: Fields = { ...EMPTY, ...(saved.defaults[editing] ?? {}) };
  const shown = (key: keyof Fields) => (current[key].trim() === '' ? defaults[key] : current[key]);
  const facts = BANNER_LANGUAGES[editing];

  function setField(key: keyof Fields, value: string): void {
    setDrafts((all) => ({ ...all, [editing]: { ...all[editing], [key]: value } }));
  }

  return (
    <div className="flex flex-col gap-3.5" data-testid="privacy-counting">
      <Card padded={false}>
        <section aria-labelledby={headingId}>
          <div className="border-b border-border p-[var(--card-pad)]">
            <h2 id={headingId} className="text-section text-fg">
              {t('studio:privacy.counting.heading', 'How visitors are counted')}
            </h2>
            <p className="mt-0.5 text-body-sm text-fg-muted">{t('studio:privacy.counting.sub', 'On your landing pages and forms. The chat is not counted.')}</p>
          </div>
          <div className="flex flex-col gap-3.5 p-[var(--card-pad)]">
            <RadioGroup
              aria-labelledby={headingId}
              value={level}
              onValueChange={(value) => setLevel(value as TrackingLevel)}
              className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3"
              data-testid="privacy-counting-levels"
            >
              {choices.map((choice) => (
                <RadioCard
                  key={choice.value}
                  value={choice.value}
                  disabled={choice.value === 'visitor' && visitorLocked}
                  hideIndicator
                  data-testid={`privacy-counting-${choice.value}`}
                  className="rounded-[14px] border-[1.5px] p-4"
                  icon={
                    <span className="mt-px flex size-[18px] items-center justify-center rounded-full border-2 border-border-strong group-data-[state=checked]:border-accent">
                      <span className="size-2 rounded-full bg-transparent group-data-[state=checked]:bg-accent" />
                    </span>
                  }
                  title={<span className="text-[14px] font-bold text-fg">{choice.title}</span>}
                  trailing={
                    choice.isDefault === true ? (
                      <span className="rounded-[20px] bg-surface-3 px-2 py-0.5 text-micro uppercase text-fg-muted">{t('studio:privacy.counting.default', 'Default')}</span>
                    ) : undefined
                  }
                  description={<span className="block text-body-sm leading-[1.5] text-fg-muted">{choice.desc}</span>}
                />
              ))}
            </RadioGroup>
            {visitorLocked ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-fg-muted" data-testid="privacy-counting-needs-notice">
                <ShieldAlert aria-hidden className="size-[14px] shrink-0 text-warn" />
                <span>{t('studio:privacy.counting.needsNotice', 'Set your privacy notice first: the banner links to it.')}</span>
                <button type="button" className="font-bold text-accent underline-offset-2 hover:underline" onClick={() => void navigate({ to: '/studio/privacy', search: { tab: 'notice' } as never, replace: true })}>
                  {t('studio:privacy.counting.setNotice', 'Set the privacy notice')}
                </button>
              </p>
            ) : null}
            {since === null ? null : (
              <p className="flex items-center gap-2 text-body-sm text-fg-muted" data-testid="privacy-counting-since">
                <Clock aria-hidden className="size-[14px] shrink-0" />
                <span>{since}</span>
              </p>
            )}
            {keptLine === null || level === 'visitor' ? null : (
              <p className="flex items-center gap-2 text-body-sm text-fg-muted">
                <Clock aria-hidden className="size-[14px] shrink-0" />
                <span>{keptLine}</span>
              </p>
            )}
          </div>
        </section>
      </Card>

      {level === 'visitor' ? (
        <Card padded={false}>
          <section aria-labelledby={bannerId} data-testid="privacy-counting-banner">
            <div className="flex flex-wrap items-start gap-3 border-b border-border p-[var(--card-pad)]">
              <div className="min-w-[200px] flex-1">
                <h2 id={bannerId} className="text-section text-fg">
                  {t('studio:privacy.counting.bannerHeading', 'The banner')}
                </h2>
                <p className="mt-0.5 text-body-sm text-fg-muted">{t('studio:privacy.counting.bannerSub', 'Shown on your landing pages and form pages before anything about a visitor is kept.')}</p>
              </div>
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="secondary"
                    size="md"
                    data-testid="privacy-counting-language"
                    aria-label={t('studio:privacy.counting.languageButton', 'Language: {name}', { name: facts.native })}
                    iconLeft={<Languages className="text-fg-muted" />}
                    iconRight={<ChevronDown className="text-fg-subtle" />}
                  >
                    <span lang={editing}>{facts.native}</span>
                    <span className="rounded-[20px] bg-surface-3 px-1.5 py-px font-mono text-[10.5px] font-bold text-fg-muted">{BANNER_LOCALES.length}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[278px] max-w-[78vw] rounded-[14px] p-[7px]" aria-label={t('studio:privacy.counting.languages', 'Language variations')}>
                  <div className="px-2.5 pb-1.5 pt-2 text-micro uppercase text-fg-subtle">{t('studio:privacy.counting.languages', 'Language variations')}</div>
                  <ul className="m-0 list-none p-0">
                    {BANNER_LOCALES.map((language) => {
                      const isCurrent = language === editing;
                      const own = Object.values(drafts[language]).some((value) => value.trim() !== '');
                      const row = BANNER_LANGUAGES[language];
                      return (
                        <li key={language}>
                          <button
                            type="button"
                            aria-current={isCurrent ? 'true' : undefined}
                            data-testid="privacy-counting-language-row"
                            data-locale={language}
                            onClick={() => {
                              setEditing(language);
                              setMenuOpen(false);
                            }}
                            className={cn('flex w-full items-center gap-2.5 rounded-[9px] px-[9px] py-[7px] text-start text-fg transition-colors hover:bg-surface-2', isCurrent && 'bg-accent-soft hover:bg-accent-soft')}
                          >
                            <span className={cn('inline-flex min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 py-[3px] font-mono text-[10.5px] font-bold', isCurrent ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-fg-muted')}>{row.code}</span>
                            <span className="min-w-0 flex-1">
                              <span lang={language} className="block text-body-sm font-bold">
                                {row.native}
                              </span>
                              <span className={cn('block text-caption', isCurrent ? 'text-accent' : 'text-fg-subtle')}>
                                {isCurrent ? t('studio:privacy.counting.editingNow', 'Editing now') : own ? t('studio:privacy.counting.ownWords', 'Your words') : t('studio:privacy.counting.defaultWords', 'Default words')}
                              </span>
                            </span>
                            {isCurrent ? <Check aria-hidden className="size-4 shrink-0 text-accent" /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5 p-[var(--card-pad)]">
              <div className="flex flex-col gap-3" lang={editing} dir={facts.dir}>
                <FormField label={t('studio:privacy.counting.fieldTitle', 'Title')}>
                  <Input value={current.title} maxLength={80} placeholder={defaults.title} onChange={(event) => setField('title', event.target.value)} className="bg-surface-2" data-testid="privacy-counting-title" />
                </FormField>
                <FormField label={t('studio:privacy.counting.fieldMessage', 'Message')}>
                  <Textarea value={current.text} maxLength={500} rows={4} placeholder={defaults.text} onChange={(event) => setField('text', event.target.value)} className="bg-surface-2" data-testid="privacy-counting-text" />
                </FormField>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
                  <FormField label={t('studio:privacy.counting.fieldYes', 'Yes button')}>
                    <Input value={current.yes} maxLength={30} placeholder={defaults.yes} onChange={(event) => setField('yes', event.target.value)} className="bg-surface-2" data-testid="privacy-counting-yes" />
                  </FormField>
                  <FormField label={t('studio:privacy.counting.fieldNo', 'No button')}>
                    <Input value={current.no} maxLength={30} placeholder={defaults.no} onChange={(event) => setField('no', event.target.value)} className="bg-surface-2" data-testid="privacy-counting-no" />
                  </FormField>
                </div>
                <p className="text-caption text-fg-subtle">{t('studio:privacy.counting.equal', 'Both buttons look the same, so saying no is as easy as saying yes.')}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-micro uppercase text-fg-subtle">{t('studio:privacy.counting.preview', 'Preview')}</span>
                <div
                  role="group"
                  aria-label={t('studio:privacy.counting.previewLabel', 'Banner preview')}
                  className="relative flex min-h-[240px] flex-col justify-end overflow-hidden rounded-[14px] border border-border bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_10px,var(--surface-3)_10px_20px)] p-3"
                  data-testid="privacy-counting-preview"
                >
                  <span className="absolute start-3 top-2.5 rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg-subtle">{t('studio:privacy.counting.previewTag', 'form page')}</span>
                  <div lang={editing} dir={facts.dir} className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface px-3.5 py-3 shadow-menu">
                    <p className="text-body font-bold text-fg">{shown('title')}</p>
                    <p className="text-body-sm leading-[1.5] text-fg">{shown('text')}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <span className="rounded-[10px] border border-border-strong bg-surface px-2.5 py-[7px] text-center text-body-sm font-bold text-fg">{shown('yes')}</span>
                      <span className="rounded-[10px] border border-border-strong bg-surface px-2.5 py-[7px] text-center text-body-sm font-bold text-fg">{shown('no')}</span>
                    </div>
                    <span className="text-body-sm font-bold text-accent">{t('studio:privacy.counting.privacyNotice', 'Privacy notice')}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </Card>
      ) : null}

      {level === 'visitor' && keptLine !== null ? (
        <p className="flex items-start gap-2 text-body-sm text-fg-muted">
          <Clock aria-hidden className="mt-[3px] size-[14px] shrink-0" />
          <span>{keptLine}</span>
        </p>
      ) : null}

      {error === null ? null : <Alert tone="danger" title={error} data-testid="privacy-counting-error" />}
      <div className="flex items-center justify-end gap-3 rounded-lg border border-border bg-surface-2 px-[var(--card-pad)] py-3">
        <p role="status" aria-live="polite" className="me-auto text-body-sm text-fg-muted">
          {said}
        </p>
        <Button disabled={!changed || busy} loading={busy && !asking} onClick={trySave} data-testid="privacy-counting-save">
          {t('studio:privacy.counting.save', 'Save')}
        </Button>
      </div>

      {asking ? (
        <Modal
          open
          size="sm"
          role="alertdialog"
          className="max-w-[420px]"
          onOpenChange={(open) => {
            if (!open && !busy) setAsking(false);
          }}
        >
          <ModalHeader
            icon={<ShieldAlert />}
            tone="danger"
            hideClose
            closeLabel={t('studio:privacy.counting.cancel', 'Cancel')}
            title={t('studio:privacy.counting.downTitle', 'Stop counting per visitor?')}
            subtitle={t('studio:privacy.counting.downBody', '{count, plural, one {This deletes # visitor’s page history now.} other {This deletes # visitors’ page history now.}}', { count: saved.kept.visitors })}
          />
          <ModalFooter className="gap-2.5">
            <Button variant="secondary" autoFocus onClick={() => setAsking(false)} disabled={busy}>
              {t('studio:privacy.counting.cancel', 'Cancel')}
            </Button>
            <Button variant="destructive" loading={busy} onClick={() => void save()} data-testid="privacy-counting-down-confirm">
              {t('studio:privacy.counting.downConfirm', 'Delete and save')}
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </div>
  );
}
