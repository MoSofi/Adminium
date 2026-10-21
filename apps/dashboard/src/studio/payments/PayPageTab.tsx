// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Pay page: who the customer is paying.
 *
 * The shop's name and logo, how to reach it (shown on every page a customer
 * can get stuck on), the shop's country (the ways' country rules use it when
 * the customer's is not known), and whether the page lists the invoice's
 * lines. The logo is a PNG, JPEG or WebP image only: an SVG on a public page
 * is a script waiting to happen. It is uploaded to the payments' own logo
 * route and kept as a branding file, like the workspace logo.
 *
 * Beside the form, the real pay page in a phone frame, on a made-up invoice:
 * it follows the form as it is typed (the page is told by message, from this
 * origin only), and "Open a full preview" opens it for real, in test mode,
 * with the pretend payment service. Where customers pay is chosen here too.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, Image as ImageIcon, Info, Store, Upload } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, FormField, IconTile, Input, Radio, RadioGroup, Switch } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import {
  LOGO_TYPES,
  PAYMENTS_PAY_ADDRESS_QUERY_KEY,
  PAYMENTS_PAY_PAGE_QUERY_KEY,
  payAddressQuery,
  payPageQuery,
  savePayAddress,
  savePayPage,
  startTestPayment,
  uploadPayPageLogo,
  type PayAddress,
  type PayPageSettings,
} from './paymentsApi.js';
import { countryName } from './paymentsWords.js';

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = (error.details as { reason?: unknown } | null | undefined)?.reason;
    if (reason === 'logo-type') return t('studio:payments.page.logoType', 'The logo must be a PNG, JPEG or WebP image.');
    return error.message;
  }
  return t('studio:payments.error.unknown', 'That did not work. Try again.');
}

/** The real pay page in a phone frame, told the form's values as they change. */
function PayPagePreview({ page }: { page: PayPageSettings }): ReactNode {
  const frame = useRef<HTMLIFrameElement>(null);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: 'adminium-pay-preview', shop: { name: page.shopName.trim(), email: page.contactEmail?.trim() || null, phone: page.contactPhone?.trim() || null }, logoFileId: page.logoFileId, showLines: page.showLines },
      window.location.origin,
    );
  }, [page]);
  useEffect(() => send(), [send]);
  useEffect(() => {
    // The page says when it listens; it is told what is on the form then.
    const ready = (event: MessageEvent): void => {
      if (event.origin === window.location.origin && (event.data as { type?: unknown } | null)?.type === 'adminium-pay-preview-ready') send();
    };
    window.addEventListener('message', ready);
    return () => window.removeEventListener('message', ready);
  }, [send]);

  async function openFull(): Promise<void> {
    setFailed(false);
    setOpening(true);
    // Opened at once, so no pop-up blocker takes it for an unasked window.
    const opened = window.open('about:blank', '_blank');
    try {
      const started = await startTestPayment('demo');
      if (opened === null) window.location.assign(started.url);
      else opened.location.href = started.url;
    } catch {
      opened?.close();
      setFailed(true);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex w-[320px] max-w-full flex-col items-center gap-3" data-testid="payments-page-preview">
      <p className="self-start text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">
        {t('studio:payments.page.previewTitle', 'Preview · invoice')} <span className="font-mono">INV-0042</span>
      </p>
      <div className="w-[300px] max-w-full overflow-hidden rounded-[40px] border-[10px] border-fg bg-surface shadow-lg">
        <iframe ref={frame} src="/pay/preview" title={t('studio:payments.page.previewFrame', 'Pay page preview')} className="block h-[600px] w-full border-0" onLoad={send} />
      </div>
      <Button variant="secondary" iconLeft={<ExternalLink className="size-4" />} disabled={opening} onClick={() => void openFull()} data-testid="payments-page-full-preview">
        {t('studio:payments.page.openPreview', 'Open a full preview')}
      </Button>
      <p className="max-w-[280px] text-center text-[11.5px] text-fg-subtle">{t('studio:payments.page.previewNote', 'Staff only. It uses a pretend payment service and moves no money.')}</p>
      {failed ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {t('studio:payments.page.previewFailed', 'The full preview could not be opened. Try again.')}
        </p>
      ) : null}
    </div>
  );
}

