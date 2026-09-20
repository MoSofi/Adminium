// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/apps` — the Studio surface for hosted app
 * surfaces.
 *
 * Three things an operator does here:
 *
 *  1. **See what this instance serves** — every discovered surface, with its
 *     open link. A surface built by an older toolkit says "internal placement
 * unavailable — rebuild", never an empty section (degradation).
 * 2. **Choose each staff surface's placement**: blended into the dashboard
 *  sidebar (the default) or external at its own URL. The write takes effect
 *  immediately here; other tabs converge within seconds.
 * 3. **Attach domains**: `host → surface`, the whole map edited and saved
 *  together. Adminium answers by `Host`; DNS and the TLS proxy stay the
 *  operator's, and the page says so rather than probing — a mapping is inert
 *  until traffic actually carries that Host.
 *
 * The customer-side key binding is DELIBERATELY not minted here: keys live on
 * `/studio/public-api` with their scopes and audit story. This page shows
 * which key a surface would serve (`surface-config.json`) and links across.
 */
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { AppWindow, Globe2, PanelsTopLeft, Tag } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FormField,
  IconTile,
  Input,
  Select,
} from '@adminium/ui';

import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { docsUrl } from '../../kb/docsLinks.js';
import { t } from '../../i18n/t.js';
import {
  SURFACES_QUERY_KEY,
  domainIssuesFrom,
  domainsFromRows,
  rowsFromDomains,
  saveSurfaceDomains,
  setAppName,
  instancesFromRows,
  rowsFromInstances,
  saveSurfaceInstances,
  setStaffConnection,
  setStaffPlacement,
  surfacesQuery,
  type DomainIssue,
  type DomainRow,
  type InstanceRow,
  type SurfaceInstance,
  type SurfaceSummaryDto,
} from './hostedAppsApi.js';
import { connectionsQuery } from '../hub/ConnectionsHub.js';
import { AppBrowser } from './AppBrowser.js';
import { AppAcquisitionAlerts, UpdateConsentDialog, useAppAcquisition } from './appAcquisition.js';
import { InstallAppWizard } from './InstallAppWizard.js';
import { InstalledAppsCard } from './InstalledAppsCard.js';

