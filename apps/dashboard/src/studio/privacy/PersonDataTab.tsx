// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Privacy → "A person's data" (comp boards 7a results, 7b the erase dialog,
 * 7c done, 7d nothing found, 7-phone).
 *
 *  - Find by an e-mail address: the server searches every people table the
 *    apps declare, their copies and mail, the consent log, the do-not-email
 *    list and what Adminium keeps itself (`POST /privacy/find`).
 *  - The result card: the person, then each place they are kept, grouped as
 *    what they gave, what they agreed to or asked, and what the business
 *    keeps about them, each with its count.
 *  - "Download everything" queues a .zip; this person's downloads are listed
 *    below with their expiry, each fetched by its id alone.
 *  - "Erase…" opens the erase dialog (`EraseDialog.tsx`); once it is done,
 *    the "Erased" line with the way to the audit log.
 *
 * The address typed is held in this tab's state alone: it goes to the
 * server in request bodies, never in the page's address, a query key or a
 * log line.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  BadgeCheck,
  Banknote,
  Bell,
  CircleCheckBig,
  Contact,
  Copy,
  CreditCard,
  Download,
  FileText,
  Mail,
  MailWarning,
  MailX,
  Paperclip,
  Receipt,
  Search,
  SearchX,
  Send,
  Trash2,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Input, Skeleton } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { bootstrapQuery, holdsSystemAction } from '../../app/bootstrap.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { EraseDialog } from './EraseDialog.js';
import { lockedWords } from './privacyWords.js';
import { PRIVACY_EXPORTS_QUERY_KEY, exportDownloadHref, findPerson, privacyExportsQuery, requestExport, type FoundSource, type PersonFound, type PrivacyExport, type SourceKind } from './privacyApi.js';

const ICONS: Record<SourceKind, LucideIcon> = {
  people: Contact,
  copy: Copy,
  outbox: Mail,
  consent: BadgeCheck,
  'stop-list': MailX,
  'campaign-mail': Send,
  'campaign-failures': MailWarning,
  documents: FileText,
  invoices: Receipt,
  payments: Banknote,
  'payment-events': CreditCard,
  'automation-runs': Workflow,
  notifications: Bell,
  files: Paperclip,
};

/** What a source is called: an app table's own label (and its app), else Adminium's store by its kind. */
function sourceLabel(source: Pick<FoundSource, 'kind' | 'label' | 'app'>): string {
  if (source.label !== null) {
    const label = source.kind === 'copy' ? t('studio:privacy.person.copyOf', '{label} (copies of them)', { label: source.label }) : source.label;
    return source.app === null || source.app === '' ? label : t('studio:privacy.person.inApp', '{label} — {app}', { label, app: source.app });
  }
  switch (source.kind) {
    case 'consent':
      return t('studio:privacy.person.kind.consent', 'Consent history');
    case 'stop-list':
      return t('studio:privacy.person.kind.stopList', 'Do-not-email list');
    case 'campaign-mail':
      return t('studio:privacy.person.kind.campaignMail', 'Campaign e-mails');
    case 'campaign-failures':
      return t('studio:privacy.person.kind.campaignFailures', 'Campaign sends that failed');
    case 'documents':
      return t('studio:privacy.person.kind.documents', 'Documents');
    case 'invoices':
      return t('studio:privacy.person.kind.invoices', 'Invoices');
    case 'payments':
      return t('studio:privacy.person.kind.payments', 'Payments');
    case 'payment-events':
      return t('studio:privacy.person.kind.paymentEvents', 'Messages from the payment services');
    case 'automation-runs':
      return t('studio:privacy.person.kind.automationRuns', 'Rule runs');
    case 'notifications':
      return t('studio:privacy.person.kind.notifications', 'Notifications to staff');
    case 'files':
      return t('studio:privacy.person.kind.files', 'Files on their rows');
    case 'people':
    case 'copy':
    case 'outbox':
      return t('studio:privacy.person.kind.appRows', 'Rows in an app');
  }
}

