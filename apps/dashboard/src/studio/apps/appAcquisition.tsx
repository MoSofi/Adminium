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
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, MonoText, Spinner } from '@adminium/ui';
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
  type InstallAnswers,
  type InstalledApp,
  type PlannedAppTable,
} from './appsApi.js';
import { SURFACES_QUERY_KEY } from './hostedAppsApi.js';
import { CheckHint, TableCheck, type TakenPick } from './InstallCheck.js';

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
}

/** What the operator checked before an update: that plan's checksum, and their answers. */
export interface UpdateChecked {
  planChecksum?: string;
  choices?: InstallAnswers['choices'];
}

/** Whether a new version's check has anything to show or ask. */
function checkAsks(tables: readonly PlannedAppTable[]): boolean {
  return tables.some(
    (table) => table.class === 'new' || table.class === 'taken' || table.edits.length > 0,
  );
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
  const [consent, setConsent] = useState<UpdateConsent | null>(null);
  const [columnsConsent, setColumnsConsent] = useState<ColumnsConsent | null>(null);
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

  const applyUpdate = async (key: string, checked?: UpdateChecked): Promise<void> => {
    const result = await updateApp(key, checked);
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
    columnsConsent,
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
          /*
           * A server that checks with the install's context: the new version's
           * tables are shown the way the install wizard shows them, and a new
           * table whose name is taken is asked about. A plan refused for any
           * other reason is sent anyway, so the refusal on the page is the
           * server's.
           */
          if (plan.tables !== undefined) {
            const askable = plan.problems.every((problem) => problem.code === 'TABLE_TAKEN');
            if (checkAsks(plan.tables) && (plan.installable || askable)) {
              setConsent({ key: app.key, to, plan, connectionId: app.connectionId });
              return;
            }
            await applyUpdate(app.key, plan.checksum === undefined ? undefined : { planChecksum: plan.checksum });
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
            setColumnsConsent({ key: app.key, to, plan, connectionId: app.connectionId });
            return;
          }
          const refused = !plan.installable || short;
          if (!refused && plan.create.length > 0) {
            setConsent({ key: app.key, to, plan });
            return;
          }
        }
        await applyUpdate(app.key);
      }, 'installed'),

    confirmUpdate: (checked?: UpdateChecked): Promise<void> => {
      const pending = consent;
      setConsent(null);
      if (pending === null) return Promise.resolve();
      return attempt(() => applyUpdate(pending.key, checked), 'installed');
    },

    /** The downloaded version stays on disk, and the list keeps offering it. */
    cancelUpdate: (): void => setConsent(null),

    /** The columns exist now (the dialog ran them); the update can go through. */
    confirmColumnsUpdate: (): Promise<void> => {
      const pending = columnsConsent;
      setColumnsConsent(null);
      if (pending === null) return Promise.resolve();
      return attempt(() => applyUpdate(pending.key), 'installed');
    },

    cancelColumnsUpdate: (): void => setColumnsConsent(null),
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
  if (consent.plan.tables !== undefined && consent.connectionId !== undefined) {
    return <UpdateCheckDialog state={state} consent={{ ...consent, connectionId: consent.connectionId }} />;
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

/**
 * A new version's tables, checked the way the install wizard checks them: what
 * it creates, what it takes back, the safe edits, and the one question — a new
 * table whose name somebody else holds. The update sends the answers and the
 * checksum of the check it showed.
 */
function UpdateCheckDialog({
  state,
  consent,
}: {
  state: AppAcquisition;
  consent: UpdateConsent & { connectionId: string };
}) {
  const [plan, setPlan] = useState(consent.plan);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [picks, setPicks] = useState<Record<string, TakenPick>>({});
  const [renameTo, setRenameTo] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<InstallAnswers['choices']>(undefined);

  const choicesOf = (
    nextPicks: Record<string, TakenPick>,
    nextRename: Record<string, string>,
  ): InstallAnswers['choices'] => {
    const choices: NonNullable<InstallAnswers['choices']> = {};
    for (const ref of Object.keys(nextPicks).sort()) {
      if (nextPicks[ref] === 'reuse') choices[ref] = { action: 'reuse' };
      if (nextPicks[ref] === 'rename-existing') choices[ref] = { action: 'rename-existing', to: nextRename[ref] ?? '' };
    }
    return Object.keys(choices).length === 0 ? undefined : choices;
  };
  const choices = choicesOf(picks, renameTo);
  const dirty = JSON.stringify(choices ?? null) !== JSON.stringify(checked ?? null);

  const recheck = useMutation({
    mutationFn: (next: InstallAnswers['choices']) =>
      planApp({
        key: consent.key,
        version: consent.to,
        connectionId: consent.connectionId,
        ...(next === undefined ? {} : { choices: next }),
      }),
    onSuccess: (reply, next) => {
      setPlan(reply.plan);
      setChecked(next);
    },
  });

  const tables = plan.tables ?? [];
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
        subtitle={t('studio:hostedApps.update.checkSubtitle', 'Check the tables this version uses.')}
        closeLabel={t('studio:hostedApps.update.close', 'Close')}
      />
      <ModalBody>
        <div className="flex flex-col gap-3">
          {recheck.error === null ? null : (
            <Alert tone="danger" title={t('studio:hostedApps.error', 'Something went wrong')}>
              {recheck.error.message}
            </Alert>
          )}
          <TableCheck
            plan={{ ...plan, tables }}
            appName={consent.key}
            connectionName=""
            heading={false}
            allowAltPrefix={false}
            open={open}
            onToggle={(ref) => setOpen((rows) => ({ ...rows, [ref]: rows[ref] !== true }))}
            picks={picks}
            onPick={(ref, pick) => {
              const table = tables.find((candidate) => candidate.ref === ref);
              const nextPicks = { ...picks, [ref]: pick };
              const nextRename =
                pick === 'rename-existing' && renameTo[ref] === undefined && table !== undefined
                  ? { ...renameTo, [ref]: table.renameExistingTo ?? `${table.table}_old` }
                  : renameTo;
              setPicks(nextPicks);
              setRenameTo(nextRename);
              recheck.mutate(choicesOf(nextPicks, nextRename));
            }}
            renameTo={renameTo}
            onRenameTo={(ref, value) => setRenameTo((names) => ({ ...names, [ref]: value }))}
            prefix=""
            onPrefix={() => undefined}
            altPrefixInUse={null}
            onUsualPrefix={() => undefined}
            busy={recheck.isPending || state.busy}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <span className="me-auto">
          <CheckHint plan={plan} picks={picks} dirty={dirty} forUpdate />
        </span>
        <Button variant="ghost" onClick={state.cancelUpdate}>
          {t('studio:hostedApps.update.cancel', 'Cancel')}
        </Button>
        {dirty ? (
          <Button disabled={recheck.isPending} onClick={() => recheck.mutate(choices)}>
            {recheck.isPending ? <Spinner size="sm" /> : null}
            {t('studio:hostedApps.install.check.again', 'Check again')}
          </Button>
        ) : (
          <Button
            disabled={state.busy || recheck.isPending || !plan.installable}
            onClick={() =>
              void state.confirmUpdate({
                ...(plan.checksum === undefined ? {} : { planChecksum: plan.checksum }),
                ...(checked === undefined ? {} : { choices: checked }),
              })
            }
          >
            {t('studio:hostedApps.update.confirm', 'Update')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
