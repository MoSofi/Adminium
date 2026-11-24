// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shipping → Label size (comp state S05).
 *
 * Saved once, on commit: a click, Space or Enter, or focus leaving the group.
 * An arrow key moves the choice and saves nothing, so walking across the three
 * sizes is one write and not three. It is the size ASKED for: a carrier
 * may return another, and the booking says so when one does.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, Card, IconTile } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { LABEL_SIZES, saveLabelSize, shippingStatusKey, type LabelSize, type ShippingApp, type ShippingStatus } from './shippingApi.js';
import { refusalWords, rovingNext, sizeLabel, sizeLine } from './shippingWords.js';

export function LabelSizeTab({ app, status }: { app: ShippingApp; status: ShippingStatus }) {
  const client = useQueryClient();
  const toasts = useAppToasts();
  const [draft, setDraft] = useState<LabelSize>(status.labelSize);
  const buttons = useRef(new Map<LabelSize, HTMLButtonElement>());
  // The last size sent, so a blur right after a click does not send it twice.
  const sent = useRef<LabelSize>(status.labelSize);

  // Follows the server, unless the person has already moved on to another size.
  useEffect(() => {
    const previous = sent.current;
    sent.current = status.labelSize;
    setDraft((held) => (held === previous ? status.labelSize : held));
  }, [status.labelSize]);

  const save = useMutation({
    mutationFn: (size: LabelSize) => saveLabelSize(app, size),
    onSuccess: (labelSize) => {
      client.setQueryData<ShippingStatus>(shippingStatusKey(app), (held) => (held === undefined ? held : { ...held, labelSize }));
      toasts.push({ variant: 'success', title: t('studio:shipping.size.saved', 'Label size saved.') });
    },
    onError: () => {
      sent.current = status.labelSize;
      setDraft(status.labelSize);
    },
  });

  const commit = (size: LabelSize) => {
    if (size === sent.current) return;
    sent.current = size;
    save.mutate(size);
  };

  return (
    <Card padded={false} data-testid="shipping-size">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <IconTile tone="neutral" icon={<Printer />} />
        <div className="min-w-[160px] flex-1">
          <h2 className="text-[14.5px] font-bold tracking-[-.01em]">{t('studio:shipping.size.heading', 'Label size')}</h2>
          <p className="mt-0.5 text-[11.5px] text-fg-subtle">{t('studio:shipping.size.subtitle', 'The size Adminium asks the carrier for. A carrier may return another size, and the booking says so.')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-5">
        <div
          role="radiogroup"
          aria-label={t('studio:shipping.size.heading', 'Label size')}
          className="inline-flex max-w-full gap-0.5 self-start rounded-[12px] bg-surface-3 p-[3px]"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) commit(draft);
          }}
        >
          {LABEL_SIZES.map((size) => {
            const on = size === draft;
            return (
              <button
                key={size}
                ref={(element) => {
                  if (element === null) buttons.current.delete(size);
                  else buttons.current.set(size, element);
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                data-testid={`shipping-size-${size}`}
                onClick={() => {
                  setDraft(size);
                  commit(size);
                }}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    commit(draft);
                    return;
                  }
                  const next = rovingNext(event, LABEL_SIZES, size) as LabelSize | null;
                  if (next === null) return;
                  event.preventDefault();
                  setDraft(next);
                  buttons.current.get(next)?.focus();
                }}
                className={`min-h-10 whitespace-nowrap rounded-[9px] px-[18px] py-2 font-mono text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft ${on ? 'bg-surface text-fg shadow-sm' : 'bg-transparent text-fg-muted'}`}
              >
                {sizeLabel(size)}
              </button>
            );
          })}
        </div>
        {save.isError ? <Alert tone="danger" role="alert" title={refusalWords(save.error, app.name)} /> : null}
        <ul aria-label={t('studio:shipping.size.which', 'Which printers each size suits')} className="flex flex-col gap-1.5">
          {LABEL_SIZES.map((size) => {
            const on = size === draft;
            return (
              <li key={size} className={`flex items-baseline gap-2.5 text-[13px] ${on ? 'text-fg' : 'text-fg-muted'}`}>
                <span className="w-14 shrink-0 font-mono text-[12px] font-semibold text-fg">{sizeLabel(size)}</span>
                <span className={on ? 'font-bold' : 'font-medium'}>{sizeLine(size)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
