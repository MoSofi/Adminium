// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One installed app's own page — `/studio/apps/$key`, ported from
 * `Installed Apps.dc.html`'s Settings view.
 *
 * Header (name, status, version and publisher, Open, Update); the app's sets
 * of screens, each with its switch, where the staff side lives and its
 * address; the settings its manifest declares (a business type); its data —
 * the connection, every table with the last row estimate, and the offer to
 * rename an old install to the prefix; its sample data; its recent activity;
 * and the danger zone (Disable / Enable, Uninstall).
 *
 * ─── Departures from the comp ──────────────────────────────────────────────
 *  - The side names and their helper lines are generic ("Staff screens",
 *    "Customer screens"): any app has these two sides, and "the till" or
 *    "book a table" is one app's wording.
 *  - A declared setting draws from the manifest: its label, its help line and
 *    its choices. The comp's per-choice note ("Retail hides Floor…") is the
 *    setting's help, one line; choice labels are the values, capitalised.
 *  - People and access and Public access join with the tasks that give them
 *    something true to show (app roles, the app's own key). A card with
 *    nothing behind it is not drawn, and Sample data only for an app that
 *    ships some.
 *  - The sample-data ledger is listed only once it exists: it is made on the
 *    first add, not at install.
 *  - No read-only state: the Studio guard on managing apps keeps anyone who
 *    cannot change these settings off the page altogether.
 *  - Row counts are the last introspection's estimates, never a live count.
 */
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  IconTile,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
  SegmentedControl,
  Skeleton,
  Switch,
} from '@adminium/ui';
import {
  ArrowUpCircle,
  Upload,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  LayoutPanelLeft,
  Smartphone,
  Package,
  PauseCircle,
  PlugZap,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import { getFormatters } from '@adminium/i18n';

import { appSectionsOf, bootstrapQuery } from '../../app/bootstrap.js';
import { DEFAULT_BRANDING, brandingQuery } from '../../app/branding.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import {
  AppAcquisitionAlerts,
  UpdateConsentDialog,
  useAppAcquisition,
} from './appAcquisition.js';
import {
  APPS_QUERY_KEY,
  LOCAL_PUBLISHER_ID,
  appCatalogQuery,
  appOverviewKey,
  appOverviewQuery,
  appSettingsKey,
  appSettingsQuery,
  installedAppsQuery,
  patchAppSettings,
  putAppDomains,
  setAppEnabled,
  type AppSettingsView,
  type InstalledApp,
  type InstalledAppSide,
} from './appsApi.js';
import { SURFACES_QUERY_KEY } from './hostedAppsApi.js';
import { AppAddOnsCard } from './AppAddOnsCard.js';
import { RenameTablesDialog } from './RenameTablesDialog.js';
import { SampleDataCard } from './SampleData.js';

/** For the app's own pages (`pages/appPageNotice.tsx`), which load it from here. */
export { SampleDataBanner } from './SampleData.js';
/** For the page route (`pages/PageRenderer.tsx`), which loads it from here, in this chunk. */
export { FeaturePageNotice } from './FeaturePageNotice.js';
import { AppPartsCard } from './AppPartsCard.js';
import { CARD, CardTitle, workspacesHolding, workspacesOf } from './appPageParts.js';
import { InstallScope, addressOf, splitAddress, useInstallId } from './installScope.js';
import { AfterInstallCard, EditScreensCard, LookCard, WhatItAddedCard, monoDigits } from './OwnAppCards.js';
import { RetiredAddress } from '../../apps/RetiredAddress.js';
import { UninstallAppDialog } from './UninstallAppDialog.js';
import { UpdateColumnsDialog } from './UpdateColumnsDialog.js';

/*
 * The comp's values on the shared primitives (COMP 516-590, 1109): header
 * buttons 10/15 r11 w700, the small row buttons 8/12 r9 w700, the status pill
 * 3/9 gap 5 — and `normal` line height, which the comp renders at (this
 * system's `leading-normal` is 1.5).
 */
const HEADER_BUTTON = 'h-auto gap-[7px] rounded-[11px] px-[15px] py-[10px] font-bold leading-[normal]';
const ROW_BUTTON = 'h-auto gap-1.5 rounded-[9px] px-3 py-2 font-bold leading-[normal]';
const STATUS_PILL = 'gap-[5px] px-[9px] py-[3px] leading-[normal]';

/** "business_type" → "Business type"; "retail" → "Retail". */
function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toLocaleUpperCase() + spaced.slice(1);
}

/** An address a person can paste: a relative prefix becomes this origin's URL. */
function absolute(url: string): string {
  return url.startsWith('/') ? `${window.location.origin}${url}` : url;
}

export function AppSettingsPage({ appKey }: { appKey: string }) {
  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <Suspense fallback={<SettingsSkeleton />}>
        <AppSettingsBody appKey={appKey} />
      </Suspense>
    </PageSurface>
  );
}

function SettingsSkeleton() {
  return (
    <div data-testid="app-settings-loading" className="flex flex-wrap gap-3.5" aria-busy="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className={`${CARD} min-w-0 flex-[1_1_340px]`}>
          <Skeleton height={13} width="40%" className="mb-3.5" />
          <Skeleton height={11} width="86%" className="mb-2" />
          <Skeleton height={11} width="70%" className="mb-2" />
          <Skeleton height={34} width="100%" />
        </div>
      ))}
    </div>
  );
}

