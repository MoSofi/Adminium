// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/shipping`: Workspace settings → Shipping (comp `Shipping Setup`).
 *
 * THE GATE is `system:shipping:manage`, through `holdsSystemAction` and never a
 * role's name. Anyone else gets a plain notice (S1-F8), so this route carries
 * no `StudioGuard`: the guard's generic forbidden page would not say who to ask.
 *
 * Four tabs: Setup, Label size, Who can buy labels and Tracking. One card per
 * app that has a carrier attached. With two or more, a plain picker above the
 * tabs says which app the rest of the page is about (F10). A test key puts a
 * banner over every tab (D5), and the not-affiliated line sits once, in a
 * footer under them (F14).
 */
import { useQueries, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { FlaskConical, Lock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Card, CardBody, IconTile, Select, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from '@adminium/ui';

import { bootstrapQuery, holdsSystemAction, type BootstrapData } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { addOnsQuery } from '../add-ons/addOnsApi.js';
import { installedAppsQuery } from '../apps/appsApi.js';
import { LabelSizeTab } from './LabelSizeTab.js';
import { LimitsTab } from './LimitsTab.js';
import { BackToShipWith, KeyCarrierCard, LockedCarrierCard, ShipWithCard } from './SetupTab.js';
import { keyFieldsFor, shippingAppsOf, shippingStatusQuery, type ShippingApp, type ShippingStatus } from './shippingApi.js';
import { SHIPPO_KEY, refusalWords } from './shippingWords.js';
import { TrackingTab } from './TrackingTab.js';

type TabName = 'setup' | 'labels' | 'people' | 'tracking';

function Frame({ intro, children }: { intro: string; children: ReactNode }) {
  return (
    <PageSurface width="page" className="mx-auto flex w-full max-w-[976px] flex-col gap-[18px] leading-[normal]">
      <PageActions title={t('studio:shipping.title', 'Shipping')} subtitle={intro} />
      {children}
      <p className="text-[11px] text-fg-subtle" data-testid="shipping-not-affiliated">
        {t('studio:shipping.notAffiliated', 'Adminium is not affiliated with Shippo or any carrier shown.')}
      </p>
    </PageSurface>
  );
}

const plainIntro = () => t('studio:shipping.introPlain', 'Labels for your orders, bought on your own carrier account. Adminium holds no account and takes no money.');

function NoAccess() {
  return (
    <Frame intro={plainIntro()}>
      <Card data-testid="shipping-no-access">
        <div className="flex items-start gap-3">
          <IconTile tone="neutral" icon={<Lock />} />
          <div>
            <h2 className="text-[14.5px] font-bold">{t('studio:shipping.gate.title', 'You need permission to manage shipping')}</h2>
            <p className="mt-[3px] text-[12.5px] text-fg-muted">{t('studio:shipping.gate.body', 'Ask whoever runs this server to give you the “Set up shipping” permission.')}</p>
          </div>
        </div>
      </Card>
    </Frame>
  );
}

/** The currency the app's database is set to, from the pages it serves. Null when none says. */
function connectionCurrency(bootstrap: BootstrapData, connectionId: string | null): string | null {
  if (connectionId === null) return null;
  for (const group of bootstrap.nav.groups) {
    for (const item of group.items) {
      if (item.connectionId === connectionId && typeof item.currency === 'string' && item.currency !== '') return item.currency;
    }
  }
  return null;
}

const appLabel = (app: ShippingApp, apps: readonly ShippingApp[]) =>
  apps.some((other) => other.installId !== app.installId && other.name === app.name) && app.connectionName !== null ? `${app.name} · ${app.connectionName}` : app.name;

export function ShippingPage(): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  if (!holdsSystemAction(bootstrap, 'shipping.manage')) return <NoAccess />;
  return <ShippingConsole bootstrap={bootstrap} />;
}

function ShippingConsole({ bootstrap }: { bootstrap: BootstrapData }) {
  const addOns = useQuery(addOnsQuery);
  // Only for a nicer name: someone who sets up shipping may not hold the apps list.
  const installed = useQuery({ ...installedAppsQuery(), enabled: holdsSystemAction(bootstrap, 'manifests.manage') });
  const apps = useMemo(() => shippingAppsOf(addOns.data ?? [], installed.data?.apps ?? []), [addOns.data, installed.data]);
  const statuses = useQueries({ queries: apps.map((app) => shippingStatusQuery(app)) });

  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<TabName>('setup');
  const [openCarrier, setOpenCarrier] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const index = Math.max(0, apps.findIndex((app) => app.installId === picked));
  const app = apps[index] ?? null;
  const query = statuses[index];
  const status: ShippingStatus | undefined = query?.data;

  // Focus follows the move: into the carrier's card, and back to the button that opened it.
  const openedFrom = useRef<string | null>(null);
  useEffect(() => {
    if (openCarrier !== null) {
      openedFrom.current = `[data-testid="shipping-app-${picked ?? ''}"] [data-testid="shipping-more-${openCarrier}"]`;
      detailRef.current?.querySelector<HTMLElement>('[data-shipping-focus]')?.focus();
    } else if (openedFrom.current !== null) {
      document.querySelector<HTMLElement>(openedFrom.current)?.focus();
      openedFrom.current = null;
    }
  }, [openCarrier, picked]);

  if (addOns.isPending) {
    return (
      <Frame intro={plainIntro()}>
        <div className="flex justify-center p-10">
          <Spinner size="md" />
        </div>
      </Frame>
    );
  }
  if (addOns.isError) {
    return (
      <Frame intro={plainIntro()}>
        <Alert tone="danger" role="alert" data-testid="shipping-load-error" title={t('studio:shipping.loadFailed', 'Shipping could not be loaded')} body={refusalWords(addOns.error, '')} />
      </Frame>
    );
  }
  if (app === null) {
    return (
      <Frame intro={plainIntro()}>
        <Card data-testid="shipping-no-apps">
          <CardBody className="text-[13px]">{t('studio:shipping.noApps', 'No app here ships yet. Attach a shipping add-on to an app, then set it up here.')}</CardBody>
        </Card>
      </Frame>
    );
  }

  const overview = tab === 'setup' && openCarrier === null;
  const several = apps.length > 1;
  const hasShippo = status?.carriers.some((carrier) => carrier.key === SHIPPO_KEY) === true;
  const intro = several && overview ? plainIntro() : hasShippo ? t('studio:shipping.intro', "Labels for {shop}'s orders, bought on the shop's own Shippo account. Adminium holds no account and takes no money.", { shop: app.name }) : plainIntro();

  // D5: on the overview, any app's test key; elsewhere, the app the page is about.
  const onTest = (one: ShippingStatus | undefined) => one?.carriers.some((carrier) => !carrier.locked && carrier.account?.mode === 'test') === true;
  const testApps = overview ? apps.filter((_, at) => onTest(statuses[at]?.data)) : onTest(status) ? [app] : [];
  const carrier = openCarrier === null ? null : (status?.carriers.find((one) => one.key === openCarrier) ?? null);
  const tabBody = (body: (loaded: ShippingStatus) => ReactNode): ReactNode =>
    status !== undefined ? (
      body(status)
    ) : query?.isError === true ? (
      <Alert tone="danger" role="alert" data-testid="shipping-status-error" title={t('studio:shipping.loadFailed', 'Shipping could not be loaded')} body={refusalWords(query.error, app.name)} />
    ) : (
      <div className="flex justify-center p-10">
        <Spinner size="md" />
      </div>
    );

  return (
    <Frame intro={intro}>
      {testApps.length > 0 ? (
        <div role="note" className="flex items-start gap-[11px] rounded-[12px] border-[1.5px] border-warn bg-warn-soft px-3.5 py-[11px]" data-testid="shipping-test-banner">
          <FlaskConical aria-hidden="true" className="mt-px size-[18px] shrink-0 text-warn" />
          <div>
            <div className="text-[13.5px] font-extrabold">{t('studio:shipping.test.title', 'Test mode: nothing will be delivered')}</div>
            <div className="mt-0.5 text-[12.5px] text-fg-muted">{t('studio:shipping.test.body', 'Labels read SAMPLE. No number reaches an order or a customer.')}</div>
            {several && overview ? <div className="mt-0.5 text-[12.5px] font-semibold">{t('studio:shipping.test.apps', 'On a test key: {apps}', { apps: testApps.map((one) => appLabel(one, apps)).join(', ') })}</div> : null}
          </div>
        </div>
      ) : null}

      {several && !overview ? (
        <label className="flex max-w-[360px] flex-col gap-1.5 text-[12.5px] font-bold">
          {t('studio:shipping.picker', 'App')}
          <Select
            value={app.installId}
            data-testid="shipping-app-picker"
            onChange={(event) => {
              setPicked(event.target.value);
              setOpenCarrier(null);
            }}
          >
            {apps.map((one) => (
              <option key={one.installId} value={one.installId}>
                {appLabel(one, apps)}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      <Tabs value={tab} onValueChange={(next) => setTab(next as TabName)}>
        <TabsList aria-label={t('studio:shipping.title', 'Shipping')} className="max-w-full overflow-x-auto">
          <TabsTrigger value="setup">{t('studio:shipping.tab.setup', 'Setup')}</TabsTrigger>
          <TabsTrigger value="labels">{t('studio:shipping.tab.labels', 'Label size')}</TabsTrigger>
          <TabsTrigger value="people">{t('studio:shipping.tab.people', 'Who can buy labels')}</TabsTrigger>
          <TabsTrigger value="tracking">{t('studio:shipping.tab.tracking', 'Tracking')}</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="flex flex-col gap-[18px] pt-4">
          {openCarrier === null ? (
            apps.map((one, at) => {
              const held = statuses[at];
              if (held?.data !== undefined) {
                return (
                  <ShipWithCard
                    key={one.installId}
                    app={one}
                    status={held.data}
                    onOpenCarrier={(key) => {
                      setPicked(one.installId);
                      setOpenCarrier(key);
                    }}
                  />
                );
              }
              if (held?.isError === true) return <Alert key={one.installId} tone="danger" role="alert" data-testid="shipping-status-error" title={t('studio:shipping.loadFailedApp', '{app} could not be loaded', { app: one.name })} body={refusalWords(held.error, one.name)} />;
              return (
                <div key={one.installId} className="flex justify-center p-10">
                  <Spinner size="md" />
                </div>
              );
            })
          ) : (
            <div ref={detailRef} className="flex flex-col gap-3">
              <BackToShipWith onBack={() => setOpenCarrier(null)} />
              {tabBody((loaded) =>
                carrier === null ? (
                  <Alert tone="warn" title={t('studio:shipping.carrierGone', 'This carrier is not attached to this app any more.')} />
                ) : carrier.locked ? (
                  <LockedCarrierCard app={app} status={loaded} carrier={carrier} onDone={() => setOpenCarrier(null)} onOpenCarrier={setOpenCarrier} />
                ) : (
                  <KeyCarrierCard
                    key={`${app.installId}:${carrier.key}`}
                    app={app}
                    status={loaded}
                    carrier={carrier}
                    declared={keyFieldsFor(addOns.data, carrier.key, app.connectionId)}
                    onOpenTracking={() => setTab('tracking')}
                  />
                ),
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="labels" className="pt-4">
          {tabBody((loaded) => (
            <LabelSizeTab key={app.installId} app={app} status={loaded} />
          ))}
        </TabsContent>
        <TabsContent value="people" className="pt-4">
          {tabBody((loaded) => (
            <LimitsTab key={app.installId} app={app} status={loaded} connectionCurrency={connectionCurrency(bootstrap, app.connectionId)} />
          ))}
        </TabsContent>
        <TabsContent value="tracking" className="pt-4">
          {tabBody((loaded) => (
            <TrackingTab app={app} status={loaded} />
          ))}
        </TabsContent>
      </Tabs>
    </Frame>
  );
}