export function HostedAppsPage() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(surfacesQuery());
  /*
   * The connection list, for the binding picker. Suspense like the surfaces
   * themselves: the picker's options ARE this list, and rendering the control
   * before they arrive would offer an empty menu that fills in underneath.
   */
  const { data: connections } = useSuspenseQuery(connectionsQuery());

  /*
   * The install flow REPLACES the page body rather than opening over it
   * (`Marketplace.dc.html` draws it as its own screen with its own sticky
   * footer, and `ConnectWizard` is the house precedent for that shape). A modal
   * would put a four-step flow with its own footer inside a dialog that already
   * has one.
   */
  const [installing, setInstalling] = useState(false);
  /** The shelf app the wizard opens on, when it was opened from a card. */
  const [chosen, setChosen] = useState<
    { key: string; version: string; name: string; downloaded?: boolean } | undefined
  >(undefined);
  /** The online app catalog: switch, check for newer, download, update (48 G8-D7). */
  const acquisition = useAppAcquisition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<DomainIssue[]>([]);
  const [savedNote, setSavedNote] = useState(false);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: SURFACES_QUERY_KEY });
  };

  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      await work();
      await refresh();
      return true;
    } catch (raised) {
      const named = domainIssuesFrom(raised);
      if (named.length > 0) setIssues(named);
      else setError(raised instanceof Error ? raised.message : String(raised));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <PageActions
        title={t('studio:hostedApps.title', 'Hosted apps')}
        subtitle={t(
          'studio:hostedApps.subtitle',
          'The app surfaces this instance serves — where each one appears, and the domains pointed at them.',
        )}
      />

      {installing ? (
        <InstallAppWizard
          preselected={chosen}
          onClose={() => {
            setInstalling(false);
            setChosen(undefined);
          }}
        />
      ) : (
        <>
      {error !== null && (
        <Alert tone="danger" title={t('studio:hostedApps.error', 'Something went wrong')}>
          {error}
        </Alert>
      )}

      <UpdateConsentDialog state={acquisition} />
      <AppAcquisitionAlerts state={acquisition} origin="shelf" />

      {/*
        * The shelf sits above the installed list, which is the order the comp
        * puts its two screens in: browse, then manage.
        */}
      <AppBrowser
        busy={acquisition.busy}
        onToggleOnline={(next) => void acquisition.toggleOnline(next)}
        onRefresh={() => void acquisition.refreshCatalog()}
        onInstall={(app) => {
          if (app.source === 'catalog') {
            // Not on disk yet: download it, then open the wizard on what landed.
            void acquisition.installFromCatalog(app, (downloaded) => {
              setChosen(downloaded);
              setInstalling(true);
            });
            return;
          }
          setChosen({ key: app.key, version: app.version, name: app.name });
          setInstalling(true);
        }}
      />

      <AppAcquisitionAlerts state={acquisition} origin="installed" />
      <InstalledAppsCard
        busy={acquisition.busy}
        onUpdate={(app, row) => void acquisition.update(app, row)}
        onInstall={() => {
          setChosen(undefined);
          setInstalling(true);
        }}
      />

      {data.surfaces.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title={t('studio:hostedApps.emptyTitle', 'No app surfaces are being served')}
              body={t(
                'studio:hostedApps.emptyBody',
                'Point ADMINIUM_SURFACES_DIR at a directory of built surfaces — one folder per app and side, each with its index.html — and restart. They are then served under /apps/ and appear here.',
              )}
            />
          </CardBody>
        </Card>
      ) : (
        <SurfacesCard
          surfaces={data.surfaces}
          connections={connections}
          busy={busy}
          onPlacement={(appKey, staff) => {
            void run(() => setStaffPlacement(appKey, staff));
          }}
          onConnection={(appKey, connectionId) => {
            void run(() => setStaffConnection(appKey, connectionId));
          }}
        />
      )}

      {data.surfaces.length > 0 && (
        <AppNamesCard
          surfaces={data.surfaces}
          busy={busy}
          onSave={(appKey, name) => {
            void run(() => setAppName(appKey, name));
          }}
        />
      )}

      {data.surfaces.length > 0 && connections.length > 1 && (
        <InstancesCard
          surfaces={data.surfaces}
          connections={connections}
          initialRows={rowsFromInstances(data.instances)}
          busy={busy}
          issues={issues}
          onSave={async (rows) => run(() => saveSurfaceInstances(instancesFromRows(rows)))}
        />
      )}

      {data.surfaces.length > 0 && (
        <DomainsCard
          surfaces={data.surfaces}
          instances={data.instances}
          initialRows={rowsFromDomains(data.domains)}
          busy={busy}
          issues={issues}
          savedNote={savedNote}
          onSave={async (rows) => {
            setSavedNote(false);
            const ok = await run(() => saveSurfaceDomains(domainsFromRows(rows)));
            setSavedNote(ok);
            return ok;
          }}
        />
      )}
        </>
      )}
    </PageSurface>
  );
}

/* ---------------------------------------------------------- the surfaces */

