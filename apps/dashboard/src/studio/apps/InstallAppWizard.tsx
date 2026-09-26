// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing an app, ported from `Marketplace.dc.html`'s install
 * wizard.
 *
 * The comp draws a six-screen flow: source → connection → schema plan →
 * settings → review & install → success, over a sticky Cancel/Back/Next
 * footer. This is that flow, in the house page-wizard shape `ConnectWizard`
 * established (`Stepper` header, one step body, sticky footer), carrying the
 * comp's own elements: the connection cards with their table count and access
 * badge, the per-table plan cards with a `CREATE TABLE` preview in a dark code
 * block, the "N created · M reused" summary bar, and the success screen.
 *
 * ─── Departures from the comp, all forced by what the server does ───────────
 *
 * Each one is a capability the comp draws and nothing behind it implements.
 * Drawing them anyway would be a page that promises what it cannot do.
 *
 *  **D1 — no settings step.** The comp's step 3 fills in the app's required
 *  settings. An install does not create `settings` (nor `pages`, `roles`,
 * `seeds`) — that is and it is unbuilt. The step is omitted rather than shown
 *  empty, and the success screen says surfaces rather than the comp's "a new
 *  group is now in your sidebar", which would be untrue.
 *
 *  **D2 — the plan's Create/Map-existing toggle is a badge, not a control.**
 *  The comp offers per-table column mapping onto an existing table. The server
 *  has no mapping: it creates a table or reuses one of the same name, and
 *  REFUSES a reuse whose columns are short rather than altering a table the
 * operator owns (rule). A segmented control with one reachable option is a
 *  control that lies, so the outcome is stated instead.
 *
 *  **D3 — review is folded into the plan step.** With settings, pages and
 *  roles out of scope, the comp's review screen restates the plan step's own
 *  summary bar. Its four stat tiles live on that bar instead.
 *
 *  **D4 — the bundle is a `.tgz`, not `manifest.json`.** The comp's upload
 *  tile takes "a .json module". A manifest alone carries no built surfaces,
 *  and the store's hardened unpack is what makes an upload safe to serve at
 *  this origin at all. Like the comp's tile, it asks for nothing but the file:
 *  the app's key and version are read from the manifest inside it.
 *
 *  **D5 — no source step.** The comp's first screen chooses marketplace or
 *  upload. The marketplace choice is made on the shelf instead, which now lists
 *  the online app catalog too (48 G8-D7): clicking a card IS choosing the
 *  marketplace, and the page downloads a catalog-only app before opening this
 *  wizard on it. "Install an app" is the upload tile. A source step here would
 *  be a second copy of the shelf, asking a question the click already answered.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  IconTile,
  Input,
  MonoText,
  RadioCard,
  RadioGroup,
  Spinner,
  Stepper,
  type Step,
} from '@adminium/ui';
import {
  Check,
  ChevronDown,
  CircleAlert,
  ChevronRight,
  Database,
  ExternalLink,
  FileUp,
  GitCompareArrows,
  LayoutPanelLeft,
  Package,
  Puzzle,
  RotateCcw,
  Sprout,
  Table2,
} from 'lucide-react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { addOnCatalogQuery, downloadAddOn, getAddOnJob } from '../add-ons/addOnsApi.js';
import { connectionsQuery } from '../hub/ConnectionsHub.js';
import {
  AddOnsInstallCard,
  addOnBlock,
  addOnChoicesOf,
  addOnStepsOf,
  type AddOnPicks,
} from './AddOnsInstallCard.js';
import { namesList, sentence } from './addOnWords.js';
import {
  APPS_QUERY_KEY,
  APP_CATALOG_QUERY_KEY,
  ddlPreview,
  installApp,
  planApp,
  sha512Of,
  uploadApp,
  type AddOnsDone,
  type AppAddOnRow,
  type AppInstallPlan,
  type InstallAnswers,
  type InstallStoppedDetails,
  type InstalledAppResult,
  type PlannedAppTable,
  type StagedApp,
} from './appsApi.js';
import { SURFACES_QUERY_KEY } from './hostedAppsApi.js';
import {
  CheckHint,
  InstallStopped,
  Installing,
  TableCheck,
  isCardProblem,
  prefixOf,
  suggestedPrefix,
  type TakenPick,
} from './InstallCheck.js';
import { PublicAccessInstallCard, publicAccessBlocked } from './PublicAccessInstallCard.js';
import { SampleInstallCard, runSampleAdd } from './SampleData.js';

type StepId = 'bundle' | 'database' | 'plan' | 'done';

/** The answers the pickers describe, in a stable key order so two can be compared. */
function answersOf(
  picks: Record<string, TakenPick>,
  renameTo: Record<string, string>,
  prefix: string,
): InstallAnswers {
  const choices: NonNullable<InstallAnswers['choices']> = {};
  let altPrefix: string | undefined;
  for (const ref of Object.keys(picks).sort()) {
    const pick = picks[ref];
    if (pick === 'reuse') choices[ref] = { action: 'reuse' };
    else if (pick === 'rename-existing') choices[ref] = { action: 'rename-existing', to: renameTo[ref] ?? '' };
    else if (pick === 'alt-prefix') altPrefix = prefix;
  }
  return {
    ...(Object.keys(choices).length === 0 ? {} : { choices }),
    ...(altPrefix === undefined ? {} : { altPrefix }),
  };
}

