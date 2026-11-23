// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shipping → Tracking (comp state S07).
 *
 * THE ADDRESS IS SHOWN ONCE. Its token is stored hashed, so the reply that makes
 * it is the only time the whole address exists here. It lives in this
 * component's state and nowhere else: not in the query cache, a toast or an
 * announcement. Every later visit shows it masked (F1).
 *
 * "Last update received" reads `webhook.lastAt`, which only an accepted webhook
 * writes, and never the time of someone's Refresh (F3).
 *
 * A PRIVATE SERVER is `webhook.publicAddress: false`, shown from the first
 * paint with no way to make an address (F4). `NO_PUBLIC_ADDRESS` is the fallback
 * for an address that went away after this page read it.
 *
 * AN ENDED ADDRESS is `webhook.ended`: the server remembers that one was made
 * and that its key was then replaced or removed, so this holds on any visit.
 *
 * Background tracking is locked in code (D7), so there is no switch.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleCheckBig, Clock, Copy, RadioTower, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, IconTile, Modal, ModalBody, ModalFooter, ModalHeader, ModalTrigger, Spinner } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { SHIPPING_LINKS } from './shippingLinks.js';
import { makeWebhook, refusalCode, shippingTrackingKey, shippingTrackingQuery, type CarrierView, type KeyMode, type ShippingApp, type ShippingStatus, type TrackingView } from './shippingApi.js';
import { OutLink, SHIPPO_KEY, carrierName, refusalWords, useShippingFormat } from './shippingWords.js';

/** The carrier whose updates this tab is about: the one in use, or else the first that can take a key. */
export function trackingCarrierOf(status: ShippingStatus): CarrierView | null {
  const active = status.carriers.find((carrier) => carrier.key === status.activeCarrier);
  if (active !== undefined && !active.locked) return active;
  return status.carriers.find((carrier) => !carrier.locked) ?? null;
}

function Shell({ subtitle, badge, children }: { subtitle: string; badge: { label: string; tone: 'pos' | 'warn' | 'neutral' }; children: ReactNode }) {
  return (
    <Card padded={false} data-testid="shipping-tracking">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <IconTile tone={badge.tone} icon={<RadioTower />} />
        <div className="min-w-[160px] flex-1">
          <h2 className="text-[14.5px] font-bold tracking-[-.01em]">{t('studio:shipping.tracking.heading', 'Tracking updates')}</h2>
          <p className="mt-0.5 text-[11.5px] text-fg-subtle" data-testid="shipping-tracking-subtitle">
            {subtitle}
          </p>
        </div>
        <Badge tone={badge.tone} data-testid="shipping-tracking-badge">
          {badge.label}
        </Badge>
      </div>
      <div className="flex flex-col gap-3.5 p-5">{children}</div>
    </Card>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0"
        aria-label={t('studio:shipping.tracking.copyLabel', 'Copy webhook address')}
        iconLeft={state === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        onClick={() => {
          const writing = navigator.clipboard?.writeText(address);
          if (writing === undefined) {
            setState('failed');
            return;
          }
          writing.then(
            () => setState('copied'),
            () => setState('failed'),
          );
        }}
        data-testid="shipping-webhook-copy"
      >
        {state === 'copied' ? t('studio:shipping.tracking.copied', 'Copied') : t('studio:shipping.tracking.copy', 'Copy')}
      </Button>
      {state === 'failed' ? (
        <span role="alert" className="basis-full text-[12px] font-semibold text-danger">
          {t('studio:shipping.tracking.copyFailed', 'Could not copy. Select the address and copy it.')}
        </span>
      ) : null}
    </>
  );
}

function Guide({ carrier, mode }: { carrier: CarrierView; mode: KeyMode | null }) {
  const format = useShippingFormat();
  const name = carrierName(carrier);
  const modeStep =
    mode === 'live'
      ? t('studio:shipping.guide.eventsLive', 'Add a webhook for each of the events {first}, {second} and {third}, and choose Live.', { first: 'track_updated', second: 'transaction_created', third: 'transaction_updated' })
      : mode === 'test'
        ? t('studio:shipping.guide.eventsTest', 'Add a webhook for each of the events {first}, {second} and {third}, and choose Test.', { first: 'track_updated', second: 'transaction_created', third: 'transaction_updated' })
        : t('studio:shipping.guide.events', 'Add a webhook for each of the events {first}, {second} and {third}, in the same mode as your key.', { first: 'track_updated', second: 'transaction_created', third: 'transaction_updated' });
  const steps = [t('studio:shipping.guide.open', 'In Shippo, open Settings, then Webhooks.'), modeStep, t('studio:shipping.guide.paste', 'Paste the address above and save.')];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[13.5px] font-bold">{t('studio:shipping.guide.heading', 'Paste this into {carrier}', { carrier: name })}</h3>
      <ol className="flex flex-col gap-2">
        {steps.map((text, index) => (
          <li key={text} className="flex items-start gap-2.5">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-[10.5px] font-semibold text-fg-muted">{format.number(index + 1)}</span>
            <span className="text-[13px] leading-normal">{text}</span>
          </li>
        ))}
      </ol>
      <p className="text-[12.5px] text-fg-muted">{t('studio:shipping.guide.moved', "If this server's public address changes, make a new address and paste it in again.")}</p>
      {carrier.key === SHIPPO_KEY ? <OutLink href={SHIPPING_LINKS.webhooks}>{t('studio:shipping.link.webhooks', 'Shippo webhook settings')}</OutLink> : null}
    </div>
  );
}

