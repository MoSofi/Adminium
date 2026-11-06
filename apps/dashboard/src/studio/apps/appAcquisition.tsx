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
 *
 * ── …AND BEFORE IT NEEDS A COLUMN ON A TABLE THAT IS ALREADY THERE ────────
 *
 * An update that needs a new column on an existing table used to go straight
 * to the server and come back `COLUMNS_REQUIRED` — a refusal with no way
 * forward for someone who does not write DDL. The plan now carries
 * those columns as an `addColumns` edit, and the page offers it instead:
 * `UpdateColumnsDialog` shows the exact statement through plan 35's doors,
 * runs it on the operator's click, and only then updates. A column the server
 * cannot type for itself (a foreign key) still falls through to the refusal,
 * which names it.
 *
 * ── …AND BEFORE IT LETS THE APP'S CUSTOMERS DO MORE ────────────────────────
 *
 * A version that adds to the app's public access (an enquiry form its guest
 * key did not reach) shows it on the same check, with the install's own
 * "Allow this public access" card, listing only what is new. The answer goes
 * with the update; unticked, the app's key gains nothing.
 *
 * ── …AND BEFORE ITS ROLES HOLD MORE OF AN ADD-ON'S TABLES ─────────────────
 *
 * A version whose roles would read or change more of an add-on's tables than
 * the running one's (a supplier's address, a row they only read) shows what is
 * new on the same check; Update is the say, and sends it. The server refuses
 * such an update without it.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, MonoText, Spinner } from '@adminium/ui';
import { ArrowUpCircle, RotateCw } from 'lucide-react';

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
  type DocumentsWaiting,
  type InstalledApp,
  type UpdateAnswers,
  type UpdateStoppedDetails,
} from './appsApi.js';
import { DocumentsWaitingNotice } from './DocumentsWaitingNotice.js';
import { SURFACES_QUERY_KEY } from './hostedAppsApi.js';
import { existingTables } from './installReview.js';
import {
  UpdateReviewDialog,
  asksGrants,
  checkAsks,
  publicAccessAdded,
  roleTablesWider,
  stoppedWords,
} from './UpdateReviewDialog.js';

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
  /** Where the app's tables live, for re-checking with the operator's answers. */
  connectionId?: string;
  /** Opened on an update that stopped before (read from the installed list): the dialog finishes it. */
  stopped?: UpdateStoppedDetails;
  /** The copy, as its title names it: "Update Invoices on kiln". */
  name?: string;
  connectionName?: string;
}

/** A copy's name and database, for an update's title. */
function copyNamed(app: InstalledApp): Pick<UpdateConsent, 'name' | 'connectionName'> {
  return { ...(app.name == null ? {} : { name: app.name }), ...(app.connectionName == null ? {} : { connectionName: app.connectionName }) };
}

/** What the operator checked before an update: that plan's checksum, their answers, and their says on what it adds. */
export type UpdateChecked = UpdateAnswers;

/** An update that stopped part way: the same update, sent again, finishes it. */
export interface StoppedUpdate {
  key: string;
  connectionId: string | null;
  checked: UpdateChecked | undefined;
  details: UpdateStoppedDetails;
}

/** An update waiting on columns the operator has been asked to add. */
export interface ColumnsConsent extends UpdateConsent {
  connectionId: string;
}

