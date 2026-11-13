// SPDX-License-Identifier: AGPL-3.0-only
/**
 * In trial mode, a database held by the size cap: on a page of it, the notice
 * that it is over the trial's limit and read-only until some rows are
 * deleted, with how full it is, and "Read-only" by the title. On every page,
 * the creates and edits of each held database are locked with the reason
 * (`setDatabaseWriteLock`, @adminium/widgets) while its deletes stay open;
 * the server refuses the writes itself.
 *
 * Drawn by `appPageNotice.tsx`, in the template loader's chunk, never the
 * entry; it asks the server nothing outside trial mode.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HardDrive } from 'lucide-react';
import type { PageEnvelope } from '@adminium/engine/config';
import { setDatabaseWriteLock } from '@adminium/widgets';

import { api } from '../app/api.js';
import { systemInfoQuery } from '../app/capabilities.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';
import { TitleReadOnlyChip } from '../trial/ReadOnlyChip.js';

/** A trial database's last reading (`GET /system/size-caps`). */
export interface SizeCapReading {
  connectionId: string;
  usedBytes: number;
  limitBytes: number;
  measuredAt: string;
  held: boolean;
}

/** How often a page asks again: a delete shows on the server within seconds, here within this. */
const SIZE_CAPS_REFRESH_MS = 30_000;

export function sizeCapsQuery() {
  return {
    queryKey: ['system', 'size-caps'] as const,
    queryFn: () => api.get<{ data: SizeCapReading[] }>('/api/v1/system/size-caps'),
    staleTime: SIZE_CAPS_REFRESH_MS,
    refetchInterval: SIZE_CAPS_REFRESH_MS,
  };
}

const MB = 1024 * 1024;

/** Whole megabytes, as the limit is set. */
function megabytes(bytes: number): string {
  return String(Math.round(bytes / MB));
}

/** The notice itself: the sentence, and how full the database is against its limit. */
export function SizeCapNotice({ reading }: { reading: Pick<SizeCapReading, 'usedBytes' | 'limitBytes'> }) {
  useCommonWords();
  const limit = megabytes(reading.limitBytes);
  // The bar runs to the larger of the two, so the limit's mark sits where the limit is.
  const scale = Math.max(reading.usedBytes, reading.limitBytes);
  const filled = Math.min(100, (reading.usedBytes / scale) * 100);
  const mark = (reading.limitBytes / scale) * 100;
  return (
    <div role="status" data-testid="size-cap-notice" className="mb-4 flex items-start gap-3.5 rounded-[12px] border border-danger/20 bg-danger-soft px-4 py-3.5">
      <HardDrive aria-hidden className="mt-px size-[18px] shrink-0 text-danger" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <p className="text-[13px] font-semibold leading-[1.5]">
          {t('operatorSwitches.sizeCapNotice', 'This database is over the trial’s {limit} MB limit, so it is read-only. Delete some rows to continue.', { limit })}
        </p>
        <div className="flex max-w-[520px] items-center gap-3">
          <div className="relative h-2 flex-1 rounded-[8px] bg-danger/15">
            <div className="absolute inset-y-0 start-0 w-[var(--size-cap-filled)] rounded-[8px] bg-danger" style={{ '--size-cap-filled': `${String(filled)}%` }} />
            <div title={t('operatorSwitches.sizeCapLimit', '{limit} MB limit', { limit })} className="absolute -inset-y-[3px] start-[var(--size-cap-mark)] w-0.5 rounded-[2px] bg-fg" style={{ '--size-cap-mark': `${String(mark)}%` }} />
          </div>
          <span className="font-mono text-[12.5px] font-bold">{t('operatorSwitches.sizeCapUsage', '{used} / {limit} MB', { used: megabytes(reading.usedBytes), limit })}</span>
        </div>
      </div>
    </div>
  );
}

function SizeCapForPage({ page, ended }: { page: PageEnvelope; ended: boolean }) {
  useCommonWords();
  const caps = useQuery(sizeCapsQuery());
  // Every held database, keyed: a board or a calendar writes to the database of its own source.
  const held = (caps.data?.data ?? []).filter((candidate) => candidate.held).map((candidate) => candidate.connectionId);
  const heldKey = held.join(' ');
  useEffect(() => {
    if (heldKey === '') return undefined;
    const reason = t('operatorSwitches.sizeCapReadOnly', 'Read-only: the database is over the trial’s limit');
    const ids = heldKey.split(' ');
    for (const id of ids) setDatabaseWriteLock(id, reason);
    return () => {
      for (const id of ids) setDatabaseWriteLock(id, null);
    };
  }, [heldKey]);
  const connectionId = page.source.connectionId;
  const reading = caps.data?.data.find((candidate) => candidate.connectionId === connectionId && candidate.held) ?? null;
  if (reading === null) return null;
  return (
    <>
      <SizeCapNotice reading={reading} />
      {/* Once the trial has ended, the ended trial's chip already says it. */}
      {ended ? null : <TitleReadOnlyChip testId="size-cap-read-only" />}
    </>
  );
}

/** In trial mode: the locks of each held database, and on a page of one, the notice. */
export function SizeCapPageNotice({ page }: { page: PageEnvelope }) {
  const { data: info } = useQuery(systemInfoQuery());
  const trial = info?.trial;
  if (trial?.on !== true) return null;
  const end = trial.endsAt === null ? Number.NaN : Date.parse(trial.endsAt);
  return <SizeCapForPage page={page} ended={Number.isFinite(end) && Date.now() >= end} />;
}
