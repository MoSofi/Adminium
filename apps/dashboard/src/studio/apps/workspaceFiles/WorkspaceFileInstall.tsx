// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing a workspace file, ported from `Apps Per Database.dc.html` part 9
 * (Y-A5): Bundle · Review · Done.
 *
 *  - **9a, the review**: "Check before you install", the file's card (its
 *    name, "Workspace file", "{n} apps", where and when it was made, the
 *    warning, and the fingerprint check with its three results), then — for
 *    someone who manages connections only — the workspace the databases go
 *    in: create one named after the file (the default), add to an existing
 *    one, or none.
 *  - **9b, the apps**: one row per app with its "Install on" (existing
 *    databases only), its status and its own review, folded; a row that needs
 *    a choice opens itself. A newer app is an update of every copy of its key.
 *  - **9c, Done**: what happened to each app, the workspace, and what is left
 *    to do after the install.
 *  - **9d, stopped**: what installed stays installed, and "Install the rest"
 *    runs the same file again. The file stays staged on the server, so this
 *    screen comes back after a reload (`resume`).
 *
 * The review of each app is the single-app review's own cards
 * (`installReview.tsx`, `InstallCheck.tsx`), so an app reads the same alone
 * and inside a workspace file.
 *
 * ─── Departures ────────────────────────────────────────────────────────────
 *
 *  **W1 — no "A new database…"** in "Install on" (plan, F14): apps go onto
 *  databases already connected; with none, the row says to connect one first.
 *  **W2 — a newer app is an update, not a refusal** (A5-F1): its pill reads
 *  "Update", with the versions, and the footer counts both.
 *  **W3 — "Add to an existing workspace" is disabled on a server with none**,
 *  and "No workspace" then reads "The databases stay as they are in the
 *  menu." (A5-F12). The first workspace's notice is from the plan (§ notes).
 *  **W4 — "Open the workspace" opens Data connections**, where its card is:
 *  switching the menu to a workspace belongs to the sidebar.
 *  **W5 — the review of an update shows the update's plan** with the same
 *  cards; its answers go with the update of every copy.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, MonoText, RadioCard, RadioGroup, Select, Spinner, Stepper, type Step } from '@adminium/ui';
import { ArrowUpCircle, Check, ChevronDown, CircleAlert, CircleCheck, Database, FolderTree, Info, Package, RotateCcw, Users } from 'lucide-react';

import { ApiError, api } from '../../../app/api.js';
import { bootstrapQuery, holdsSystemAction } from '../../../app/bootstrap.js';
import { brandingQuery } from '../../../app/branding.js';
import { t } from '../../../i18n/t.js';
import { connectionsQuery } from '../../hub/ConnectionsHub.js';
import { namesList, sentence } from '../addOnWords.js';
import { APPS_QUERY_KEY, planApp, sha512Of } from '../appsApi.js';
import { TableCheck, type TakenPick } from '../InstallCheck.js';
import { answersOf, hasTables } from '../InstallAppWizard.js';
import {
  AfterInstallCard,
  ExistingTablesCard,
  HoldHint,
  InstanceCard,
  NO_INSTANCE_ANSWERS,
  OutsideAddressesCard,
  PageClashesCard,
  RefusalCard,
  ScreensWarning,
  WhereItCameFrom,
  afterInstallLines,
  fingerprintHolds,
  instanceAnswersOf,
  movedAddress,
  outsideRules,
  uploadRefusal,
  type InstanceAnswers,
  type PageAnswer,
} from '../installReview.js';
import { alreadyThere, doneCount, goesNow, statusOf, type AppReviewState, type AppStatus } from './workspaceFileStatus.js';
import {
  WORKSPACE_FILES_QUERY_KEY,
  discardWorkspaceFile,
  installWorkspaceFile,
  reasonOf,
  readWorkspaceFile,
  uploadWorkspaceFile,
  type WorkspaceChoice,
  type WorkspaceFile,
  type WorkspaceFileApp,
  type WorkspaceInstallBody,
} from './workspaceFilesApi.js';

const STEP_IDS = ['bundle', 'review', 'done'] as const;
type StepId = (typeof STEP_IDS)[number];

// `leading-[normal]`: the comp renders at `normal`, and this system's `leading-normal` is 1.5.
const SECTION = 'flex flex-col gap-3.5 rounded-[14px] border border-border bg-surface p-5 leading-[normal] shadow-sm';
const SECTION_TITLE = 'text-[14.5px] font-bold tracking-[-0.01em]';
const CHIP = 'inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11.5px] font-bold leading-[normal]';

/** One app's answers on the review, as the single-app review keeps them. */
interface AppAnswers {
  picks: Record<string, TakenPick>;
  renameTo: Record<string, string>;
  pages: Record<string, PageAnswer>;
  useExisting: boolean;
  instance: InstanceAnswers;
}

const NO_ANSWERS: AppAnswers = { picks: {}, renameTo: {}, pages: {}, useExisting: false, instance: NO_INSTANCE_ANSWERS };

interface WorkspaceRow {
  id: string;
  name: string;
  connectionIds: string[];
}