/** "Where customers pay": this server's public address or one of its customer domains. */
function AddressChoice({ address, value, onChange, readOnly }: { address: PayAddress; value: string | null; onChange: (origin: string) => void; readOnly: boolean }): ReactNode {
  if (address.choices.length === 0) {
    return <p className="text-[12.5px] text-fg-muted">{t('studio:payments.page.whereNone', "Set this server's public address first: pay links need an address customers can reach.")}</p>;
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend id="payments-page-where" className="mb-1.5 text-[12.5px] font-bold">
        {t('studio:payments.page.where', 'Where customers pay')}
      </legend>
      <RadioGroup aria-labelledby="payments-page-where" value={value ?? ''} disabled={readOnly} onValueChange={onChange} data-testid="payments-page-where">
        {address.choices.map((origin) => (
          <Radio
            key={origin}
            value={origin}
            label={
              <span>
                <span dir="ltr" className="font-mono text-[12.5px] font-semibold">
                  {origin}
                </span>{' '}
                <span className="text-fg-muted">
                  {origin === (address.staffOrigin ?? null) ? t('studio:payments.page.whereStaff', '(your staff address)') : t('studio:payments.page.whereCustomer', '(your customer address)')}
                </span>
              </span>
            }
          />
        ))}
      </RadioGroup>
      <p className="text-[11.5px] text-fg-subtle">{t('studio:payments.page.whereNote', 'Pay links always use the address you choose here.')}</p>
    </fieldset>
  );
}

