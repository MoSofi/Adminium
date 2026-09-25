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
import { Suspense, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
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
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  LayoutPanelLeft,
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
import { UninstallAppDialog } from './UninstallAppDialog.js';
import { UpdateColumnsDialog } from './UpdateColumnsDialog.js';

const CARD = 'rounded-[14px] border border-border bg-surface px-[19px] py-[18px] shadow-sm';
/*
 * The comp's values on the shared primitives (COMP 516-590, 1109): header
 * buttons 10/15 r11 w700, the small row buttons 8/12 r9 w700, the status pill
 * 3/9 gap 5 — and `normal` line height, which the comp renders at (this
 * system's `leading-normal` is 1.5).
 */
const HEADER_BUTTON = 'h-auto gap-[7px] rounded-[11px] px-[15px] py-[10px] font-bold leading-[normal]';
const ROW_BUTTON = 'h-auto gap-1.5 rounded-[9px] px-3 py-2 font-bold leading-[normal]';
const STATUS_PILL = 'gap-[5px] px-[9px] py-[3px] leading-[normal]';

function CardTitle({ icon, children, tone = 'accent' }: { icon: ReactNode; children: ReactNode; tone?: 'accent' | 'danger' | 'subtle' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'subtle' ? 'text-fg-subtle' : 'text-accent';
  return (
    <h3 className="mb-[13px] flex items-center gap-[9px]">
      <span aria-hidden className={`${color} [&_svg]:size-4`}>
        {icon}
      </span>
      <span className={`text-sm font-extrabold leading-[normal] tracking-[-0.01em] ${tone === 'danger' ? 'text-danger' : ''}`}>
        {children}
      </span>
    </h3>
  );
}

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
  const app = list.apps.find((candidate) => candidate.key === appKey);
  if (app === undefined) {
    return (
      <Alert tone="warn" title={t('studio:appSettings.notInstalled', 'This app is not installed')}>
        <Link to="/studio/apps" className="font-bold text-accent">
          {t('studio:appSettings.backToApps', 'Back to apps')}
        </Link>
      </Alert>
    );
  }
  return <Loaded app={app} />;
}

function Loaded({ app }: { app: InstalledApp }) {
  const queryClient = useQueryClient();
  const { data: catalog } = useSuspenseQuery(appCatalogQuery());
  const { data: settings } = useSuspenseQuery(appSettingsQuery(app.key));
  // Read here so the whole page suspends once, not card by card.
  const { data: overview } = useSuspenseQuery(appOverviewQuery(app.key));
  const acquisition = useAppAcquisition();
  const [error, setError] = useState<string | null>(null);

  const row = catalog.apps.find((candidate) => candidate.key === app.key && candidate.installed);
  const name = settings.name ?? row?.name ?? app.key;
  const disabled = app.status === 'disabled';
  const updateTo = row?.updateTo ?? null;

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appSettingsKey(app.key) }),
      queryClient.invalidateQueries({ queryKey: appOverviewKey(app.key) }),
      queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: SURFACES_QUERY_KEY }),
      // The sidebar carries the app's section, and its name.
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
    ]);
  };

  const patch = useMutation({
    mutationFn: (change: Parameters<typeof patchAppSettings>[1]) => patchAppSettings(app.key, change),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const staff = app.sides.find((side) => side.side === 'staff');
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const section = appSectionsOf(bootstrap).find((entry) => entry.appKey === app.key) ?? null;

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
            ) : updateTo !== null ? (
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
          <p className="mt-[5px] text-[12.5px] leading-[normal] text-fg-muted">
            {t('studio:appSettings.version', 'Version {version} · by {publisher}', {
              version: app.version,
              publisher: row?.publisher ?? '—',
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-[9px]">
          {/* Where the app lives: its section in the dashboard, or its own address. */}
          {disabled ? null : section !== null ? (
            <Button variant="secondary" className={HEADER_BUTTON} asChild>
              {section.staff?.placement === 'internal' ? (
                <Link to="/a/$appKey/$" params={{ appKey: app.key, _splat: '' }}>
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
          <Button
            className={HEADER_BUTTON}
            disabled={updateTo === null || row === undefined || acquisition.busy}
            onClick={() => {
              if (row !== undefined) void acquisition.update(app, row);
            }}
          >
            <ArrowUpCircle aria-hidden className="size-[15px]" />
            {updateTo === null
              ? t('studio:appSettings.upToDate', 'Up to date')
              : t('studio:appSettings.update', 'Update')}
          </Button>
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

      <div className="flex flex-wrap items-start gap-3.5">
        <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-3.5">
          <ScreensCard app={app} settings={settings} busy={patch.isPending} onPatch={(change) => patch.mutate(change)} onChanged={refresh} />
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
          {/* An app that names no add-on has no card. */}
          {(settings.addOns ?? []).length === 0 ? null : (
            <AppAddOnsCard appKey={app.key} appName={name} rows={settings.addOns ?? []} />
          )}
          <ActivityCard appKey={app.key} />
          <DangerZone app={app} name={name} publisher={row?.publisher ?? '—'} onChanged={refresh} />
        </div>
      </div>
    </div>
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
      return putAppDomains(app.key, next);
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
  const { data: overview } = useSuspenseQuery(appOverviewQuery(app.key));
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

function activityText(action: string, actor: string): string {
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
    default:
      return `${action} · ${actor}`;
  }
}

function ActivityCard({ appKey }: { appKey: string }) {
  const { data: overview } = useSuspenseQuery(appOverviewQuery(appKey));
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
                {activityText(entry.action, entry.actor)}{' '}
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
  onChanged,
}: {
  app: InstalledApp;
  name: string;
  publisher: string;
  onChanged: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const disabled = app.status === 'disabled';
  const [asking, setAsking] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  const toggle = useMutation({
    mutationFn: (enable: boolean) => setAppEnabled(app.key, enable),
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
            {t('studio:appSettings.uninstallNote', 'Removes the app’s files and pages. Keeps the tables and data.')}
          </p>
          <Button variant="destructive" size="sm" onClick={() => setUninstalling(true)}>
            {t('studio:appSettings.uninstall', 'Uninstall')}
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
