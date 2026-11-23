// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shipping → Who can buy labels (comp state S06).
 *
 * The daily limit is ONE count for the whole install, so every word about it
 * says "all packers together" (F18). With no limit set, the owner books. The
 * abroad switch is Release 2 and is not drawn (F17).
 *
 * The currency is the saved limit's, else the one the app's database is set
 * to. A rate in any other currency counts as above the limit on the server, so
 * when neither is known the person names it rather than the page guessing.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, UsersRound } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Alert, Button, Card, IconTile, Input, ProgressBar } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { saveLimits, shippingStatusKey, type LimitsBody, type ShippingApp, type ShippingStatus } from './shippingApi.js';
import { refusalWords, useShippingFormat } from './shippingWords.js';

const MAX_DAILY = 100_000;

/** A decimal as the server takes it, from what a person types (a comma counts). Null when it is not one above zero. */
export function cleanAmount(text: string): string | null {
  const value = text.trim().replace(',', '.');
  return /^\d{1,12}(\.\d{1,4})?$/.test(value) && /[1-9]/.test(value) ? value : null;
}

export function cleanDaily(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,6}$/.test(value)) return null;
  const count = Number(value);
  return count >= 1 && count <= MAX_DAILY ? count : null;
}

export function LimitsTab({ app, status, connectionCurrency }: { app: ShippingApp; status: ShippingStatus; connectionCurrency: string | null }) {
  const client = useQueryClient();
  const toasts = useAppToasts();
  const format = useShippingFormat();
  const ids = useId();
  const saved = status.limits;
  const isSet = saved.perLabel !== null && saved.dailyLabels !== null;
  const knownCurrency = saved.perLabel?.currency ?? connectionCurrency;

  const [opening, setOpening] = useState(false);
  const [per, setPer] = useState(saved.perLabel?.amount ?? '');
  const [day, setDay] = useState(saved.dailyLabels === null ? '' : String(saved.dailyLabels));
  const [currency, setCurrency] = useState('');
  const [perError, setPerError] = useState<string | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [currencyError, setCurrencyError] = useState<string | null>(null);

  useEffect(() => {
    setPer(saved.perLabel?.amount ?? '');
    setDay(saved.dailyLabels === null ? '' : String(saved.dailyLabels));
    setPerError(null);
    setDayError(null);
    setCurrencyError(null);
  }, [saved.perLabel?.amount, saved.dailyLabels, app.installId]);

  const write = useMutation({
    mutationFn: (body: LimitsBody) => saveLimits(app, body),
    onSuccess: (data, body) => {
      client.setQueryData(shippingStatusKey(app), data);
      setOpening(false);
      toasts.push({
        variant: 'success',
        title: body.perLabel === null ? t('studio:shipping.limits.stopped', "Packers can't buy labels now. You book them.") : t('studio:shipping.limits.saved', 'Limits saved.'),
      });
    },
  });

  function submit() {
    const amount = cleanAmount(per);
    const daily = cleanDaily(day);
    const code = knownCurrency ?? currency.trim().toUpperCase();
    const codeOk = /^[A-Z]{3}$/.test(code);
    setPerError(amount === null ? t('studio:shipping.limits.perError', 'Enter the most a packer can spend on one label, above zero.') : null);
    setDayError(daily === null ? t('studio:shipping.limits.dayError', 'Enter how many labels all packers together can buy in a day, 1 or more.') : null);
    setCurrencyError(codeOk ? null : t('studio:shipping.limits.currencyError', 'Enter the three-letter currency code, such as EUR.'));
    if (amount === null || daily === null || !codeOk) return;
    write.mutate({ perLabel: { amount, currency: code }, dailyLabels: daily });
  }

  const showForm = isSet || opening;
  const used = saved.usedToday;
  const limit = saved.dailyLabels ?? 0;

  return (
    <Card padded={false} data-testid="shipping-limits">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <IconTile tone="neutral" icon={<UsersRound />} />
        <div className="min-w-[160px] flex-1">
          <h2 className="text-[14.5px] font-bold tracking-[-.01em]">{t('studio:shipping.limits.heading', 'Who can buy labels')}</h2>
          <p className="mt-0.5 text-[11.5px] text-fg-subtle">{t('studio:shipping.limits.subtitle', 'You can always buy labels. Packers buy only within these limits.')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3.5 p-5">
        {showForm ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[14px] leading-[1.6]">
              <span>{t('studio:shipping.limits.upTo', 'Packers can buy labels up to')}</span>
              <span className="inline-flex items-center gap-1">
                {knownCurrency !== null ? (
                  <span className="font-mono text-[13px] font-medium text-fg-subtle" data-testid="shipping-limit-currency">
                    {format.currencySign(knownCurrency)}
                  </span>
                ) : (
                  <Input
                    aria-label={t('studio:shipping.limits.currencyLabel', 'Currency of the limit')}
                    aria-invalid={currencyError !== null ? 'true' : 'false'}
                    aria-describedby={currencyError !== null ? `${ids}-currency` : undefined}
                    dir="ltr"
                    maxLength={3}
                    className="w-16 font-mono font-medium uppercase"
                    value={currency}
                    onChange={(event) => {
                      setCurrency(event.target.value);
                      setCurrencyError(null);
                    }}
                    data-testid="shipping-limit-currency-input"
                  />
                )}
                <Input
                  aria-label={t('studio:shipping.limits.perLabel', 'Most a packer can spend on one label')}
                  aria-invalid={perError !== null ? 'true' : 'false'}
                  aria-describedby={perError !== null ? `${ids}-per` : undefined}
                  inputMode="decimal"
                  dir="ltr"
                  className="w-[84px] font-mono font-medium"
                  value={per}
                  onChange={(event) => {
                    setPer(event.target.value);
                    setPerError(null);
                  }}
                  data-testid="shipping-limit-per"
                />
              </span>
              <span>{t('studio:shipping.limits.each', 'each, and')}</span>
              <Input
                aria-label={t('studio:shipping.limits.daily', 'Most labels all packers together can buy in a day')}
                aria-invalid={dayError !== null ? 'true' : 'false'}
                aria-describedby={dayError !== null ? `${ids}-day` : undefined}
                inputMode="numeric"
                dir="ltr"
                className="w-16 font-mono font-medium"
                value={day}
                onChange={(event) => {
                  setDay(event.target.value);
                  setDayError(null);
                }}
                data-testid="shipping-limit-day"
              />
              <span>{t('studio:shipping.limits.aDay', 'a day, all packers together.')}</span>
            </div>
            {currencyError !== null ? (
              <p id={`${ids}-currency`} role="alert" className="text-[12px] font-semibold text-danger">
                {currencyError}
              </p>
            ) : null}
            {perError !== null ? (
              <p id={`${ids}-per`} role="alert" className="text-[12px] font-semibold text-danger" data-testid="shipping-limit-per-error">
                {perError}
              </p>
            ) : null}
            {dayError !== null ? (
              <p id={`${ids}-day`} role="alert" className="text-[12px] font-semibold text-danger" data-testid="shipping-limit-day-error">
                {dayError}
              </p>
            ) : null}
            {isSet ? (
              <div className="flex max-w-[420px] flex-col gap-1.5" data-testid="shipping-limit-used">
                <div className="flex flex-wrap items-baseline gap-2 text-[12.5px] text-fg-muted">
                  <span>{t('studio:shipping.limits.today', 'Today:')}</span>
                  <span className="font-mono font-semibold text-fg">{t('studio:shipping.limits.count', '{used} of {limit}', { used: format.number(used), limit: format.number(limit) })}</span>
                  <span>{t('studio:shipping.limits.bought', 'bought by all packers together')}</span>
                </div>
                <ProgressBar role="meter" size="md" value={used} max={limit} animated={false} label={t('studio:shipping.limits.meter', 'Labels bought by all packers together today')} />
              </div>
            ) : null}
            {write.isError ? <Alert tone="danger" role="alert" title={refusalWords(write.error, app.name)} /> : null}
            <div className="flex flex-wrap items-center gap-2.5">
              <Button className="min-h-11" disabled={write.isPending} onClick={submit} data-testid="shipping-limit-save">
                {t('studio:shipping.limits.save', 'Save limits')}
              </Button>
              {isSet ? (
                <Button variant="secondary" className="min-h-11" disabled={write.isPending} onClick={() => write.mutate({ perLabel: null, dailyLabels: null })} data-testid="shipping-limit-stop">
                  {t('studio:shipping.limits.stop', 'Stop packers buying labels')}
                </Button>
              ) : (
                <Button variant="ghost" className="min-h-11" disabled={write.isPending} onClick={() => setOpening(false)}>
                  {t('studio:shipping.limits.cancel', 'Cancel')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-2.5 rounded-[12px] border border-border bg-surface-2 px-3.5 py-3" data-testid="shipping-limit-none">
              <Lock aria-hidden="true" className="mt-px size-[18px] shrink-0 text-fg-muted" />
              <p className="text-[14px] font-bold">{t('studio:shipping.limits.none', "Packers can't buy labels yet. You book them.")}</p>
            </div>
            <div>
              <Button variant="secondary" className="min-h-11" iconLeft={<Plus className="size-3.5" />} onClick={() => setOpening(true)} data-testid="shipping-limit-open">
                {t('studio:shipping.limits.open', 'Let packers buy labels')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