function PayPageForm({ saved, address, canManage }: { saved: PayPageSettings; address: PayAddress; canManage: boolean }) {
  const client = useQueryClient();
  const [page, setPage] = useState<PayPageSettings>(saved);
  const [origin, setOrigin] = useState<string | null>(address.origin);
  useEffect(() => setOrigin(address.origin), [address.origin]);
  const [status, setStatus] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setPage(saved), [saved]);
  // What was typed, spaces and all ("+49 30 …"); trimmed only in what is saved.
  const text = (value: string | null) => (value === null || value.trim() === '' ? null : value.trim());
  const body: PayPageSettings = { ...page, shopName: page.shopName.trim(), contactEmail: text(page.contactEmail), contactPhone: text(page.contactPhone), shopCountry: text(page.shopCountry) };
  /** Any edit makes "saved" no longer true. */
  const edit = (patch: Partial<PayPageSettings>) => {
    setStatus(null);
    setPage((current) => ({ ...current, ...patch }));
  };
  const save = useMutation({
    mutationFn: async () => {
      await savePayPage(body);
      // A new pay address moves every link and webhook: saved only when it was changed.
      if (origin !== null && origin !== address.origin) await savePayAddress(origin);
    },
    onMutate: () => setStatus(null),
    onSuccess: async () => {
      setStatus(t('studio:payments.page.saved', 'Pay page saved'));
      await client.invalidateQueries({ queryKey: PAYMENTS_PAY_PAGE_QUERY_KEY });
      await client.invalidateQueries({ queryKey: PAYMENTS_PAY_ADDRESS_QUERY_KEY });
    },
  });
  const upload = useMutation({
    mutationFn: async (picked: File) => {
      if (!(LOGO_TYPES as readonly string[]).includes(picked.type)) throw new Error('logo-type');
      return uploadPayPageLogo(picked);
    },
    onSuccess: (id) => edit({ logoFileId: id }),
  });
  const uploadError =
    upload.error instanceof Error && upload.error.message === 'logo-type'
      ? t('studio:payments.page.logoType', 'The logo must be a PNG, JPEG or WebP image.')
      : upload.isError
        ? errorText(upload.error)
        : null;
  const emailOk = body.contactEmail === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail);
  const countryOk = body.shopCountry === null || /^[A-Z]{2}$/.test(body.shopCountry);
  const ok = body.shopName !== '' && emailOk && countryOk;
  const blank = (value: string) => (value === '' ? null : value);
  const logoPending = page.logoFileId !== null && page.logoFileId !== saved.logoFileId;
  const readOnly = !canManage;

  return (
    <div className="flex flex-wrap items-start gap-5">
    <Card data-testid="payments-page" className="min-w-0 flex-[1_1_420px]">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile icon={<Store />} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">{t('studio:payments.page.title', 'What customers see')}</h2>
          <p className="text-[12.5px] text-fg-muted">{t('studio:payments.page.intro', 'The name, logo and contact on every pay page.')}</p>
        </div>
      </CardHeader>
      <CardBody className="flex max-w-[640px] flex-col gap-4">
        <FormField label={t('studio:payments.page.shopName', 'Shop name')} required error={page.shopName.trim() === '' ? t('studio:payments.page.shopNameNeeded', 'The pay page needs a name.') : undefined}>
          <Input dir="auto" maxLength={120} readOnly={readOnly} value={page.shopName} onChange={(event) => edit({ shopName: event.target.value })} data-testid="payments-page-name" />
        </FormField>
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-semibold">{t('studio:payments.page.logo', 'Logo')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface-2" aria-hidden="true">
              <ImageIcon className="size-5 text-fg-muted" />
            </span>
            <span className="text-[12.5px]" data-testid="payments-page-logo-state">
              {page.logoFileId === null
                ? t('studio:payments.page.noLogo', 'No logo yet')
                : logoPending
                  ? t('studio:payments.page.logoPending', 'Logo uploaded. Save to use it on the pay page.')
                  : t('studio:payments.page.logoUploaded', 'Logo uploaded')}
            </span>
            {canManage ? (
              <>
                <input
                  ref={file}
                  type="file"
                  accept={LOGO_TYPES.join(',')}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  data-testid="payments-page-logo-input"
                  onChange={(event) => {
                    const picked = event.target.files?.[0];
                    if (picked !== undefined) upload.mutate(picked);
                    event.target.value = '';
                  }}
                />
                <Button variant="secondary" size="sm" iconLeft={<Upload className="size-4" />} disabled={upload.isPending} onClick={() => file.current?.click()}>
                  {t('studio:payments.page.upload', 'Upload a logo')}
                </Button>
                {page.logoFileId !== null ? (
                  <Button variant="ghost" size="sm" onClick={() => edit({ logoFileId: null })}>
                    {t('studio:payments.page.removeLogo', 'Remove the logo')}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
          <p className="text-[12px] text-fg-muted">{t('studio:payments.page.logoHelp', 'PNG, JPEG or WebP. Square works best.')}</p>
          {uploadError !== null ? (
            <p role="alert" className="text-[12.5px] text-danger" data-testid="payments-page-logo-error">
              {uploadError}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <FormField label={t('studio:payments.page.email', 'Contact email')} className="min-w-[200px] flex-1" error={emailOk ? undefined : t('studio:payments.page.emailInvalid', 'Write an address such as hello@example.com.')}>
            <Input dir="ltr" type="email" readOnly={readOnly} value={page.contactEmail ?? ''} onChange={(event) => edit({ contactEmail: blank(event.target.value) })} />
          </FormField>
          <FormField label={t('studio:payments.page.phone', 'Contact phone')} className="min-w-[200px] flex-1">
            <Input dir="ltr" className="font-mono" type="tel" placeholder="+49" readOnly={readOnly} value={page.contactPhone ?? ''} onChange={(event) => edit({ contactPhone: blank(event.target.value) })} />
          </FormField>
        </div>
        <FormField
          label={t('studio:payments.page.country', "The shop's country")}
          helper={body.shopCountry !== null && countryOk ? countryName(body.shopCountry) : t('studio:payments.page.countryHelp', 'A two-letter code, such as DE. The rules on Ways to pay use it when a customer’s country is not known.')}
          error={countryOk ? undefined : t('studio:payments.page.countryInvalid', 'Write a two-letter code, such as DE.')}
        >
          <Input dir="ltr" className="w-24 font-mono uppercase" maxLength={2} readOnly={readOnly} value={page.shopCountry ?? ''} onChange={(event) => edit({ shopCountry: blank(event.target.value.toUpperCase()) })} data-testid="payments-page-country" />
        </FormField>
        <div className="flex items-center gap-3">
          <Switch id="payments-page-lines" checked={page.showLines} disabled={readOnly} onCheckedChange={(next) => edit({ showLines: next })} />
          <label htmlFor="payments-page-lines" className="text-[13px]">
            {t('studio:payments.page.lines', "Show the invoice's lines on the pay page")}
          </label>
        </div>
        <AddressChoice
          address={address}
          value={origin}
          readOnly={readOnly}
          onChange={(next) => {
            setStatus(null);
            setOrigin(next);
          }}
        />
        <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[12.5px] text-fg-muted">
          <Info className="mt-[3px] size-3.5 shrink-0 text-info" aria-hidden="true" />
          <span>{t('studio:payments.page.providerBranding', 'Customers also see the name and logo set in your Stripe dashboard on the Stripe page.')}</span>
        </p>
        {save.isError ? <Alert tone="danger" role="alert" title={errorText(save.error)} /> : null}
        <p role="status" className="text-[12.5px]" data-testid="payments-page-status">
          {status}
        </p>
        {canManage ? (
          <div>
            <Button disabled={!ok || save.isPending} onClick={() => save.mutate()} data-testid="payments-page-save">
              {t('studio:payments.field.save', 'Save')}
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
    <PayPagePreview page={page} />
    </div>
  );
}

export function PayPageTab({ canManage }: { canManage: boolean }): ReactNode {
  const page = useQuery(payPageQuery());
  const address = useQuery(payAddressQuery());
  if (page.isPending || address.isPending) return <p className="text-[13px] text-fg-muted">{t('studio:payments.loading', 'Loading…')}</p>;
  if (page.isError) return <Alert tone="danger" role="alert" title={errorText(page.error)} />;
  if (address.isError) return <Alert tone="danger" role="alert" title={errorText(address.error)} />;
  return <PayPageForm saved={page.data} address={address.data} canManage={canManage} />;
}
