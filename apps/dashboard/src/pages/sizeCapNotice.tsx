// SPDX-License-Identifier: AGPL-3.0-only
/**
 * In trial mode, the notice on a page of a database held by the size cap:
 * that it is over the trial's limit and read-only until some rows are
 * deleted, with how full it is. The server refuses the writes itself and
 * leaves the page's create and edit buttons out; this says why.
 *
 * Drawn by `appPageNotice.tsx`, in the template loader's chunk, never the
 * entry; it asks the server nothing outside trial mode.
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive } from 'lucide-react';
import type { PageEnvelope } from '@adminium/engine/config';

import { api } from '../app/api.js';
import { systemInfoQuery } from '../app/capabilities.js';
import { useCommonWords } from '../i18n/commonWords.js';
import { t } from '../i18n/t.js';

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

function SizeCapForPage({ page }: { page: PageEnvelope }) {
  const connectionId = page.source.connectionId;
  const caps = useQuery({ ...sizeCapsQuery(), enabled: connectionId !== null });
  const reading = caps.data?.data.find((candidate) => candidate.connectionId === connectionId && candidate.held) ?? null;
  // The page's own buttons follow the hold: read the page again when it starts or lets go.
  const queryClient = useQueryClient();
  const held = reading !== null;
  const was = useRef(held);
  useEffect(() => {
    if (was.current === held) return;
    was.current = held;
    void queryClient.invalidateQueries({ queryKey: ['page', page.id] });
  }, [held, page.id, queryClient]);
  return reading === null ? null : <SizeCapNotice reading={reading} />;
}

/** In trial mode, on a page bound to a database: the notice while that database is held. */
export function SizeCapPageNotice({ page }: { page: PageEnvelope }) {
  const { data: info } = useQuery(systemInfoQuery());
  return info?.trial?.on === true && page.source.connectionId !== null ? <SizeCapForPage page={page} /> : null;
}
