// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The installed-apps list, ported from `Marketplace.dc.html`'s manage
 * screen.
 *
 * The comp's row: app tile, name, version pill, "category · installed <when>",
 * an open link, and Uninstall.
 *
 * The CATEGORY comes from the app catalogue reply this card already reads for
 * its update pills — it is the installed package's own manifest, so a bundled
 * or uploaded app has one too, not only a listed one.
 *
 * ─── Updates (b G8-D6/D7) ───────────────────────────────────────────────────
 *
 * The comp's update elements now have a source: the header's "N updates
 * available" pill, the row's "Update to vX" pill beside the version, and the
 * Update button before Uninstall. All three read `updateTo` from the app catalog
 * reply, which counts a newer version already on disk AND one the online
 * catalog offers; the page downloads first when it has to.
 *
 *  **D11 — no "View in marketplace" link.** Only apps listed on adminium.dev
 *  have a page there. A bundled or uploaded app of the operator's own would
 *  get a link to nothing, and the page cannot tell the two apart from the list.
 *
 *  **D12 — a newer release this server cannot take is named, not offered.** The
 *  comp has no such state. Silently offering nothing would leave an operator
 *  who read about v2 wondering why; the sub-line says which Adminium it needs.
 *
 * A STAGED row is not in the comp, and it is here because the server can
 * produce one: an upload interrupted between staging and install leaves bytes
 * on disk that no row accounts for. Without a line for it the operator has an
 * invisible, undeletable package and their next upload of that key silently
 * replaces it.
 */
import { useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  IconTile,
  MonoText,
} from '@adminium/ui';
import { ArrowUp, ArrowUpCircle, Download, Package, Trash2, TriangleAlert, Wand2 } from 'lucide-react';
import { getFormatters } from '@adminium/i18n';

import { getI18nInstance, t } from '../../i18n/t.js';
import {
  APP_CATALOG_QUERY_KEY,
  APPS_QUERY_KEY,
  appCatalogQuery,
  discardStagedApp,
  installedAppsQuery,
  type CatalogApp,
  type InstalledApp,
} from './appsApi.js';
import { RenameTablesDialog } from './RenameTablesDialog.js';
import { UninstallAppDialog } from './UninstallAppDialog.js';

export interface InstalledAppsCardProps {
  onInstall: () => void;
  /**
   * Update this app to `row.updateTo`. The page downloads it first when it is
   * not on disk, shows the tables a new version would create, then updates.
   */
  onUpdate: (app: InstalledApp, row: CatalogApp) => void;
  /** A download or update is in flight. */
  busy?: boolean;
}