/** The workspaces of this server, for the choice: asked only of someone who manages connections. */
function workspacesQuery(enabled: boolean) {
  return {
    queryKey: WORKSPACES_FOR_FILE_KEY,
    queryFn: async () => (await api.get<{ workspaces: WorkspaceRow[] }>('/api/v1/workspaces')).workspaces,
    enabled,
  };
}

/** Where an app's plan on its database is kept: by the file, the app, the database and the answers. */
export function planQueryKey(fileId: string, app: Pick<WorkspaceFileApp, 'key' | 'version'>, target: string | null, sent: object) {
  return ['workspace-file-plan', fileId, app.key, app.version, target, sent] as const;
}

/** Where a staged file read back is kept. */
export function workspaceFileQueryKey(id: string | undefined) {
  return ['workspace-file', id] as const;
}

/** The workspaces of this server, as the choice reads them. */
export const WORKSPACES_FOR_FILE_KEY = ['workspaces', 'for-workspace-file'] as const;

/** The refusal of a whole file, in words. */
export function wholeFileRefusal(error: unknown): { title: string; body: ReactNode } {
  const reason = reasonOf(error);
  const details = error instanceof ApiError ? error.details : undefined;
  if (reason === 'REQUIRES_NEWER_ADMINIUM') {
    const said = uploadRefusal('REQUIRES_NEWER_ADMINIUM', details);
    if (said !== null) return said;
  }
  const words: Record<string, string> = {
    WORKSPACE_FILE_INTEGRITY: t('studio:workspaceFiles.refusal.integrity', 'An app inside is not the file that was saved: its fingerprint does not match.'),
    WORKSPACE_FILE_APP_MISMATCH: t('studio:workspaceFiles.refusal.mismatch', 'An app inside is not the app the file says it is.'),
    WORKSPACE_FILE_NESTED: t('studio:workspaceFiles.refusal.nested', 'A workspace file inside a workspace file is not installed.'),
    WORKSPACE_FILE_TWO_INSTANCES: t('studio:workspaceFiles.refusal.twoInstances', 'Two apps inside carry the server settings. A workspace file carries them with one app at most.'),
    WORKSPACE_FILE_EXTRA: t('studio:workspaceFiles.refusal.extra', 'The file carries something its list of apps does not name.'),
    WORKSPACE_FILE_MEMBER_MISSING: t('studio:workspaceFiles.refusal.missing', 'An app the file names is not in it.'),
  };
  return {
    title: t('studio:workspaceFiles.refusal.title', 'This workspace file can’t be installed'),
    body: (reason === null ? undefined : words[reason]) ?? (error instanceof Error ? error.message : String(error)),
  };
}

export interface WorkspaceFileInstallProps {
  /** A file to send: the app upload said it is a workspace file. */
  file?: File | undefined;
  /** A file staged before (a reload): its review, or "Install the rest". */
  resumeId?: string | undefined;
  onClose: () => void;
}

