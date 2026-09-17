// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Getting apps from the online app catalog, in Studio (b G8-D7): the switch,
 * "Check for newer", install-from-catalog and Update.
 *
 * One hook for the page, because the four share everything that makes them
 * awkward: each may start a JOB that has to be followed to the end, each can
 * fail in the server's own words, and the progress, veto and result belong at
 * the page rather than inside a button.
 *
 * WHERE THE ANSWER APPEARS. Beside the card whose action started it: above the
 * shelf for the switch, "Check for newer" and installing, above the installed
 * list for Update. On a page with a long shelf, an Update failure written at
 * the top would be off-screen from the button that caused it, so a failure or a
 * result also scrolls itself into view when it is not already there.
 *
 * ── UPDATE ASKS BEFORE IT CREATES A TABLE ──────────────────────────────────
 *
 * The comp's Update button applies at once. It still does whenever the new
 * version needs nothing new in the database. When it DOES need new tables, the
 * page shows them first, for the reason the install wizard has a plan step at
 * all: an operator sees what will be created in their database before it is
 * created. The plan comes from `POST /apps/plan` against the connection the app
 * already uses, which is where the update creates them. A version the plan
 * refuses is sent anyway, so the refusal on the page is the server's.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, MonoText } from '@adminium/ui';
import { ArrowUpCircle } from 'lucide-react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import {
  APP_CATALOG_QUERY_KEY,
  APPS_QUERY_KEY,
  ddlPreview,
  downloadApp,
  followAppJob,
  planApp,
  refreshAppCatalog,
  setAppCatalogEnabled,
  updateApp,
  type AppInstallPlan,
  type CatalogApp,
  type InstalledApp,
} from './appsApi.js';
import { SURFACES_QUERY_KEY } from './hostedAppsApi.js';

/** Which card an action belongs to, so its answer renders beside it. */
export type AcquisitionOrigin = 'shelf' | 'installed';

/** Bring a failure or result into view when it lands off-screen; a no-op where it is already visible. */
function revealOnMount(node: HTMLDivElement | null): void {
  node?.scrollIntoView?.({ block: 'nearest' });
}

/** What the wizard is opened on once a catalog app is on disk. */
export interface DownloadedApp {
  key: string;
  version: string;
  name: string;
  downloaded: true;
}

interface UpdateConsent {
  key: string;
  to: string;
  plan: AppInstallPlan;
}

/** A thrown request as one sentence, naming the tables when an update is short of columns. */
function messageOf(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (caught instanceof ApiError) {
    const details = caught.details as
      | { reason?: unknown; tables?: { ref: string; missingColumns: string[] }[] }
      | undefined;
    if (details?.reason === 'COLUMNS_REQUIRED' && Array.isArray(details.tables)) {
      const tables = details.tables
        .map((table) => `${table.ref} (${table.missingColumns.join(', ')})`)
        .join('; ');
      return `${message} ${t('studio:hostedApps.update.missingColumns', 'Missing: {tables}.', { tables })}`;
    }
  }
  return message;
}

export function useAppAcquisition() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ title: string; pct: number; message: string | null } | null>(
    null,
  );
  const [vetoed, setVetoed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [consent, setConsent] = useState<UpdateConsent | null>(null);
  const [origin, setOrigin] = useState<AcquisitionOrigin>('shelf');

  /** Everything a download, refresh or update can change. */
  const refreshLists = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: APP_CATALOG_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: SURFACES_QUERY_KEY }),
    ]);
  };

  /** One place a thrown request becomes page state. The lists are re-read either way. */
  const attempt = async (work: () => Promise<void>, from: AcquisitionOrigin): Promise<void> => {
    setOrigin(from);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setProgress(null);
      setBusy(false);
      await refreshLists();
    }
  };

  /** Start a job and follow it to the end, showing its progress under `title`. */
  const follow = async (start: () => Promise<{ jobId: string }>, title: string): Promise<void> => {
    setProgress({ title, pct: 0, message: null });
    const { jobId } = await start();
    await followAppJob(jobId, {
      onProgress: (next) => setProgress({ title, ...next }),
      failed: t(
        'studio:hostedApps.job.failed',
        'The job did not finish. Nothing was installed or changed.',
      ),
    });
  };

  const applyUpdate = async (key: string): Promise<void> => {
    const result = await updateApp(key);
    setNotice(
      t('studio:hostedApps.update.done', '{app} updated to v{version}', {
        app: key,
        version: result.to,
      }),
    );
  };

  return {
    busy,
    error,
    progress,
    vetoed,
    notice,
    consent,
    origin,

    toggleOnline: (next: boolean): Promise<void> =>
      attempt(async () => {
        const state = await setAppCatalogEnabled(next);
        setVetoed(state.vetoed);
      }, 'shelf'),

    refreshCatalog: (): Promise<void> =>
      attempt(() =>
        follow(
          refreshAppCatalog,
          t('studio:hostedApps.job.refreshTitle', 'Checking the online app catalogue'),
        ),
        'shelf',
      ),

    /** Download a catalog-only app, then hand it to `open` for the install wizard. */
    installFromCatalog: (app: CatalogApp, open: (downloaded: DownloadedApp) => void): Promise<void> =>
      attempt(async () => {
        await follow(
          () => downloadApp(app.key, app.version),
          t('studio:hostedApps.job.downloadTitle', 'Downloading {app}', { app: app.name }),
        );
        await refreshLists();
        open({ key: app.key, version: app.version, name: app.name, downloaded: true });
      }, 'shelf'),

    update: (app: InstalledApp, row: CatalogApp): Promise<void> =>
      attempt(async () => {
        const to = row.updateTo;
        if (to === null) return;
        if (!row.updateStaged) {
          await follow(
            () => downloadApp(app.key, to),
            t('studio:hostedApps.job.downloadTitle', 'Downloading {app}', { app: app.key }),
          );
        }
        if (app.connectionId !== null) {
          const { plan } = await planApp({ key: app.key, version: to, connectionId: app.connectionId });
          const refused =
            !plan.installable || plan.reuse.some((table) => table.missingColumns.length > 0);
          if (!refused && plan.create.length > 0) {
            setConsent({ key: app.key, to, plan });
            return;
          }
        }
        await applyUpdate(app.key);
      }, 'installed'),

    confirmUpdate: (): Promise<void> => {
      const pending = consent;
      setConsent(null);
      if (pending === null) return Promise.resolve();
      return attempt(() => applyUpdate(pending.key), 'installed');
    },

    /** The downloaded version stays on disk, and the list keeps offering it. */
    cancelUpdate: (): void => setConsent(null),
  };
}

