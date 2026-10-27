// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send log" (comp `Email To Contacts.dc.html` 439-504, 1146-1179,
 * 1326-1336): who a campaign's send reached and who it did not, from
 * the run's ledger.
 *
 *  - The summary: Sent, Skipped, Bounced, Marked as spam, Unsubscribed,
 *    Waiting, and Failed (failures are counted here; the comp's summary
 *    has no cell for them).
 *  - Filter chips (All, Sent, Waiting, Skipped, Bounced, Marked as spam,
 *    Failed, Unsubscribed), a search over names and addresses, and
 *    "Download CSV" (the same filter and search, as a file).
 *  - A table at desktop width; stacked rows on a phone.
 *  - A row still being tried after a refusal reads "Failed" with "… — will
 *    try again" (the comp's row); once the mail queue gives up it reads
 *    "Failed" with what the server said, and nothing about trying again.
 *
 * A campaign sent more than once picks the send to read (newest first).
 * While the send goes on, the log reads itself again every few seconds.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, ChoiceChips, SearchInput, Select, Spinner, cn } from '@adminium/ui';

import { emailApi, sendLogCsvUrl, type EmailRunView, type EmailSendLogFilter, type EmailSendLogRow, type EmailSendLogSummary } from '../../email/api.js';
import { EMAIL_DOCUMENTS_KEY, emailRunsQuery } from '../../email/queries.js';
import { t } from '../../i18n/t.js';
import { StudioWords, sendDetail, sendStateBadge } from './campaignWords.js';
import { runIsActive } from './RunControls.js';

export interface SendLogProps {
  documentId: string;
  /** The campaign's latest run: the log opens on it. */
  run: EmailRunView;
  /** BCP 47, for the times. */
  localeTag: string;
}

const PAGE = 50;

export function SendLog(props: SendLogProps): ReactNode {
  return (
    <StudioWords>
      <Log {...props} />
    </StudioWords>
  );
}

function filters(stopped: boolean): { value: EmailSendLogFilter; label: string }[] {
  return [
    { value: 'all', label: t('studio:email.log.filter.all', 'All') },
    { value: 'sent', label: t('studio:email.log.filter.sent', 'Sent') },
    // A send stopped for good leaves the rest unsent, not waiting.
    { value: 'waiting', label: stopped ? t('studio:email.log.filter.notSent', 'Not sent') : t('studio:email.log.filter.waiting', 'Waiting') },
    { value: 'skipped', label: t('studio:email.log.filter.skipped', 'Skipped') },
    { value: 'bounced', label: t('studio:email.log.filter.bounced', 'Bounced') },
    { value: 'spam', label: t('studio:email.log.filter.spam', 'Marked as spam') },
    { value: 'failed', label: t('studio:email.log.filter.failed', 'Failed') },
    { value: 'unsubscribed', label: t('studio:email.log.filter.unsubscribed', 'Unsubscribed') },
  ];
}