export function WorkspaceFileInstall({ file, resumeId, onClose }: WorkspaceFileInstallProps) {
  const queryClient = useQueryClient();
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const { data: branding } = useQuery(brandingQuery());
  const { data: connections = [] } = useQuery(connectionsQuery());
  const managesConnections = bootstrap !== undefined && holdsSystemAction(bootstrap, 'connections.manage');
  const { data: workspaces = [], isSuccess: workspacesRead } = useQuery(workspacesQuery(managesConnections));
  const server = branding?.appName ?? 'Adminium';

  const [step, setStep] = useState<StepId>(resumeId === undefined ? 'bundle' : 'review');
  const [staged, setStaged] = useState<WorkspaceFile | null>(null);
  const [refusal, setRefusal] = useState<{ title: string; body: ReactNode } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState('');
  const [targets, setTargets] = useState<Record<string, string | null>>({});
  const [answers, setAnswers] = useState<Record<string, AppAnswers>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [choice, setChoice] = useState<'create' | 'existing' | 'none' | null>(null);
  const [existingId, setExistingId] = useState('');
  const holdId = useId();

  const take = (next: WorkspaceFile) => {
    setStaged(next);
    // Each app starts on the database it was saved from, when one here has that name and engine and is free.
    setTargets((held) => Object.fromEntries(next.apps.map((app) => [app.key, held[app.key] !== undefined ? held[app.key]! : (app.target ?? app.suggested)])));
    if (next.state === 'done' || next.state === 'stopped') setStep('done');
    else setStep('review');
  };

  // The upload, once: the bytes go up with their own fingerprint, and the file comes back read.
  const upload = useMutation({
    mutationFn: async (sent: File) => uploadWorkspaceFile(sent, await sha512Of(sent)),
    onSuccess: (next) => {
      take(next);
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_FILES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
    },
    onError: (cause) => setRefusal(wholeFileRefusal(cause)),
  });
  const resume = useQuery({ queryKey: workspaceFileQueryKey(resumeId), queryFn: () => readWorkspaceFile(resumeId!), enabled: resumeId !== undefined, staleTime: Infinity, gcTime: 0 });
  useEffect(() => {
    if (file !== undefined && upload.isIdle) upload.mutate(file);
    // Once, for the file this screen was opened with.
  }, [file]);
  useEffect(() => {
    if (resume.data !== undefined && staged === null) take(resume.data);
  }, [resume.data]);

  // The workspace choice's start: a workspace named like the file is added to; otherwise one is made.
  const sameName = workspaces.find((one) => staged !== null && one.name.toLowerCase() === staged.name.toLowerCase());
  const mode = choice ?? (sameName !== undefined ? 'existing' : 'create');
  const chosenExisting = existingId !== '' ? existingId : (sameName?.id ?? workspaces[0]?.id ?? '');

  // Each app's plan on its database, with its answers: the review's cards and the row's status.
  const pending = staged?.apps.filter((app) => app.state !== 'installed' && app.state !== 'updated' && app.state !== 'refused') ?? [];
  const plans = useQueries({
    queries: pending.map((app) => {
      const target = targets[app.key] ?? null;
      const a = answers[app.key] ?? NO_ANSWERS;
      const sent = answersOf(a.picks, a.renameTo, '', {}, a.pages, a.useExisting);
      return {
        queryKey: planQueryKey(staged?.id ?? '', app, target, sent),
        queryFn: () => planApp({ key: app.key, version: app.version, connectionId: target!, ...sent }),
        enabled: target !== null && !alreadyThere(app, target),
        retry: false,
        staleTime: 30_000,
      };
    }),
  });
  const reviews = useMemo(() => {
    const out: Record<string, AppReviewState & { error: unknown }> = {};
    pending.forEach((app, n) => {
      const q = plans[n];
      const a = answers[app.key] ?? NO_ANSWERS;
      const planned = q?.data?.plan ?? null;
      const failure = q?.error ?? null;
      out[app.key] = {
        plan: planned,
        planError: failure instanceof ApiError ? { code: failure.code, message: failure.message, details: failure.details } : null,
        error: failure,
        loading: q?.isFetching === true && planned === null,
        pages: a.pages,
        useExisting: a.useExisting,
        choices: answersOf(a.picks, a.renameTo, '', {}, {}, false).choices,
      };
    });
    return out;
  }, [pending, plans, answers]);

  const statuses: Record<string, AppStatus> = Object.fromEntries((staged?.apps ?? []).map((app) => [app.key, statusOf(app, targets[app.key] ?? null, reviews[app.key])]));
  // A row that needs a choice opens itself (once: the person may fold it again).
  useEffect(() => {
    for (const app of staged?.apps ?? []) {
      if (statuses[app.key] === 'answer' && open[app.key] === undefined) setOpen((held) => ({ ...held, [app.key]: true }));
    }
  });

  const install = useMutation({
    mutationFn: async () => {
      if (staged === null) throw new Error('no file');
      const workspace: WorkspaceChoice | undefined = !managesConnections
        ? undefined
        : mode === 'create'
          ? { mode: 'create', name: staged.name }
          : mode === 'existing' && chosenExisting !== ''
            ? { mode: 'existing', workspaceId: chosenExisting }
            : { mode: 'none' };
      const body: WorkspaceInstallBody = {
        ...(workspace === undefined ? {} : { workspace }),
        apps: staged.apps
          .filter((app) => app.state !== 'installed' && app.state !== 'updated' && app.state !== 'refused')
          .map((app) => {
            const status = statuses[app.key]!;
            const target = targets[app.key] ?? null;
            // Only an app that is ready goes now; the others keep their place for later.
            if (!goesNow(status) && status !== 'installed') return { key: app.key, connectionId: null };
            const a = answers[app.key] ?? NO_ANSWERS;
            const plan = reviews[app.key]?.plan ?? null;
            const sent = {
              ...answersOf(a.picks, a.renameTo, '', {}, a.pages, a.useExisting),
              ...(plan?.instance === undefined ? {} : instanceAnswersOf(plan.instance, a.instance)),
              ...(plan?.checksum === undefined ? {} : { planChecksum: plan.checksum }),
            };
            return { key: app.key, connectionId: target, install: sent, update: sent };
          }),
      };
      return installWorkspaceFile(staged.id, body);
    },
    onSuccess: (next) => {
      setStaged(next);
      setStep('done');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_FILES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: bootstrapQuery().queryKey });
    },
    onError: (cause) => setError(cause.message),
  });

  const discard = useMutation({
    mutationFn: () => discardWorkspaceFile(staged!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_FILES_QUERY_KEY });
      onClose();
    },
  });

  const steps: Step[] = [
    { id: 'bundle', label: t('studio:workspaceFiles.install.steps.bundle', 'Bundle') },
    { id: 'review', label: t('studio:workspaceFiles.install.steps.review', 'Review') },
    { id: 'done', label: t('studio:workspaceFiles.install.steps.done', 'Done') },
  ];
  const stepIndex = STEP_IDS.indexOf(step);
  const busy = upload.isPending || install.isPending || discard.isPending;
  const apps = staged?.apps ?? [];
  const going = apps.filter((app) => goesNow(statuses[app.key]!));
  const installs = going.filter((app) => statuses[app.key] !== 'update').length;
  const updates = going.filter((app) => statuses[app.key] === 'update').length;
  const fingerprintHold = staged !== null && fingerprintHolds(fingerprint, staged.integrity);
  const filename = file?.name ?? staged?.name ?? '';

  return (
    <section className="flex min-h-full flex-col gap-6" data-part="workspace-file-install">
      <div>
        <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">{t('studio:workspaceFiles.install.title', 'Install a workspace file')}</h2>
        <p className="mt-0.5 text-[13px] text-fg-muted">{server}</p>
      </div>
      <header>
        <Stepper steps={steps} activeIndex={stepIndex} label={t('studio:workspaceFiles.install.progress', 'Install progress')} />
      </header>

      {refusal !== null ? (
        <RefusalCard title={refusal.title} onBack={onClose}>
          {refusal.body}
        </RefusalCard>
      ) : staged === null ? (
        resume.isError ? (
          <Alert tone="danger" title={t('studio:workspaceFiles.error', 'Something went wrong')}>
            {resume.error.message}
          </Alert>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner size="sm" />
            {t('studio:workspaceFiles.install.reading', 'Reading the workspace file…')}
          </p>
        )
      ) : step === 'done' ? (
        <DoneScreen
          file={staged}
          server={server}
          busy={busy}
          restReady={apps.filter((app) => app.state === 'stopped').every((app) => statuses[app.key] === 'stopped')}
          onRest={() => {
            // A stopped app whose review now asks something goes back to the review first.
            if (apps.some((app) => app.state === 'stopped' && statuses[app.key] === 'answer')) setStep('review');
            else install.mutate();
          }}
          onReview={() => setStep('review')}
          connections={connections}
          workspaces={workspaces}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-base font-bold tracking-tight">{t('studio:workspaceFiles.install.checkTitle', 'Check before you install')}</h3>
            <p className="mt-1 text-sm text-fg-muted">
              {t('studio:workspaceFiles.install.checkIntro', 'The apps in {workspace} go onto {server}. Nothing changes until you press Install.', { workspace: staged.name, server })}
            </p>
          </div>
          <WhereItCameFrom
            name={staged.name}
            version=""
            badge={t('studio:workspaceFiles.install.badge', 'Workspace file')}
            chip={t('studio:workspaceFiles.install.apps', '{count, plural, one {# app} other {# apps}}', { count: staged.apps.length })}
            madeAt={staged.savedAt === null || staged.adminiumVersion === null ? undefined : { label: staged.label, savedAt: staged.savedAt, adminiumVersion: staged.adminiumVersion }}
            integrity={staged.integrity}
            fingerprint={fingerprint}
            onFingerprint={setFingerprint}
            fieldId={`${holdId}-fp`}
          />
          {managesConnections && workspacesRead ? (
            <WorkspaceChoiceCard
              name={staged.name}
              server={server}
              mode={mode}
              onMode={setChoice}
              workspaces={workspaces}
              existingId={chosenExisting}
              onExisting={setExistingId}
            />
          ) : null}
          <section className={SECTION} data-part="apps-in-file">
            <div className="flex flex-wrap items-center gap-[9px]">
              <Package aria-hidden className="size-[17px] text-accent" />
              <h3 className={SECTION_TITLE}>{t('studio:workspaceFiles.install.appsTitle', 'Apps in the file')}</h3>
              <MonoText className={`${CHIP} bg-surface-3 text-fg-muted`}>{String(apps.length)}</MonoText>
            </div>
            <p className="text-[12.5px] leading-[1.5] text-fg-muted">
              {t('studio:workspaceFiles.install.appsIntro', 'Each app installs on its own database. One that is refused does not stop the others.')}
            </p>
            {connections.length === 0 ? (
              <Alert tone="warn" title={t('studio:workspaceFiles.install.noDatabases.title', 'No database here yet')}>
                {t('studio:workspaceFiles.install.noDatabases.body', 'Apps go onto databases that are connected. Connect a database first, then come back to this file.')}
              </Alert>
            ) : null}
            <ul className="flex flex-col gap-2.5">
              {apps.map((app) => (
                <AppRow
                  key={app.key}
                  app={app}
                  status={statuses[app.key]!}
                  target={targets[app.key] ?? null}
                  onTarget={(next) => setTargets((held) => ({ ...held, [app.key]: next }))}
                  connections={connections}
                  review={reviews[app.key]}
                  answers={answers[app.key] ?? NO_ANSWERS}
                  onAnswers={(next) => setAnswers((held) => ({ ...held, [app.key]: next }))}
                  open={open[app.key] === true}
                  onOpen={(next) => setOpen((held) => ({ ...held, [app.key]: next }))}
                  busy={busy}
                />
              ))}
            </ul>
          </section>
          {error === null ? null : (
            <Alert tone="danger" title={t('studio:workspaceFiles.install.failed', 'The install did not run')}>
              {error}
            </Alert>
          )}
        </div>
      )}

      {staged !== null && step === 'review' && refusal === null ? (
        <footer className="sticky bottom-0 -mx-6 mt-auto flex flex-wrap items-center gap-3 border-t border-border bg-surface px-6 py-3.5">
          {fingerprintHold ? (
            <HoldHint id={holdId}>{t('studio:hostedApps.review.fingerprint.hold', 'The fingerprint does not match. Clear it, or paste the one shown when it was saved.')}</HoldHint>
          ) : (
            <span id={holdId} className="min-w-0 flex-1 text-[12.5px] text-fg-subtle">
              {sentence('studio:workspaceFiles.install.footer', 'Step {n} of {total} · {file}', { file: <MonoText>{filename}</MonoText> }, { n: 2, total: 3 })}
              {summaryOf(apps, statuses) === '' ? null : <> · {summaryOf(apps, statuses)}</>}
            </span>
          )}
          <span className="ms-auto flex items-center gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => discard.mutate()}>
              {t('studio:workspaceFiles.cancel', 'Cancel')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {t('studio:workspaceFiles.install.back', 'Back')}
            </Button>
            <Button disabled={busy || going.length === 0 || fingerprintHold} loading={install.isPending} aria-describedby={going.length === 0 || fingerprintHold ? holdId : undefined} onClick={() => install.mutate()}>
              {installLabel(installs, updates)}
            </Button>
          </span>
        </footer>
      ) : null}
    </section>
  );
}