function AppSettingsBody({ appKey }: { appKey: string }) {
  const { data: list } = useSuspenseQuery(installedAppsQuery());
  // The page's address is the install's: `invoices`, or `invoices~kiln` for a later copy.
  const app = list.apps.find((candidate) => addressOf(candidate) === appKey);
  if (app === undefined) {
    // A plain address whose copy is gone, while other copies stay: it says where they are.
    const { key } = splitAddress(appKey);
    const copies = list.apps.filter((candidate) => candidate.key === key);
    if (copies.length > 0) return <RetiredAddress appName={copies[0]?.name ?? key} copies={copies} />;
    return (
      <Alert tone="warn" title={t('studio:appSettings.notInstalled', 'This app is not installed')}>
        <Link to="/studio/apps" className="font-bold text-accent">
          {t('studio:appSettings.backToApps', 'Back to apps')}
        </Link>
      </Alert>
    );
  }
  const copies = list.apps.filter((candidate) => candidate.key === app.key);
  return (
    // Every card below reads and writes this install alone.
    <InstallScope installId={app.installId ?? null}>
      <Loaded app={app} copies={copies} />
    </InstallScope>
  );
}

/** "1 Nov 2026": the made-at line's date, absolute, in the reader's language. */
function madeOn(savedAt: string): string {
  return getFormatters(getI18nInstance()?.language ?? 'en-US').date(savedAt, 'medium');
}