export type AppAcquisition = ReturnType<typeof useAppAcquisition>;

/**
 * What failed, what the environment vetoed, what is running and what finished,
 * for the actions that started at `origin`. The veto belongs to the switch, so
 * it always renders with the shelf.
 */
export function AppAcquisitionAlerts({
  state,
  origin,
}: {
  state: AppAcquisition;
  origin: AcquisitionOrigin;
}) {
  const mine = state.origin === origin;
  return (
    <>
      {!mine || state.error === null ? null : (
        <Alert
          ref={revealOnMount}
          tone="danger"
          title={t('studio:hostedApps.error', 'Something went wrong')}
        >
          {state.error}
        </Alert>
      )}
      {origin === 'shelf' && state.vetoed ? (
        <Alert
          tone="warn"
          title={t('studio:hostedApps.veto.title', 'This deployment cannot browse online')}
        >
          {t(
            'studio:hostedApps.veto.body',
            'The setting is saved, but network features are off for this server and that wins. Installed apps keep working, and you can still upload one yourself.',
          )}
        </Alert>
      ) : null}
      {!mine || state.progress === null ? null : (
        <Alert tone="info" title={state.progress.title}>
          {state.progress.message ??
            t(
              'studio:hostedApps.job.body',
              'Fetching and verifying. Nothing is installed or changed until you say so.',
            )}{' '}
          <strong>{`${String(Math.round(state.progress.pct))}%`}</strong>
        </Alert>
      )}
      {!mine || state.notice === null ? null : (
        <Alert ref={revealOnMount} tone="pos" title={state.notice} />
      )}
    </>
  );
}

/** The tables an update would create, before it creates them. */
export function UpdateConsentDialog({ state }: { state: AppAcquisition }) {
  const consent = state.consent;
  if (consent === null) return null;
  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) state.cancelUpdate();
      }}
    >
      <ModalHeader
        icon={<ArrowUpCircle />}
        title={t('studio:hostedApps.update.title', 'Update {app} to v{version}', {
          app: consent.key,
          version: consent.to,
        })}
        subtitle={t(
          'studio:hostedApps.update.subtitle',
          'This version needs tables the installed one did not have.',
        )}
        closeLabel={t('studio:hostedApps.update.close', 'Close')}
      />
      <ModalBody>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">
            {t(
              'studio:hostedApps.update.body',
              'They are created in the database this app already uses. Tables that are already there are not changed.',
            )}
          </p>
          {consent.plan.create.map((table) => (
            <div key={table.ref} className="flex flex-col gap-1">
              <MonoText className="text-sm font-bold">{table.ref}</MonoText>
              <pre className="overflow-x-auto rounded-xl bg-fg p-4 text-xs leading-relaxed text-surface">
                <code>{ddlPreview(table)}</code>
              </pre>
            </div>
          ))}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={state.cancelUpdate}>
          {t('studio:hostedApps.update.cancel', 'Cancel')}
        </Button>
        <Button disabled={state.busy} onClick={() => void state.confirmUpdate()}>
          {t('studio:hostedApps.update.confirm', 'Update')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