/** "Install 2 apps", "Update 1 app", "Install 2 apps, update 1". */
export function installLabel(installs: number, updates: number): string {
  if (updates === 0) return t('studio:workspaceFiles.install.button', '{count, plural, one {Install # app} other {Install # apps}}', { count: installs });
  if (installs === 0) return t('studio:workspaceFiles.install.buttonUpdate', '{count, plural, one {Update # app} other {Update # apps}}', { count: updates });
  return t('studio:workspaceFiles.install.buttonBoth', '{installs, plural, one {Install # app} other {Install # apps}}, {updates, plural, one {update #} other {update #}}', { installs, updates });
}

/** The footer's sentence: what is refused, and what waits for a choice. */
export function summaryOf(apps: readonly WorkspaceFileApp[], statuses: Record<string, AppStatus>): string {
  const named = (wanted: AppStatus[]) => apps.filter((app) => wanted.includes(statuses[app.key]!)).map((app) => app.name);
  const refused = named(['refused']);
  const waiting = named(['database', 'answer']);
  const ready = named(['ready', 'update', 'stopped']);
  const parts: string[] = [];
  if (refused.length > 0) {
    parts.push(
      ready.length === 0
        ? t('studio:workspaceFiles.install.summary.refusedAll', '{apps} {count, plural, one {is refused.} other {are refused.}}', { apps: namesList(refused), count: refused.length })
        : t('studio:workspaceFiles.install.summary.refused', '{apps} {count, plural, one {is refused.} other {are refused.}} The others install.', { apps: namesList(refused), count: refused.length }),
    );
  }
  if (waiting.length > 0) {
    parts.push(
      ready.length === 0
        ? t('studio:workspaceFiles.install.summary.waitingAll', 'Choose a database for {apps}, and answer its review.', { apps: namesList(waiting) })
        : t('studio:workspaceFiles.install.summary.waiting', '{ready} {count, plural, one {installs now.} other {install now.}} Make the choices for {apps} to add {others, plural, one {it} other {them}}.', {
            ready: namesList(ready),
            count: ready.length,
            apps: namesList(waiting),
            others: waiting.length,
          }),
    );
  }
  return parts.join(' ');
}