/** A thrown request as one sentence, naming the tables when an update is short of columns. */
function messageOf(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (caught instanceof ApiError) {
    const details = caught.details as
      | {
          reason?: unknown;
          tables?: { ref: string; missingColumns: string[] }[];
          problems?: { message?: unknown }[];
        }
      | undefined;
    if (details?.reason === 'COLUMNS_REQUIRED' && Array.isArray(details.tables)) {
      const tables = details.tables
        .map((table) => `${table.ref} (${table.missingColumns.join(', ')})`)
        .join('; ');
      return `${message} ${t('studio:hostedApps.update.missingColumns', 'Missing: {tables}.', { tables })}`;
    }
    // A refused plan names each reason; the headline alone ("cannot be
    // updated on this database") leaves the operator nothing to act on.
    if (details?.reason === 'PLAN_REFUSED' && Array.isArray(details.problems)) {
      const reasons = details.problems.flatMap((problem) => (typeof problem.message === 'string' ? [problem.message] : []));
      if (reasons.length > 0) return `${message} ${reasons.join(' ')}`;
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
  /** An update's documents that wait for an add-on update, said under its notice. */
  const [waiting, setWaiting] = useState<DocumentsWaiting['waiting'] | null>(null);
  const [consent, setConsent] = useState<UpdateConsent | null>(null);
  const [stopped, setStopped] = useState<StoppedUpdate | null>(null);
  const [columnsConsent, setColumnsConsent] = useState<ColumnsConsent | null>(null);
  const [origin, setOrigin] = useState<AcquisitionOrigin>('shelf');
  /**
   * "Update every copy": the copies still to update after this one, in order.
   * Every copy runs one version, so they all move, each through its own check;
   * a check the operator cancels, or a copy that stops, stops the rest.
   */
  const queue = useRef<InstalledApp[]>([]);

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
    setWaiting(null);
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

  const applyUpdate = async (key: string, checked?: UpdateChecked, connectionId: string | null = null): Promise<void> => {
    let result;
    try {
      result = await updateApp(key, checked, connectionId);
    } catch (caught) {
      // Stopped part way: nothing is undone, and the same update finishes it.
      if (caught instanceof ApiError && caught.code === 'APP_UPDATE_INCOMPLETE') {
        const details = (caught.details ?? {}) as Partial<UpdateStoppedDetails>;
        queue.current = [];
        setStopped({
          key,
          connectionId,
          checked,
          details: { stage: details.stage ?? '', from: details.from ?? '', to: details.to ?? '', cause: details.cause ?? caught.message },
        });
        return;
      }
      throw caught;
    }
    setStopped(null);
    setNotice(
      t('studio:hostedApps.update.done', '{app} updated to v{version}', {
        app: key,
        version: result.to,
      }),
    );
    setWaiting(result.app.documents?.waiting ?? null);
    // The next copy, when every copy is being updated: the file is on disk now.
    const next = queue.current.shift();
    if (next !== undefined) await updateCopy(next, result.to, true);
  };

  /**
   * One copy of an app to version `to`: checked against its own database, and
   * asked about when the check asks. Resolves once it is updated, or once its
   * check is on screen (the operator's answer continues from there).
   */
  const updateCopy = async (app: InstalledApp, to: string, staged: boolean): Promise<void> => {
    if (!staged) {
      await follow(
        () => downloadApp(app.key, to),
        t('studio:hostedApps.job.downloadTitle', 'Downloading {app}', { app: app.key }),
      );
    }
    if (app.connectionId !== null) {
      const { plan } = await planApp({ key: app.key, version: to, connectionId: app.connectionId });
      /*
       * A server that checks with the install's context: the new version's
       * tables are shown the way the install wizard shows them, and a new
       * table whose name is taken is asked about. A plan refused for any
       * other reason is sent anyway, so the refusal on the page is the
       * server's.
       */
      if (plan.tables !== undefined) {
        // A taken table's name and a taken page address are both answered on the check.
        const askable = plan.problems.every((problem) => problem.code === 'TABLE_TAKEN' || problem.code === 'PAGE_SLUG_UNANSWERED' || problem.code === 'EXISTING_TABLE_UNUSABLE');
        const asksShare = (plan.shareOffers ?? []).length > 0;
        const asksPages = (plan.pageClashes ?? []).length > 0 || existingTables(plan).length > 0;
        if ((checkAsks(plan.tables) || asksShare || asksPages || publicAccessAdded(plan) !== null || roleTablesWider(plan).length > 0 || asksGrants(plan)) && (plan.installable || askable)) {
          setConsent({ key: app.key, to, plan, connectionId: app.connectionId, ...copyNamed(app) });
          return;
        }
        await applyUpdate(app.key, plan.checksum === undefined ? undefined : { planChecksum: plan.checksum }, app.connectionId);
        return;
      }
      const short = plan.reuse.some((table) => table.missingColumns.length > 0);
      const edit = plan.missingColumnsEdit;
      // Offered only when EVERY missing column can be added this way; a
      // blocked one (a foreign key) means the update would still refuse,
      // and the server's refusal names it better than a half-offer would.
      // Missing columns are a problem of their own (COLUMNS_REQUIRED) and
      // the one this offer resolves; any OTHER problem still refuses.
      const onlyMissing = plan.problems.every((problem) => problem.code === 'COLUMNS_REQUIRED');
      if (
        onlyMissing &&
        short &&
        edit !== undefined &&
        edit.blocked.length === 0 &&
        edit.addColumns.length > 0
      ) {
        setColumnsConsent({ key: app.key, to, plan, connectionId: app.connectionId, ...copyNamed(app) });
        return;
      }
      const refused = !plan.installable || short;
      if (!refused && plan.create.length > 0) {
        setConsent({ key: app.key, to, plan, connectionId: app.connectionId, ...copyNamed(app) });
        return;
      }
    }
    await applyUpdate(app.key, undefined, app.connectionId);
  };

  return {
    busy,
    error,
    progress,
    vetoed,
    notice,
    waiting,
    consent,
    columnsConsent,
    origin,
    stopped,

    /** Resolves to whether the list is on now: a switch the environment vetoes, or one that failed, is not. */
    toggleOnline: async (next: boolean): Promise<boolean> => {
      let on = false;
      await attempt(async () => {
        const state = await setAppCatalogEnabled(next);
        setVetoed(state.vetoed);
        on = state.onlineEnabled;
      }, 'shelf');
      return on;
    },

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
        queue.current = [];
        const to = row.updateTo;
        if (to === null) return;
        await updateCopy(app, to, row.updateStaged);
      }, 'installed'),

    /**
     * Every copy of an app to `row.updateTo` (one version per app on a
     * server): the first copy, then each of the rest in order, each through
     * its own check. The file is fetched once.
     */
    updateEvery: (copies: readonly InstalledApp[], row: CatalogApp): Promise<void> =>
      attempt(async () => {
        const to = row.updateTo;
        const [first, ...rest] = copies;
        if (to === null || first === undefined) return;
        queue.current = [...rest];
        await updateCopy(first, to, row.updateStaged);
      }, 'installed'),

    confirmUpdate: (checked?: UpdateChecked): Promise<void> => {
      const pending = consent;
      setConsent(null);
      if (pending === null) return Promise.resolve();
      return attempt(() => applyUpdate(pending.key, checked, pending.connectionId ?? null), 'installed');
    },

    /**
     * A copy whose update stopped before, read from the installed list after a
     * reload: its review opens on the version it moved to, saying where it
     * stopped, and Finish the update sends the same update with the answers
     * on screen. Without a check to show, the alert's Finish the update does.
     */
    finishUnfinished: (app: InstalledApp): Promise<void> =>
      attempt(async () => {
        const pending = app.unfinishedUpdate;
        if (pending === undefined) return;
        const details: UpdateStoppedDetails = { stage: pending.stage ?? '', from: pending.from, to: pending.to, cause: '' };
        if (app.connectionId !== null) {
          const checked = await planApp({ key: app.key, version: pending.to, connectionId: app.connectionId }).catch(() => null);
          if (checked !== null) {
            setConsent({ key: app.key, to: pending.to, plan: checked.plan, connectionId: app.connectionId, stopped: details, ...copyNamed(app) });
            return;
          }
        }
        setStopped({ key: app.key, connectionId: app.connectionId, checked: undefined, details });
      }, 'installed'),

    /** "Finish the update": the same update, sent again, carries on from where it stopped. */
    finishUpdate: (): Promise<void> => {
      const pending = stopped;
      if (pending === null) return Promise.resolve();
      return attempt(() => applyUpdate(pending.key, pending.checked, pending.connectionId), 'installed');
    },

    /** The downloaded version stays on disk, and the list keeps offering it. A cancelled copy stops the rest. */
    cancelUpdate: (): void => {
      queue.current = [];
      setConsent(null);
    },

    /** The columns exist now (the dialog ran them); the update can go through. */
    confirmColumnsUpdate: (): Promise<void> => {
      const pending = columnsConsent;
      setColumnsConsent(null);
      if (pending === null) return Promise.resolve();
      return attempt(() => applyUpdate(pending.key, undefined, pending.connectionId), 'installed');
    },

    cancelColumnsUpdate: (): void => {
      queue.current = [];
      setColumnsConsent(null);
    },
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
      {!mine || state.stopped === null ? null : (
        <Alert
          ref={revealOnMount}
          role="alert"
          tone="danger"
          title={stoppedWords(state.stopped.details)}
          action={
            <Button size="sm" disabled={state.busy} onClick={() => void state.finishUpdate()}>
              {state.busy ? <Spinner size="sm" /> : <RotateCw aria-hidden className="size-4" />}
              {t('studio:hostedApps.update.finish', 'Finish the update')}
            </Button>
          }
        />
      )}
      {!mine || state.notice === null ? null : (
        <Alert ref={revealOnMount} tone="pos" title={state.notice} />
      )}
      {!mine || state.notice === null ? null : <DocumentsWaitingNotice waiting={state.waiting ?? undefined} />}
    </>
  );
}

/** The tables an update would create, before it creates them. */
export function UpdateConsentDialog({ state }: { state: AppAcquisition }) {
  const consent = state.consent;
  if (consent === null) return null;
  if ((consent.plan.tables !== undefined || consent.stopped !== undefined) && consent.connectionId !== undefined) {
    return (
      <UpdateReviewDialog
        appKey={consent.key}
        appName={consent.name ?? consent.key}
        connectionName={consent.connectionName}
        to={consent.to}
        from={consent.stopped?.from}
        stopped={consent.stopped}
        plan={consent.plan}
        connectionId={consent.connectionId}
        busy={state.busy}
        onCancel={state.cancelUpdate}
        onConfirm={(checked) => void state.confirmUpdate(checked)}
      />
    );
  }
  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) state.cancelUpdate();
      }}
    >
      <ModalHeader
        icon={<ArrowUpCircle />}
        title={
          consent.connectionName === undefined
            ? t('studio:hostedApps.update.title', 'Update {app} to v{version}', { app: consent.name ?? consent.key, version: consent.to })
            : t('studio:hostedApps.update.titleOn', 'Update {app} on {database} to v{version}', { app: consent.name ?? consent.key, database: consent.connectionName, version: consent.to })
        }
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
