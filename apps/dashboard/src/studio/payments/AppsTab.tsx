// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Payments → Apps: each installed app that says which of its records a
 * customer pays, with one switch per app. An app's payments arrive switched
 * off (installing or updating an app never switches them on); someone who
 * manages payments switches it on here, after a confirm that says what
 * customers will be asked. Switching off needs no confirm. A reader sees the
 * state and no switch. No payment service connected yet: the row says to
 * connect one first, and the switch waits.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { CircleAlert, Puzzle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, IconTile, Modal, ModalBody, ModalFooter, ModalHeader, Switch } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { useTabListWorkspace } from '../../shell/workspaces/listWorkspace.js';
import { PAYMENTS_APPS_QUERY_KEY, PAYMENTS_PAYABLES_QUERY_KEY, REHEARSAL_QUERY_KEY, paymentsAppsQuery, rehearsalQuery, setRehearsal, switchPaymentApp, type PaymentAppView } from './paymentsApi.js';

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return t('studio:payments.error.unknown', 'That did not work. Try again.');
}

/** A table's own name, without its schema. */
function tableWord(tableName: string): string {
  return tableName.slice(tableName.lastIndexOf('.') + 1).replace(/_/g, ' ');
}

function AppRow({ app, canManage, connected, onConnect }: { app: PaymentAppView; canManage: boolean; connected: boolean; onConnect: () => void }): ReactNode {
  const client = useQueryClient();
  const toasts = useAppToasts();
  const ids = useId();
  const [confirming, setConfirming] = useState(false);
  const flip = useMutation({
    mutationFn: (enabled: boolean) => switchPaymentApp(app.connectionId, app.appKey, enabled),
    onSuccess: async (_none, enabled) => {
      setConfirming(false);
      toasts.push({
        variant: 'success',
        title: enabled ? t('studio:payments.apps.toastOn', 'Payments are on for {app}.', { app: app.name }) : t('studio:payments.apps.toastOff', 'Payments are off for {app}.', { app: app.name }),
      });
      await client.invalidateQueries({ queryKey: PAYMENTS_APPS_QUERY_KEY });
      await client.invalidateQueries({ queryKey: PAYMENTS_PAYABLES_QUERY_KEY });
    },
  });
  // "Try it as a customer": rehearsal on for this person, then the app's customer side on this address, where their session reaches it.
  const rehearse = useMutation({
    mutationFn: () => setRehearsal(true),
    onSuccess: async (data) => {
      client.setQueryData(REHEARSAL_QUERY_KEY, data);
      window.open(`/apps/${encodeURIComponent(app.appKey)}/customer/`, '_blank', 'noopener');
    },
  });
  const broken = app.tables.some((table) => !table.valid);
  const tables = app.tables.map((table) => tableWord(table.tableName)).join(', ');
  return (
    <div className="flex flex-wrap items-start gap-4 border-t border-border px-[var(--card-pad,20px)] py-4 first:border-t-0" data-testid={`payments-app-${app.appKey}`}>
      <IconTile icon={<Puzzle />} />
      <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
        <div>
          <h3 id={`${ids}-name`} className="text-[14px] font-bold">
            {app.name}
          </h3>
          <p className="mt-0.5 text-[12.5px] leading-normal text-fg-muted">{t('studio:payments.apps.line', 'Customers pay for: {tables}', { tables })}</p>
        </div>
        {broken ? (
          <p role="note" className="flex w-fit max-w-full items-center gap-2 rounded-[10px] bg-warn-soft px-[11px] py-2 text-[12.5px]">
            <CircleAlert aria-hidden="true" className="size-4 text-warn" />
            {t('studio:payments.apps.needsUpdate', 'Update the app to take payments again.')}
          </p>
        ) : null}
        {canManage && !broken ? (
          <button type="button" className="w-fit text-[12.5px] font-bold text-fg underline" disabled={rehearse.isPending} onClick={() => rehearse.mutate()} data-testid={`payments-app-try-${app.appKey}`}>
            {t('studio:payments.apps.tryAsCustomer', 'Try {app} as a customer', { app: app.name })}
          </button>
        ) : null}
        {!connected && !app.enabled ? (
          <p role="note" className="flex w-fit max-w-full items-center gap-2 rounded-[10px] bg-warn-soft px-[11px] py-2 text-[12.5px]">
            <CircleAlert aria-hidden="true" className="size-4 text-warn" />
            <button type="button" className="font-bold text-fg underline" onClick={onConnect}>
              {t('studio:payments.apps.connectFirst', 'Connect a payment service first')}
            </button>
          </p>
        ) : null}
      </div>
      <div className="flex min-h-[var(--hit,40px)] shrink-0 items-center gap-2.5">
        {canManage ? (
          <>
            <Switch
              id={`${ids}-switch`}
              aria-labelledby={`${ids}-label ${ids}-name`}
              checked={app.enabled}
              disabled={flip.isPending || ((!connected || broken) && !app.enabled)}
              onCheckedChange={(next) => (next ? setConfirming(true) : flip.mutate(false))}
            />
            <label id={`${ids}-label`} htmlFor={`${ids}-switch`} className="cursor-pointer text-[13px] font-semibold">
              {t('studio:payments.apps.canTake', 'Can take payments')}
            </label>
          </>
        ) : (
          <span className="text-[12.5px] text-fg-muted">{t('studio:payments.apps.canTake', 'Can take payments')}</span>
        )}
        <Badge tone={app.enabled ? 'pos' : 'neutral'}>{app.enabled ? t('studio:payments.apps.on', 'On') : t('studio:payments.apps.off', 'Off')}</Badge>
      </div>
      {flip.isError ? (
        <p role="alert" className="w-full text-[12.5px] text-danger">
          {errorText(flip.error)}
        </p>
      ) : null}
      <Modal open={confirming} onOpenChange={(open) => (open ? null : setConfirming(false))}>
        <ModalHeader title={t('studio:payments.apps.confirmTitle', 'Switch on payments for {app}?', { app: app.name })} closeLabel={t('studio:payments.close', 'Close')} />
        <ModalBody>
          <p className="text-[13px]">
            {t('studio:payments.apps.confirmBody', '{app} will ask its customers to pay online, through the payment services you connected. You can switch it off at any time.', { app: app.name })}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t('studio:payments.apps.cancel', 'Cancel')}
          </Button>
          <Button disabled={flip.isPending} onClick={() => flip.mutate(true)} data-testid={`payments-app-switch-on-${app.appKey}`}>
            {t('studio:payments.apps.switchOn', 'Switch on')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

/** While this person rehearses: what that means, until when, and the way out. */
function RehearsalBand({ canManage }: { canManage: boolean }): ReactNode {
  const client = useQueryClient();
  const rehearsal = useQuery({ ...rehearsalQuery(), enabled: canManage });
  const stop = useMutation({ mutationFn: () => setRehearsal(false), onSuccess: (data) => client.setQueryData(REHEARSAL_QUERY_KEY, data) });
  const until = rehearsal.data?.until ?? null;
  if (!canManage || until === null) return null;
  return (
    <Alert
      tone="info"
      role="status"
      data-testid="payments-rehearsal-band"
      title={t('studio:payments.rehearsal.title', 'TEST · Rehearsal on until {time}', { time: new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })}
      body={t('studio:payments.rehearsal.body', 'Orders you make in your apps are sample data, and you pay for them with test payments. Their e-mails come to you. Remove sample data takes them all away.')}
      action={
        <Button size="sm" variant="secondary" disabled={stop.isPending} onClick={() => stop.mutate()} data-testid="payments-rehearsal-stop">
          {t('studio:payments.rehearsal.stop', 'Stop rehearsing')}
        </Button>
      }
    />
  );
}

export function AppsTab({ canManage, connected, onConnect }: { canManage: boolean; connected: boolean; onConnect: () => void }): ReactNode {
  const workspace = useTabListWorkspace();
  const list = useQuery(paymentsAppsQuery(workspace.workspaceId));
  if (list.isPending) return <p className="text-[13px] text-fg-muted">{t('studio:payments.loading', 'Loading…')}</p>;
  if (list.isError) return <Alert tone="danger" role="alert" title={errorText(list.error)} />;
  const titleId = 'payments-apps-title';
  return (
    <div className="flex flex-col gap-4" data-testid="payments-apps">
      {!canManage ? <Alert tone="info" data-testid="payments-apps-view-only" title={t('studio:payments.apps.viewOnly', 'You can view payments. Ask someone who manages payments to act.')} /> : null}
      <RehearsalBand canManage={canManage} />
      <Card aria-labelledby={titleId}>
        <CardHeader>
          <h2 id={titleId} className="text-[14.5px] font-bold">
            {t('studio:payments.apps.title', 'Apps that can take payments')}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-normal text-fg-muted">{t('studio:payments.apps.sub', 'Each installed app that can ask customers to pay. Payments stay off until you switch them on.')}</p>
        </CardHeader>
        {list.data.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 py-11 text-center" data-testid="payments-apps-empty">
            <IconTile icon={<Puzzle />} />
            <p className="text-[14px] font-bold">{t('studio:payments.apps.empty', 'No installed app takes payments yet.')}</p>
          </div>
        ) : (
          list.data.map((app) => <AppRow key={`${app.connectionId}|${app.appKey}`} app={app} canManage={canManage} connected={connected} onConnect={onConnect} />)
        )}
      </Card>
    </div>
  );
}
