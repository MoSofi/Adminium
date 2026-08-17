// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desktop-only §13 About sections (11-electron.md §13), rendered beneath the
 * shared About surface (see `AboutPage.tsx`) whenever the SPA runs in the
 * Electron shell.
 *
 * Every field §13 enumerates lives here: app/server/migration/Electron/Chromium/
 * Node versions, the data directory (click → reveal), the secret-storage mode
 * with its plain-text WARN banner, the update channel + "Check for updates", the
 * AGPL notice with an in-app licence viewer, the third-party notices viewer, the
 * telemetry toggle, and the diagnostics copy/show-logs actions.
 *
 * The data is the §4 bridge's (native affordances — versions, the data dir, the
 * bundled files) plus the shared `/api/v1/about` reply (server version, migration
 * version, telemetry state) and the `/api/v1/settings/telemetry` write. Feature
 * gating is NOT decided here — this component renders only when the shell is
 * present (`AboutPage` gates on `isDesktopRuntime()`), which is the one native
 * fact the bridge is trusted for (`lib/desktop-runtime.ts`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Check,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  RefreshCw,
  RotateCw,
  Scale,
  ScrollText,
  Stethoscope,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  IconTile,
  KeyValueList,
  Label,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTrigger,
  Spinner,
  Switch,
} from '@adminium/ui';

import { useDesktopUpdateFlow, type DesktopUpdateFlow } from '../desktop/updates.js';
import { t } from '../i18n/t.js';
import { getI18nInstance } from '../i18n/t.js';
import { useAppToasts } from '../pages/toasts.js';
import { type AboutData } from './aboutApi.js';
import {
  buildDiagnostics,
  checkForUpdates,
  dataDirBytes,
  desktopPlatform,
  desktopRuntimeQuery,
  desktopVersions,
  formatBytes,
  readBundledText,
  revealPath,
  setTelemetry,
  showLogs,
  type DesktopUpdateOutcome,
} from './desktopAbout.js';

function currentLocale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

/** A titled card with a tinted icon tile, matching the shared About page cards. */
function SectionCard(props: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Card padded={false}>
      <CardHeader className="flex items-start gap-3">
        <IconTile tone="accent" size="md" icon={props.icon} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-section text-fg">{props.title}</h2>
          {props.description === undefined ? null : (
            <p className="text-body-sm text-fg-muted">{props.description}</p>
          )}
        </div>
      </CardHeader>
      <CardBody>{props.children}</CardBody>
    </Card>
  );
}

// ─── System / versions (§13) ─────────────────────────────────────────────────