/** The pill on an app's row. */
function StatusPill({ app, status }: { app: WorkspaceFileApp; status: AppStatus }) {
  const copy = app.installs[0]?.version;
  switch (status) {
    case 'installed':
      return <Badge tone="pos">{sentence('studio:workspaceFiles.status.installed', 'Installed · {version}', { version: <MonoText>{app.version}</MonoText> })}</Badge>;
    case 'updated':
      return <Badge tone="pos">{t('studio:workspaceFiles.status.updated', 'Updated')}</Badge>;
    case 'refused':
      return <Badge tone="danger">{t('studio:workspaceFiles.status.refused', 'Refused')}</Badge>;
    case 'stopped':
      return <Badge tone="warn">{t('studio:workspaceFiles.status.stopped', 'Stopped')}</Badge>;
    case 'database':
    case 'answer':
      return <Badge tone="warn">{t('studio:workspaceFiles.status.choice', 'Needs a choice')}</Badge>;
    case 'checking':
      return (
        <Badge tone="neutral">
          <Spinner size="sm" />
          {t('studio:workspaceFiles.status.checking', 'Checking')}
        </Badge>
      );
    case 'update':
      return (
        <Badge tone="info">
          <ArrowUpCircle aria-hidden className="size-3" />
          {sentence('studio:workspaceFiles.status.update', 'Update · {from} → {to}', { from: <MonoText>{copy ?? ''}</MonoText>, to: <MonoText>{app.version}</MonoText> })}
        </Badge>
      );
    default:
      return <Badge tone="pos">{t('studio:workspaceFiles.status.ready', 'Ready')}</Badge>;
  }
}

/** Why an app is refused, in words: its own refusal, or its plan's. */
function refusalWords(app: WorkspaceFileApp, review: (AppReviewState & { error: unknown }) | undefined): ReactNode {
  if (app.refusal !== null) {
    const said = uploadRefusal(app.refusal.reason, { reason: app.refusal.reason });
    return said?.body ?? app.refusal.message;
  }
  if (review?.planError != null) {
    const said = uploadRefusal(review.planError.code, review.planError.details);
    return said?.body ?? review.planError.message;
  }
  return review?.plan?.problems.map((problem) => problem.message).join(' ') ?? null;
}