/** The count as the comp writes it: rows for a table, entries for the consent history, "yes" on the list. */
function countOf(source: FoundSource): { pre: string; n: string; post: string } {
  // A word, not a number: in the page's own face (mono would break Arabic's joined letters).
  if (source.kind === 'stop-list') return { pre: t('studio:privacy.person.onList', 'yes'), n: '', post: '' };
  const words =
    source.kind === 'people' || source.kind === 'copy'
      ? t('studio:privacy.person.rows', '{count, plural, one {# row} other {# rows}}', { count: source.count })
      : source.kind === 'consent'
        ? t('studio:privacy.person.entries', '{count, plural, one {# entry} other {# entries}}', { count: source.count })
        : new Intl.NumberFormat(locale()).format(source.count);
  // The number in mono (the comp's `n`), the words around it as they are.
  const digits = new Intl.NumberFormat(locale()).format(source.count);
  const at = words.indexOf(digits);
  return at < 0 ? { pre: '', n: words, post: '' } : { pre: words.slice(0, at), n: digits, post: words.slice(at + digits.length) };
}

function locale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter((word) => word !== '');
  const letters = words.length === 1 ? [...words[0]!].slice(0, 1) : [words[0]!, words.at(-1)!].map((word) => [...word][0] ?? '');
  return letters.join('').toLocaleUpperCase(locale());
}

const GROUPS = ['gave', 'agreed', 'held'] as const;

function groupWords(group: (typeof GROUPS)[number]): string {
  switch (group) {
    case 'gave':
      return t('studio:privacy.person.group.gave', 'What they gave you');
    case 'agreed':
      return t('studio:privacy.person.group.agreed', 'What they agreed to or asked');
    case 'held':
      return t('studio:privacy.person.group.held', 'What the business keeps about them');
  }
}