function SystemCard({ about }: { about: AboutData }): ReactNode {
  const versions = desktopVersions();
  const { data: runtime } = useQuery(desktopRuntimeQuery());

  const items = [
    { label: t('about.desktop.appVersion', 'App version'), value: versions?.app ?? '—', mono: true },
    { label: t('about.desktop.serverVersion', 'Server version'), value: about.version, mono: true },
    {
      label: t('about.desktop.migration', 'Meta-store migration'),
      value: about.metaMigrationVersion ?? t('about.desktop.unknown', 'Unknown'),
      mono: true,
    },
    { label: t('about.desktop.electron', 'Electron'), value: versions?.electron ?? '—', mono: true },
    { label: t('about.desktop.chromium', 'Chromium'), value: versions?.chrome ?? '—', mono: true },
    { label: t('about.desktop.runtimeNode', 'Node runtime'), value: versions?.node ?? '—', mono: true },
  ];

  return (
    <SectionCard icon={<Cpu />} title={t('about.desktop.system.title', 'System')}>
      <div className="flex flex-col gap-4">
        <KeyValueList items={items} />

        {/* Data directory — click to reveal in the OS file manager (§13). */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body-sm text-fg-muted">
              {t('about.desktop.dataDir', 'Data directory')}
            </span>
            <span className="truncate font-mono text-body-sm text-fg" title={runtime?.dataDir ?? ''}>
              {runtime?.dataDir ?? '—'}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={runtime === null || runtime === undefined}
            onClick={() => {
              if (runtime?.dataDir !== undefined) void revealPath(runtime.dataDir);
            }}
            className="shrink-0"
          >
            <FolderOpen className="size-3.5" aria-hidden="true" />
            {t('about.desktop.reveal', 'Show in folder')}
          </Button>
        </div>

        {/* Secret storage mode + the §2.2-3 plaintext WARN banner. */}
        {runtime?.secretStorage === 'plain' ? (
          <Banner tone="warn" data-testid="about-secret-plain-warning">
            {t(
              'about.desktop.secret.plainWarning',
              'This computer has no system keychain available, so your Adminium secret is stored unencrypted on disk. Anyone who can read this machine’s files can read it. Set up a login keychain (or a Linux secret service) and restart Adminium to protect it.',
            )}
          </Banner>
        ) : (
          <KeyValueList
            items={[
              {
                label: t('about.desktop.secret.title', 'Secret storage'),
                value:
                  runtime?.secretStorage === undefined
                    ? '—'
                    : t('about.desktop.secret.safe', 'Encrypted by your operating system'),
              },
            ]}
          />
        )}
      </div>
    </SectionCard>
  );
}

// ─── Updates (§11 / §13) ─────────────────────────────────────────────────────

function updateModeLabel(mode: string | undefined): string {
  switch (mode) {
    case 'notify':
      return t('about.desktop.updates.mode.notify', 'Notify me about new versions');
    case 'manual':
      return t('about.desktop.updates.mode.manual', 'Only when I check');
    case 'disabled':
      return t('about.desktop.updates.mode.disabled', 'Off (air-gapped)');
    default:
      return t('about.desktop.unknown', 'Unknown');
  }
}

function UpdatesCard(): ReactNode {
  const { data: runtime } = useQuery(desktopRuntimeQuery());
  const [outcome, setOutcome] = useState<DesktopUpdateOutcome | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  // §11's event-driven flow: the About card is the SPA surface that turns a
  // broadcast `available`/`progress`/`downloaded` into the Download → progress →
  // Restart controls. Before this, `onUpdateEvent` had no subscriber and
  // `downloadUpdate`/`quitAndInstall` had no caller anywhere in the SPA.
  const flow = useDesktopUpdateFlow();
  const check = useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (result) => {
      setLastChecked(new Date());
      // A discovered update hands off to the flow so the Download control
      // appears (the autoUpdater also emits `available`, so this is idempotent);
      // everything else is a one-line status the flow does not own.
      if (result.status === 'available') {
        flow.markAvailable(result.version);
        setOutcome(null);
      } else {
        setOutcome(result);
      }
    },
  });

  const mode = runtime?.updates.mode;
  const disabled = mode === 'disabled';

  return (
    <SectionCard
      icon={<RefreshCw />}
      title={t('about.desktop.updates.title', 'Updates')}
      description={updateModeLabel(mode)}
    >
      {disabled ? (
        <p className="text-body-sm text-fg-muted" data-testid="about-updates-disabled">
          {t(
            'about.desktop.updates.disabledBody',
            'Automatic updates are off (air-gapped). Install new versions manually.',
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={check.isPending || runtime === undefined}
              onClick={() => check.mutate()}
            >
              {check.isPending ? (
                <Spinner size="sm" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              {check.isPending
                ? t('about.desktop.updates.checking', 'Checking…')
                : t('about.desktop.updates.check', 'Check for updates')}
            </Button>
            {lastChecked === null ? null : (
              <span className="text-body-sm text-fg-muted" data-testid="about-updates-last-checked">
                {t('about.desktop.updates.lastChecked', 'Last checked {when}', {
                  when: lastChecked.toLocaleString(),
                })}
              </span>
            )}
          </div>
          {/* The event-driven flow owns availability/download/install; the
              inline outcome line only speaks for `none`/`error`/`unavailable`,
              which the flow never enters. */}
          {flow.phase === 'idle' ? (
            outcome === null ? null : <UpdateOutcomeLine outcome={outcome} />
          ) : (
            <UpdateFlowLine flow={flow} />
          )}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * §11's in-app download/install controls: the availability → Download → progress
 * → Restart lifecycle the acceptance criterion names ("downloads only on user
 * action, and installs on restart").
 */
function UpdateFlowLine({ flow }: { flow: DesktopUpdateFlow }): ReactNode {
  switch (flow.phase) {
    case 'available':
      return (
        <div
          className="flex flex-wrap items-center gap-3"
          data-testid="about-updates-available"
        >
          <span className="text-body-sm text-fg">
            {t('about.desktop.updates.available', 'Version {version} is available', {
              version: flow.version ?? '',
            })}
          </span>
          <Button type="button" variant="primary" size="md" onClick={flow.download}>
            <Download className="size-3.5" aria-hidden="true" />
            {t('about.desktop.updates.download', 'Download update')}
          </Button>
        </div>
      );
    case 'downloading':
      return (
        <p
          className="flex items-center gap-2 text-body-sm text-fg-muted"
          data-testid="about-updates-downloading"
        >
          <Spinner size="sm" />
          {t('about.desktop.updates.downloading', 'Downloading… {percent}%', {
            percent: String(flow.percent),
          })}
        </p>
      );
    case 'downloaded':
      return (
        <div
          className="flex flex-wrap items-center gap-3"
          data-testid="about-updates-downloaded"
        >
          <span className="flex items-center gap-2 text-body-sm text-fg">
            <Check className="size-4 text-pos" aria-hidden="true" />
            {t('about.desktop.updates.downloaded', 'Version {version} is ready to install', {
              version: flow.version ?? '',
            })}
          </span>
          <Button type="button" variant="primary" size="md" onClick={flow.install}>
            <RotateCw className="size-3.5" aria-hidden="true" />
            {t('about.desktop.updates.restart', 'Restart to install')}
          </Button>
        </div>
      );
    case 'error':
      return (
        <div className="flex flex-wrap items-center gap-3" data-testid="about-updates-download-error">
          <span className="text-body-sm text-warn">
            {t('about.desktop.updates.downloadError', 'The download did not finish. You can try again.')}
          </span>
          <Button type="button" variant="outline" size="md" onClick={flow.download}>
            <Download className="size-3.5" aria-hidden="true" />
            {t('about.desktop.updates.download', 'Download update')}
          </Button>
        </div>
      );
    case 'idle':
      return null;
  }
}

function UpdateOutcomeLine({ outcome }: { outcome: DesktopUpdateOutcome }): ReactNode {
  switch (outcome.status) {
    case 'available':
      // Availability is now owned by `UpdateFlowLine` (the card hands `available`
      // off to the flow so a Download control appears); kept exhaustive so the
      // union stays fully handled, but this branch is not reached from the card.
      return (
        <p className="flex items-center gap-2 text-body-sm text-fg" data-testid="about-updates-available">
          {t('about.desktop.updates.available', 'Version {version} is available', {
            version: outcome.version ?? '',
          })}
        </p>
      );
    case 'none':
      return (
        <p className="flex items-center gap-2 text-body-sm text-fg-muted" data-testid="about-updates-none">
          <Check className="size-4 text-pos" aria-hidden="true" />
          {t('about.desktop.updates.none', 'You are on the latest version.')}
        </p>
      );
    case 'unavailable':
      return (
        <p className="text-body-sm text-fg-muted" data-testid="about-updates-unavailable">
          {t('about.desktop.updates.unavailable', 'Updates are turned off in this installation.')}
        </p>
      );
    case 'error':
      return (
        <p className="text-body-sm text-warn" data-testid="about-updates-error">
          {t('about.desktop.updates.error', 'Could not check for updates.')}
        </p>
      );
  }
}

// ─── Legal / licences (§13) ──────────────────────────────────────────────────

function BundledTextModal(props: {
  kind: 'license' | 'third-party-notices';
  triggerLabel: string;
  title: string;
  icon: ReactNode;
  unavailable: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['about', 'bundled-text', props.kind],
    queryFn: () => readBundledText(props.kind),
    enabled: open,
    staleTime: Infinity,
  });

  return (
    <Modal open={open} onOpenChange={setOpen} size="lg">
      <ModalTrigger asChild>
        <Button type="button" variant="outline" size="md">
          {props.icon}
          {props.triggerLabel}
        </Button>
      </ModalTrigger>
      <ModalHeader
        icon={props.icon}
        title={props.title}
        closeLabel={t('about.desktop.legal.close', 'Close')}
      />
      <ModalBody>
        {query.isFetching ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : query.data === null || query.data === undefined ? (
          <p className="text-body-sm text-fg-muted">{props.unavailable}</p>
        ) : (
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words font-mono text-body-sm text-fg-muted">
            {query.data}
          </pre>
        )}
      </ModalBody>
      <ModalFooter>
        <ModalClose asChild>
          <Button type="button" variant="secondary" size="md">
            {t('about.desktop.legal.close', 'Close')}
          </Button>
        </ModalClose>
      </ModalFooter>
    </Modal>
  );
}

function LegalCard({ about }: { about: AboutData }): ReactNode {
  return (
    <SectionCard icon={<Scale />} title={t('about.desktop.legal.title', 'Licences')}>
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-fg-muted">
          {t(
            'about.desktop.legal.agpl',
            'Adminium Desktop is free software under the GNU Affero General Public License v3.0.',
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <BundledTextModal
            kind="license"
            icon={<FileText className="size-3.5" aria-hidden="true" />}
            triggerLabel={t('about.desktop.legal.viewLicense', 'View licence')}
            title={t('about.desktop.legal.licenseTitle', 'GNU Affero General Public License v3.0')}
            unavailable={t(
              'about.desktop.legal.licenseUnavailable',
              'The bundled licence file is not available in this build.',
            )}
          />
          <BundledTextModal
            kind="third-party-notices"
            icon={<ScrollText className="size-3.5" aria-hidden="true" />}
            triggerLabel={t('about.desktop.legal.viewNotices', 'Third-party licences')}
            title={t('about.desktop.legal.noticesTitle', 'Third-party notices')}
            unavailable={t(
              'about.desktop.legal.noticesUnavailable',
              'Third-party notices are generated when the app is packaged and are not available in this build.',
            )}
          />
          {/* The source link opens the system browser (§2.4 nav lockdown). */}
          <Button asChild variant="outline" size="md">
            <a href={about.sourceUrl} target="_blank" rel="noreferrer noopener">
              {t('about.desktop.legal.source', 'Source code')}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Telemetry (§13) ─────────────────────────────────────────────────────────

function TelemetryCard({ about }: { about: AboutData }): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const save = useMutation({
    mutationFn: setTelemetry,
    onSuccess: () => {
      // The honest source is the value we just wrote; refetch About rather than
      // guess, mirroring the desktop settings panel's stance on config writes.
      void queryClient.invalidateQueries({ queryKey: ['about'] });
    },
    onError: () => {
      toasts.push({
        variant: 'error',
        title: t('about.desktop.telemetry.saveFailed', 'Could not save that setting. Try again.'),
      });
    },
  });

  const descriptionId = 'about-telemetry-description';
  return (
    <SectionCard icon={<BarChart3 />} title={t('about.desktop.telemetry.title', 'Anonymous usage data')}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor="about-telemetry" className="text-body font-semibold text-fg">
            {t('about.desktop.telemetry.label', 'Share anonymous usage data')}
          </Label>
          <p id={descriptionId} className="text-body-sm text-fg-muted">
            {t(
              'about.desktop.telemetry.description',
              'Helps us decide which database engines to prioritise. Off unless you turn it on; no schema, data, or personal information is ever sent.',
            )}
          </p>
        </div>
        <Switch
          id="about-telemetry"
          checked={about.telemetry.enabled}
          disabled={save.isPending}
          aria-describedby={descriptionId}
          onCheckedChange={(telemetry) => {
            // A full write of both consents — the update-check preference rides
            // along unchanged (see `setTelemetry`).
            save.mutate({ telemetry, updateCheck: about.updates.checkEnabled });
          }}
          className="mt-0.5 shrink-0"
        />
      </div>
    </SectionCard>
  );
}

// ─── Diagnostics (§13) ───────────────────────────────────────────────────────

function DiagnosticsCard({ about }: { about: AboutData }): ReactNode {
  const { data: runtime } = useQuery(desktopRuntimeQuery());
  const sizeQuery = useQuery({
    queryKey: ['about', 'data-dir-bytes'],
    queryFn: dataDirBytes,
    staleTime: 60_000,
  });
  const versions = desktopVersions();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = (): void => {
    const text = buildDiagnostics({
      appVersion: versions?.app,
      serverVersion: about.version,
      metaMigrationVersion: about.metaMigrationVersion,
      electron: versions?.electron,
      chromium: versions?.chrome,
      node: versions?.node,
      platform: desktopPlatform(),
      dataDirBytes: sizeQuery.data ?? null,
      secretStorage: runtime?.secretStorage,
      updateMode: runtime?.updates.mode,
      locale: currentLocale(),
    });
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <SectionCard
      icon={<Stethoscope />}
      title={t('about.desktop.diagnostics.title', 'Diagnostics')}
      description={t(
        'about.desktop.diagnostics.description',
        'Details that help when you report a problem. No schema or data is included.',
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="md" onClick={onCopy} data-copied={copied ? '' : undefined}>
            {copied ? <Check className="size-3.5 text-pos" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied
              ? t('about.desktop.diagnostics.copied', 'Copied')
              : t('about.desktop.diagnostics.copy', 'Copy diagnostic info')}
          </Button>
          <Button type="button" variant="outline" size="md" onClick={() => void showLogs()}>
            {t('about.desktop.diagnostics.showLogs', 'Show logs')}
          </Button>
        </div>
        {sizeQuery.data === null || sizeQuery.data === undefined ? null : (
          <span className="text-body-sm text-fg-muted" data-testid="about-data-size">
            {t('about.desktop.diagnostics.dataSize', 'Data size: {size}', {
              size: formatBytes(sizeQuery.data),
            })}
          </span>
        )}
      </div>
    </SectionCard>
  );
}

// ─── The desktop sections ────────────────────────────────────────────────────

export function DesktopAboutSections({ about }: { about: AboutData }): ReactNode {
  return (
    <>
      <SystemCard about={about} />
      <UpdatesCard />
      <LegalCard about={about} />
      <TelemetryCard about={about} />
      <DiagnosticsCard about={about} />
    </>
  );
}