function Loaded({ app, copies }: { app: InstalledApp; copies: readonly InstalledApp[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const install = app.installId ?? null;
  const { data: catalog } = useSuspenseQuery(appCatalogQuery());
  const { data: settings } = useSuspenseQuery(appSettingsQuery(app.key, install));
  // Read here so the whole page suspends once, not card by card.
  const { data: overview } = useSuspenseQuery(appOverviewQuery(app.key, install));
  const acquisition = useAppAcquisition();
  const [error, setError] = useState<string | null>(null);
  // What a finished action says (the comp's toasts), read out once.
  const [notice, setNotice] = useState<string | null>(null);

  const row = catalog.apps.find((candidate) => candidate.key === app.key && candidate.installed);
  const name = settings.name ?? app.name ?? row?.name ?? app.key;
  const disabled = app.status === 'disabled';
  const updateTo = row?.updateTo ?? null;
  // An app someone made, installed from its file: no catalogue to update from, a newer file instead.
  const own = app.publisher?.id === LOCAL_PUBLISHER_ID && app.folder === undefined;
  const fromFolder = app.folder !== undefined;
  const several = copies.length > 1;
  const database = app.connectionName ?? overview.connection?.name ?? null;
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const workspaces = workspacesOf(bootstrap);
  const holders = workspacesHolding(workspaces, app.connectionId);
  const branding = useQuery(brandingQuery()).data ?? DEFAULT_BRANDING;
  const wide = useWide();
  const serverName = branding.appName;

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appSettingsKey(app.key, install) }),
      queryClient.invalidateQueries({ queryKey: appOverviewKey(app.key, install) }),
      queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: SURFACES_QUERY_KEY }),
      // The sidebar carries the app's section, and its name.
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
    ]);
  };

  const patch = useMutation({
    mutationFn: (change: Parameters<typeof patchAppSettings>[1]) => patchAppSettings(app.key, change, install),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const staff = app.sides.find((side) => side.side === 'staff');
  // The sidebar section of this install: a later copy's carries its address.
  const section = appSectionsOf(bootstrap).find((entry) => entry.kind !== 'add-on' && entry.appKey === addressOf(app)) ?? null;
  const tables = overview.tables.filter((table) => table.role !== 'sample-ledger');
  const before = tables.filter((table) => table.before === true).length;
  // Every table was here before the app: the uninstall line says so.
  const allBefore = tables.length > 0 && before === tables.length;
  const firstCopy = copies.find((copy) => (copy.slug ?? '') === '') ?? null;

  /** The version line: the copy's database and workspaces, then where the app came from. */
  const versionLine = (
    <>
      {several || holders.length > 0
        ? database === null
          ? null
          : `${t('studio:apps.copies.on', 'on {database}', { database })}${holders.length === 0 ? '' : ` · ${holders.map((workspace) => workspace.name).join(', ')}`} · `
        : null}
      {fromFolder ? (
        <>
          {t('studio:apps.page.versionOnly', 'Version {version}', { version: app.version })} · <FromFolder appKey={app.key} />
        </>
      ) : own ? (
        app.madeAt === undefined ? (
          t('studio:apps.page.ownVersion', 'Version {version} · Your own app', { version: app.version })
        ) : (
          <MadeAtLine version={app.version} label={app.madeAt.label} date={madeOn(app.madeAt.savedAt)} />
        )
      ) : (
        t('studio:appSettings.version', 'Version {version} · by {publisher}', {
          version: app.version,
          publisher: row?.publisher ?? '—',
        })
      )}
    </>
  );

  return (
    <div className="flex max-w-[1080px] flex-col gap-4">
      <PageActions title={name} subtitle={t('studio:appSettings.crumb', 'Apps')} />
      <header className="flex flex-wrap items-start gap-4">
        <IconTile size="lg" className="size-[52px] rounded-[15px]">
          <Package aria-hidden className="size-[26px]" />
        </IconTile>
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[22px] font-extrabold leading-[normal] tracking-[-0.03em]">{name}</h2>
            {disabled ? (
              <Badge tone="neutral" className={STATUS_PILL}>
                <PauseCircle aria-hidden className="size-3" />
                {t('studio:appSettings.statusDisabled', 'Disabled')}
              </Badge>
            ) : updateTo !== null && !own ? (
              <Badge tone="warn" className={STATUS_PILL}>
                <ArrowUpCircle aria-hidden className="size-3" />
                {t('studio:appSettings.statusUpdate', 'Update available · {version}', { version: updateTo })}
              </Badge>
            ) : (
              <Badge tone="pos" className={STATUS_PILL}>
                <CheckCircle2 aria-hidden className="size-3" />
                {t('studio:appSettings.statusActive', 'Active')}
              </Badge>
            )}
          </div>
          <p className="mt-[5px] text-[12.5px] leading-[normal] text-fg-muted" data-testid="app-version-line">
            {versionLine}
          </p>
        </div>
        <div className="flex flex-wrap gap-[9px]">
          {/* Where the app lives: its section in the dashboard, or its own address. A copy whose screens open for the first install only has none. */}
          {disabled || app.screensFirstOnly === true ? null : section !== null ? (
            <Button variant="secondary" className={HEADER_BUTTON} asChild>
              {section.staff?.placement === 'internal' ? (
                <Link to="/a/$appKey/$" params={{ appKey: addressOf(app), _splat: '' }}>
                  {t('studio:appSettings.open', 'Open the app')}
                </Link>
              ) : section.staff?.placement === 'external' ? (
                <a href={section.staff.url} target="_blank" rel="noreferrer">
                  {t('studio:appSettings.open', 'Open the app')}
                  <ExternalLink aria-hidden className="size-[15px] rtl:-scale-x-100" />
                </a>
              ) : (
                <Link to="/p/$slug" params={{ slug: section.groups[0]?.items[0]?.slug ?? '' }}>
                  {t('studio:appSettings.open', 'Open the app')}
                </Link>
              )}
            </Button>
          ) : staff?.openUrl === undefined ? null : (
            <Button variant="secondary" className={HEADER_BUTTON} asChild>
              <a href={staff.openUrl} target="_blank" rel="noreferrer">
                {t('studio:appSettings.open', 'Open the app')}
                <ExternalLink aria-hidden className="size-[15px] rtl:-scale-x-100" />
              </a>
            </Button>
          )}
          {fromFolder ? null : own ? (
            // An app someone made has no catalogue: a newer version comes as a file.
            <Button className={HEADER_BUTTON} onClick={() => void navigate({ to: '/studio/apps', search: { upload: true } })}>
              <Upload aria-hidden className="size-[15px]" />
              {t('studio:apps.page.uploadNewer', 'Upload a newer version')}
            </Button>
          ) : (
            <Button
              className={HEADER_BUTTON}
              disabled={updateTo === null || row === undefined || acquisition.busy}
              onClick={() => {
                if (row === undefined) return;
                // One version per app on a server: every copy moves, each through its own check.
                void (several ? acquisition.updateEvery(copies, row) : acquisition.update(app, row));
              }}
            >
              <ArrowUpCircle aria-hidden className="size-[15px]" />
              {updateTo === null
                ? t('studio:appSettings.upToDate', 'Up to date')
                : several
                  ? t('studio:apps.copies.updateEvery', 'Update every copy')
                  : t('studio:appSettings.update', 'Update')}
            </Button>
          )}
        </div>
      </header>

      <UpdateConsentDialog state={acquisition} />
      <UpdateColumnsDialog state={acquisition} />
      <AppAcquisitionAlerts state={acquisition} origin="installed" />
      {error === null ? null : (
        <Alert tone="danger" title={t('studio:appSettings.saveFailed', 'The change was not saved')}>
          {error}
        </Alert>
      )}
      <div role="status" aria-live="polite">
        {notice === null ? null : <Alert tone="pos" title={notice} />}
      </div>

      <div className="flex flex-wrap items-start gap-3.5">
        <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-3.5">
          {/* At phone width the list of what is left to do comes first. */}
          {wide ? null : <AfterInstallCard appKey={app.key} onNotice={setNotice} />}
          {/* No sides, no Sets of screens: a pages-only app has no screens of its own. */}
          {app.sides.length === 0 ? null : (
            <ScreensCard app={app} settings={settings} busy={patch.isPending} onPatch={(change) => patch.mutate(change)} onChanged={refresh} />
          )}
          <EditScreensCard appKey={app.key} appName={name} serverName={serverName} onNotice={setNotice} />
          {own || several ? (
            <WhatItAddedCard
              overview={overview}
              intro={
                several && database !== null
                  ? t('studio:apps.added.onlyHere', 'On {database} only.', { database })
                  : app.sides.length === 0
                    ? t('studio:apps.added.pagesOnly', 'Pages only. This app has no screens of its own.')
                    : null
              }
              note={
                app.screensFirstOnly === true
                  ? firstCopy?.connectionName == null
                    ? t('studio:apps.copies.screensFirstOnly', 'This app’s screens open for its first install only. Its pages, tables and rules work here.')
                    : t('studio:apps.copies.screensFirstOnlyOn', 'This app’s screens open for its first install only, on {database}. Its pages, tables and rules work here.', {
                        database: firstCopy.connectionName,
                      })
                  : null
              }
            />
          ) : null}
          {/* An app with no parts has no card. */}
          <AppPartsCard appKey={app.key} />
          {app.phone === true ? <PhoneAppCard /> : null}
          {settings.declared.map((setting) => (
            <DeclaredSettingCard
              key={setting.key}
              setting={setting}
              value={settings.values[setting.key]}
              busy={patch.isPending}
              onSave={(value) => patch.mutate({ values: { [setting.key]: value } })}
            />
          ))}
          <DataCard app={app} />
          <SampleDataCard appKey={app.key} connectionName={overview.connection?.name ?? null} />
        </div>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          {wide ? <AfterInstallCard appKey={app.key} onNotice={setNotice} /> : null}
          <LookCard appKey={app.key} appName={name} onNotice={setNotice} />
          {/* An app that names no add-on has no card. */}
          {(settings.addOns ?? []).length === 0 ? null : (
            <AppAddOnsCard appKey={app.key} appName={name} rows={settings.addOns ?? []} />
          )}
          <ActivityCard appKey={app.key} />
          <DangerZone
            app={app}
            name={name}
            publisher={row?.publisher ?? '—'}
            uninstallNote={
              several && database !== null
                ? t('studio:apps.copies.uninstallNote', 'Removes {app} from {database}: its pages and rules there. Keeps the tables and their rows.', { app: name, database })
                : own
                  ? allBefore
                    ? t('studio:apps.page.uninstallNoteBefore', 'Removes the app’s pages and rules. Keeps the tables and their rows — they were here before the app.')
                    : t('studio:apps.page.uninstallNote', 'Removes the app’s pages and rules. Keeps the tables and their rows.')
                  : null
            }
            uninstallLabel={several && database !== null ? t('studio:apps.copies.uninstall', 'Uninstall {app} from {database}', { app: name, database }) : null}
            onChanged={refresh}
          />
        </div>
      </div>
    </div>
  );
}

/** "Version 1.0.0 · Your own app · made at Fernhill main on 1 Nov 2026", the version and date in mono. */
function MadeAtLine({ version, label, date }: { version: string; label: string | null; date: string }) {
  const text =
    label === null
      ? t('studio:apps.page.madeOn', 'Version {version} · Your own app · made on {date}', { version: '\u0001', date: '\u0002' })
      : t('studio:apps.page.madeAt', 'Version {version} · Your own app · made at {label} on {date}', { version: '\u0001', label, date: '\u0002' });
  return <>{withMono(text, { '\u0001': version, '\u0002': date })}</>;
}

/** A translated sentence whose marks are replaced by mono values, wherever the language puts them. */
export function withMono(text: string, values: Readonly<Record<string, string>>): ReactNode[] {
  const marks = Object.keys(values);
  const parts: string[] = [];
  let rest = text;
  // Split at each mark, keeping it: a mark is one of the keys of `values`.
  for (;;) {
    const at = marks.map((mark) => ({ mark, index: rest.indexOf(mark) })).filter((hit) => hit.index >= 0).sort((a, b) => a.index - b.index)[0];
    if (at === undefined) break;
    parts.push(rest.slice(0, at.index), at.mark);
    rest = rest.slice(at.index + at.mark.length);
  }
  parts.push(rest);
  return parts.map((part, index) => {
    const value = values[part];
    return value === undefined ? part : <MonoText key={index}>{value}</MonoText>;
  });
}

/** Wider than a phone: the two columns sit side by side. */
function useWide(): boolean {
  const query = '(min-width: 700px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const change = (): void => setWide(list.matches);
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, []);
  return wide;
}