function SurfacesCard({
  surfaces,
  connections,
  busy,
  onPlacement,
  onConnection,
}: {
  surfaces: SurfaceSummaryDto[];
  connections: { id: string; name: string }[];
  busy: boolean;
  onPlacement: (appKey: string, staff: 'internal' | 'external') => void;
  onConnection: (appKey: string, connectionId: string | null) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex items-start justify-start gap-3">
        <IconTile tone="accent" size="md" icon={<AppWindow />} />
        <div>
          <h2 className="text-section text-fg">
            {t('studio:hostedApps.surfaces.title', 'Surfaces')}
          </h2>
          <p className="text-sm text-fg-muted">
            {t(
              'studio:hostedApps.surfaces.subtitle',
              'A staff surface can blend into this dashboard’s sidebar or stand on its own; a customer surface is public and reads through its bound key.',
            )}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <ul className="flex flex-col gap-4">
          {surfaces.map((surface) => (
            <li
              key={`${surface.appKey}/${surface.side}`}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {surface.appKey}{' '}
                  <Badge tone={surface.side === 'staff' ? 'accent' : 'neutral'}>
                    {surface.side === 'staff'
                      ? t('studio:hostedApps.surfaces.staff', 'Staff')
                      : t('studio:hostedApps.surfaces.customer', 'Customer')}
                  </Badge>
                </p>
                <p className="text-sm text-fg-muted">
                  <a
                    className="underline decoration-dotted underline-offset-2"
                    href={`${surface.prefix}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {surface.prefix}/
                  </a>
                  {surface.domains.map((host) => (
                    <span key={host}>
                      {' · '}
                      <Globe2 aria-hidden className="inline size-3.5 align-[-2px]" /> {host}
                    </span>
                  ))}
                </p>
                {surface.side === 'staff' && !surface.navAvailable && (
                  <p className="text-sm text-fg-muted">
                    {t(
                      'studio:hostedApps.surfaces.noNav',
                      'Internal placement unavailable — rebuild this surface with the current toolkit so it emits surface.json.',
                    )}
                  </p>
                )}
                {surface.side === 'customer' && (
                  <p className="text-sm text-fg-muted">
                    {surface.boundKey === null ? (
                      <>
                        {t(
                          'studio:hostedApps.surfaces.noKey',
                          'No key bound — this surface cannot read data until one is minted for it.',
                        )}{' '}
                        <Link className="underline" to="/studio/public-api">
                          {t('studio:hostedApps.surfaces.mintLink', 'Mint one under Public API')}
                        </Link>
                      </>
                    ) : (
                      <>
                        {t('studio:hostedApps.surfaces.boundKey', 'Serves key')}{' '}
                        <code>
                          {surface.boundKey.prefix}… · {surface.boundKey.name}
                        </code>
                      </>
                    )}
                  </p>
                )}
              </div>
              {surface.side === 'staff' && surface.navAvailable && (
                <FormField
                  label={t('studio:hostedApps.surfaces.placementLabel', 'Placement')}
                  className="w-56"
                >
                  <Select
                    value={surface.staffPlacement ?? 'internal'}
                    disabled={busy}
                    onChange={(event) => {
                      onPlacement(
                        surface.appKey,
                        event.target.value === 'external' ? 'external' : 'internal',
                      );
                    }}
                  >
                    <option value="internal">
                      {t('studio:hostedApps.surfaces.placementInternal', 'In the sidebar (blended)')}
                    </option>
                    <option value="external">
                      {t('studio:hostedApps.surfaces.placementExternal', 'External (own URL only)')}
                    </option>
                  </Select>
                </FormField>
              )}
              {/*
                WHICH DATABASE this staff surface reads. Shown on staff
                surfaces regardless of `navAvailable` — unlike placement, this
                matters just as much to a surface opened at its own URL, and a
                surface too old to emit nav still reads a database.

                Offered only once there is a CHOICE to make: on the
                single-connection instance nearly every install is, the app's
                inference is already right and a picker with one option is a
                question with no wrong answer.
              */}
              {surface.side === 'staff' && connections.length > 1 && (
                <FormField
                  label={t('studio:hostedApps.surfaces.connectionLabel', 'Reads')}
                  className="w-56"
                >
                  <Select
                    value={surface.connectionId ?? ''}
                    disabled={busy}
                    onChange={(event) => {
                      onConnection(surface.appKey, event.target.value === '' ? null : event.target.value);
                    }}
                  >
                    <option value="">
                      {t('studio:hostedApps.surfaces.connectionUnset', 'Whichever is serving')}
                    </option>
                    {connections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------- the app names */

/**
 * WHAT THE OPERATOR CALLS EACH APP.
 *
 * Its own card, and one row per APP rather than per surface, because the name
 * belongs to the app and the surfaces list has a row per side — an editable
 * name on each would be the same field twice, disagreeing the moment one was
 * saved.
 *
 * Every app ships a name baked into its bundle ("Outline", "Wren House"). That
 * is a fine default and a poor permanent answer: it is the business's name, and
 * rebuilding a bundle to change a word is not something an operator can do.
 *
 * EMPTY MEANS "use the app's own", shown as the placeholder rather than
 * pre-filled. Pre-filling would make the app's name look like a decision
 * somebody made, and the next save would freeze it — so the app would stop
 * tracking its own name across upgrades without anyone choosing that.
 */
function AppNamesCard({
  surfaces,
  busy,
  onSave,
}: {
  surfaces: SurfaceSummaryDto[];
  busy: boolean;
  onSave: (appKey: string, name: string | null) => void;
}) {
  // One entry per app, in discovery order; the staff row wins where both exist
  // only because it comes first — either carries the same name.
  const apps = new Map<string, SurfaceSummaryDto>();
  for (const surface of surfaces) if (!apps.has(surface.appKey)) apps.set(surface.appKey, surface);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftFor = (surface: SurfaceSummaryDto): string =>
    drafts[surface.appKey] ?? surface.nameOverride ?? '';

  return (
    <Card>
      <CardHeader className="flex items-start justify-start gap-3">
        <IconTile tone="accent" size="md" icon={<Tag />} />
        <div>
          <h2 className="text-section text-fg">
            {t('studio:hostedApps.names.title', 'App names')}
          </h2>
          <p className="text-sm text-fg-muted">
            {t(
              'studio:hostedApps.names.subtitle',
              'What each app is called — in its own screens and in this dashboard’s sidebar. Leave it empty to use the name the app was built with.',
            )}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <ul className="flex flex-col gap-3">
          {[...apps.values()].map((surface) => {
            const draft = draftFor(surface);
            const trimmed = draft.trim();
            const next = trimmed === '' ? null : trimmed;
            return (
              <li
                key={surface.appKey}
                className="flex flex-wrap items-end gap-3"
              >
                <FormField
                  label={t('studio:hostedApps.names.label', 'Name for {app}', {
                    app: surface.appKey,
                  })}
                  className="min-w-64 flex-1"
                >
                  <Input
                    value={draft}
                    // The app's own name, so the field reads as "this is what
                    // you get if you leave it alone" rather than as blank.
                    placeholder={surface.appName}
                    maxLength={60}
                    onChange={(event) => {
                      setDrafts((current) => ({
                        ...current,
                        [surface.appKey]: event.target.value,
                      }));
                    }}
                  />
                </FormField>
                <Button
                  disabled={busy || next === surface.nameOverride}
                  onClick={() => {
                    onSave(surface.appKey, next);
                  }}
                >
                  {t('studio:hostedApps.names.save', 'Save name')}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

/* ----------------------------------------------------------- the domains */

/* ------------------------------------------------------- the instances */

/**
 * THE SAME APP OVER SEVERAL DATABASES.
 *
 * Shown only when there is more than one connection, for the same reason the
 * per-surface picker is: with one database an instance is a second name for the
 * only answer, and the editor would be an invitation to complicate an install
 * that has nothing to gain.
 *
 * A full-map editor, like domains: the screen shows every instance and saves
 * every instance, so removing one is expressible without a second verb.
 */
function InstancesCard({
  surfaces,
  connections,
  initialRows,
  busy,
  issues,
  onSave,
}: {
  surfaces: SurfaceSummaryDto[];
  connections: { id: string; name: string }[];
  initialRows: InstanceRow[];
  busy: boolean;
  issues: DomainIssue[];
  onSave: (rows: InstanceRow[]) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<InstanceRow[]>(initialRows);
  const [nextKey, setNextKey] = useState(initialRows.length);

  const appKeys = [...new Set(surfaces.map((surface) => surface.appKey))];
  const firstApp = appKeys[0] ?? '';
  const firstConnection = connections[0]?.id ?? '';

  const patch = (key: number, change: Partial<InstanceRow>): void => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };

  return (
    <Card>
      <CardHeader className="flex items-start justify-start gap-3">
        <IconTile tone="accent" size="md" icon={<AppWindow />} />
        <div>
          <h2 className="text-section text-fg">
            {t('studio:hostedApps.instances.title', 'Instances')}
          </h2>
          <p className="mt-1 text-body-sm text-fg-muted">
            {t(
              'studio:hostedApps.instances.body',
              'Serve the same app over more than one database. Each instance is reachable at /apps/<app>/<segment>/<side>/ and reads only the connection you give it.',
            )}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {issues.length > 0 && (
          <Alert
            tone="danger"
            title={t('studio:hostedApps.instances.failed', 'Instances were not saved')}
            body={issues.map((issue) => issue.message).join(' ')}
          />
        )}
        {rows.length === 0 && (
          <p className="text-body-sm text-fg-muted">
            {t('studio:hostedApps.instances.empty', 'No extra instances.')}
          </p>
        )}
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-end gap-3">
            <FormField label={t('studio:hostedApps.instances.appLabel', 'App')} className="w-40">
              <Select
                value={row.appKey}
                onChange={(event) => {
                  patch(row.key, { appKey: event.target.value });
                }}
              >
                {appKeys.map((appKey) => (
                  <option key={appKey} value={appKey}>
                    {appKey}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label={t('studio:hostedApps.instances.slugLabel', 'URL segment')}
              className="min-w-48 flex-1"
            >
              <Input
                value={row.slug}
                placeholder="berlin"
                onChange={(event) => {
                  patch(row.key, { slug: event.target.value });
                }}
              />
            </FormField>
            <FormField
              label={t('studio:hostedApps.instances.readsLabel', 'Reads')}
              className="w-56"
            >
              <Select
                value={row.connectionId}
                onChange={(event) => {
                  patch(row.key, { connectionId: event.target.value });
                }}
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <Button
              variant="ghost"
              onClick={() => {
                setRows((current) => current.filter((candidate) => candidate.key !== row.key));
              }}
            >
              {t('studio:hostedApps.instances.remove', 'Remove')}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setRows((current) => [
                ...current,
                { key: nextKey, appKey: firstApp, slug: '', connectionId: firstConnection },
              ]);
              setNextKey((key) => key + 1);
            }}
          >
            {t('studio:hostedApps.instances.add', 'Add an instance')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void onSave(rows);
            }}
          >
            {t('studio:hostedApps.instances.save', 'Save instances')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function DomainsCard({
  surfaces,
  instances,
  initialRows,
  busy,
  issues,
  savedNote,
  onSave,
}: {
  surfaces: SurfaceSummaryDto[];
  instances: Record<string, SurfaceInstance[]>;
  initialRows: DomainRow[];
  busy: boolean;
  issues: DomainIssue[];
  savedNote: boolean;
  onSave: (rows: DomainRow[]) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<DomainRow[]>(initialRows);
  const [nextKey, setNextKey] = useState(initialRows.length);

  const first = surfaces[0];

  const patch = (key: number, change: Partial<DomainRow>): void => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };

  return (
    <Card>
      <CardHeader className="flex items-start justify-start gap-3">
        <IconTile tone="accent" size="md" icon={<PanelsTopLeft />} />
        <div>
          <h2 className="text-section text-fg">
            {t('studio:hostedApps.domains.title', 'Domains')}
          </h2>
          <p className="text-sm text-fg-muted">
            {t(
              'studio:hostedApps.domains.subtitle',
              'Point a domain’s DNS at your proxy, pass the Host header through to Adminium, and attach it here — that host then serves the surface instead of this dashboard. Certificates stay on your proxy.',
            )}
          </p>
          {/*
            The procedure lives in the docs and did not used to be reachable
            from here, which left the subtitle above as the whole of the
            guidance. Resolved through `docsUrl` so a self-hoster pointing at
            their own mirror changes one file (kb/docsLinks.ts).
          */}
          <a
            className="mt-1 inline-block text-body-sm text-accent underline"
            href={docsUrl('self-hosting/app-domains')}
            target="_blank"
            rel="noreferrer"
          >
            {t('studio:hostedApps.domains.docsLink', 'How to set up a domain')}
          </a>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {issues.length > 0 && (
          <Alert
            tone="danger"
            title={t('studio:hostedApps.domains.issuesTitle', 'The domain map was refused')}
          >
            <ul className="list-disc ps-5">
              {issues.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          </Alert>
        )}
        {savedNote && (
          <Alert tone="info" title={t('studio:hostedApps.domains.savedTitle', 'Saved')}>
            <p>
              {t(
                'studio:hostedApps.domains.savedBody',
                'Mappings take effect within a few seconds. A host only answers once its DNS and your proxy actually reach this instance.',
              )}
            </p>
            {/*
              THE THREE STEPS THIS SCREEN CANNOT DO FOR YOU, named at the moment
              they become the operator's next move.

              Saving a mapping looks finished and is not: DNS and TLS are the
              operator's, and Adminium states the prerequisite rather than
              probing it. Without this list the card's own subtitle is
              the only guidance, and the failure it leads to is silent — a host
              that answers nothing, with a correct mapping behind it.

              Ordered because the order matters: an ACME challenge cannot
              succeed before the name resolves, so a proxy reloaded first just
              fails and retries.
            */}
            <ol className="mt-2 flex list-decimal flex-col gap-1 ps-5">
              <li>
                {t(
                  'studio:hostedApps.domains.stepDns',
                  'Point the host at this server in your DNS — the same record type and target as the address you use for this dashboard.',
                )}
              </li>
              <li>
                {t(
                  'studio:hostedApps.domains.stepProxy',
                  'Give the host its own site block on your reverse proxy, passing the Host header through unchanged — then reload the proxy. Editing its config file does not change a process that is already running.',
                )}
              </li>
              <li>
                {t(
                  'studio:hostedApps.domains.stepSignIn',
                  'Staff surfaces ask you to sign in again: session cookies belong to one host, so a mapped host sends you to its own login page first.',
                )}
              </li>
            </ol>
          </Alert>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {t('studio:hostedApps.domains.none', 'No domains are attached.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.key} className="flex flex-wrap items-end gap-3">
                <FormField
                  label={t('studio:hostedApps.domains.hostLabel', 'Host')}
                  className="min-w-64 flex-1"
                >
                  <Input
                    value={row.host}
                    placeholder="shop.example.com"
                    onChange={(event) => {
                      patch(row.key, { host: event.target.value });
                    }}
                  />
                </FormField>
                <FormField
                  label={t('studio:hostedApps.domains.surfaceLabel', 'Surface')}
                  className="w-64"
                >
                  <Select
                    value={`${row.appKey}/${row.side}`}
                    onChange={(event) => {
                      const [appKey, side] = event.target.value.split('/');
                      if (appKey !== undefined && (side === 'staff' || side === 'customer')) {
                        patch(row.key, { appKey, side });
                      }
                    }}
                  >
                    {surfaces.map((surface) => (
                      <option
                        key={`${surface.appKey}/${surface.side}`}
                        value={`${surface.appKey}/${surface.side}`}
                      >
                        {surface.appKey} — {surface.side}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {/*
                  WHICH INSTANCE this host serves. Only where the app
                  has any: on an app with one database the control would offer a
                  single answer, and a host cannot point at an instance that
                  does not exist — the server refuses it by name.
                */}
                {(instances[row.appKey]?.length ?? 0) > 0 && (
                  <FormField
                    label={t('studio:hostedApps.domains.instanceLabel', 'Instance')}
                    className="w-48"
                  >
                    <Select
                      value={row.instance}
                      onChange={(event) => {
                        patch(row.key, { instance: event.target.value });
                      }}
                    >
                      <option value="">
                        {t('studio:hostedApps.domains.instanceOwn', "The app's own")}
                      </option>
                      {(instances[row.appKey] ?? []).map((instance) => (
                        <option key={instance.slug} value={instance.slug}>
                          {instance.slug}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRows((current) => current.filter((candidate) => candidate.key !== row.key));
                  }}
                >
                  {t('studio:hostedApps.domains.remove', 'Remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={first === undefined}
            onClick={() => {
              if (first === undefined) return;
              setRows((current) => [
                ...current,
                { key: nextKey, host: '', appKey: first.appKey, side: first.side, instance: '' },
              ]);
              setNextKey((value) => value + 1);
            }}
          >
            {t('studio:hostedApps.domains.add', 'Attach a domain')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void onSave(rows).then((ok) => {
                if (ok) setRows((current) => current.filter((row) => row.host.trim() !== ''));
              });
            }}
          >
            {t('studio:hostedApps.domains.save', 'Save domains')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
