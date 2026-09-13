// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The installed-apps list, ported from `Marketplace.dc.html`'s manage screen
 * (47-app-installation.md step 3).
 *
 * The comp's row: app tile, name, version pill, "category · installed <when>",
 * an open link, and Uninstall. What this one drops is drawn from capabilities
 * that do not exist yet rather than from taste — the update badge and the
 * "View in marketplace" link both need the feed (47 O1), and an app has no
 * category to show without one either.
 *
 * A STAGED row is not in the comp, and it is here because the server can
 * produce one: an upload interrupted between staging and install leaves bytes
 * on disk that no row accounts for. Without a line for it the operator has an
 * invisible, undeletable package and their next upload of that key silently
 * replaces it.
 */
import { useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmModal,
  EmptyState,
  IconTile,
  MonoText,
} from '@adminium/ui';
import { Package, Trash2 } from 'lucide-react';
import { getFormatters } from '@adminium/i18n';

import { getI18nInstance, t } from '../../i18n/t.js';
import {
  APPS_QUERY_KEY,
  discardStagedApp,
  installedAppsQuery,
  uninstallApp,
} from './appsApi.js';
import { SURFACES_QUERY_KEY } from './hostedAppsApi.js';

export interface InstalledAppsCardProps {
  onInstall: () => void;
}

export function InstalledAppsCard({ onInstall }: InstalledAppsCardProps) {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(installedAppsQuery());
  const [confirming, setConfirming] = useState<string | null>(null);

  const discard = useMutation({
    mutationFn: (staged: { key: string; version: string }) =>
      discardStagedApp(staged.key, staged.version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
    },
  });

  const remove = useMutation({
    mutationFn: (key: string) => uninstallApp(key),
    onSuccess: async () => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: SURFACES_QUERY_KEY });
    },
  });

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <span className="text-sm font-bold tracking-tight">
          {t('studio:hostedApps.installed.title', 'Installed apps')}
        </span>
        <MonoText className="text-xs text-fg-subtle">{data.apps.length}</MonoText>
        <Button className="ms-auto" size="sm" onClick={onInstall}>
          {t('studio:hostedApps.installed.install', 'Install an app')}
        </Button>
      </CardHeader>

      <CardBody className="flex flex-col gap-3">
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
            {data.apps.map((app) => (
              <li key={app.key} className="flex items-center gap-4">
                <IconTile>
                  <Package aria-hidden className="size-5" />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold tracking-tight">{app.key}</span>
                    <Badge>
                      <MonoText>{app.version}</MonoText>
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
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
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirming(app.key)}
                  disabled={remove.isPending}
                >
                  <Trash2 aria-hidden className="size-4" />
                  {t('studio:hostedApps.installed.uninstall', 'Uninstall')}
                </Button>
              </li>
            ))}
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

      <ConfirmModal
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={t('studio:hostedApps.installed.confirmTitle', 'Uninstall this app?')}
        /*
         * The tables are NOT mentioned as being removed, because they are not.
         * Uninstall drops the bundle and the record; what an install created in
         * the operator's own database stays theirs — 24 D16 / 26 D5, disabling
         * never destroys data.
         */
        body={t(
          'studio:hostedApps.installed.confirmBody',
          'Its surfaces stop being served and the bundle is deleted. Any tables it created in your database are left alone.',
        )}
        /*
         * D6 — the comp's Uninstall button has no confirm at all. The house
         * component for removing something irreversibly asks for the name back,
         * and taking an app offline is that: its surfaces stop answering for
         * everyone the moment this runs.
         */
        confirmWord={confirming ?? ''}
        promptLabel={t('studio:hostedApps.installed.confirmPrompt', 'Type {key} to confirm', {
          key: confirming ?? '',
        })}
        confirmLabel={t('studio:hostedApps.installed.uninstall', 'Uninstall')}
        cancelLabel={t('studio:hostedApps.installed.confirmCancel', 'Cancel')}
        closeLabel={t('studio:hostedApps.installed.confirmClose', 'Close')}
        busy={remove.isPending}
        onConfirm={() => {
          if (confirming !== null) remove.mutate(confirming);
        }}
      />
    </Card>
  );
}