export function PersonDataTab(): ReactNode {
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<PersonFound | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [erasing, setErasing] = useState(false);
  const [done, setDone] = useState<{ filesFailed: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const doneRef = useRef<HTMLElement>(null);

  async function find(): Promise<void> {
    if (typed.trim() === '') return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setFound(await findPerson(typed.trim()));
    } catch (failure) {
      setFound(null);
      setError(
        failure instanceof ApiError && failure.status === 503
          ? lockedWords()
          : failure instanceof ApiError && failure.status === 422
            ? t('studio:privacy.person.notAddress', 'That isn’t an e-mail address. Enter one like name@company.com.')
            : t('studio:privacy.person.findFailed', 'The search did not finish. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function download(address: string): Promise<void> {
    setAsking(true);
    try {
      await requestExport(address);
      await queryClient.invalidateQueries({ queryKey: PRIVACY_EXPORTS_QUERY_KEY });
      toasts.push({ variant: 'success', title: t('studio:privacy.person.downloadQueued', 'The download is being made. It shows under Downloads when it’s ready.') });
    } catch {
      toasts.push({ variant: 'error', title: t('studio:privacy.person.downloadFailed', 'The download could not be asked for. Try again.') });
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <form
          role="search"
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void find();
          }}
        >
          <label htmlFor="privacy-person-q" className="text-body-sm font-bold text-fg">
            {t('studio:privacy.person.q', 'E-mail address')}
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="privacy-person-q"
              type="email"
              dir="ltr"
              mono
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="min-w-[200px] flex-1 bg-surface-2 text-[12.5px] max-sm:min-h-11"
              data-testid="privacy-person-q"
            />
            <Button type="submit" iconLeft={<Search />} loading={busy} disabled={typed.trim() === ''} className="max-sm:min-h-11" data-testid="privacy-person-find">
              {t('studio:privacy.person.find', 'Find')}
            </Button>
          </div>
        </form>
      </Card>

      {error === null ? null : <Alert tone="danger" title={error} />}

      {done === null ? null : (
        <section ref={doneRef} tabIndex={-1} role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-pos/30 bg-pos-soft px-4 py-3.5 outline-none" data-testid="privacy-erased">
          <CircleCheckBig aria-hidden className="size-[18px] shrink-0 text-pos" />
          <div className="min-w-[200px] flex-1">
            <p className="text-body font-bold text-fg">{t('studio:privacy.person.done', 'Erased. Saved in the audit log.')}</p>
            {done.filesFailed > 0 ? (
              <p className="mt-0.5 text-body-sm text-fg-muted">
                {t('studio:privacy.person.filesFailed', '{count, plural, one {# file could not be deleted from storage. Erase again to try it once more.} other {# files could not be deleted from storage. Erase again to try them once more.}}', { count: done.filesFailed })}
              </p>
            ) : null}
          </div>
          <AuditLink />
        </section>
      )}

      {found === null || done !== null ? null : found.found ? (
        <ResultCard found={found} asking={asking} onDownload={() => void download(found.address)} onErase={() => setErasing(true)} />
      ) : (
        <section role="status" className="flex flex-col items-center gap-2.5 rounded-lg border border-border bg-surface px-[var(--card-pad)] py-10 text-center shadow-card" data-testid="privacy-none">
          <div className="flex size-14 items-center justify-center rounded-lg bg-surface-3 text-fg-muted">
            <SearchX aria-hidden className="size-[26px]" />
          </div>
          <h2 className="text-[14px] font-bold text-fg">{t('studio:privacy.person.none', 'Nothing here for that address.')}</h2>
          <p className="max-w-[36ch] text-body leading-[1.55] text-fg-muted">{t('studio:privacy.person.noneSub', 'Check the spelling, or try another address this person used.')}</p>
        </section>
      )}

      <Downloads />

      {erasing && found !== null ? (
        <EraseDialog
          address={found.address}
          onClose={() => setErasing(false)}
          onErased={async (result) => {
            setErasing(false);
            setFound(null);
            setDone({ filesFailed: result.filesFailed });
            // Their downloads went with them.
            await queryClient.invalidateQueries({ queryKey: PRIVACY_EXPORTS_QUERY_KEY });
            requestAnimationFrame(() => doneRef.current?.focus());
          }}
        />
      ) : null}
    </div>
  );
}

/** "Open the audit log": the erasure is its newest entry. Only for a reader of the log. */
function AuditLink(): ReactNode {
  const navigate = useNavigate();
  const bootstrap = useQuery(bootstrapQuery());
  if (bootstrap.data === undefined || !holdsSystemAction(bootstrap.data, 'audit.read')) return null;
  return (
    <Button variant="link" className="min-h-[34px] text-body-sm font-bold" onClick={() => void navigate({ to: '/audit' })}>
      {t('studio:privacy.person.audit', 'Open the audit log')}
    </Button>
  );
}

function ResultCard({ found, asking, onDownload, onErase }: { found: PersonFound; asking: boolean; onDownload: () => void; onErase: () => void }): ReactNode {
  const navigate = useNavigate();
  // The do-not-email list is the e-mail screens' (`settings.manage`): no "Open" for a reader it would refuse.
  const bootstrap = useQuery(bootstrapQuery());
  const opensList = bootstrap.data !== undefined && holdsSystemAction(bootstrap.data, 'settings.manage');
  const name = found.person?.name ?? null;
  const company = found.person?.company ?? null;
  const heading = name === null ? found.address : company === null ? name : t('studio:privacy.person.nameAt', '{name} · {company}', { name, company });
  return (
    <Card padded={false} className="overflow-hidden" data-testid="privacy-result">
      <section aria-labelledby="privacy-person-h">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-[var(--card-pad)]">
          <div aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[13px] font-extrabold text-accent">
            {name === null ? <Contact className="size-[18px]" /> : initialsOf(name)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="privacy-person-h" className="text-section text-fg [overflow-wrap:anywhere]">
              {name === null ? <bdi dir="ltr">{heading}</bdi> : heading}
            </h2>
            {name === null ? null : (
              <p className="mt-0.5">
                <span dir="ltr" className="font-mono text-[12px] text-fg-muted [overflow-wrap:anywhere]">
                  {found.address}
                </span>
              </p>
            )}
          </div>
        </div>
        {GROUPS.map((group) => {
          const items = found.sources.filter((one) => one.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              <div className="border-b border-border bg-surface-2 px-[var(--card-pad)] pb-1.5 pt-2.5 text-micro uppercase text-fg-subtle">{groupWords(group)}</div>
              <ul>
                {items.map((source) => {
                  const Icon = ICONS[source.kind];
                  const label = sourceLabel(source);
                  const count = countOf(source);
                  return (
                    <li key={source.id} className="flex min-h-[var(--hit,34px)] items-center gap-3 border-b border-border px-[var(--card-pad)] py-[var(--row-py,13px)] text-[length:var(--cell-fs,13px)]" data-testid="privacy-source">
                      <Icon aria-hidden className="size-4 shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{label}</span>
                      <span className="whitespace-nowrap text-fg" data-testid="privacy-source-count">
                        {count.pre}
                        {count.n === '' ? null : <span className="font-mono font-semibold">{count.n}</span>}
                        {count.post}
                      </span>
                      {source.kind === 'stop-list' && opensList ? (
                        <Button variant="link" className="min-h-[34px] text-body-sm font-bold" aria-label={t('studio:privacy.person.openLabel', 'Open {what}', { what: label })} onClick={() => void navigate({ to: '/email-templates/do-not-email' })}>
                          {t('studio:privacy.person.open', 'Open')}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-3 p-[var(--card-pad)]">
          <Button variant="secondary" iconLeft={<Download />} loading={asking} onClick={onDownload} className="font-bold max-sm:min-h-11" data-testid="privacy-download">
            {t('studio:privacy.person.download', 'Download everything')}
          </Button>
          <span className="min-w-[140px] flex-1 text-caption text-fg-subtle">{t('studio:privacy.person.downloadSub', 'A .zip of JSON and CSV files.')}</span>
          <Button variant="outline" iconLeft={<Trash2 />} onClick={onErase} className="border-danger font-bold text-danger hover:bg-danger-soft max-sm:min-h-11" data-testid="privacy-erase">
            {t('studio:privacy.person.erase', 'Erase…')}
          </Button>
        </div>
      </section>
    </Card>
  );
}

function statusWords(row: PrivacyExport): string {
  switch (row.status) {
    case 'processing':
      return t('studio:privacy.downloads.processing', 'Being made…');
    case 'ready':
      return t('studio:privacy.downloads.ready', 'Ready');
    case 'failed':
      return t('studio:privacy.downloads.failed', 'Failed');
    case 'expired':
      return t('studio:privacy.downloads.expired', 'Expired');
  }
}

/** This person's downloads, newest first, each with when it was asked and how long it stays. */
function Downloads(): ReactNode {
  const list = useQuery(privacyExportsQuery());
  if (list.isError) return null;
  if (list.data === undefined) return <Skeleton className="h-[64px] w-full" />;
  if (list.data.length === 0) return null;
  const when = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const now = Date.now();
  return (
    <Card padded={false} className="overflow-hidden">
      <section aria-labelledby="privacy-downloads-h">
        <div className="border-b border-border px-[var(--card-pad)] py-3">
          <h2 id="privacy-downloads-h" className="text-section text-fg">
            {t('studio:privacy.downloads.heading', 'Downloads')}
          </h2>
          <p className="mt-0.5 text-caption text-fg-subtle">{t('studio:privacy.downloads.sub', 'Only you can download these. Each is deleted when it expires.')}</p>
        </div>
        <ul>
          {list.data.map((row) => {
            const expired = row.status === 'expired' || (row.expiresAt !== null && row.expiresAt < now);
            const asked = when.format(new Date(row.createdAt));
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-[var(--card-pad)] py-[var(--row-py,13px)] text-[length:var(--cell-fs,13px)] last:border-b-0" data-testid="privacy-download-row">
                <Download aria-hidden className="size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 font-semibold">{t('studio:privacy.downloads.asked', 'Asked {when}', { when: asked })}</span>
                <span className={expired || row.status === 'failed' ? 'text-fg-subtle' : row.status === 'ready' ? 'font-semibold text-pos' : 'text-fg-muted'} data-testid="privacy-download-status">
                  {expired ? statusWords({ ...row, status: 'expired' }) : statusWords(row)}
                </span>
                {row.status === 'ready' && !expired && row.expiresAt !== null ? (
                  <span className="text-caption text-fg-subtle">{t('studio:privacy.downloads.until', 'Until {when}', { when: when.format(new Date(row.expiresAt)) })}</span>
                ) : null}
                {row.status === 'ready' && !expired ? (
                  <Button asChild variant="secondary" size="sm" className="font-bold max-sm:min-h-11">
                    <a href={exportDownloadHref(row.id)} download aria-label={t('studio:privacy.downloads.getLabel', 'Download the file asked {when}', { when: asked })} data-testid="privacy-download-get">
                      {t('studio:privacy.downloads.get', 'Download')}
                    </a>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}