/** "From the folder `apps/<key>`": the folder in mono, wherever the language puts it. */
function FromFolder({ appKey }: { appKey: string }) {
  const MARK = '\u0001';
  const [before = '', after = ''] = t('studio:hostedApps.installed.fromFolder', 'From the folder {folder}', { folder: MARK }).split(MARK);
  return (
    <>
      {before}
      <MonoText>{`apps/${appKey}`}</MonoText>
      {after}
    </>
  );
}

function ScreensCard({
  app,
  settings,
  busy,
  onPatch,
  onChanged,
}: {
  app: InstalledApp;
  settings: AppSettingsView;
  busy: boolean;
  onPatch: (change: Parameters<typeof patchAppSettings>[1]) => void;
  onChanged: () => Promise<void>;
}) {
  const disabled = app.status === 'disabled';
  return (
    <section className={CARD} aria-labelledby="app-screens-title">
      <CardTitle icon={<LayoutPanelLeft />}>
        <span id="app-screens-title">{t('studio:appSettings.screens', 'Sets of screens')}</span>
      </CardTitle>
      <div className="flex flex-col gap-3">
        {app.sides.map((side) => (
          <SideRow
            key={side.side}
            app={app}
            side={side}
            settings={settings}
            busy={busy}
            disabled={disabled}
            onPatch={onPatch}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * An app with a phone app. It is not one of the sets of screens: Adminium
 * serves it to nobody, so it has no address and no switch. What an operator
 * needs to know is that it has a key of its own, and where that is.
 */
function PhoneAppCard() {
  return (
    <section className={CARD} aria-labelledby="app-phone-title" data-testid="app-phone">
      <CardTitle icon={<Smartphone />}>
        <span id="app-phone-title">{t('studio:appSettings.phone', 'Phone app')}</span>
      </CardTitle>
      <p className="text-[13px] leading-[1.5] text-fg-muted">
        {t(
          'studio:appSettings.phoneLine',
          'This app has a phone app for customers. Adminium serves it to nobody: it runs on a phone, and reaches what guests may reach with a key of its own. Switching the customer screens off stops it too.',
        )}
      </p>
      <p className="mt-2 text-[13px] leading-[1.5] text-fg-muted">
        {t(
          'studio:appSettings.phoneBuild',
          'A phone app built for a store needs two things from this server: its address as a phone reaches it, and the app’s “phone app” key.',
        )}
      </p>
      <Link to="/studio/public-api" className="mt-2.5 inline-block text-[13px] font-bold text-accent hover:underline">
        {t('studio:appSettings.phoneKeys', 'Open API keys')}
      </Link>
    </section>
  );
}

function SideRow({
  app,
  side,
  settings,
  busy,
  disabled,
  onPatch,
  onChanged,
}: {
  app: InstalledApp;
  side: InstalledAppSide;
  settings: AppSettingsView;
  busy: boolean;
  disabled: boolean;
  onPatch: (change: Parameters<typeof patchAppSettings>[1]) => void;
  onChanged: () => Promise<void>;
}) {
  const install = useInstallId();
  const on = !settings.off.includes(side.side);
  const staff = side.side === 'staff';
  const [adding, setAdding] = useState(false);
  const [host, setHost] = useState('');
  const [copied, setCopied] = useState(false);
  const addDomain = useMutation({
    mutationFn: () => {
      // The whole list for the app goes back: the new host beside the ones it has.
      const next: Record<string, { side: 'staff' | 'customer'; instance?: string }> = { ...settings.domains };
      next[host.trim()] = { side: side.side };
      return putAppDomains(app.key, next, install);
    },
    onSuccess: async () => {
      setAdding(false);
      setHost('');
      await onChanged();
    },
  });
  const address = absolute(side.openUrl ?? `${side.prefix}/`);
  const name = staff
    ? t('studio:appSettings.sideStaff', 'Staff screens')
    : t('studio:appSettings.sideCustomer', 'Customer screens');

  return (
    <div
      data-testid={`app-side-${side.side}`}
      className={`rounded-[13px] border border-border px-[15px] py-3.5 ${on && !disabled ? 'bg-surface' : 'bg-surface-2'}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold leading-[normal]">{name}</div>
          <p className="mt-[3px] text-xs leading-[1.5] text-fg-muted">
            {disabled
              ? t('studio:appSettings.sideAppOff', 'The whole app is switched off.')
              : on
                ? staff
                  ? t('studio:appSettings.staffOnHelp', 'Your team signs in here with their own accounts.')
                  : t('studio:appSettings.customerOnHelp', 'Customers use these pages. They are public.')
                : staff
                  ? t('studio:appSettings.staffOffHelp', 'These screens are not served. Nothing was deleted.')
                  : t('studio:appSettings.customerOffHelp', 'Customers see “not available”. Nothing was deleted.')}
          </p>
          {/* On, and unable to answer: the switch serves the pages; the public API is what they call. */}
          {!staff && on && !disabled && customerTrouble(settings.publicAccess) !== null ? (
            <p className="mt-[5px] text-xs leading-[1.5] text-warn" data-testid="app-side-customer-trouble">
              {customerTrouble(settings.publicAccess)}
            </p>
          ) : null}
        </div>
        <Switch
          checked={on}
          disabled={busy || disabled}
          aria-label={t('studio:appSettings.sideSwitch', '{side}, on or off', { side: name })}
          onCheckedChange={(next) =>
            onPatch({ off: next ? settings.off.filter((s) => s !== side.side) : [...settings.off, side.side] })
          }
        />
        <span className={`min-w-6 text-xs font-extrabold ${on ? 'text-accent' : 'text-fg-subtle'}`}>
          {on ? t('studio:appSettings.on', 'On') : t('studio:appSettings.off', 'Off')}
        </span>
      </div>

      {staff && on && !disabled ? (
        <div className="mt-3">
          <div className="mb-[7px] text-[11px] font-extrabold uppercase leading-[normal] tracking-[0.05em] text-fg-subtle">
            {t('studio:appSettings.whereItLives', 'Where it lives')}
          </div>
          <SegmentedControl
            className="gap-1 p-1"
            aria-label={t('studio:appSettings.whereItLives', 'Where it lives')}
            value={settings.placement}
            disabled={busy}
            onValueChange={(value) => onPatch({ placement: value as 'internal' | 'external' })}
            options={[
              { value: 'external', label: t('studio:appSettings.ownAddress', 'On its own address') },
              { value: 'internal', label: t('studio:appSettings.insideDashboard', 'Inside the dashboard') },
            ]}
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-[9px]">
        <MonoText className="min-w-[180px] flex-1 truncate rounded-[9px] bg-surface-3 px-[11px] py-2 text-[12.5px] leading-[normal]">
          {address}
        </MonoText>
        <Button
          variant="secondary"
          size="sm"
          className={ROW_BUTTON}
          aria-label={t('studio:appSettings.copyAddress', 'Copy address')}
          onClick={() => {
            void navigator.clipboard?.writeText(address).then(() => setCopied(true));
          }}
        >
          <Copy aria-hidden className="size-3.5" />
          {copied ? t('studio:appSettings.copied', 'Copied') : t('studio:appSettings.copy', 'Copy')}
        </Button>
        {staff ? (
          <Button variant="secondary" size="sm" className={ROW_BUTTON} onClick={() => setAdding((open) => !open)}>
            <Plus aria-hidden className="size-3.5" />
            {t('studio:appSettings.addDomain', 'Add a domain')}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className={ROW_BUTTON} asChild>
            <a href={address} target="_blank" rel="noreferrer">
              <Eye aria-hidden className="size-3.5" />
              {t('studio:appSettings.preview', 'Preview')}
            </a>
          </Button>
        )}
      </div>

      {adding ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (host.trim() !== '') addDomain.mutate();
          }}
        >
          <label className="min-w-[220px] flex-1 text-[11.5px] font-bold text-fg-muted">
            {t('studio:appSettings.domainField', 'Domain')}
            <Input
              className="mt-1.5 font-mono"
              value={host}
              placeholder="till.example.com"
              onChange={(event) => setHost(event.currentTarget.value)}
            />
          </label>
          <Button type="submit" size="sm" disabled={addDomain.isPending || host.trim() === ''}>
            {t('studio:appSettings.addDomainSave', 'Add')}
          </Button>
          {addDomain.error === null ? null : (
            <p role="alert" className="w-full text-xs text-danger">
              {addDomain.error.message}
            </p>
          )}
        </form>
      ) : null}
    </div>
  );
}

function DeclaredSettingCard({
  setting,
  value,
  busy,
  onSave,
}: {
  setting: AppSettingsView['declared'][number];
  value: unknown;
  busy: boolean;
  onSave: (value: unknown) => void;
}) {
  const title = setting.label ?? humanize(setting.key);
  const [draft, setDraft] = useState(value === null || value === undefined ? '' : String(value));
  let control: ReactNode;
  if (setting.type === 'enum' && setting.enum !== undefined) {
    control = (
      <SegmentedControl
        aria-label={title}
        className="max-w-[360px]"
        value={typeof value === 'string' ? value : ''}
        disabled={busy}
        onValueChange={onSave}
        options={setting.enum.map((option) => ({ value: option, label: humanize(option) }))}
      />
    );
  } else if (setting.type === 'boolean') {
    control = <Switch aria-label={title} checked={value === true} disabled={busy} onCheckedChange={onSave} />;
  } else if (setting.type === 'number' || setting.type === 'string') {
    control = (
      <Input
        aria-label={title}
        className="max-w-[360px]"
        type={setting.type === 'number' ? 'number' : 'text'}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          if (draft === (value === null || value === undefined ? '' : String(value))) return;
          onSave(draft === '' ? null : setting.type === 'number' ? Number(draft) : draft);
        }}
      />
    );
  } else {
    // A file or a JSON document has no honest one-line control here.
    control = <MonoText className="text-xs text-fg-muted">{JSON.stringify(value)}</MonoText>;
  }
  return (
    <section className={CARD} data-testid={`app-setting-${setting.key}`}>
      <CardTitle icon={<SlidersHorizontal />}>{title}</CardTitle>
      {control}
      {setting.help === undefined ? null : (
        <p className="mt-[11px] text-[12.5px] leading-[1.55] text-fg-muted">{setting.help}</p>
      )}
    </section>
  );
}

function DataCard({ app }: { app: InstalledApp }) {
  const install = useInstallId();
  const { data: overview } = useSuspenseQuery(appOverviewQuery(app.key, install));
  const [renaming, setRenaming] = useState(false);
  const [renamed, setRenamed] = useState<string | null>(null);
  return (
    <section className={CARD}>
      <CardTitle icon={<Database />}>{t('studio:appSettings.data', 'Data')}</CardTitle>
      {overview.connection === null ? null : (
        <div className="mb-[13px] inline-flex items-center gap-2 rounded-full bg-surface-3 px-3 py-[7px]">
          <span aria-hidden className="size-[7px] rounded-full bg-pos" />
          <MonoText className="text-xs font-bold">
            {`${overview.connection.name} · ${overview.connection.engine}`}
          </MonoText>
        </div>
      )}
      {renamed === null ? null : (
        <Alert
          tone="pos"
          className="mb-[13px]"
          title={t('studio:hostedApps.installed.renamed', 'Tables renamed to {prefix}…', { prefix: renamed })}
        />
      )}
      {app.oldTableNames === undefined ? null : (
        <div className="mb-[13px] flex flex-wrap items-center gap-[11px] rounded-[12px] border border-warn/25 bg-warn-soft px-3.5 py-3">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn" />
          <p className="min-w-[160px] flex-1 text-[12.5px] leading-[1.5] text-fg-muted">
            <span className="font-bold text-fg">
              {t('studio:hostedApps.installed.oldNames', 'This install uses the old table names.')}
            </span>{' '}
            {t('studio:hostedApps.installed.oldNamesWhy', 'They were made before prefixes.')}
          </p>
          <Button size="sm" onClick={() => setRenaming(true)}>
            <Wand2 aria-hidden className="size-4" />
            {t('studio:hostedApps.installed.renameTo', 'Rename to {prefix}…', {
              prefix: app.oldTableNames.prefix,
            })}
          </Button>
        </div>
      )}
      {/* How many of its tables were here before the app (it found them and used them). */}
      {(() => {
        const own = overview.tables.filter((table) => table.role !== 'sample-ledger');
        const before = own.filter((table) => table.before === true).length;
        return before === 0 ? null : (
          <p className="mb-[13px] text-[12.5px] leading-[normal] text-fg-muted" data-testid="app-tables-before">
            {monoDigits(t('studio:apps.data.before', '{count, plural, one {# table} other {# tables}}. {before} of them were here before the app.', { count: own.length, before }))}
          </p>
        );
      })()}
      {overview.tables.length === 0 ? (
        <p className="text-[12.5px] text-fg-muted">{t('studio:appSettings.noTables', 'This app uses no tables.')}</p>
      ) : (
        <ul className="overflow-hidden rounded-[12px] border border-border">
          {overview.tables.map((table) => (
            <li
              key={table.ref}
              data-role={table.role}
              className={`flex items-center gap-2.5 border-b border-border px-[13px] py-[9px] last:border-b-0 ${
                table.role === 'sample-ledger' ? 'opacity-60' : ''
              }`}
            >
              <span className="min-w-0 flex-1">
                <MonoText className="block truncate text-[12.5px]">{table.table}</MonoText>
                {table.role === 'sample-ledger' ? (
                  <span className="block text-[11px] text-fg-subtle">
                    {t('studio:appSettings.sampleLedger', 'Adminium’s list of sample records')}
                  </span>
                ) : null}
              </span>
              <MonoText className="text-xs font-bold text-fg-muted">
                {table.rows === null
                  ? '—'
                  : t('studio:appSettings.rows', '{count, plural, one {# row} other {# rows}}', { count: table.rows })}
              </MonoText>
            </li>
          ))}
        </ul>
      )}
      {renaming && app.oldTableNames !== undefined ? (
        <RenameTablesDialog
          app={{ ...app, oldTableNames: app.oldTableNames }}
          onClose={() => setRenaming(false)}
          onRenamed={(prefix) => {
            setRenaming(false);
            setRenamed(prefix);
          }}
        />
      ) : null}
    </section>
  );
}

/** Why a customer side that is on cannot answer, or null when it can (or the app asks for no public access). */
export function customerTrouble(access: { apiOn: boolean; granted: boolean } | undefined): string | null {
  if (access === undefined) return null;
  if (!access.granted) {
    return t(
      'studio:appSettings.customerNoAccess',
      'These pages open, but they cannot read or save anything: the app was installed without its public access. Update the app and allow it.',
    );
  }
  if (!access.apiOn) {
    return t(
      'studio:appSettings.customerApiOff',
      'These pages open, but they cannot read or save anything: the public API is switched off. Switch it on under Studio › API keys.',
    );
  }
  return null;
}

export function activityText(action: string, actor: string, subject?: string): string {
  switch (action) {
    case 'app.staged':
      return t('studio:appSettings.activity.staged', 'Uploaded by {actor}', { actor });
    case 'app.installed':
      return t('studio:appSettings.activity.installed', 'Installed by {actor}', { actor });
    case 'app.updated':
      return t('studio:appSettings.activity.updated', 'Updated by {actor}', { actor });
    case 'app.disabled':
      return t('studio:appSettings.activity.disabled', 'Switched off by {actor}', { actor });
    case 'app.enabled':
      return t('studio:appSettings.activity.enabled', 'Switched on by {actor}', { actor });
    case 'app.settings-changed':
      return t('studio:appSettings.activity.settings', 'Settings changed by {actor}', { actor });
    case 'app.domains-changed':
      return t('studio:appSettings.activity.domains', 'Domains changed by {actor}', { actor });
    case 'app.instances-changed':
      return t('studio:appSettings.activity.instances', 'Instances changed by {actor}', { actor });
    case 'app.tables-renamed':
      return t('studio:appSettings.activity.renamed', 'Tables renamed by {actor}', { actor });
    case 'app.sample-data.add':
      return t('studio:appSettings.activity.sampleAdded', 'Sample data added by {actor}', { actor });
    case 'app.sample-data.remove':
      return t('studio:appSettings.activity.sampleRemoved', 'Sample data removed by {actor}', { actor });
    case 'app.add-on-step':
      return subject === undefined
        ? t('studio:appSettings.activity.addOnUnnamed', 'An add-on set up by {actor}', { actor })
        : t('studio:appSettings.activity.addOn', '{name} set up by {actor}', { name: subject, actor });
    case 'app.install-failed':
      return t('studio:appSettings.activity.installFailed', 'An install by {actor} did not finish', { actor });
    case 'app.update-failed':
      return t('studio:appSettings.activity.updateFailed', 'An update by {actor} did not finish', { actor });
    default:
      // Never the raw key: `app.add-on-step · owner@…` is the server's word, not a sentence.
      return t('studio:appSettings.activity.other', 'Changed by {actor}', { actor });
  }
}

function ActivityCard({ appKey }: { appKey: string }) {
  const install = useInstallId();
  const { data: overview } = useSuspenseQuery(appOverviewQuery(appKey, install));
  const formatters = getFormatters(getI18nInstance()?.language ?? 'en-US');
  return (
    <section className={CARD}>
      <CardTitle icon={<History />} tone="subtle">
        {t('studio:appSettings.activity.title', 'Activity')}
      </CardTitle>
      {overview.activity.length === 0 ? (
        <p className="text-[12.5px] text-fg-muted">{t('studio:appSettings.activity.none', 'Nothing yet.')}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {overview.activity.map((entry) => (
            <li key={`${entry.action}:${String(entry.at)}`} className="flex items-start gap-2.5">
              <span aria-hidden className="mt-1.5 size-[7px] shrink-0 rounded-full bg-border-strong" />
              <span className="text-[12.5px] leading-[1.5] text-fg-muted">
                {activityText(entry.action, entry.actor, entry.subject)}{' '}
                <span className="text-fg-subtle">· {formatters.relative(entry.at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DangerZone({
  app,
  name,
  publisher,
  uninstallNote,
  uninstallLabel,
  onChanged,
}: {
  app: InstalledApp;
  name: string;
  publisher: string;
  /** The uninstall line, when this copy or this kind of app says it differently; null for the usual one. */
  uninstallNote: string | null;
  /** "Uninstall Invoices from kiln", for one copy of several; null for "Uninstall". */
  uninstallLabel: string | null;
  onChanged: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const install = useInstallId();
  const disabled = app.status === 'disabled';
  const [asking, setAsking] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  const toggle = useMutation({
    mutationFn: (enable: boolean) => setAppEnabled(app.key, enable, install),
    onSuccess: async () => {
      setAsking(false);
      await onChanged();
    },
  });

  return (
    <section className={`${CARD} border-danger/30`}>
      <CardTitle icon={<TriangleAlert />} tone="danger">
        {t('studio:appSettings.danger', 'Danger zone')}
      </CardTitle>
      <div className="flex flex-col gap-[11px]">
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-[170px] flex-1 text-[12.5px] leading-[1.5] text-fg-muted">
            {disabled
              ? t('studio:appSettings.disabledNote', 'The app is switched off. Enable brings back exactly what was there.')
              : t('studio:appSettings.disableNote', 'Hides the app everywhere and stops its endpoints. Nothing is deleted.')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={toggle.isPending}
            onClick={() => (disabled ? toggle.mutate(true) : setAsking(true))}
          >
            {disabled ? t('studio:appSettings.enable', 'Enable') : t('studio:appSettings.disable', 'Disable')}
          </Button>
        </div>
        <div aria-hidden className="h-px bg-border" />
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-[170px] flex-1 text-[12.5px] leading-[1.5] text-fg-muted">
            {uninstallNote ?? t('studio:appSettings.uninstallNote', 'Removes the app’s files and pages. Keeps the tables and data.')}
          </p>
          <Button variant="destructive" size="sm" onClick={() => setUninstalling(true)}>
            {uninstallLabel ?? t('studio:appSettings.uninstall', 'Uninstall')}
          </Button>
        </div>
        {toggle.error === null ? null : (
          <p role="alert" className="text-xs text-danger">
            {toggle.error.message}
          </p>
        )}
      </div>

      {asking ? (
        <Modal open onOpenChange={(next) => !next && setAsking(false)}>
          <ModalHeader
            icon={<PauseCircle />}
            title={t('studio:appSettings.disableTitle', 'Disable {app}?', { app: name })}
            subtitle={t('studio:appSettings.version', 'Version {version} · by {publisher}', {
              version: app.version,
              publisher,
            })}
            closeLabel={t('studio:appSettings.close', 'Close')}
          />
          <ModalBody>
            <ul className="flex flex-col gap-2.5">
              {[
                { icon: <EyeOff />, text: t('studio:appSettings.disableLine1', 'Its section is hidden for everyone.') },
                { icon: <PlugZap />, text: t('studio:appSettings.disableLine2', 'Its screens and its own endpoints stop answering.') },
                { icon: <Database />, text: t('studio:appSettings.disableLine3', 'The tables, records and settings stay as they are.') },
              ].map((line) => (
                <li key={line.text} className="flex items-start gap-2.5">
                  <span aria-hidden className="mt-0.5 text-fg-subtle [&_svg]:size-4">
                    {line.icon}
                  </span>
                  <span className="text-[13px] leading-[1.55] text-fg-muted">{line.text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3.5 flex gap-[11px] rounded-[12px] bg-pos-soft px-[15px] py-[13px]">
              <ShieldCheck aria-hidden className="mt-px size-[17px] shrink-0 text-pos" />
              <p className="text-[12.5px] leading-[1.5] text-fg-muted">
                <span className="font-bold text-fg">
                  {t('studio:appSettings.nothingDeleted', 'Nothing is deleted.')}
                </span>{' '}
                {t('studio:appSettings.enableBrings', 'Enable brings back exactly what was there.')}
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t('studio:appSettings.cancel', 'Cancel')}
            </Button>
            <Button variant="destructive" disabled={toggle.isPending} onClick={() => toggle.mutate(false)}>
              <PauseCircle aria-hidden className="size-[15px]" />
              {t('studio:appSettings.disable', 'Disable')}
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}

      {uninstalling ? (
        <UninstallAppDialog
          appKey={app.key}
          name={name}
          subtitle={t('studio:appSettings.version', 'Version {version} · by {publisher}', {
            version: app.version,
            publisher,
          })}
          onClose={() => setUninstalling(false)}
          onUninstalled={() => void navigate({ to: '/studio/apps' })}
        />
      ) : null}
    </section>
  );
}