function Log({ documentId, run: latest, localeTag }: SendLogProps): ReactNode {
  const runs = useQuery(emailRunsQuery(documentId)).data?.runs ?? [];
  const [runId, setRunId] = useState(latest.id);
  const run = runs.find((one) => one.id === runId) ?? latest;
  const [filter, setFilter] = useState<EmailSendLogFilter>('all');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  // The search asks once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => {
    setRunId(latest.id);
  }, [latest.id]);

  const log = useInfiniteQuery({
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'log', run.id, filter, q] as const,
    queryFn: ({ pageParam }) => emailApi.sendLog(run.id, { filter, q, limit: PAGE, ...(pageParam === null ? {} : { after: pageParam }) }),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.next,
    refetchInterval: runIsActive(run) ? 5_000 : false,
    retry: false,
  });
  const summary = log.data?.pages[0]?.summary;
  const stopped = run.state === 'stopped';
  const rows = log.data?.pages.flatMap((page) => page.rows) ?? [];
  const time = (at: number | null) => (at === null ? '—' : new Intl.DateTimeFormat(localeTag, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at));
  const runLabel = (one: EmailRunView) =>
    t('studio:email.log.runOf', 'Sent {when}', { when: new Intl.DateTimeFormat(localeTag, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(one.startedAt ?? one.scheduledAt) });

  return (
    <div data-testid="email-send-log" className="flex min-w-0 flex-1 flex-col gap-4 bg-bg px-4 py-4 md:px-7 md:py-6">
      {runs.length > 1 ? (
        <Select aria-label={t('studio:email.log.whichSend', 'Which send')} value={run.id} onChange={(event) => setRunId(event.target.value)} wrapperClassName="self-start" data-testid="email-log-run">
          {runs.map((one) => (
            <option key={one.id} value={one.id}>
              {runLabel(one)}
            </option>
          ))}
        </Select>
      ) : null}
      <Summary summary={summary} stopped={stopped} />
      <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
        <ChoiceChips
          aria-label={t('studio:email.log.filterLabel', 'Filter by state')}
          data-testid="email-log-filters"
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&>button]:h-11 md:[&>button]:h-7 [&>button]:font-bold"
          options={filters(stopped)}
          value={filter}
          onValueChange={(value) => setFilter((value ?? 'all') as EmailSendLogFilter)}
        />
        <div className="flex items-center gap-2 md:ms-auto">
          <SearchInput
            aria-label={t('studio:email.log.search', 'Search people or addresses')}
            placeholder={t('studio:email.log.search', 'Search people or addresses')}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            data-testid="email-log-search"
            className="h-11 min-w-0 flex-1 rounded-[10px] bg-surface md:h-[38px] md:w-60 md:flex-none"
          />
          <a
            href={sendLogCsvUrl(run.id, { filter, q })}
            download
            data-testid="email-log-csv"
            aria-label={t('studio:email.log.csv', 'Download CSV')}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-[7px] rounded-[10px] border border-border-strong bg-surface px-3 text-body-sm font-bold text-fg hover:bg-surface-3 md:h-[38px] md:px-3.5 [&_svg]:size-[15px]"
          >
            <Download aria-hidden="true" />
            <span className="hidden md:inline">{t('studio:email.log.csv', 'Download CSV')}</span>
          </a>
        </div>
      </div>

      {log.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner label={t('common.loading', 'Loading')} />
        </div>
      ) : log.isError ? (
        <p role="alert" className="text-body-sm text-danger">
          {t('studio:email.log.loadFailed', 'The send log could not be loaded. Try again.')}
        </p>
      ) : (
        <>
          <LogTable rows={rows} time={time} stopped={stopped} />
          <LogList rows={rows} time={time} stopped={stopped} />
          {log.hasNextPage ? (
            <Button variant="secondary" className="self-center" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()} data-testid="email-log-more">
              {t('studio:email.log.more', 'Show more')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function Summary({ summary, stopped }: { summary: EmailSendLogSummary | undefined; stopped: boolean }): ReactNode {
  const cells: [keyof EmailSendLogSummary, string, string][] = [
    ['sent', t('studio:email.log.summary.sent', 'Sent'), 'text-pos'],
    ['skipped', t('studio:email.log.summary.skipped', 'Skipped'), 'text-fg'],
    ['bounced', t('studio:email.log.summary.bounced', 'Bounced'), 'text-warn'],
    ['spam', t('studio:email.log.summary.spam', 'Marked as spam'), 'text-danger'],
    ['unsubscribed', t('studio:email.log.summary.unsubscribed', 'Unsubscribed'), 'text-info'],
    ['waiting', stopped ? t('studio:email.log.summary.notSent', 'Not sent') : t('studio:email.log.summary.waiting', 'Waiting'), 'text-fg'],
    ['failed', t('studio:email.log.summary.failed', 'Failed'), 'text-danger'],
  ];
  return (
    <dl data-testid="email-log-summary" className="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface shadow-card md:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
      {cells.map(([key, label, tone]) => (
        <div key={key} data-testid={`email-log-summary-${key}`} className="border-b border-e border-border px-3 py-2.5 md:border-b-0 md:px-5 md:py-3.5">
          <dt className="truncate text-caption font-semibold text-fg-muted">{label}</dt>
          <dd dir="ltr" className={cn('mt-0.5 text-start font-mono text-[20px] font-bold rtl:text-end', tone)}>
            {summary === undefined ? '—' : String(summary[key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const COLUMNS = 'grid grid-cols-[minmax(130px,1fr)_minmax(220px,1.5fr)_210px_120px_minmax(180px,1.4fr)] gap-3';

function StateBadge({ row, stopped }: { row: EmailSendLogRow; stopped: boolean }): ReactNode {
  const badge = sendStateBadge(row, stopped);
  return (
    <Badge tone={badge.tone} data-testid="email-log-state" data-state={row.state}>
      {badge.label}
    </Badge>
  );
}

function LogTable({ rows, time, stopped }: { rows: readonly EmailSendLogRow[]; time: (at: number | null) => string; stopped: boolean }): ReactNode {
  return (
    <div role="table" aria-label={t('studio:email.log.tab', 'Send log')} className="hidden overflow-x-auto rounded-xl border border-border bg-surface shadow-card md:block">
      <div role="row" className={cn(COLUMNS, 'border-b border-border bg-surface-2 px-[18px] py-[11px] text-micro uppercase text-fg-subtle')}>
        <span role="columnheader">{t('studio:email.log.col.person', 'Person')}</span>
        <span role="columnheader">{t('studio:email.log.col.address', 'Address')}</span>
        <span role="columnheader">{t('studio:email.log.col.state', 'State')}</span>
        <span role="columnheader">{t('studio:email.log.col.time', 'Time')}</span>
        <span role="columnheader">{t('studio:email.log.col.detail', 'Detail')}</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-9 text-center text-body text-fg-muted">{t('studio:email.log.empty', 'Nobody in this state.')}</div>
      ) : (
        rows.map((row) => (
          <div key={row.id} role="row" data-testid="email-log-row" className={cn(COLUMNS, 'items-center border-b border-border px-[18px] py-[var(--row-py,13px)] text-[length:var(--cell-fs,13px)] last:border-b-0 hover:bg-surface-2')}>
            <span role="cell" className="truncate font-bold text-fg">
              {row.name}
            </span>
            <span role="cell" dir="ltr" className="truncate text-start font-mono text-[12px] text-fg-muted rtl:text-end">
              {row.address}
            </span>
            <span role="cell">
              <StateBadge row={row} stopped={stopped} />
            </span>
            <span role="cell" className="font-mono text-[12px] text-fg-muted">
              {time(row.time)}
            </span>
            <span role="cell" className="min-w-0 break-words text-fg-muted">
              {sendDetail(row) || '—'}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function LogList({ rows, time, stopped }: { rows: readonly EmailSendLogRow[]; time: (at: number | null) => string; stopped: boolean }): ReactNode {
  return (
    <ul aria-label={t('studio:email.log.tab', 'Send log')} className="overflow-hidden rounded-xl border border-border bg-surface md:hidden">
      {rows.length === 0 ? (
        <li className="p-7 text-center text-body text-fg-muted">{t('studio:email.log.empty', 'Nobody in this state.')}</li>
      ) : (
        rows.map((row) => {
          const detail = sendDetail(row);
          return (
            <li key={row.id} data-testid="email-log-item" className="flex flex-col gap-1 border-b border-border px-3.5 py-[11px] last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-body font-bold text-fg">{row.name}</span>
                <span className="font-mono text-caption text-fg-muted">{time(row.time)}</span>
              </div>
              <div dir="ltr" className="text-start font-mono text-caption text-fg-muted [overflow-wrap:anywhere] rtl:text-end">
                {row.address}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge row={row} stopped={stopped} />
                {detail === '' ? null : <span className="text-[12px] text-fg-muted">{detail}</span>}
              </div>
            </li>
          );
        })
      )}
    </ul>
  );
}