function hasTables(plan: AppInstallPlan): plan is AppInstallPlan & { tables: PlannedAppTable[] } {
  return plan.tables !== undefined;
}

const STEP_IDS: readonly StepId[] = ['bundle', 'database', 'plan', 'done'];

export interface InstallAppWizardProps {
  onClose: () => void;
  /**
   * An app picked off the shelf, already staged in the store.
   *
   * This is the comp's source step returning — D5 dropped it because with no
   * feed the choice had one option, and the bundled set (step 4a) gives it a
   * second. Rather than a step that asks a question already answered by WHICH
   * CARD was clicked, the bundle step becomes the comp's confirmation of the
   * app you chose, and Upload stays the other way in.
   */
  preselected?:
    | {
        key: string;
        version: string;
        name: string;
        /** True when the page just downloaded it from the online app catalog. */
        downloaded?: boolean | undefined;
      }
    | undefined;
}

export function InstallAppWizard({ onClose, preselected }: InstallAppWizardProps) {
  const queryClient = useQueryClient();
  const { data: connections } = useSuspenseQuery(connectionsQuery());

  const [step, setStep] = useState<StepId>('bundle');
  const [error, setError] = useState<string | null>(null);

  // Step 1 — the bundle.
  const [file, setFile] = useState<File | null>(null);
  const [integrity, setIntegrity] = useState('');
  /*
   * WHICH APP THIS IS, and the only place later steps read it from.
   *
   * Never typed. A shelf app brings its identity from the card; an upload gets
   * it back from the server, which reads it out of the bundle's own manifest.
   * The form used to ask for both, and a key that differed from the manifest
   * uploaded fine and was refused one step later, on the database step.
   */
  const [staged, setStaged] = useState<StagedApp | null>(
    // A shelf app is ALREADY on disk — the boot seed staged it — so there is
    // nothing to upload and the footer can name it from the first step.
    preselected === undefined
      ? null
      : {
          key: preselected.key,
          version: preselected.version,
          name: preselected.name,
          files: 0,
          integrity: '',
          sides: [],
        },
  );

  // Step 2 — where it goes.
  const [connectionId, setConnectionId] = useState('');

  // Step 3 — what it would do.
  const [plan, setPlan] = useState<AppInstallPlan | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<InstalledAppResult | null>(null);
  /*
   * The check step's answers. `checked` is what the plan on screen was made
   * with, and so what the install sends: a pick, a name or a prefix that has
   * not been checked yet changes what the install would do, and Install waits.
   */
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [picks, setPicks] = useState<Record<string, TakenPick>>({});
  const [renameTo, setRenameTo] = useState<Record<string, string>>({});
  const [prefix, setPrefix] = useState('');
  const [checked, setChecked] = useState<InstallAnswers>({});
  const [stopped, setStopped] = useState<InstallStoppedDetails | null>(null);
  // Unticked by default; added once the install is done, as its own job.
  const [addSample, setAddSample] = useState(false);
  // Ticked by default: the app's customer screens need it to work.
  const [allowPublic, setAllowPublic] = useState(true);
  // The Add-ons card's ticks and "Update it too", by add-on key.
  const [addOnPicks, setAddOnPicks] = useState<AddOnPicks>({ ticked: {}, update: {} });
  const [downloading, setDownloading] = useState<{ key: string; pct: number } | null>(null);
  const answers = answersOf(picks, renameTo, prefix);
  const dirty = JSON.stringify(answers) !== JSON.stringify(checked);
  const connectionName = connections.find((connection) => connection.id === connectionId)?.name ?? '';
  const addOnRows: readonly AppAddOnRow[] = plan?.addOns ?? [];
  const appName = staged?.name ?? '';
  // What holds the install on the add-ons' account, in words; null when nothing does.
  const addOnHint = addOnRows.length === 0 ? null : addOnBlock(appName, addOnRows, addOnPicks);
  // Whether the catalogue is on, for the words under an add-on that cannot be had.
  const catalogue = useQuery({ ...addOnCatalogQuery, enabled: addOnRows.some((row) => row.state === 'unavailable') });

  const stepIndex = STEP_IDS.indexOf(step);
  const steps: Step[] = [
    { id: 'bundle', label: t('studio:hostedApps.install.steps.bundle', 'Bundle') },
    { id: 'database', label: t('studio:hostedApps.install.steps.database', 'Database') },
    { id: 'plan', label: t('studio:hostedApps.install.steps.plan', 'Schema plan') },
    { id: 'done', label: t('studio:hostedApps.install.steps.done', 'Done') },
  ];

  const upload = useMutation({
    mutationFn: async () => {
      if (file === null) throw new Error('no file');
      /*
       * The operator's own hash wins when they have one: then the check is real
       * end to end and the server's constant-time compare is what fails. With
       * no value the browser computes one — see `sha512Of` on why that is the
       * right default and what it is worth.
       */
      const expectedSha512 = integrity.trim() === '' ? await sha512Of(file) : integrity.trim();
      return uploadApp(file, { expectedSha512 });
    },
    onSuccess: (next) => {
      setStaged(next);
      setError(null);
      setStep('database');
      /*
       * The bundle is on disk from this moment, whatever the operator does
       * next, so the installed list (its staged row) and the shelf (its card)
       * are already out of date. Left to the install, a Cancel went back to the
       * lists as they were before the upload: a suspense query refetches on
       * remount only once it is a second old, so the bundle stayed invisible.
       * Not awaited, so the wizard moves on at once. Nothing observes either
       * query while it is open, so this marks them stale for the remount.
       */
      void queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: APP_CATALOG_QUERY_KEY });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const preview = useMutation({
    mutationFn: (with_: InstallAnswers) => {
      if (staged === null) throw new Error('no bundle');
      return planApp({ key: staged.key, version: staged.version, connectionId, ...with_ });
    },
    onSuccess: ({ plan: next }, with_) => {
      setPlan(next);
      setChecked(with_);
      setError(null);
      setStep('plan');
    },
    onError: (cause: Error) => setError(cause.message),
  });

  /** The sample data, after the install: the app has to be there first. */
  const sample = useMutation({
    mutationFn: (key: string) => runSampleAdd(key, () => undefined),
  });

  const install = useMutation({
    mutationFn: () => {
      if (staged === null) throw new Error('no bundle');
      return installApp({
        key: staged.key,
        version: staged.version,
        connectionId,
        // The plan on screen. A database that changed since answers
        // SCHEMA_DRIFT, and the check is re-run below rather than installing
        // something nobody reviewed.
        ...(plan?.checksum === undefined ? {} : { planChecksum: plan.checksum }),
        ...(plan?.publicAccess === undefined
          ? {}
          : { publicAccess: allowPublic && !publicAccessBlocked(plan.publicAccess) }),
        // Every add-on the install acts on, at the version the check showed:
        // a version that moved since answers SCHEMA_DRIFT, and is checked again.
        ...(addOnRows.length === 0 ? {} : { addOns: addOnChoicesOf(addOnRows, addOnPicks) }),
        ...checked,
      });
    },
    onSuccess: async (next) => {
      setResult(next);
      setError(null);
      setStopped(null);
      setStep('done');
      if (addSample && plan?.sampleData === true) sample.mutate(next.key);
      // Both lists change: the app is installed, and it is now a surface.
      await queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: SURFACES_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: APP_CATALOG_QUERY_KEY });
    },
    onError: (cause: Error) => {
      // Stopped part way: the tables it made are recorded, and the same
      // request finishes from there. Its own screen says so.
      if (cause instanceof ApiError && cause.code === 'APP_INSTALL_INCOMPLETE') {
        const details = (cause.details ?? {}) as Partial<InstallStoppedDetails>;
        setStopped({
          stage: details.stage ?? 'tables',
          table: details.table ?? null,
          created: details.created ?? [],
          pending: details.pending ?? [],
          cause: details.cause ?? cause.message,
          ...(details.addOns === undefined ? {} : { addOns: details.addOns }),
        });
        setError(null);
        return;
      }
      setError(cause.message);
      // The check is stale, so show the fresh one in its place.
      // Re-run, then say why the check changed: the re-plan's own success would
      // otherwise clear the message the moment the new check arrived.
      if (cause instanceof ApiError && (cause.code === 'SCHEMA_DRIFT' || cause.code.startsWith('ADD_ON_'))) {
        preview.mutate(checked, { onSuccess: () => setError(cause.message) });
      }
    },
  });

  /**
   * An add-on in the catalogue but not on this server: downloaded first, as a
   * job, then the check is made again — its own plan can only be read once its
   * bytes are here.
   */
  const download = useMutation({
    mutationFn: async (row: AppAddOnRow) => {
      if (row.offeredVersion === null) throw new Error('no version');
      setDownloading({ key: row.key, pct: 0 });
      const { jobId } = await downloadAddOn(row.key, row.offeredVersion);
      for (;;) {
        const job = await getAddOnJob(jobId);
        setDownloading({ key: row.key, pct: job.progress?.pct ?? 0 });
        if (job.status === 'succeeded') return;
        if (job.status === 'failed' || job.status === 'cancelled') {
          throw new Error(
            job.lastError ?? t('studio:addOns.job.failed', 'The download did not finish. Nothing was installed.'),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    },
    onSuccess: () => {
      setError(null);
      preview.mutate(checked);
    },
    onError: (cause: Error) => setError(cause.message),
    onSettled: () => setDownloading(null),
  });

  /** Pick what to do with a taken table. A pick with nothing to type re-checks at once. */
  const onPick = (ref: string, pick: TakenPick) => {
    const table = plan?.tables?.find((candidate) => candidate.ref === ref);
    const nextPicks = { ...picks, [ref]: pick };
    const nextRename =
      pick === 'rename-existing' && renameTo[ref] === undefined && table !== undefined
        ? { ...renameTo, [ref]: table.renameExistingTo ?? `${table.table}_old` }
        : renameTo;
    const nextPrefix =
      pick === 'alt-prefix' && prefix === '' && table !== undefined && staged !== null
        ? suggestedPrefix(staged.key, prefixOf(table))
        : prefix;
    setPicks(nextPicks);
    setRenameTo(nextRename);
    setPrefix(nextPrefix);
    if (pick !== 'alt-prefix') preview.mutate(answersOf(nextPicks, nextRename, nextPrefix));
  };

  const busy = upload.isPending || preview.isPending || install.isPending || download.isPending;
  const checking = step === 'plan' && plan !== null && hasTables(plan);

  return (
    <section className="flex min-h-full flex-col gap-6">
      <header>
        <Stepper
          steps={steps}
          activeIndex={stepIndex}
          label={t('studio:hostedApps.install.progress', 'Install progress')}
          onStepClick={(index) => {
            // Back-navigation only; forward moves go through the footer, which
            // is where the upload and the plan actually happen.
            const target = STEP_IDS[index];
            if (index < stepIndex && target !== undefined && target !== 'done') setStep(target);
          }}
        />
      </header>

      {error === null ? null : (
        <Alert tone="danger" title={t('studio:hostedApps.install.failed', 'Install failed')}>
          {error}
        </Alert>
      )}

      {/*
        * The app this install is for, once it is known: picked off the shelf,
        * or read from an uploaded bundle (reached by stepping back after the
        * upload). The comp's marketplace tile draws this row — name, then the
        * version in mono — so an upload confirms itself the same way.
        */}
      {step === 'bundle' && staged !== null ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">
              {t('studio:hostedApps.install.chosen.title', 'Install {app}', {
                app: staged.name,
              })}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              {preselected === undefined
                ? t(
                    'studio:hostedApps.install.uploaded.hint',
                    'Read from the manifest.json inside the bundle you uploaded. Nothing is created until you confirm the schema plan.',
                  )
                : preselected.downloaded === true
                  ? t(
                      'studio:hostedApps.install.downloaded.hint',
                      'Downloaded from the online app catalogue and checked against its published fingerprint. Nothing is created until you confirm the schema plan.',
                    )
                  : t(
                      'studio:hostedApps.install.chosen.hint',
                      'This app came with your build and is already on disk. Nothing is created until you confirm the schema plan.',
                    )}
            </p>
          </div>
          <Card>
            <CardBody className="flex items-center gap-3">
              <IconTile>
                <Package aria-hidden className="size-5" />
              </IconTile>
              <span className="flex-1 text-sm font-bold">{staged.name}</span>
              <MonoText className="text-xs text-fg-muted">{staged.version}</MonoText>
            </CardBody>
          </Card>
          {preselected === undefined ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              disabled={busy}
              onClick={() => {
                // The staged bytes stay on disk, as they would after a Cancel;
                // the installed list offers to discard them.
                setStaged(null);
                setFile(null);
                // A pasted hash describes the old file, and would refuse the next.
                setIntegrity('');
                setPlan(null);
                setError(null);
              }}
            >
              <FileUp aria-hidden className="size-4" />
              {t('studio:hostedApps.install.uploaded.replace', 'Upload a different bundle')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {step === 'bundle' && staged === null ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">
              {t('studio:hostedApps.install.bundle.title', 'Upload the app bundle')}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              {t(
                'studio:hostedApps.install.bundle.hint',
                'The app’s release file (.tgz) — it holds manifest.json and a staff/ or customer/ directory.',
              )}
            </p>
          </div>

          <Card>
            <CardBody className="flex flex-col gap-4">
              <FormField
                label={t('studio:hostedApps.install.bundle.file', 'Bundle file (.tgz)')}
                helper={t(
                  'studio:hostedApps.install.bundle.fileHint',
                  'Nothing is created until you confirm on the schema-plan step.',
                )}
              >
                <Input
                  type="file"
                  accept=".tgz,.tar.gz,application/gzip"
                  aria-label={t('studio:hostedApps.install.bundle.file', 'Bundle file (.tgz)')}
                  onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
                />
              </FormField>
              <FormField
                label={t('studio:hostedApps.install.bundle.integrity', 'Integrity (optional)')}
                helper={t(
                  'studio:hostedApps.install.bundle.integrityHint',
                  'Paste the sha512- fingerprint published with the release to have the server check these exact bytes. Left empty, it is computed here.',
                )}
              >
                <Input
                  value={integrity}
                  onChange={(event) => setIntegrity(event.currentTarget.value)}
                  placeholder="sha512-…"
                />
              </FormField>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {step === 'database' ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">
              {t('studio:hostedApps.install.database.title', 'Install into which database?')}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              {t(
                'studio:hostedApps.install.database.hint',
                'Pick a writable connection. This is where the tables will be created, and it is what the app reads afterwards.',
              )}
            </p>
          </div>
          <RadioGroup
            value={connectionId}
            onValueChange={setConnectionId}
            className="flex flex-col gap-3"
          >
            {connections.map((connection) => (
              <RadioCard
                key={connection.id}
                value={connection.id}
                disabled={connection.readOnly}
                /*
                 * G1 — the comp puts a radio at the START of the row, and the
                 * reason is not decoration: `RadioCard`'s own indicator appears
                 * only once something is checked, so a list nobody has touched
                 * (an instance with ONE connection, the common case) reads as a
                 * static card that happens to be clickable. The leading circle
                 * says "this is a choice" before a choice exists. The corner
                 * indicator is hidden so the two do not say it twice.
                 */
                hideIndicator
                icon={
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden
                      data-part="connection-radio"
                      className="grid size-[18px] shrink-0 place-items-center rounded-full border-2 border-border-strong group-data-[state=checked]:border-accent group-data-[state=checked]:bg-accent"
                    >
                      <span className="size-[7px] rounded-full bg-accent-fg opacity-0 group-data-[state=checked]:opacity-100" />
                    </span>
                    <IconTile>
                      <Database aria-hidden className="size-[18px]" />
                    </IconTile>
                  </span>
                }
                title={connection.name}
                description={connection.engine}
                trailing={
                  <span className="flex items-center gap-3">
                    {connection.tableCount === null ? null : (
                      <MonoText className="text-xs text-fg-muted">
                        {t('studio:hostedApps.install.database.tables', 'Tables: {count}', {
                          count: connection.tableCount,
                        })}
                      </MonoText>
                    )}
                    <Badge tone={connection.readOnly ? 'warn' : 'neutral'}>
                      {connection.readOnly
                        ? t('studio:hostedApps.install.database.readOnly', 'Read-only')
                        : t('studio:hostedApps.install.database.writable', 'Writable')}
                    </Badge>
                  </span>
                }
              />
            ))}
          </RadioGroup>
          {connections.every((connection) => connection.readOnly) ? (
            <Alert
              tone="warn"
              title={t('studio:hostedApps.install.database.noWritable', 'No writable connection')}
            >
              {t(
                'studio:hostedApps.install.database.allReadOnly',
                'Every connection here uses a read-only role, so no app can create its tables. Connect one that can run DDL first.',
              )}
            </Alert>
          ) : null}
        </div>
      ) : null}

      {checking && install.isPending ? (
        <Installing
          appName={staged?.name ?? ''}
          connectionName={connectionName}
          addOnSteps={addOnStepsOf(addOnRows, addOnPicks)}
        />
      ) : null}

      {checking && !install.isPending && stopped !== null ? (
        <InstallStopped
          details={stopped}
          busy={busy}
          onRetry={() => install.mutate()}
          onBack={() => {
            // The tables it made are there now, so the check is made again.
            setStopped(null);
            preview.mutate(checked);
          }}
        />
      ) : null}

      {checking && !install.isPending && stopped === null && plan !== null && hasTables(plan) ? (
        <div className="flex flex-col gap-4">
          <PlanAlerts plan={plan} appName={staged?.name ?? ''} connections={connections} />
          <TableCheck
            plan={plan}
            appName={staged?.name ?? ''}
            connectionName={connectionName}
            open={openRows}
            onToggle={(ref) => setOpenRows((rows) => ({ ...rows, [ref]: rows[ref] !== true }))}
            picks={picks}
            onPick={onPick}
            renameTo={renameTo}
            onRenameTo={(ref, value) => setRenameTo((names) => ({ ...names, [ref]: value }))}
            prefix={prefix}
            onPrefix={setPrefix}
            altPrefixInUse={checked.altPrefix ?? null}
            onUsualPrefix={() => {
              const nextPicks = Object.fromEntries(
                Object.entries(picks).filter(([, pick]) => pick !== 'alt-prefix'),
              );
              setPicks(nextPicks);
              preview.mutate(answersOf(nextPicks, renameTo, prefix));
            }}
            busy={busy}
          />
          {plan.publicAccess !== undefined || plan.sampleData === true || addOnRows.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(272px,1fr))] gap-3">
              {plan.publicAccess === undefined ? null : (
                <PublicAccessInstallCard access={plan.publicAccess} checked={allowPublic} onChange={setAllowPublic} />
              )}
              {/* An app that names no add-on has no card, and installs as before. */}
              {addOnRows.length === 0 ? null : (
                <AddOnsInstallCard
                  appName={appName}
                  connectionName={connectionName}
                  rows={addOnRows}
                  picks={addOnPicks}
                  onTick={(key, next) => setAddOnPicks((picks) => ({ ...picks, ticked: { ...picks.ticked, [key]: next } }))}
                  onUpdate={(key, next) => setAddOnPicks((picks) => ({ ...picks, update: { ...picks.update, [key]: next } }))}
                  catalogueOn={catalogue.data?.onlineEnabled ?? null}
                  downloading={downloading}
                  onDownload={(row) => download.mutate(row)}
                  busy={busy}
                  grants={plan.addOnGrants}
                />
              )}
              {plan.sampleData === true ? <SampleInstallCard checked={addSample} onChange={setAddSample} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 'plan' && plan !== null && !hasTables(plan) ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">
              {t('studio:hostedApps.install.plan.title', 'Review the schema plan')}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              {t(
                'studio:hostedApps.install.plan.hint',
                'Exactly what will be created in your database. Nothing has been written yet.',
              )}
            </p>
          </div>

          <PlanAlerts plan={plan} appName={staged?.name ?? ''} connections={connections} />

          <div className="flex flex-col gap-3">
            {[
              ...plan.create.map((table) => ({ table, action: 'create' as const })),
              ...plan.reuse.map((table) => ({ table, action: 'reuse' as const })),
            ].map(({ table, action }) => {
              const expanded = open === table.ref;
              return (
                <Card key={table.ref}>
                  <CardHeader className="flex items-center gap-3">
                    <Table2 aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                    <MonoText className="flex-1 truncate text-sm font-bold">{table.ref}</MonoText>
                    {/* D2: the outcome, not a choice — there is no other. */}
                    <Badge tone={action === 'create' ? 'pos' : 'neutral'}>
                      {action === 'create'
                        ? t('studio:hostedApps.install.plan.create', 'Create')
                        : t('studio:hostedApps.install.plan.reuse', 'Reuse existing')}
                    </Badge>
                    {action === 'create' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : table.ref)}
                      >
                        {expanded ? (
                          <ChevronDown aria-hidden className="size-4" />
                        ) : (
                          <ChevronRight aria-hidden className="size-4" />
                        )}
                        <span className="sr-only">
                          {t('studio:hostedApps.install.plan.toggleDdl', 'Show the DDL preview')}
                        </span>
                      </Button>
                    ) : null}
                  </CardHeader>
                  {expanded && action === 'create' && 'columns' in table ? (
                    <CardBody className="flex flex-col gap-2">
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">
                        {t('studio:hostedApps.install.plan.ddl', 'DDL preview')}
                      </span>
                      <pre className="overflow-x-auto rounded-xl bg-fg p-4 text-xs leading-relaxed text-surface">
                        <code>{ddlPreview(table)}</code>
                      </pre>
                      <p className="text-xs text-fg-subtle">
                        {t(
                          'studio:hostedApps.install.plan.ddlNote',
                          'Illustrative. The server emits the exact statement for your engine, including foreign keys.',
                        )}
                      </p>
                    </CardBody>
                  ) : null}
                </Card>
              );
            })}
          </div>

          <div
            data-part="plan-summary"
            className="flex items-center gap-3 rounded-xl bg-surface-3 px-4 py-3 text-sm text-fg-muted"
          >
            {/* G5 — the comp's `git-compare-arrows`, which reads the pill as a diff. */}
            <GitCompareArrows aria-hidden className="size-4 shrink-0" />
            <span>
              {t('studio:hostedApps.install.plan.summary', '{created} created · {reused} reused', {
                created: plan.create.length,
                reused: plan.reuse.length,
              })}
            </span>
          </div>
        </div>
      ) : null}

      {step === 'done' && result !== null ? (
        <div className="flex max-w-[620px] flex-col gap-4">
          <div className="flex items-start gap-[13px]">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[13px] bg-pos-soft text-pos">
              <Check aria-hidden className="size-[22px]" />
            </div>
            <div>
              <h2 className="text-[19px] font-extrabold leading-[normal] tracking-[-0.025em]">
                {t('studio:hostedApps.install.done.titleApp', '{app} is installed', {
                  app: staged?.name ?? result.key,
                })}
              </h2>
              <p className="mt-1 text-[13px] leading-[1.55] text-fg-muted">
                {t(
                  'studio:hostedApps.install.done.body',
                  '{key} is being served now. Choose where its staff side appears below.',
                  { key: result.key },
                )}
              </p>
            </div>
          </div>
          {result.schema === undefined && result.pages === undefined ? null : (
            <ul
              data-part="done-summary"
              className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm"
            >
              {result.schema === undefined ? null : (
                <DoneRow
                  icon={<Table2 aria-hidden className="size-4" />}
                  label={t('studio:hostedApps.install.done.tablesCreated', 'Tables created in {connection}', {
                    connection: connectionName,
                  })}
                  value={result.schema.created.length}
                />
              )}
              {result.schema === undefined || result.schema.reused.length === 0 ? null : (
                <DoneRow
                  icon={<RotateCcw aria-hidden className="size-4" />}
                  label={t('studio:hostedApps.install.done.tablesKept', 'Tables used as they were')}
                  value={result.schema.reused.length}
                />
              )}
              {result.pages === undefined ? null : (
                <DoneRow
                  icon={<LayoutPanelLeft aria-hidden className="size-4" />}
                  label={t('studio:hostedApps.install.done.pages', 'Pages generated')}
                  value={result.pages.created.length}
                />
              )}
              {plan?.sampleData === true ? (
                <DoneRow
                  icon={<Sprout aria-hidden className="size-4" />}
                  label={t('studio:sampleData.title', 'Sample data')}
                  value={
                    addSample && sample.isPending
                      ? t('studio:hostedApps.install.done.sampleAdding', 'adding…')
                      : addSample && sample.isSuccess
                        ? t('studio:hostedApps.install.done.sampleAdded', 'added')
                        : t('studio:hostedApps.install.done.sampleNotAdded', 'not added')
                  }
                />
              ) : null}
            </ul>
          )}
          {result.addOns === undefined ? null : <AddOnsDoneLine done={result.addOns} />}
          {sample.error === null ? null : (
            <Alert role="alert" tone="danger" title={t('studio:sampleData.addFailed', 'The sample data was not added')}>
              {sample.error.message}{' '}
              {t('studio:hostedApps.install.done.sampleLater', 'You can add it later from the app’s page.')}
            </Alert>
          )}
          {/*
            * G3 — the mounts are LINKS. The comp ends this screen with "Open
            * the till", and the thing an operator wants next is the app they
            * just installed; rendering its address as plain text asks them to
            * retype it. Same idiom the Surfaces card on this page already uses.
            */}
          <ul className="flex flex-wrap gap-2.5">
            {result.sides.map((side) => (
              <li key={side.side}>
                <a
                  className="inline-flex items-center gap-2 rounded-[11px] border border-border-strong bg-surface px-4 py-2.5 text-[13.5px] font-bold hover:border-fg-subtle"
                  href={`${side.prefix}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MonoText className="text-sm">{side.prefix}/</MonoText>
                  <ExternalLink aria-hidden className="size-[15px] rtl:-scale-x-100" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer className="sticky bottom-0 -mx-6 mt-auto flex items-center gap-3 border-t border-border bg-surface px-6 py-3.5">
        {/*
          * G4 — the comp's footer-left is a step counter on EVERY step, and
          * this slot was blank on three of four.
          *
          * It replaces the "nothing is written until you install" line rather
          * than joining it, and that loses nothing: the plan step's own
          * subtitle already says "Nothing has been written yet", which is where
          * the comp puts that reassurance too. Two places saying it and a blank
          * footer elsewhere was the worst of both.
          *
          * The app half only appears once there IS one — the comp knows its app
          * from the marketplace card it was opened from, and an upload learns
          * it from the bundle's manifest once the file has gone up.
          */}
        {checking && stopped === null && !install.isPending && plan !== null && addOnHint !== null ? (
          // The add-ons' refusal wins over the table hint: it is the one that holds Install.
          <span
            data-part="add-on-hint"
            className="inline-flex items-center gap-[7px] text-[12.5px] font-semibold text-danger"
          >
            <CircleAlert aria-hidden className="size-3.5 shrink-0" />
            {addOnHint}
          </span>
        ) : checking && stopped === null && !install.isPending && plan !== null ? (
          <CheckHint plan={plan} picks={picks} dirty={dirty} />
        ) : (
          <span className="text-sm text-fg-subtle">
            {staged === null
              ? t('studio:hostedApps.install.footerStep', 'Step {n} of {total}', {
                  n: stepIndex + 1,
                  total: STEP_IDS.length,
                })
              : t('studio:hostedApps.install.footerStepApp', 'Step {n} of {total} · {app}', {
                  n: stepIndex + 1,
                  total: STEP_IDS.length,
                  app: staged.key,
                })}
          </span>
        )}
        <span className="ms-auto flex items-center gap-2">
          {step === 'done' ? null : (
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('studio:hostedApps.install.cancel', 'Cancel')}
            </Button>
          )}
          {stepIndex > 0 &&
          step !== 'done' &&
          !(checking && (stopped !== null || install.isPending)) ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const target = STEP_IDS[stepIndex - 1];
                if (target !== undefined) setStep(target);
              }}
            >
              {t('studio:hostedApps.install.back', 'Back')}
            </Button>
          ) : null}

          {step === 'bundle' && staged !== null ? (
            <Button disabled={busy} onClick={() => setStep('database')}>
              {t('studio:hostedApps.install.continue', 'Continue')}
            </Button>
          ) : null}

          {step === 'bundle' && staged === null ? (
            <Button disabled={busy || file === null} onClick={() => upload.mutate()}>
              {upload.isPending ? <Spinner size="sm" /> : <FileUp aria-hidden className="size-4" />}
              {t('studio:hostedApps.install.upload', 'Upload')}
            </Button>
          ) : null}

          {step === 'database' ? (
            <Button
              disabled={busy || connectionId === ''}
              onClick={() => {
                // A new check for this database: earlier answers were about another.
                setPicks({});
                setRenameTo({});
                setPrefix('');
                setOpenRows({});
                setAddOnPicks({ ticked: {}, update: {} });
                preview.mutate({});
              }}
            >
              {preview.isPending ? <Spinner size="sm" /> : null}
              {t('studio:hostedApps.install.continue', 'Continue')}
            </Button>
          ) : null}

          {step === 'plan' && checking && dirty && stopped === null ? (
            <Button disabled={busy} onClick={() => preview.mutate(answers)}>
              {preview.isPending ? <Spinner size="sm" /> : null}
              {t('studio:hostedApps.install.check.again', 'Check again')}
            </Button>
          ) : null}

          {step === 'plan' && !(checking && (dirty || stopped !== null || install.isPending)) ? (
            <Button
              disabled={busy || plan === null || !plan.installable || addOnHint !== null}
              onClick={() => install.mutate()}
            >
              {install.isPending ? <Spinner size="sm" /> : null}
              {t('studio:hostedApps.install.confirm', 'Install')}
            </Button>
          ) : null}

          {step === 'done' ? (
            <Button onClick={onClose}>
              {t('studio:hostedApps.install.finish', 'Manage apps')}
            </Button>
          ) : null}
        </span>
      </footer>

      {staged === null ? null : (
        <p className="sr-only" role="status">
          {t('studio:hostedApps.install.staged', 'Files unpacked: {files}', {
            files: staged.files,
          })}
        </p>
      )}
    </section>
  );
}

/**
 * The plan's refusals and its page warnings. A taken table's own problem is
 * left to its card on the check step, where the answer to it is.
 */
function PlanAlerts({
  plan,
  appName,
  connections,
}: {
  plan: AppInstallPlan;
  appName: string;
  connections: readonly { id: string; name: string }[];
}) {
  const problems = plan.problems.filter((problem) => !isCardProblem(plan, problem));
  // The one refusal about where the app already is, said in the reader's language with the connection's name.
  const said = (problem: AppInstallPlan['problems'][number]): string =>
    problem.code === 'APP_INSTALLED_ELSEWHERE' && problem.connectionId !== undefined
      ? t(
          'studio:hostedApps.install.plan.installedElsewhere',
          '{app} is already installed on the connection {connection}. An app runs on one connection: update it there, or uninstall it there before installing it on another.',
          {
            app: appName === '' ? problem.table : appName,
            connection: connections.find((connection) => connection.id === problem.connectionId)?.name ?? problem.connectionId,
          },
        )
      : problem.message;
  return (
    <>
    {problems.length === 0 ? null : (
      <Alert
        tone="danger"
        title={t('studio:hostedApps.install.plan.refused', 'This app cannot be installed here')}
      >
        <ul className="list-disc ps-5">
          {problems.map((problem) => (
            <li key={`${problem.table}.${problem.column ?? ''}${problem.code}`}>
              {said(problem)}
            </li>
          ))}
        </ul>
      </Alert>
    )}

    {/* Not a refusal: the app installs, and a table it reuses keeps its
        secrets — the rule that would show one is skipped, as said here. */}
    {(plan.ruleWarnings ?? []).length === 0 ? null : (
      <Alert
        tone="warn"
        data-testid="app-install-rule-warnings"
        title={t(
          'studio:hostedApps.install.plan.ruleWarnings',
          'Some of this app’s rules would show what a table of yours keeps hidden, and are left out',
        )}
      >
        <ul className="list-disc ps-5">
          {(plan.ruleWarnings ?? []).map((warning) => (
            <li key={`${warning.table}.${warning.column}`}>{warning.message}</li>
          ))}
        </ul>
      </Alert>
    )}

    {/* Not a refusal: the app installs, and these pages arrive empty,
        each showing the "this page has no table" notice that leads to
        the fix. Said here so it is not a surprise afterwards. */}
    {(plan.pageWarnings ?? []).length === 0 ? null : (
      <Alert
        tone="warn"
        data-testid="app-install-page-warnings"
        title={t(
          'studio:hostedApps.install.plan.pageWarnings',
          'Some of this app’s pages will arrive without a table',
        )}
      >
        <ul className="list-disc ps-5">
          {(plan.pageWarnings ?? []).map((warning) => (
            <li key={`${warning.page}:${warning.code}`}>{warning.message}</li>
          ))}
        </ul>
      </Alert>
    )}

    </>
  );
}

/**
 * "Also installed: Invoices & Receipts. Its settings are under Add-ons." — and
 * "Also updated:" for an add-on the install moved on. An add-on only connected
 * is not news here: it was already installed, and its settings already listed.
 */
function AddOnsDoneLine({ done }: { done: AddOnsDone }) {
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | null;
  if (done.installed.length === 0 && done.updated.length === 0) return null;
  const link = (
    <a
      href="/studio/add-ons"
      className="font-bold text-accent"
      onClick={(event) => {
        if (router === null) return;
        event.preventDefault();
        void router.navigate({ to: '/studio/add-ons' });
      }}
    >
      {t('studio:appAddOns.title', 'Add-ons')}
    </a>
  );
  const names = (list: readonly { name: string }[]) => (
    <span className="font-bold text-fg">{namesList(list.map((addOn) => addOn.name))}</span>
  );
  return (
    <div
      data-part="done-add-ons"
      className="flex items-start gap-2.5 rounded-[12px] bg-surface-3 px-[15px] py-3 text-[12.5px] leading-[1.5] text-fg-muted"
    >
      <Puzzle aria-hidden className="mt-px size-4 shrink-0 text-fg-muted" />
      <p className="flex flex-col gap-1">
        {done.installed.length === 0 ? null : (
          <span>
            {sentence(
              'studio:appAddOns.done.installed',
              'Also installed: {names}. {count, plural, one {Its settings are} other {Their settings are}} under {addOns}.',
              { names: names(done.installed), addOns: link },
              { count: done.installed.length },
            )}
          </span>
        )}
        {done.updated.length === 0 ? null : (
          <span>
            {sentence(
              'studio:appAddOns.done.updated',
              'Also updated: {names}. {count, plural, one {Its settings are} other {Their settings are}} under {addOns}.',
              { names: names(done.updated), addOns: link },
              { count: done.updated.length },
            )}
          </span>
        )}
      </p>
    </div>
  );
}

/** One line of the done screen's summary: what was made, and how many. */
function DoneRow({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-[17px] py-[13px] last:border-b-0">
      <span className="shrink-0 text-fg-muted">{icon}</span>
      <span className="flex-1 text-[13px] text-fg-muted">{label}</span>
      <MonoText className="text-[13px] font-bold">{value}</MonoText>
    </li>
  );
}