function ParcelCounts({ parcels }: { parcels: TrackingView['parcels'] }) {
  const format = useShippingFormat();
  const rows: { label: string; value: string; id: string }[] = [
    { id: 'open', label: t('studio:shipping.parcels.open', 'Open parcels'), value: format.number(parcels.open) },
    { id: 'never', label: t('studio:shipping.parcels.never', 'Never checked'), value: format.number(parcels.neverChecked) },
    {
      id: 'oldest',
      label: t('studio:shipping.parcels.oldest', 'Oldest check'),
      value: parcels.oldestCheckedAt === null ? t('studio:shipping.parcels.noCheck', 'None yet') : format.when(parcels.oldestCheckedAt),
    },
    { id: 'quiet', label: t('studio:shipping.parcels.quiet', 'Quiet for 7 days'), value: format.number(parcels.quiet) },
  ];
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2 border-t border-border pt-3" data-testid="shipping-parcels">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-0.5 rounded-[10px] bg-surface-2 px-3 py-2">
          <dt className="text-[11.5px] text-fg-muted">{row.label}</dt>
          <dd className="font-mono text-[13px] font-semibold" data-testid={`shipping-parcels-${row.id}`}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TrackingTab({ app, status }: { app: ShippingApp; status: ShippingStatus }) {
  const carrier = trackingCarrierOf(status);
  if (carrier === null) {
    return (
      <Shell subtitle={t('studio:shipping.tracking.noCarrierSubtitle', 'No carrier here sends tracking updates.')} badge={{ label: t('studio:shipping.tracking.refreshOnly', 'Refresh only'), tone: 'neutral' }}>
        <p className="text-[13px]" data-testid="shipping-tracking-no-carrier">
          {t('studio:shipping.tracking.noCarrier', 'A demo carrier sends no updates. You type the tracking number on the order.')}
        </p>
      </Shell>
    );
  }
  return <CarrierTracking key={`${app.installId}:${carrier.key}`} app={app} carrier={carrier} />;
}

function CarrierTracking({ app, carrier }: { app: ShippingApp; carrier: CarrierView }) {
  const client = useQueryClient();
  const format = useShippingFormat();
  const name = carrierName(carrier);
  const tracking = useQuery(shippingTrackingQuery(app, carrier.key));
  // The whole address, for this one showing. Never put in the query cache.
  const [fresh, setFresh] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const make = useMutation({
    // The reply goes straight to this component's state, so the mutation's own result never holds the address.
    gcTime: 0,
    mutationFn: async (): Promise<void> => {
      setFresh((await makeWebhook(app, carrier.key)).address);
    },
    onSuccess: async () => {
      setIsPrivate(false);
      setConfirming(false);
      await client.invalidateQueries({ queryKey: shippingTrackingKey(app, carrier.key) });
    },
    onError: (error) => {
      setConfirming(false);
      // With an address already made, that one keeps working: this is a refused change, not a private server.
      if (refusalCode(error) === 'NO_PUBLIC_ADDRESS' && tracking.data?.webhook.made !== true) setIsPrivate(true);
    },
  });

  // A key changed elsewhere on this page ended the address: its one showing is over too.
  useEffect(() => {
    if (tracking.data?.webhook.made === false) setFresh(null);
  }, [tracking.data?.webhook.made]);

  if (tracking.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner size="md" />
      </div>
    );
  }
  if (tracking.isError) return <Alert tone="danger" role="alert" data-testid="shipping-tracking-error" title={refusalWords(tracking.error, name)} />;

  const data = tracking.data;
  const { webhook } = data;
  const mode = carrier.account?.mode ?? null;
  const heard = webhook.lastAt !== null;
  const privateServer = isPrivate || !webhook.publicAddress;
  const addressGone = webhook.ended && !privateServer;

  if (!webhook.supported) {
    return (
      <Shell subtitle={t('studio:shipping.tracking.privateSubtitle', 'Tracking updates when someone presses Refresh.')} badge={{ label: t('studio:shipping.tracking.refreshOnly', 'Refresh only'), tone: 'neutral' }}>
        <p className="text-[13px]">{t('studio:shipping.error.noWebhook', '{carrier} does not send tracking updates to a webhook.', { carrier: name })}</p>
        <ParcelCounts parcels={data.parcels} />
      </Shell>
    );
  }

  if (privateServer) {
    return (
      <Shell subtitle={t('studio:shipping.tracking.privateSubtitle', 'Tracking updates when someone presses Refresh.')} badge={{ label: t('studio:shipping.tracking.refreshOnly', 'Refresh only'), tone: 'neutral' }}>
        <div className="flex items-start gap-2.5 rounded-[12px] border border-border bg-surface-2 px-3.5 py-3" data-testid="shipping-tracking-private">
          <RefreshCw aria-hidden="true" className="mt-px size-[18px] shrink-0 text-fg-muted" />
          <p className="text-[14px] font-bold">{t('studio:shipping.tracking.private', "This server can't receive updates. Tracking changes when someone presses Refresh.")}</p>
        </div>
        <ParcelCounts parcels={data.parcels} />
      </Shell>
    );
  }

  const badge = heard
    ? { label: t('studio:shipping.tracking.receiving', 'Receiving'), tone: 'pos' as const }
    : webhook.made
      ? { label: t('studio:shipping.tracking.waiting', 'Waiting'), tone: 'warn' as const }
      : { label: t('studio:shipping.tracking.notSet', 'Not set up'), tone: 'neutral' as const };

  return (
    <Shell subtitle={t('studio:shipping.tracking.subtitle', '{carrier} sends each carrier scan to this server.', { carrier: name })} badge={badge}>
      {make.isError && (refusalCode(make.error) !== 'NO_PUBLIC_ADDRESS' || webhook.made) ? <Alert tone="danger" role="alert" title={refusalWords(make.error, name)} /> : null}

      {addressGone ? (
        <Alert
          tone="warn"
          data-testid="shipping-tracking-gone"
          title={t('studio:shipping.tracking.goneTitle', 'The webhook address stopped working when the key changed')}
          body={t('studio:shipping.tracking.goneBody', 'Make a new address, then paste it into {carrier}. Until then, tracking changes only when someone presses Refresh.', { carrier: name })}
        />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-bold">{t('studio:shipping.tracking.address', 'Webhook address')}</span>
        {fresh !== null ? (
          <>
            <div className="flex max-w-[560px] flex-wrap items-center gap-1.5 rounded-[10px] bg-surface-3 py-1 pe-1 ps-3">
              <code dir="ltr" className="min-w-0 flex-1 break-all font-mono text-[12.5px] font-medium" data-testid="shipping-webhook-full">
                {fresh}
              </code>
              <CopyAddress address={fresh} />
            </div>
            <p className="text-[12px] font-semibold text-warn" data-testid="shipping-webhook-once">
              {t('studio:shipping.tracking.once', 'Copy it now. This is the only time the whole address is shown.')}
            </p>
          </>
        ) : webhook.made ? (
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="min-w-0 break-all rounded-sm bg-surface-3 px-[9px] py-1 font-mono text-[12px] font-medium" data-testid="shipping-webhook-masked">
              {webhook.address}
            </code>
            {/* The button is the dialog's trigger, so Escape puts focus back on it. */}
            <Modal open={confirming} onOpenChange={setConfirming}>
              <ModalTrigger asChild>
                <Button variant="secondary" size="sm" data-testid="shipping-webhook-new">
                  {t('studio:shipping.tracking.makeNew', 'Make a new address')}
                </Button>
              </ModalTrigger>
              <ModalHeader title={t('studio:shipping.tracking.confirmTitle', 'Make a new address?')} closeLabel={t('studio:shipping.close', 'Close')} />
              <ModalBody className="text-[13px]" data-testid="shipping-webhook-warning">
                <p>{t('studio:shipping.tracking.confirmBody', 'The old address stops working at once. Updates stop until you paste the new one into {carrier}.', { carrier: name })}</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  {t('studio:shipping.limits.cancel', 'Cancel')}
                </Button>
                <Button disabled={make.isPending} onClick={() => make.mutate()} data-testid="shipping-webhook-confirm">
                  {t('studio:shipping.tracking.makeNew', 'Make a new address')}
                </Button>
              </ModalFooter>
            </Modal>
          </div>
        ) : (
          <div>
            <Button className="min-h-11" disabled={make.isPending} iconLeft={make.isPending ? <Spinner size="sm" /> : undefined} onClick={() => make.mutate()} data-testid="shipping-webhook-make">
              {t('studio:shipping.tracking.make', 'Make the address')}
            </Button>
          </div>
        )}
      </div>

      {webhook.made || fresh !== null ? <Guide carrier={carrier} mode={mode} /> : null}

      {heard ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[12.5px] text-fg-muted" data-testid="shipping-last-update">
          <CircleCheckBig aria-hidden="true" className="size-[15px] text-pos" />
          <span>{t('studio:shipping.tracking.last', 'Last update received:')}</span>
          <span className="font-mono font-medium text-fg">{format.when(webhook.lastAt as number)}</span>
        </div>
      ) : webhook.made ? (
        <div className="flex items-start gap-2 rounded-[10px] bg-warn-soft px-3 py-2.5 text-[13px]" data-testid="shipping-never-arrived">
          <Clock aria-hidden="true" className="mt-[3px] size-[15px] shrink-0 text-warn" />
          <span>{t('studio:shipping.tracking.never', 'No update has arrived yet. Check that the address is saved in {carrier}.', { carrier: name })}</span>
        </div>
      ) : null}

      <ParcelCounts parcels={data.parcels} />
    </Shell>
  );
}