function AppRow({
  app,
  status,
  target,
  onTarget,
  connections,
  review,
  answers,
  onAnswers,
  open,
  onOpen,
  busy,
}: {
  app: WorkspaceFileApp;
  status: AppStatus;
  target: string | null;
  onTarget: (next: string | null) => void;
  connections: readonly { id: string; name: string }[];
  review: (AppReviewState & { error: unknown }) | undefined;
  answers: AppAnswers;
  onAnswers: (next: AppAnswers) => void;
  open: boolean;
  onOpen: (next: boolean) => void;
  busy: boolean;
}) {
  const selectId = useId();
  const panelId = useId();
  const finished = app.state === 'installed' || app.state === 'updated' || app.state === 'refused';
  const plan = review?.plan ?? null;
  const tables = plan !== null && hasTables(plan) ? plan : null;
  const outside = outsideRules(plan?.afterInstall).length;
  const after = afterInstallLines(plan?.afterInstall).length;
  const clashes = plan?.pageClashes?.length ?? 0;
  return (
    <li className="rounded-[12px] border border-border bg-surface leading-[normal]" data-testid={`ws-app-${app.key}`}>
      <div className="flex flex-wrap items-center gap-3 px-[15px] py-3">
        <span className="text-[13.5px] font-bold">{app.name}</span>
        <MonoText className="text-xs text-fg-muted">{app.version}</MonoText>
        <span className="flex-1" />
        <div className="flex items-center gap-2">
          <label htmlFor={selectId} className="text-[12.5px] font-bold">
            {t('studio:workspaceFiles.app.installOn', 'Install on')}
          </label>
          <Select
            id={selectId}
            mono
            value={target ?? ''}
            disabled={busy || finished || connections.length === 0}
            aria-invalid={status === 'database' ? true : undefined}
            aria-describedby={status === 'database' ? `${selectId}-need` : undefined}
            onChange={(event) => onTarget(event.currentTarget.value === '' ? null : event.currentTarget.value)}
          >
            <option value="">{t('studio:workspaceFiles.app.choose', 'Choose a database')}</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </Select>
        </div>
        <StatusPill app={app} status={status} />
      </div>
      {status === 'database' ? (
        <p id={`${selectId}-need`} className="border-t border-border px-[15px] py-2.5 text-[12.5px] text-warn">
          {t('studio:workspaceFiles.app.chooseWhere', 'Choose where {app} goes.', { app: app.name })}
        </p>
      ) : status === 'refused' ? (
        <p role="alert" className="flex items-start gap-2 border-t border-border px-[15px] py-2.5 text-[12.5px] leading-[1.5] text-fg-muted">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-danger" />
          <span>{refusalWords(app, review)}</span>
        </p>
      ) : status === 'update' ? (
        <p className="border-t border-border px-[15px] py-2.5 text-[12.5px] leading-[1.5] text-fg-muted">
          {t('studio:workspaceFiles.app.update', 'This file is newer. Every copy of {app} is updated: {databases}.', { app: app.name, databases: namesList(app.installs.map((copy) => copy.connectionName)) })}
        </p>
      ) : null}
      {plan !== null && !finished && status !== 'installed' && status !== 'refused' ? (
        <div className="border-t border-border px-[15px] py-2.5">
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-fg-muted">
            <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => onOpen(!open)}>
              <ChevronDown aria-hidden className={open ? 'rotate-180' : undefined} />
              {open ? t('studio:workspaceFiles.app.hideReview', 'Hide the review') : t('studio:workspaceFiles.app.showReview', 'Show the review')}
            </Button>
            <span>{t('studio:workspaceFiles.app.counts.tables', '{count, plural, one {# table} other {# tables}}', { count: plan.tables?.length ?? 0 })}</span>
            {clashes > 0 ? <span>{t('studio:workspaceFiles.app.counts.choices', '{count, plural, one {# choice} other {# choices}}', { count: clashes })}</span> : null}
            {outside > 0 ? <span>{t('studio:workspaceFiles.app.counts.outside', '{count, plural, one {# outside address} other {# outside addresses}}', { count: outside })}</span> : null}
            {app.sides.length > 0 ? <span>{t('studio:workspaceFiles.app.counts.screens', '{count, plural, one {# screen} other {# screens}}', { count: app.sides.length })}</span> : null}
            {after > 0 ? <span>{t('studio:workspaceFiles.app.counts.after', '{count, plural, one {# thing after you install} other {# things after you install}}', { count: after })}</span> : null}
          </div>
          {open ? (
            <div id={panelId} className="mt-3 flex flex-col gap-3.5">
              <ExistingTablesCard
                plan={plan}
                used={answers.useExisting}
                busy={busy}
                onUse={() => onAnswers({ ...answers, useExisting: true, picks: {} })}
                onChange={() => onAnswers({ ...answers, useExisting: false })}
              />
              {(plan.pageClashes ?? []).length === 0 ? null : (
                <PageClashesCard
                  clashes={plan.pageClashes ?? []}
                  answers={answers.pages}
                  busy={busy}
                  onAnswer={(page, answer) => {
                    const pages = { ...answers.pages };
                    if (answer === undefined) delete pages[page];
                    else pages[page] = answer.action === 'rename-existing' && answer.to === '' ? { action: 'rename-existing', to: movedAddress(page.replace(/^\/p\//, '')) } : answer;
                    onAnswers({ ...answers, pages });
                  }}
                  onRenameTo={(page, to) => onAnswers({ ...answers, pages: { ...answers.pages, [page]: { action: 'rename-existing', to } } })}
                />
              )}
              {tables === null || answers.useExisting ? null : (
                <TableCheck
                  plan={tables}
                  appName={app.name}
                  connectionName={connections.find((connection) => connection.id === target)?.name ?? ''}
                  open={{}}
                  onToggle={() => undefined}
                  picks={answers.picks}
                  onPick={(ref, pick) => onAnswers({ ...answers, picks: { ...answers.picks, [ref]: pick } })}
                  renameTo={answers.renameTo}
                  onRenameTo={(ref, value) => onAnswers({ ...answers, renameTo: { ...answers.renameTo, [ref]: value } })}
                  prefix=""
                  onPrefix={() => undefined}
                  altPrefixInUse={null}
                  onUsualPrefix={() => undefined}
                  allowAltPrefix={false}
                  busy={busy}
                />
              )}
              <OutsideAddressesCard items={plan.afterInstall} forUpdate={app.route === 'update'} />
              {plan.instance === undefined ? null : <InstanceCard part={plan.instance} answers={answers.instance} onAnswers={(instance) => onAnswers({ ...answers, instance })} />}
              {app.sides.length > 0 && plan.madeAt !== undefined ? <ScreensWarning /> : null}
              <AfterInstallCard items={plan.afterInstall} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** For a connection manager: the workspace the databases the apps go into are put in. */
function WorkspaceChoiceCard({
  name,
  server,
  mode,
  onMode,
  workspaces,
  existingId,
  onExisting,
}: {
  name: string;
  server: string;
  mode: 'create' | 'existing' | 'none';
  onMode: (next: 'create' | 'existing' | 'none') => void;
  workspaces: readonly WorkspaceRow[];
  existingId: string;
  onExisting: (id: string) => void;
}) {
  const selectId = useId();
  const none = workspaces.length === 0;
  const taken = workspaces.some((one) => one.name.toLowerCase() === name.toLowerCase());
  return (
    <section className={SECTION} data-part="workspace-choice">
      <div className="flex flex-wrap items-center gap-[9px]">
        <FolderTree aria-hidden className="size-[17px] text-accent" />
        <h3 className={SECTION_TITLE} id={`${selectId}-title`}>
          {t('studio:workspaceFiles.choice.title', 'Workspace')}
        </h3>
      </div>
      <RadioGroup aria-labelledby={`${selectId}-title`} value={mode} onValueChange={(next) => onMode(next as 'create' | 'existing' | 'none')} className="flex flex-col gap-2">
        {taken ? null : (
          <RadioCard
            value="create"
            title={t('studio:workspaceFiles.choice.create', 'Create workspace {name}', { name })}
            description={t('studio:workspaceFiles.choice.createHint', 'The databases the apps go into are put in it.')}
          />
        )}
        <RadioCard
          value="existing"
          disabled={none}
          title={taken ? t('studio:workspaceFiles.choice.addTo', 'Add to {name}', { name }) : t('studio:workspaceFiles.choice.existing', 'Add to an existing workspace')}
          description={none ? t('studio:workspaceFiles.choice.noneYet', 'No workspaces on {server} yet', { server }) : t('studio:workspaceFiles.choice.existingHint', 'Pick it below.')}
        />
        <RadioCard
          value="none"
          title={t('studio:workspaceFiles.choice.none', 'No workspace')}
          description={none ? t('studio:workspaceFiles.choice.noneHintFirst', 'The databases stay as they are in the menu.') : t('studio:workspaceFiles.choice.noneHint', 'The databases stay in Other databases.')}
        />
      </RadioGroup>
      {mode === 'existing' && !none ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={selectId} className="text-[12.5px] font-bold">
            {t('studio:workspaceFiles.choice.existingLabel', 'Existing workspace')}
          </label>
          <Select id={selectId} value={existingId} onChange={(event) => onExisting(event.currentTarget.value)}>
            {workspaces.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {mode === 'create' && none ? (
        <p role="note" className="flex items-start gap-2 rounded-[10px] bg-info-soft px-3.5 py-2.5 text-[12.5px] leading-[1.5]" data-part="first-workspace">
          <Info aria-hidden className="mt-px size-4 shrink-0 text-info" />
          {t('studio:workspaceFiles.choice.first', 'Everyone’s menu groups by workspace from now on. Databases in none show under Other databases.')}
        </p>
      ) : null}
    </section>
  );
}

/** 9c and 9d: what happened to each app, the workspace, and what is left. */
function DoneScreen({
  file,
  server,
  busy,
  restReady,
  onRest,
  onReview,
  connections,
  workspaces,
}: {
  file: WorkspaceFile;
  server: string;
  busy: boolean;
  /** Every stopped app's plan is read again: Install the rest can send it. */
  restReady: boolean;
  onRest: () => void;
  onReview: () => void;
  connections: readonly { id: string; name: string }[];
  workspaces: readonly WorkspaceRow[];
}) {
  const done = doneCount(file);
  const total = file.apps.length;
  const stopped = file.apps.find((app) => app.state === 'stopped');
  const waiting = file.apps.filter((app) => app.state === 'pending');
  const nameOf = (id: string | null) => connections.find((connection) => connection.id === id)?.name ?? id ?? '';
  const workspace = file.workspace?.workspaceId === undefined ? null : (workspaces.find((one) => one.id === file.workspace?.workspaceId) ?? { id: file.workspace.workspaceId, name: file.workspace.name ?? '', connectionIds: [] });
  const joined = [...new Set(file.apps.map((app) => app.target).filter((id): id is string => id !== null))];
  return (
    <div className="flex flex-col gap-5" data-part="workspace-file-done">
      {stopped !== undefined ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[12px] border border-warn/25 bg-warn-soft px-[15px] py-3 text-[13px] leading-[1.5]">
          <CircleAlert aria-hidden className="size-4 shrink-0 text-warn" />
          <span className="min-w-0 flex-1">
            {t('studio:workspaceFiles.done.stopped', '{done} of {total} installed. {app} stopped. Nothing of it was kept.', { done, total, app: stopped.name })}
          </span>
          <Button disabled={busy || !restReady} loading={busy} onClick={onRest}>
            <RotateCcw aria-hidden />
            {t('studio:workspaceFiles.done.rest', 'Install the rest')}
          </Button>
        </div>
      ) : (
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
            <CircleCheck aria-hidden className="size-5 text-pos" />
            {t('studio:workspaceFiles.done.title', '{done} of {total} apps are installed', { done, total })}
          </h3>
          <p className="mt-1 text-sm text-fg-muted">
            {file.workspace?.mode === 'create' && workspace !== null
              ? t('studio:workspaceFiles.done.inNew', 'They are on {server}, in the new workspace {workspace}.', { server, workspace: workspace.name })
              : workspace !== null
                ? t('studio:workspaceFiles.done.inExisting', 'They are on {server}, in the workspace {workspace}.', { server, workspace: workspace.name })
                : t('studio:workspaceFiles.done.on', 'They are on {server}.', { server })}
          </p>
        </div>
      )}
      <section className={SECTION}>
        <h3 className={SECTION_TITLE}>{t('studio:workspaceFiles.done.what', 'What happened')}</h3>
        <ul className="flex flex-col">
          {file.apps.map((app) => (
            <li key={app.key} className="flex flex-wrap items-center gap-3 border-b border-border py-2.5 last:border-b-0" data-testid={`done-${app.key}`}>
              <span className="text-[13px] font-bold">{app.name}</span>
              <MonoText className="text-xs text-fg-muted">{app.version}</MonoText>
              <span className="flex-1" />
              {app.state === 'installed' || app.state === 'updated' ? (
                <span className="flex items-center gap-1.5 text-[12.5px]">
                  <Badge tone="pos">
                    <Check aria-hidden className="size-3" />
                    {app.state === 'updated' ? t('studio:workspaceFiles.status.updated', 'Updated') : t('studio:workspaceFiles.done.installed', 'Installed')}
                  </Badge>
                  {sentence('studio:workspaceFiles.done.onDatabase', 'on {database}', { database: <MonoText>{nameOf(app.target)}</MonoText> })}
                </span>
              ) : app.state === 'stopped' ? (
                <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
                  <Badge tone="warn">{t('studio:workspaceFiles.status.stopped', 'Stopped')}</Badge>
                  {t('studio:workspaceFiles.done.nothingKept', 'nothing kept')}
                </span>
              ) : app.state === 'refused' ? (
                <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
                  <Badge tone="danger">{t('studio:workspaceFiles.done.notInstalled', 'Not installed')}</Badge>
                  {app.refusal?.message ?? ''}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
                  <Badge tone="warn">{t('studio:workspaceFiles.status.choice', 'Needs a choice')}</Badge>
                  {t('studio:workspaceFiles.done.waiting', 'not installed yet')}
                </span>
              )}
            </li>
          ))}
          {workspace === null || joined.length === 0 ? null : (
            <li className="flex flex-wrap items-center gap-3 py-2.5" data-testid="done-workspace">
              <Users aria-hidden className="size-4 text-fg-subtle" />
              <span className="text-[13px] font-bold">{t('studio:workspaceFiles.done.workspace', 'Workspace')}</span>
              <span className="text-[12.5px] text-fg-muted">
                {workspace.name} · <MonoText>{joined.map(nameOf).join(', ')}</MonoText>
              </span>
            </li>
          )}
        </ul>
      </section>
      <div className="flex flex-wrap gap-2">
        {waiting.length > 0 && stopped === undefined ? (
          <Button variant="secondary" onClick={onReview}>
            <Database aria-hidden />
            {t('studio:workspaceFiles.done.chooseRest', 'Choose a database for the rest')}
          </Button>
        ) : null}
        {workspace === null ? null : (
          <a href="/studio" className="inline-flex items-center gap-2 self-start rounded-[11px] border border-border-strong bg-surface px-4 py-2.5 text-[13.5px] font-bold hover:border-fg-subtle">
            {t('studio:workspaceFiles.done.openWorkspace', 'Open the workspace')}
          </a>
        )}
      </div>
    </div>
  );
}
