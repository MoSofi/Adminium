// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Texts → Activity: replies and delivery reports this server took in but
 * could not act on (`sms.manage` only).
 *
 * Each row says who it is from, masked, why it failed and how long ago. One
 * that may be a request to stop holds every text to that person until it is
 * tried again or closed, or until its content is deleted on the day shown:
 * the row says so plainly. Nothing here shows a word of what the person wrote.
 * Try again and Close are each audited on the server.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareWarning, RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, IconTile } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { dismissFailed, failedRepliesKey, failedRepliesQuery, retryAllFailed, retryFailed, type FailedReply } from './textsApi.js';
import { activeLocale, stamp } from './textsWords.js';

function kindWord(kind: string): string {
  switch (kind) {
    case 'reply':
      return t('studio:texts.failed.kind.reply', 'Reply');
    case 'delivery':
      return t('studio:texts.failed.kind.delivery', 'Delivery report');
    case 'opt-out':
      return t('studio:texts.failed.kind.optOut', 'Opt-out from the provider');
    default:
      return kind;
  }
}

function Row({ row, locale, busy, onRetry, onClose }: { row: FailedReply; locale: string; busy: boolean; onRetry: () => void; onClose: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border px-[18px] py-3 text-[13px] last:border-b-0" data-testid="texts-failed-row">
      <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{kindWord(row.kind)}</span>
          <bdi dir="ltr" className="font-mono text-[12px]">
            {row.masked ?? '•••'}
          </bdi>
          {row.holds ? <Badge tone="warn">{t('studio:texts.failed.holds', 'Holds texts to this number')}</Badge> : null}
        </span>
        <span className="text-[12px] text-fg-muted">
          {t('studio:texts.failed.when', 'Received {date} · {reason}', { date: stamp(row.receivedAt, locale), reason: row.reason ?? '—' })}
        </span>
        {row.holds && row.holdsUntil !== null ? (
          <span className="text-[12px] text-fg-muted" data-testid="texts-failed-until">
            {t('studio:texts.failed.until', 'It may be a request to stop, so no text goes to this number until you try it again or close it, or until {date}, when its content is deleted.', { date: stamp(row.holdsUntil, locale) })}
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={busy || !row.retryable} iconLeft={<RotateCcw className="size-3.5" />} onClick={onRetry} data-testid="texts-failed-retry">
          {t('studio:texts.failed.retry', 'Try again')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} iconLeft={<X className="size-3.5" />} onClick={onClose} data-testid="texts-failed-close">
          {t('studio:texts.failed.close', 'Close')}
        </Button>
      </div>
    </li>
  );
}

export function FailedRepliesCard(): ReactNode {
  const client = useQueryClient();
  const locale = activeLocale();
  const list = useQuery(failedRepliesQuery());
  const refresh = () => void client.invalidateQueries({ queryKey: failedRepliesKey });
  const retry = useMutation({ mutationFn: retryFailed, onSettled: refresh });
  const close = useMutation({ mutationFn: dismissFailed, onSettled: refresh });
  const all = useMutation({ mutationFn: retryAllFailed, onSettled: refresh });
  const rows = list.data?.data ?? [];
  // Nothing failed: the card stays out of the way.
  if (list.data !== undefined && rows.length === 0) return null;
  if (list.data === undefined && !list.isError) return null;
  const busy = retry.isPending || close.isPending || all.isPending;
  const summary = list.data?.summary;
  return (
    <Card data-testid="texts-failed">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile tone={summary !== undefined && summary.holding > 0 ? 'warn' : 'neutral'} icon={<MessageSquareWarning />} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">{t('studio:texts.failed.heading', 'Replies that could not be read')}</h2>
          {summary === undefined ? null : (
            <p className="mt-0.5 text-[12.5px] text-fg-muted" data-testid="texts-failed-summary">
              {t('studio:texts.failed.summary', '{failed, plural, one {# could not be acted on} other {# could not be acted on}}, {holding, plural, one {# holds texts} other {# hold texts}}.', { failed: summary.failed, holding: summary.holding })}
            </p>
          )}
        </div>
        <Button size="sm" variant="secondary" disabled={busy} loading={all.isPending} iconLeft={<RotateCcw className="size-3.5" />} onClick={() => all.mutate()} data-testid="texts-failed-retry-all">
          {t('studio:texts.failed.retryAll', 'Try all again')}
        </Button>
      </CardHeader>
      <CardBody className="p-0">
        {list.isError ? <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} /> : null}
        <ul>
          {rows.map((row) => (
            <Row key={row.id} row={row} locale={locale} busy={busy} onRetry={() => retry.mutate(row.id)} onClose={() => close.mutate(row.id)} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