export function InstalledAppsCard({ onInstall, onUpdate, busy = false }: InstalledAppsCardProps) {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(installedAppsQuery());
  // The same reply the shelf reads, so the two cannot disagree about an update.
  const { data: catalog } = useSuspenseQuery(appCatalogQuery());
  const rowByKey = new Map(
    catalog.apps.filter((row) => row.installed).map((row) => [row.key, row] as const),
  );
  const updateCount = data.apps.filter((app) => rowByKey.get(app.key)?.updateTo != null).length;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamed, setRenamed] = useState<string | null>(null);
  const renamingApp = data.apps.find((app) => app.key === renaming);

  const discard = useMutation({
    mutationFn: (staged: { key: string; version: string }) =>
      discardStagedApp(staged.key, staged.version),
    onSuccess: async () => {
      // The shelf lists what is on disk too, and this package no longer is.
      await queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: APP_CATALOG_QUERY_KEY });
    },
  });


  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <span className="text-sm font-bold tracking-tight">
          {t('studio:hostedApps.installed.title', 'Installed apps')}
        </span>
        <MonoText className="text-xs text-fg-subtle">{data.apps.length}</MonoText>
        {updateCount === 0 ? null : (
          <Badge tone="warn" className="ms-auto">
            <ArrowUpCircle aria-hidden className="size-3.5" />
            {t(
              'studio:hostedApps.installed.updatesAvailable',
              '{count, plural, one {# update available} other {# updates available}}',
              { count: updateCount },
            )}
          </Badge>
        )}
        <Button className={updateCount === 0 ? 'ms-auto' : undefined} size="sm" onClick={onInstall}>
          {t('studio:hostedApps.installed.install', 'Install an app')}
        </Button>
      </CardHeader>

      <CardBody className="flex flex-col gap-3">
        {renamed === null ? null : (
          <Alert
            tone="pos"
            title={t('studio:hostedApps.installed.renamed', 'Tables renamed to {prefix}…', { prefix: renamed })}
          />
        )}
        {data.apps.length === 0 ? (
          <EmptyState
            title={t('studio:hostedApps.installed.emptyTitle', 'No apps installed yet')}
            body={t(
              'studio:hostedApps.installed.emptyBody',
              'Upload a built surface bundle to install one. Apps installed here are served immediately — no restart, unlike a directory you point at.',
            )}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {data.apps.map((app) => {
              const row = rowByKey.get(app.key);
              const updateTo = row?.updateTo ?? null;
              const blocked = row?.needsNewerAdminium ?? null;
              const cannotUpdate = row?.cannotUpdate ?? null;
              // The comp's sub-line leads with it; the manifest's own word, so
              // it is data rather than a key (the shelf card's badge is the same).
              const category = row?.categories[0] ?? null;
              return (
              <li key={app.key} className="flex items-center gap-4">
                <IconTile>
                  <Package aria-hidden className="size-5" />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The app's own page: its switches, settings, data and danger zone. */}
                    <Link
                      to="/studio/apps/$key"
                      params={{ key: app.key }}
                      className="text-sm font-bold tracking-tight underline-offset-2 hover:underline"
                    >
                      {app.key}
                    </Link>
                    <Badge>
                      <MonoText>{app.version}</MonoText>
                    </Badge>
                    {updateTo === null ? null : (
                      <Badge tone="warn">
                        <ArrowUp aria-hidden className="size-3" />
                        {t('studio:hostedApps.installed.updateTo', 'Update to v{version}', {
                          version: updateTo,
                        })}
                      </Badge>
                    )}
                    {/* The row used to read exactly like a healthy
                        install, because a lost app's only tell is an empty
                        `sides` — which also means "no frontends". */}
                    {app.missing && (
                      <Badge tone="danger">
                        {t('studio:hostedApps.installed.missing', 'Missing')}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                    {category === null ? null : (
                      <span className="flex items-center gap-2">
                        {category}
                        <span aria-hidden>·</span>
                      </span>
                    )}
                    {/* G2: the comp's sub-line carries this and the DTO always had it. */}
                    <span>
                      {t('studio:hostedApps.installed.installedAt', 'installed {when}', {
                        when: getFormatters(getI18nInstance()?.language ?? 'en-US').relative(
                          app.installedAt,
                        ),
                      })}
                    </span>
                    {app.sides.map((side) => (
                      // G3: the same dotted-underline mount link the Surfaces
                      // card on this page already renders.
                      <a
                        key={side.side}
                        className="underline decoration-dotted underline-offset-2"
                        href={`${side.prefix}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MonoText>{side.prefix}/</MonoText>
                      </a>
                    ))}
                    {blocked === null ? null : (
                      <span className="text-warn">
                        {t(
                          'studio:hostedApps.installed.needsNewer',
                          'v{version} needs Adminium {minimum} or later',
                          { version: blocked.version, minimum: blocked.minAdminiumVersion },
                        )}
                      </span>
                    )}
                    {cannotUpdate === null ? null : (
                      <span className="text-warn">
                        {t(
                          'studio:hostedApps.installed.cannotUpdate',
                          'v{version} cannot update this version in place. Uninstall it first, then install v{version}.',
                          { version: cannotUpdate.version },
                        )}
                      </span>
                    )}
                    {app.missing && (
                      <span className="text-danger">
                        {t(
                          'studio:hostedApps.installed.missingBody',
                          'Its files are not on this server, so it is not served. Install the same version again, or uninstall it.',
                        )}
                      </span>
                    )}
                  </div>
                  {/* An install made before its app was prefixed: the offer to
                      give every table the prefix. */}
                  {app.oldTableNames === undefined ? null : (
                    <div
                      data-part="old-table-names"
                      className="mt-2 flex flex-wrap items-center gap-2.5 rounded-[10px] border border-warn/30 bg-warn-soft px-3 py-2"
                    >
                      <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn" />
                      <span className="min-w-0 flex-1 text-xs">
                        <span className="font-bold text-fg">
                          {t('studio:hostedApps.installed.oldNames', 'This install uses the old table names.')}
                        </span>{' '}
                        <span className="text-fg-muted">
                          {t('studio:hostedApps.installed.oldNamesWhy', 'They were made before prefixes.')}
                        </span>
                      </span>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRenaming(app.key)}>
                        <Wand2 aria-hidden className="size-4" />
                        {t('studio:hostedApps.installed.renameTo', 'Rename to {prefix}…', {
                          prefix: app.oldTableNames.prefix,
                        })}
                      </Button>
                    </div>
                  )}
                </div>
                {updateTo === null || row === undefined ? null : (
                  <Button size="sm" disabled={busy} onClick={() => onUpdate(app, row)}>
                    <Download aria-hidden className="size-4" />
                    {t('studio:hostedApps.installed.update', 'Update')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirming(app.key)}
                  disabled={busy}
                >
                  <Trash2 aria-hidden className="size-4" />
                  {t('studio:hostedApps.installed.uninstall', 'Uninstall')}
                </Button>
              </li>
              );
            })}
          </ul>
        )}

        {data.staged.length === 0 ? null : (
          /*
           * Bundles uploaded and never installed — abandoned at the connection
           * step, refused at the plan step, or thought better of. They are shown
           * because they are on disk and the operator is the only person who can
           * decide what happens to them, and each one can be discarded, because
           * "upload it again to replace it" asks someone to perform the thing
           * they decided against in order to undo it.
           */
          <div className="flex flex-col gap-2 rounded-xl bg-surface-3 px-4 py-3">
            <span className="text-sm font-bold">
              {t('studio:hostedApps.installed.stagedTitle', 'Uploaded but not installed')}
            </span>
            <span className="text-sm text-fg-muted">
              {t(
                'studio:hostedApps.installed.stagedHint',
                'Discard one you decided against, or upload the same key again to replace it.',
              )}
            </span>
            {discard.error === null ? null : (
              <Alert
                role="alert"
                tone="danger"
                data-testid="staged-discard-error"
                title={t('studio:hostedApps.installed.discardFailed', 'The upload was not discarded')}
                body={discard.error.message}
              />
            )}
            <ul className="flex flex-col gap-1">
              {data.staged.map((staged) => (
                <li key={`${staged.key}@${staged.version}`} className="flex items-center gap-3">
                  <MonoText className="flex-1 truncate text-sm">
                    {staged.key}@{staged.version}
                  </MonoText>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={discard.isPending}
                    onClick={() => discard.mutate(staged)}
                  >
                    {t('studio:hostedApps.installed.discard', 'Discard')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>

      {renamingApp?.oldTableNames === undefined ? null : (
        <RenameTablesDialog
          app={{ ...renamingApp, oldTableNames: renamingApp.oldTableNames }}
          onClose={() => setRenaming(null)}
          onRenamed={(prefix) => {
            setRenaming(null);
            setRenamed(prefix);
          }}
        />
      )}

      {confirming === null ? null : (
        <UninstallAppDialog
          appKey={confirming}
          name={rowByKey.get(confirming)?.name ?? confirming}
          onClose={() => setConfirming(null)}
          onUninstalled={() => setConfirming(null)}
        />
      )}
    </Card>
  );
}
