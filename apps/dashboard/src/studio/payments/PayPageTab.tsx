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
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Image as ImageIcon, Store, Upload } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, FormField, IconTile, Input, Switch } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { LOGO_TYPES, PAYMENTS_PAY_PAGE_QUERY_KEY, payPageQuery, savePayPage, uploadPayPageLogo, type PayPageSettings } from './paymentsApi.js';
import { countryName } from './paymentsWords.js';

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = (error.details as { reason?: unknown } | null | undefined)?.reason;
    if (reason === 'logo-type') return t('studio:payments.page.logoType', 'The logo must be a PNG, JPEG or WebP image.');
    return error.message;
  }
  return t('studio:payments.error.unknown', 'That did not work. Try again.');
}

function PayPageForm({ saved, canManage }: { saved: PayPageSettings; canManage: boolean }) {
  const client = useQueryClient();
  const [page, setPage] = useState<PayPageSettings>(saved);
  const [status, setStatus] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setPage(saved), [saved]);
  const save = useMutation({
    mutationFn: () => savePayPage(page),
    onSuccess: async () => {
      setStatus(t('studio:payments.page.saved', 'Pay page saved'));
      await client.invalidateQueries({ queryKey: PAYMENTS_PAY_PAGE_QUERY_KEY });
    },
  });
  const upload = useMutation({
    mutationFn: async (picked: File) => {
      if (!(LOGO_TYPES as readonly string[]).includes(picked.type)) throw new Error('logo-type');
      return uploadPayPageLogo(picked);
    },
    onSuccess: (id) => setPage((current) => ({ ...current, logoFileId: id })),
  });
  const uploadError =
    upload.error instanceof Error && upload.error.message === 'logo-type'
      ? t('studio:payments.page.logoType', 'The logo must be a PNG, JPEG or WebP image.')
      : upload.isError
        ? errorText(upload.error)
        : null;
  const emailOk = page.contactEmail === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(page.contactEmail);
  const countryOk = page.shopCountry === null || /^[A-Z]{2}$/.test(page.shopCountry);
  const ok = page.shopName.trim() !== '' && emailOk && countryOk;
  const blank = (value: string) => (value.trim() === '' ? null : value.trim());
  const readOnly = !canManage;

  return (
    <Card data-testid="payments-page">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile icon={<Store />} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-bold">{t('studio:payments.page.title', 'What customers see')}</h2>
          <p className="text-[12.5px] text-fg-muted">{t('studio:payments.page.intro', 'The name, logo and contact on every pay page.')}</p>
        </div>
      </CardHeader>
      <CardBody className="flex max-w-[640px] flex-col gap-4">
        <FormField label={t('studio:payments.page.shopName', 'Shop name')} required error={page.shopName.trim() === '' ? t('studio:payments.page.shopNameNeeded', 'The pay page needs a name.') : undefined}>
          <Input dir="auto" maxLength={120} readOnly={readOnly} value={page.shopName} onChange={(event) => setPage({ ...page, shopName: event.target.value })} data-testid="payments-page-name" />
        </FormField>
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-semibold">{t('studio:payments.page.logo', 'Logo')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface-2" aria-hidden="true">
              <ImageIcon className="size-5 text-fg-muted" />
            </span>
            <span className="text-[12.5px]" data-testid="payments-page-logo-state">
              {page.logoFileId === null ? t('studio:payments.page.noLogo', 'No logo yet') : t('studio:payments.page.logoUploaded', 'Logo uploaded')}
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
                  <Button variant="ghost" size="sm" onClick={() => setPage({ ...page, logoFileId: null })}>
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
            <Input dir="ltr" type="email" readOnly={readOnly} value={page.contactEmail ?? ''} onChange={(event) => setPage({ ...page, contactEmail: blank(event.target.value) })} />
          </FormField>
          <FormField label={t('studio:payments.page.phone', 'Contact phone')} className="min-w-[200px] flex-1">
            <Input dir="ltr" className="font-mono" type="tel" placeholder="+49" readOnly={readOnly} value={page.contactPhone ?? ''} onChange={(event) => setPage({ ...page, contactPhone: blank(event.target.value) })} />
          </FormField>
        </div>
        <FormField
          label={t('studio:payments.page.country', "The shop's country")}
          helper={page.shopCountry !== null && countryOk ? countryName(page.shopCountry) : t('studio:payments.page.countryHelp', 'A two-letter code, such as DE. The rules on Ways to pay use it when a customer’s country is not known.')}
          error={countryOk ? undefined : t('studio:payments.page.countryInvalid', 'Write a two-letter code, such as DE.')}
        >
          <Input dir="ltr" className="w-24 font-mono uppercase" maxLength={2} readOnly={readOnly} value={page.shopCountry ?? ''} onChange={(event) => setPage({ ...page, shopCountry: blank(event.target.value.toUpperCase()) })} data-testid="payments-page-country" />
        </FormField>
        <div className="flex items-center gap-3">
          <Switch id="payments-page-lines" checked={page.showLines} disabled={readOnly} onCheckedChange={(next) => setPage({ ...page, showLines: next })} />
          <label htmlFor="payments-page-lines" className="text-[13px]">
            {t('studio:payments.page.lines', "Show the invoice's lines on the pay page")}
          </label>
        </div>
        <p className="text-[12.5px] text-fg-muted">{t('studio:payments.page.providerBranding', 'Customers also see the name and logo set in your Stripe dashboard on the Stripe page.')}</p>
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
  );
}

export function PayPageTab({ canManage }: { canManage: boolean }): ReactNode {
  const page = useQuery(payPageQuery());
  if (page.isPending) return <p className="text-[13px] text-fg-muted">{t('studio:payments.loading', 'Loading…')}</p>;
  if (page.isError) return <Alert tone="danger" role="alert" title={errorText(page.error)} />;
  return <PayPageForm saved={page.data} canManage={canManage} />;
}
