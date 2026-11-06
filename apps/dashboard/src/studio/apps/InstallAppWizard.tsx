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
 *
 * ─── Your own apps and copies per database (`Install Your Own App.dc.html`,
 * `Apps Per Database.dc.html`) ──────────────────────────────────────────────
 *
 *  The fingerprint field leaves the upload: the browser hashes the file it
 *  sends, and the person checks a fingerprint they were given on the review,
 *  where a mismatch holds Install. The upload's reply says where the file
 *  goes: nowhere yet (the steps as before), over every copy (each updated in
 *  turn through its own review, then optionally onto another database), or
 *  onto a database without a copy. The Database step lists existing databases
 *  only, marks those with a copy ("Installed · 1.0.15") and names the version
 *  being installed. Refusals are said per database. The review cards are in
 *  `installReview.tsx`, the update dialog in `UpdateReviewDialog.tsx`.
 *
 *  **W1 — the upload choice has no comp.** "Update every copy" and "Install on
 *  another database" are drawn from notes, in the bundle step's own anatomy:
 *  the app's card, then the copies with their versions, then the footer's
 *  button.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
  cn,
} from '@adminium/ui';
import {
  ArrowUpCircle,
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
  Download,
  Info,
  Send,
  ListChecks,
} from 'lucide-react';

import { ApiError } from '../../app/api.js';
import { bootstrapQuery, type BootstrapData } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { addOnCatalogQuery, downloadAddOn, getAddOnJob } from '../add-ons/addOnsApi.js';
import { connectionsQuery } from '../hub/connectionsQuery.js';
import {
  AddOnsInstallCard,
  addOnBlock,
  addOnChoicesOf,
  addOnStepsOf,
  isSelected,
  type AddOnPicks,
} from './AddOnsInstallCard.js';
import { namesList, sentence } from './addOnWords.js';
import { isWorkspaceFileRefusal } from './workspaceFiles/workspaceFilesApi.js';
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
  WorkspaceChips,
  afterInstallLines,
  existingTables,
  instanceAnswersOf,
  outsideRules,
  reviewHold,
  savedFromHere,
  uploadRefusal,
  type InstanceAnswers,
  type PageAnswer,
} from './installReview.js';
import { UpdateReviewDialog } from './UpdateReviewDialog.js';
import { DocumentsWaitingNotice } from './DocumentsWaitingNotice.js';
import {
  APPS_QUERY_KEY,
  APP_CATALOG_QUERY_KEY,
  ddlPreview,
  installApp,
  installedAppsQuery,
  planApp,
  sha512Of,
  updateApp,
  uploadApp,
  type AddOnsDone,
  type AppAddOnRow,
  type AppInstallPlan,
  type InstallAnswers,
  type InstallStoppedDetails,
  type InstalledAppResult,
  type PlannedAppTable,
  LOCAL_PUBLISHER_ID,
  type StagedApp,
  type StagedInstall,
  type UpdateAnswers,
  type UpdateStoppedDetails,
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
  type SharePick,
  type TakenPick,
} from './InstallCheck.js';
import { MapsInstallCard, PartsInstallCard, partChoicesOf } from './AppPartsCard.js';
import { PublicAccessInstallCard, publicAccessBlocked } from './PublicAccessInstallCard.js';
import { AppsRoleTablesWiderCard } from './RoleTablesList.js';
import { PrivacyGrantsCard } from './PrivacyGrantsCard.js';
import { SampleInstallCard, runSampleAdd } from './SampleData.js';

type StepId = 'bundle' | 'database' | 'plan' | 'done';

/** The answers the pickers describe, in a stable key order so two can be compared. */
export function answersOf(
  picks: Record<string, TakenPick>,
  renameTo: Record<string, string>,
  prefix: string,
  sharePicks: Record<string, SharePick> = {},
  pagePicks: Record<string, PageAnswer> = {},
  useExisting = false,
): InstallAnswers {
  const choices: NonNullable<InstallAnswers['choices']> = {};
  let altPrefix: string | undefined;
  // "Use the existing tables" answers every taken table at once: no pick of one is sent beside it.
  for (const ref of useExisting ? [] : Object.keys(picks).sort()) {
    const pick = picks[ref];
    if (pick === 'reuse') choices[ref] = { action: 'reuse' };
    else if (pick === 'rename-existing') choices[ref] = { action: 'rename-existing', to: renameTo[ref] ?? '' };
    else if (pick === 'alt-prefix') altPrefix = prefix;
  }
  const shares: NonNullable<InstallAnswers['shares']> = {};
  for (const shape of Object.keys(sharePicks).sort()) shares[shape] = sharePicks[shape]!;
  const pages: NonNullable<InstallAnswers['pages']> = {};
  for (const page of Object.keys(pagePicks).sort()) pages[page] = pagePicks[page]!;
  return {
    ...(Object.keys(choices).length === 0 ? {} : { choices }),
    ...(altPrefix === undefined ? {} : { altPrefix }),
    ...(Object.keys(shares).length === 0 ? {} : { shares }),
    ...(Object.keys(pages).length === 0 ? {} : { pages }),
    ...(useExisting ? { existing: 'use' as const } : {}),
  };
}

/** The workspaces of each database, as the bootstrap lists them (none while the server has none). */
function workspacesByConnection(bootstrap: BootstrapData | undefined): Map<string, { id: string; name: string; initials: string }[]> {
  const listed = bootstrap?.workspaces?.workspaces ?? [];
  const out = new Map<string, { id: string; name: string; initials: string }[]>();
  for (const workspace of listed) {
    for (const id of workspace.connectionIds) out.set(id, [...(out.get(id) ?? []), { id: workspace.id, name: workspace.name, initials: workspace.initials }]);
  }
  return out;
}

export function hasTables(plan: AppInstallPlan): plan is AppInstallPlan & { tables: PlannedAppTable[] } {
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
  /**
   * ONE DIALOG (plan 65, C2). The app came off adminium.dev's list by one
   * click: instead of four steps, the person is shown what it would add, the
   * database it goes to and the add-ons it brings, with Install, Cancel and
   * "More choices", which opens the steps. It installs with what the steps
   * would start with. Where that cannot be decided for them (more than one
   * database, or none), the dialog says so and "More choices" is its button.
   */
  quick?: boolean | undefined;
  /** Told whether the wizard is working (a download, a check, an install): the dialog around it does not close meanwhile. */
  onBusy?: ((busy: boolean) => void) | undefined;
  /** "More choices": open the steps on the same app. */
  onMoreChoices?: (() => void) | undefined;
  /** The upload is a workspace file (several apps): the page sends it again to the workspace upload. */
  onWorkspaceFile?: ((file: File) => void) | undefined;
}

export function InstallAppWizard({ onClose, preselected, quick = false, onMoreChoices, onBusy, onWorkspaceFile }: InstallAppWizardProps) {
  const queryClient = useQueryClient();
  const { data: connections } = useSuspenseQuery(connectionsQuery());

  const [step, setStep] = useState<StepId>('bundle');
  const [error, setError] = useState<string | null>(null);

  // Step 1 — the bundle.
  const [file, setFile] = useState<File | null>(null);
  /** An upload the server refused before anything was staged: an older file, another lineage, a newer Adminium. */
  const [refusal, setRefusal] = useState<{ title: string; body: ReactNode } | null>(null);
  /** The fingerprint typed on the review, compared in this browser with the uploaded file's own. */
  const [fingerprint, setFingerprint] = useState('');
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
  const [firstCopy, setFirstCopy] = useState(false);
  /*
   * The check step's answers. `checked` is what the plan on screen was made
   * with, and so what the install sends: a pick, a name or a prefix that has
   * not been checked yet changes what the install would do, and Install waits.
   */
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [picks, setPicks] = useState<Record<string, TakenPick>>({});
  const [renameTo, setRenameTo] = useState<Record<string, string>>({});
  // Per shape another app already has (a menu): use that app's tables, or keep separate ones.
  const [sharePicks, setSharePicks] = useState<Record<string, SharePick>>({});
  const [prefix, setPrefix] = useState('');
  // Per page address a page here already has: replace, rename the one here, or skip the app's.
  const [pagePicks, setPagePicks] = useState<Record<string, PageAnswer>>({});
  // "Use the existing tables": every table of the app that is here already, as it is.
  const [useExisting, setUseExisting] = useState(false);
  // The look and languages of the whole server, off unless ticked.
  const [instanceAnswers, setInstanceAnswers] = useState<InstanceAnswers>(NO_INSTANCE_ANSWERS);
  const [checked, setChecked] = useState<InstallAnswers>({});
  const [stopped, setStopped] = useState<InstallStoppedDetails | null>(null);
  // Unticked by default; added once the install is done, as its own job.
  const [addSample, setAddSample] = useState(false);
  // Ticked by default: the app's customer screens need it to work.
  const [allowPublic, setAllowPublic] = useState(true);
  // The Add-ons card's ticks and "Update it too", by add-on key.
  const [addOnPicks, setAddOnPicks] = useState<AddOnPicks>({ ticked: {}, update: {} });
  // The parts of the app to start with, where the operator said otherwise than the app.
  const [partPicks, setPartPicks] = useState<Record<string, boolean>>({});
  // Maps: asked by the first app that shows them, ticked unless the operator says no.
  const [showMaps, setShowMaps] = useState(true);
  /*
   * The add-ons ticked, for the check: a part built on one that is not ticked
   * is left out of the plan, so the plan is asked for with the ticks. Held in
   * a ref as well as in state, so a check made in the same breath as a tick
   * is of the ticks as they now are.
   */
  const tickedAddOns = useRef<string[] | undefined>(undefined);
  const [downloading, setDownloading] = useState<{ key: string; pct: number } | null>(null);
  const answers = answersOf(picks, renameTo, prefix, sharePicks, pagePicks, useExisting);
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
      // A workspace file by its name goes to its own upload at once: it may be larger than an app upload takes.
      if (onWorkspaceFile !== undefined && file.name.endsWith('.workspace.tgz')) throw new ApiError(422, 'VALIDATION_FAILED', 'A workspace file.', null, { reason: 'IS_WORKSPACE_FILE' });
      /*
       * The browser hashes the bytes it sends (see `sha512Of` on what that is
       * worth). A fingerprint the person was given is checked on the review,
       * against the file's own, where a mismatch holds Install.
       */
      return uploadApp(file, { expectedSha512: await sha512Of(file) });
    },
    onSuccess: (next) => {
      setStaged(next);
      setError(null);
      setRefusal(null);
      // A file whose key is installed stays here, where its choice is: update every copy, or install on another database.
      setStep((next.route ?? 'install') === 'install' ? 'database' : 'bundle');
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
    onError: (cause: Error) => {
      // A workspace file: the app upload answers it, and its own screen takes it over.
      if (file !== null && onWorkspaceFile !== undefined && isWorkspaceFileRefusal(cause)) {
        onWorkspaceFile(file);
        return;
      }
      // Refused before anything was staged, in a sentence per database: the card replaces the upload.
      const refused = cause instanceof ApiError ? uploadRefusal(cause.code, cause.details) : null;
      if (refused !== null) {
        setRefusal(refused);
        setError(null);
        return;
      }
      setError(cause.message);
    },
  });

  const preview = useMutation({
    mutationFn: (with_: InstallAnswers) => {
      if (staged === null) throw new Error('no bundle');
      return planApp({ key: staged.key, version: staged.version, connectionId, ...(tickedAddOns.current === undefined ? {} : { addOns: tickedAddOns.current }), ...with_ });
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
    mutationFn: (asked: { key: string; addOns: readonly string[] }) => runSampleAdd(asked.key, () => undefined, 'app', asked.addOns),
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
        ...(plan?.modules === undefined ? {} : { modules: partChoicesOf(plan.modules, partPicks) }),
        ...(plan?.maps === true ? { maps: showMaps } : {}),
        // Shown on the check: what an add-on it updates gives other apps' roles more of its tables. The Install button is the say.
        ...((plan?.roleTables ?? []).some((entry) => entry.app !== undefined && entry.wider !== undefined) ? { roleTables: true } : {}),
        ...checked,
        // The look and languages: only when ticked, and only the link hosts ticked one by one.
        ...instanceAnswersOf(plan?.instance, instanceAnswers),
      });
    },
    onSuccess: async (next) => {
      setResult(next);
      // The app's page is the key's own address only for its first copy; a later copy's is its database's.
      setFirstCopy(copyOn.size === 0);
      setError(null);
      setStopped(null);
      setStep('done');
      // With the add-ons this install put in: their own sample comes with the app's. One that was here already is not touched.
      if (addSample && plan?.sampleData === true) sample.mutate({ key: next.key, addOns: (next.addOns?.installed ?? []).map((addOn) => addOn.key) });
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
    if (pick !== 'alt-prefix') preview.mutate(answersOf(nextPicks, nextRename, nextPrefix, sharePicks, pagePicks, useExisting));
  };

  /** A taken page address answered (or taken back with Change): the check is made again at once. */
  const onPage = (page: string, answer: PageAnswer | undefined) => {
    const next = { ...pagePicks };
    if (answer === undefined) delete next[page];
    else next[page] = answer;
    setPagePicks(next);
    preview.mutate(answersOf(picks, renameTo, prefix, sharePicks, next, useExisting));
  };

  /** "Use the existing tables", or Change back to choosing table by table: checked again at once. */
  const onUseExisting = (next: boolean) => {
    setUseExisting(next);
    if (next) setPicks({});
    preview.mutate(answersOf(next ? {} : picks, renameTo, prefix, sharePicks, pagePicks, next));
  };

  /** Use another app's tables of a shape, or keep separate ones: the check is made again at once. */
  const onShare = (shape: string, pick: SharePick) => {
    const nextShares = { ...sharePicks, [shape]: pick };
    setSharePicks(nextShares);
    preview.mutate(answersOf(picks, renameTo, prefix, nextShares, pagePicks, useExisting));
  };

  /*
   * UPDATE EVERY COPY. Every copy of an app runs one version, so a newer file
   * updates each copy in turn, in the order the server lists them, each
   * through its own review on its own database. A copy cancelled is left as
   * it is, and "Update the rest" picks up from there.
   */
  const copies: readonly StagedInstall[] = staged?.installs ?? [];
  const [updatedIds, setUpdatedIds] = useState<string[]>([]);
  const [updating, setUpdating] = useState<{ copy: StagedInstall; n: number; plan: AppInstallPlan } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateStopped, setUpdateStopped] = useState<UpdateStoppedDetails | null>(null);
  const remaining = copies.filter((copy) => !updatedIds.includes(copy.installId));
  const updateNext = useMutation({
    mutationFn: async (copy: StagedInstall) => {
      if (staged === null || copy.connectionId === null) throw new Error('no copy');
      const { plan: next } = await planApp({ key: staged.key, version: staged.version, connectionId: copy.connectionId });
      return { copy, plan: next };
    },
    onSuccess: ({ copy, plan: next }) => {
      setUpdateError(null);
      setUpdateStopped(null);
      setUpdating({ copy, n: copies.indexOf(copy) + 1, plan: next });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const updateCopy = useMutation({
    mutationFn: async (sent: UpdateAnswers) => {
      if (staged === null || updating === null) throw new Error('no copy');
      return updateApp(staged.key, sent, updating.copy.connectionId);
    },
    onSuccess: async () => {
      if (updating === null) return;
      const done = [...updatedIds, updating.copy.installId];
      setUpdatedIds(done);
      setUpdating(null);
      setUpdateStopped(null);
      await queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: SURFACES_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: APP_CATALOG_QUERY_KEY });
      // On to the next copy, each with its own review.
      const next = copies.find((copy) => !done.includes(copy.installId));
      if (next !== undefined) updateNext.mutate(next);
    },
    onError: (cause: Error) => {
      // Stopped part way: nothing is undone, and the same update finishes it.
      if (cause instanceof ApiError && cause.code === 'APP_UPDATE_INCOMPLETE') {
        const details = (cause.details ?? {}) as Partial<UpdateStoppedDetails>;
        setUpdateStopped({ stage: details.stage ?? '', from: details.from ?? '', to: details.to ?? '', cause: details.cause ?? cause.message });
        setUpdateError(null);
        return;
      }
      setUpdateError(cause.message);
    },
  });

  // Where the app already is: the upload's copies, and the installed list for an app picked off the shelf.
  // Read from the page's own list, not observed: the wizard does not refetch it under the person.
  const installedList = queryClient.getQueryData(installedAppsQuery().queryKey);
  const copyOn = new Map<string, string>();
  for (const app of installedList?.apps ?? []) if (app.key === staged?.key && app.connectionId !== null) copyOn.set(app.connectionId, app.version);
  for (const copy of copies) if (copy.connectionId !== null) copyOn.set(copy.connectionId, copy.version);
  const workspaces = workspacesByConnection(queryClient.getQueryData(bootstrapQuery().queryKey));
  const route = staged?.route ?? 'install';
  const uploaded = upload.data !== undefined;
  const integrityOf = uploaded ? (staged?.integrity ?? '') : '';
  const holdId = useId();

  const busy = upload.isPending || preview.isPending || install.isPending || download.isPending || updateNext.isPending || updateCopy.isPending;
  const checking = step === 'plan' && plan !== null && hasTables(plan);
  // Install waits for these, said in the footer and tied to the button: a fingerprint that does not match, a table that can't be used, a page address unanswered.
  const hold = plan === null ? null : reviewHold({ plan, pages: checked.pages, fingerprint, integrity: integrityOf });
  const refusedHere = plan !== null && savedFromHere(plan);

  /*
   * The one dialog: the only database is taken, and the app is checked
   * against it at once, so what opens is the plan. With more than one
   * database (or none) there is a choice the dialog does not make.
   */
  const onlyDatabase = connections.length === 1 ? (connections[0]?.id ?? '') : '';
  const quickAsked = useRef(false);
  useEffect(() => {
    if (!quick || staged === null || onlyDatabase === '') return;
    if (connectionId === '') {
      setConnectionId(onlyDatabase);
      return;
    }
    if (quickAsked.current) return;
    quickAsked.current = true;
    preview.mutate({});
    // `preview` is a new object each render; the ref makes this run once.
  }, [quick, staged, onlyDatabase, connectionId]);
  const quickNeedsChoice = quick && onlyDatabase === '';
  /*
   * The one dialog: an add-on the app requires comes with it (D98), and it is
   * fetched by the dialog's own Install, never before: until that press the
   * person has only been shown its name. So Install does three things in
   * order: fetch each required add-on that is not on this server, check the
   * app again (an add-on's own plan can only be read from its bytes), and
   * install if that check still stands. If it does not, the dialog shows why
   * and installs nothing.
   */
  const needFetch = addOnRows.filter(
    (row) => row.need === 'requires' && row.state !== 'unavailable' && (row.action === 'install' || row.action === 'update') && !row.staged && row.offeredVersion !== null,
  );
  /** Only fetching holds Install: the press that installs fetches first. */
  /** The server calls a plan not installable while a required add-on is still to be downloaded: that alone does not hold the press that downloads it. */
  const heldByFetchAlone = plan !== null && (plan.installable || (plan.problems.length > 0 && plan.problems.every((problem) => problem.code === 'ADD_ON_DOWNLOAD_REQUIRED')));
  const onlyFetchHolds =
    quick && needFetch.length > 0 && addOnHint !== null && heldByFetchAlone && addOnBlock(appName, addOnRows.map((row) => (needFetch.includes(row) ? { ...row, staged: true } : row)), addOnPicks) === null;
  /** Set by the Install press, read once the check made after the fetch is on screen. */
  const [installAfterCheck, setInstallAfterCheck] = useState(false);
  /** The add-ons this dialog fetched, and those of them whose own plan the person has yet to read. */
  const fetchedKeys = useRef(new Set<string>());
  const [toRead, setToRead] = useState<string[]>([]);
  const fetchThenInstall = async (): Promise<void> => {
    try {
      for (const row of needFetch) {
        fetchedKeys.current.add(row.key);
        await download.mutateAsync(row);
      }
    } catch {
      // Said by the download's own error; nothing is installed.
      return;
    }
    setInstallAfterCheck(true);
  };
  useEffect(() => {
    if (!installAfterCheck || busy || plan === null) return;
    setInstallAfterCheck(false);
    // The check made after the fetch. An add-on's own plan can only be read from its bytes, so it is on screen for the
    // first time now: one that makes tables or changes the database is the person's to read, and Install is pressed again.
    const unread = addOnRows.filter((row) => fetchedKeys.current.has(row.key) && row.plan !== undefined && row.plan !== null && (row.plan.create.length > 0 || row.plan.requiresSchemaChange || row.plan.touchesData));
    fetchedKeys.current.clear();
    if (unread.length > 0) {
      setToRead(unread.map((row) => row.name));
      return;
    }
    // Installed only if nothing holds it now.
    if (plan.installable && addOnHint === null && !dirty && stopped === null) install.mutate();
    // `install` is a new object each render; the flag makes this run once.
  }, [installAfterCheck, busy, plan, addOnHint, dirty, stopped]);
  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);

  /** What comes with the app: public access, the add-ons it brings, sample data. */
  const cardsOfPlan =
    plan === null
      ? null
      : plan.publicAccess !== undefined || plan.sampleData === true || addOnRows.length > 0 || plan.modules !== undefined || plan.maps === true || plan.privacyGrants !== undefined ? (
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
            onTick={(key, next) => {
              const picks = { ...addOnPicks, ticked: { ...addOnPicks.ticked, [key]: next } };
              setAddOnPicks(picks);
              // A part of the app is built on this add-on: with or without it is a different plan, checked again.
              if ((plan.modules ?? []).some((module) => module.needs.includes(key))) {
                tickedAddOns.current = addOnRows.filter((row) => isSelected(row, picks)).map((row) => row.key);
                preview.mutate(checked);
              }
            }}
            onUpdate={(key, next) => setAddOnPicks((picks) => ({ ...picks, update: { ...picks.update, [key]: next } }))}
            catalogueOn={catalogue.data?.onlineEnabled ?? null}
            downloading={downloading}
            onDownload={(row) => download.mutate(row)}
            busy={busy}
            grants={plan.addOnGrants}
            roleTables={plan.roleTables}
          />
        )}
        <AppsRoleTablesWiderCard entries={plan.roleTables ?? []} />
        <PrivacyGrantsCard grants={plan.privacyGrants ?? []} />
        {plan.modules === undefined ? null : (
          <PartsInstallCard
            appName={appName}
            modules={plan.modules}
            picks={partPicks}
            addOns={addOnRows}
            onTick={(id, next) => setPartPicks((picks) => ({ ...picks, [id]: next }))}
            busy={busy}
            whole={plan.whole}
            // What the install makes: the app's new tables, and those of each add-on it brings.
            tables={plan.create.length + addOnRows.filter((row) => isSelected(row, addOnPicks)).reduce((sum, row) => sum + (row.plan?.create.length ?? 0), 0)}
          />
        )}
        {plan.maps === true ? (
          <MapsInstallCard checked={showMaps} onChange={setShowMaps} server={queryClient.getQueryData(bootstrapQuery().queryKey)?.maps?.server} />
        ) : null}
        {plan.sampleData === true ? <SampleInstallCard checked={addSample} onChange={setAddSample} withAddOns={addOnRows.length > 0} /> : null}
      </div>
    ) : null;

  return (
    <section className={quick ? 'flex flex-col gap-5' : 'flex min-h-full flex-col gap-6'}>
      {quick && step !== 'done' ? (
        <div data-part="quick-intro" className="flex flex-col gap-1">
          <p className="text-sm text-fg-muted">
            {quickNeedsChoice
              ? connections.length === 0
                ? t('studio:hostedApps.install.quick.noDatabase', 'This server has no database connected yet. More choices opens the steps, where one is chosen.')
                : t('studio:hostedApps.install.quick.manyDatabases', 'This server has more than one database, and the app goes into one of them. More choices opens the steps, where you choose.')
              : t('studio:hostedApps.install.quick.into', 'It is installed into your database “{database}”. Nothing is added until you press Install.', { database: connectionName })}
          </p>
          {!quickNeedsChoice && step !== 'plan' && error === null ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Spinner size="sm" />
              {t('studio:hostedApps.install.quick.reading', 'Reading what it would add…')}
            </p>
          ) : null}
        </div>
      ) : null}
      <header className={quick ? 'hidden' : undefined}>
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

      {/* Said on every step before the install, the database step included:
          an upload goes straight there. */}
      {/* Said once the plan says whether the file was saved elsewhere: a saved file's review says where it came from instead. */}
      {staged?.publisher?.id === LOCAL_PUBLISHER_ID && step === 'plan' && plan !== null && plan.madeAt === undefined ? (
        <p data-part="made-here" className="rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-xs text-fg-subtle">
          {t(
            'studio:hostedApps.install.madeHere',
            'Made on this install. It does not come from adminium.dev, and nobody else has checked it. Install it only if you trust where it came from.',
          )}
        </p>
      ) : null}

      {/*
        * The app this install is for, once it is known: picked off the shelf,
        * or read from an uploaded bundle (reached by stepping back after the
        * upload). The comp's marketplace tile draws this row — name, then the
        * version in mono — so an upload confirms itself the same way.
        */}
      {step === 'bundle' && staged !== null && !quick && route !== 'install' ? (
        <UploadRoute
          staged={staged}
          route={route}
          copies={copies}
          updatedIds={updatedIds}
          onBack={() => {
            setStaged(null);
            setFile(null);
            setUpdatedIds([]);
            setError(null);
          }}
          busy={busy}
        />
      ) : null}

      {updating === null || staged === null ? null : (
        <UpdateReviewDialog
          key={updating.copy.installId}
          appKey={staged.key}
          appName={staged.name}
          to={staged.version}
          from={updating.copy.version}
          plan={updating.plan}
          connectionId={updating.copy.connectionId ?? ''}
          connectionName={updating.copy.connectionName}
          copy={{ n: updating.n, total: copies.length }}
          integrity={staged.integrity}
          publisher={staged.publisher}
          busy={updateCopy.isPending}
          error={updateError}
          stopped={updateStopped}
          onCancel={() => {
            setUpdating(null);
            setUpdateError(null);
            setUpdateStopped(null);
          }}
          onConfirm={(sent) => updateCopy.mutate(sent)}
        />
      )}

      {refusal === null || step !== 'bundle' ? null : (
        <RefusalCard
          title={refusal.title}
          onBack={() => {
            setRefusal(null);
            setFile(null);
          }}
        >
          {refusal.body}
        </RefusalCard>
      )}

      {step === 'bundle' && staged !== null && !quick && route === 'install' ? (
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
                // A typed fingerprint describes the old file.
                setFingerprint('');
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

      {step === 'bundle' && staged === null && refusal === null ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">
              {t('studio:hostedApps.install.bundle.title', 'Upload the app bundle')}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              {t('studio:hostedApps.install.bundle.fileOnly', 'The app’s file (.tgz).')}
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
            {staged === null ? null : (
              // The version being installed, so a copy's "Installed · 1.0.15" reads against it.
              <p data-part="installing-version" className="mt-1.5 text-sm text-fg-muted">
                {sentence('studio:hostedApps.install.database.version', 'Installing {app} {version}.', {
                  app: <span className="font-bold text-fg">{staged.name}</span>,
                  version: <MonoText className="font-bold text-fg">{staged.version}</MonoText>,
                })}{' '}
                {copyOn.size === 0 ? null : t('studio:hostedApps.install.database.ownCopy', 'Each database can have its own copy of {app}.', { app: staged.name })}
              </p>
            )}
          </div>
          {connections.length === 0 ? (
            <Alert tone="warn" title={t('studio:hostedApps.install.database.noneTitle', 'No database yet')}>
              {t('studio:hostedApps.install.database.none', 'Connect a database first. An app goes into a database this server already has.')}
            </Alert>
          ) : null}
          <RadioGroup
            value={connectionId}
            onValueChange={setConnectionId}
            className="flex flex-col gap-3"
          >
            {connections.map((connection) => (
              <RadioCard
                key={connection.id}
                value={connection.id}
                // A database with a copy of the app can't take a second one.
                disabled={connection.readOnly || copyOn.has(connection.id)}
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
                description={
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{connection.engine}</span>
                    <WorkspaceChips workspaces={workspaces.get(connection.id) ?? []} />
                  </span>
                }
                trailing={
                  <span className="flex items-center gap-3">
                    {copyOn.has(connection.id) ? (
                      <Badge tone="neutral" data-part="installed-marker">
                        {sentence('studio:hostedApps.install.database.installed', 'Installed · {version}', {
                          version: <MonoText>{copyOn.get(connection.id) ?? ''}</MonoText>,
                        })}
                      </Badge>
                    ) : null}
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
          {connectionId !== '' && copyOn.size > 0 && staged !== null ? (
            <p data-part="own-copy" className="text-[12.5px] text-fg-muted">
              {t(
                'studio:hostedApps.install.database.notTouched',
                'This copy gets its own settings, roles and email templates. {app} on {databases} is not touched.',
                {
                  app: staged.name,
                  databases: namesList(connections.filter((connection) => copyOn.has(connection.id)).map((connection) => connection.name)),
                },
              )}
            </p>
          ) : null}
          {connections.length > 0 && connections.every((connection) => connection.readOnly) ? (
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

      {checking && !install.isPending && stopped === null && plan !== null && hasTables(plan) && refusedHere ? (
        // A file saved from this very database: it replaces the review, with no Install.
        <RefusalCard title={t('studio:hostedApps.refusal.savedHere.title', 'Saved from this database')} onBack={() => setStep('database')}>
          {sentence(
            'studio:hostedApps.refusal.savedHere.body',
            'This file was saved from {database} on this server. Installing it there would run every automation twice. Pick another database, or try it on a test server.',
            { database: <MonoText className="font-semibold text-fg">{connectionName}</MonoText> },
          )}
        </RefusalCard>
      ) : null}

      {checking && !install.isPending && stopped === null && plan !== null && hasTables(plan) && !refusedHere ? (
        <div className="flex flex-col gap-4">
          {plan.madeAt === undefined && integrityOf === '' ? null : (
            <>
              {quick || plan.madeAt === undefined ? null : (
                <div>
                  <h2 className="text-[16.5px] font-extrabold leading-[normal] tracking-[-0.02em]">
                    {t('studio:hostedApps.review.title', 'Check before you install')}
                  </h2>
                  <p className="mt-1 text-[13px] leading-[1.5] text-fg-muted">
                    {sentence('studio:hostedApps.review.intro', '{app} goes into {database}. Nothing changes until you press Install.', {
                      database: <MonoText>{connectionName}</MonoText>,
                    }, { app: appName })}
                  </p>
                </div>
              )}
              <WhereItCameFrom
                name={appName}
                version={staged?.version ?? plan.version}
                madeAt={plan.madeAt}
                publisher={staged?.publisher}
                integrity={integrityOf}
                fingerprint={fingerprint}
                onFingerprint={setFingerprint}
              />
            </>
          )}
          <PlanAlerts plan={plan} appName={staged?.name ?? ''} connections={connections} copies={copyOn} />
          {/* The one dialog leads with what comes with the app; the tables fold while there is nothing to answer about them. */}
          {quick ? cardsOfPlan : null}
          <PageClashesCard
            clashes={plan.pageClashes ?? []}
            answers={pagePicks}
            busy={busy}
            onAnswer={onPage}
            onRenameTo={(page, to) => setPagePicks((pages) => ({ ...pages, [page]: { action: 'rename-existing', to } }))}
          />
          {existingTables(plan).length === 0 ? null : (
            <ExistingTablesCard plan={plan} used={checked.existing === 'use'} busy={busy} onUse={() => onUseExisting(true)} onChange={() => onUseExisting(false)} />
          )}
          {quick && plan.tables.every((table) => table.class === 'new') && !dirty ? (
            <details data-part="quick-tables" className="rounded-lg border border-border bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                {t('studio:hostedApps.install.quick.tables', '{count, plural, one {It adds # new table to {database}. Show it} other {It adds # new tables to {database}. Show them}}', {
                  count: plan.tables.length,
                  database: connectionName,
                })}
              </summary>
              <div className="border-t border-border p-4">
              <TableCheck
                plan={plan}
                appName={staged?.name ?? ''}
                connectionName={connectionName}
                open={openRows}
                onToggle={(ref) => setOpenRows((rows) => ({ ...rows, [ref]: rows[ref] !== true }))}
                picks={picks}
                onPick={onPick}
                onShare={onShare}
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
                  preview.mutate(answersOf(nextPicks, renameTo, prefix, sharePicks, pagePicks, useExisting));
                }}
                busy={busy}
              />
              </div>
            </details>
          ) : (
            <TableCheck
              plan={plan}
              appName={staged?.name ?? ''}
              connectionName={connectionName}
              open={openRows}
              onToggle={(ref) => setOpenRows((rows) => ({ ...rows, [ref]: rows[ref] !== true }))}
              picks={picks}
              onPick={onPick}
              onShare={onShare}
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
                preview.mutate(answersOf(nextPicks, renameTo, prefix, sharePicks, pagePicks, useExisting));
              }}
              busy={busy}
            />
          )}
          <OutsideAddressesCard items={plan.afterInstall} />
          {plan.instance === undefined ? null : <InstanceCard part={plan.instance} answers={instanceAnswers} onAnswers={setInstanceAnswers} />}
          {plan.madeAt !== undefined && (staged?.sides.length ?? 0) > 0 ? <ScreensWarning /> : null}
          <AfterInstallCard items={plan.afterInstall} />
          {quick ? null : cardsOfPlan}
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

          <PlanAlerts plan={plan} appName={staged?.name ?? ''} connections={connections} copies={copyOn} />

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
                {connectionName === ''
                  ? t('studio:hostedApps.install.done.titleApp', '{app} is installed', {
                      app: staged?.name ?? result.key,
                    })
                  : t('studio:hostedApps.install.done.titleOn', '{app} {version} is installed on {database}', {
                      app: staged?.name ?? result.key,
                      version: result.version,
                      database: connectionName,
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
              {outsideRules(plan?.afterInstall).length === 0 ? null : (
                <DoneRow
                  icon={<Send aria-hidden className="size-4" />}
                  label={t('studio:hostedApps.install.done.rulesOff', 'Rules that send data out')}
                  value={t('studio:hostedApps.install.done.rulesOffValue', '{count}, switched off', { count: outsideRules(plan?.afterInstall).length })}
                />
              )}
              {afterInstallLines(plan?.afterInstall).length === 0 ? null : (
                <DoneRow
                  icon={<ListChecks aria-hidden className="size-4" />}
                  label={t('studio:hostedApps.review.after.title', 'After you install')}
                  value={t('studio:hostedApps.install.done.toDo', '{count, plural, one {# thing to do} other {# things to do}}', {
                    count: afterInstallLines(plan?.afterInstall).length,
                  })}
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
          {firstCopy ? <OpenAppPage appKey={result.key} /> : null}
          <DocumentsWaitingNotice waiting={result.documents?.waiting} />
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

      <footer
        className={cn(
          'sticky bottom-0 mt-auto flex items-center gap-3 border-t border-border bg-surface py-3.5',
          // In the dialog the body has no padding under it (the page gives it none), so the footer is the last thing in view.
          quick ? '-mx-5 px-5' : '-mx-6 px-6',
        )}
      >
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
        {quick && downloading !== null ? (
          <span data-part="quick-getting" role="status" className="inline-flex items-center gap-[7px] text-[12.5px] font-semibold text-fg-muted">
            <Spinner size="sm" />
            {t('studio:hostedApps.install.quick.getting', 'Getting {addOn}, which {app} needs…', {
              addOn: addOnRows.find((row) => row.key === downloading.key)?.name ?? downloading.key,
              app: appName,
            })}
          </span>
        ) : quick && toRead.length > 0 && stopped === null && !install.isPending && step === 'plan' ? (
          <span data-part="quick-read" role="status" className="inline-flex items-center gap-[7px] text-[12.5px] font-semibold text-fg">
            <Info aria-hidden className="size-3.5 shrink-0" />
            {t('studio:hostedApps.install.quick.readFirst', '{addOn} is on this server now. Read what it adds, above, then press Install.', { addOn: toRead.join(', ') })}
          </span>
        ) : onlyFetchHolds && stopped === null && !install.isPending && step === 'plan' ? (
          // Not a refusal: what the Install press will do first, said before it is pressed.
          <span data-part="quick-brings" className="inline-flex items-center gap-[7px] text-[12.5px] font-semibold text-fg-muted">
            <Download aria-hidden className="size-3.5 shrink-0" />
            {t('studio:hostedApps.install.quick.brings', 'Install first downloads {addOn}, which {app} needs, from adminium.dev.', {
              addOn: needFetch.map((row) => row.name).join(', '),
              app: appName,
            })}
          </span>
        ) : checking && stopped === null && !install.isPending && plan !== null && addOnHint !== null ? (
          // The add-ons' refusal wins over the table hint: it is the one that holds Install.
          <span
            data-part="add-on-hint"
            className="inline-flex items-center gap-[7px] text-[12.5px] font-semibold text-danger"
          >
            <CircleAlert aria-hidden className="size-3.5 shrink-0" />
            {addOnHint}
          </span>
        ) : checking && stopped === null && !install.isPending && plan !== null && hold !== null && !dirty ? (
          <HoldHint id={holdId}>{hold}</HoldHint>
        ) : checking && stopped === null && !install.isPending && plan !== null ? (
          <CheckHint plan={plan} picks={picks} dirty={dirty} />
        ) : (
          <span className="text-sm text-fg-subtle">
            {staged === null
              ? t('studio:hostedApps.install.footerStep', 'Step {n} of {total}', {
                  n: stepIndex + 1,
                  total: STEP_IDS.length,
                })
              : t('studio:hostedApps.install.footerStepVersion', 'Step {n} of {total} · {app} {version}', {
                  n: stepIndex + 1,
                  total: STEP_IDS.length,
                  app: staged.key,
                  version: staged.version,
                })}
          </span>
        )}
        <span className="ms-auto flex items-center gap-2">
          {step === 'done' ? null : (
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('studio:hostedApps.install.cancel', 'Cancel')}
            </Button>
          )}
          {quick && step !== 'done' && onMoreChoices !== undefined ? (
            <Button variant={quickNeedsChoice ? 'primary' : 'secondary'} disabled={busy} onClick={onMoreChoices}>
              {t('studio:hostedApps.install.quick.more', 'More choices')}
            </Button>
          ) : null}
          {!quick &&
          stepIndex > 0 &&
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

          {step === 'bundle' && staged !== null && !quick && route === 'install' ? (
            <Button disabled={busy} onClick={() => setStep('database')}>
              {t('studio:hostedApps.install.continue', 'Continue')}
            </Button>
          ) : null}

          {step === 'bundle' && staged !== null && !quick && route === 'update' && remaining.length > 0 && remaining[0] !== undefined ? (
            <Button disabled={busy} onClick={() => updateNext.mutate(remaining[0]!)}>
              {updateNext.isPending ? <Spinner size="sm" /> : <ArrowUpCircle aria-hidden className="size-4" />}
              {remaining.length === copies.length
                ? t('studio:hostedApps.route.update.button', 'Update every copy ({databases})', { databases: namesList(remaining.map((copy) => copy.connectionName)) })
                : t('studio:hostedApps.route.update.rest', 'Update the rest ({databases})', { databases: namesList(remaining.map((copy) => copy.connectionName)) })}
            </Button>
          ) : null}

          {step === 'bundle' && staged !== null && !quick && ((route === 'update' && remaining.length === 0) || route === 'install-another') && (staged.databasesFree ?? 0) > 0 ? (
            <Button variant={route === 'update' ? 'secondary' : 'primary'} disabled={busy} onClick={() => setStep('database')}>
              {route === 'update'
                ? t('studio:hostedApps.route.update.also', 'Also install on another database')
                : t('studio:hostedApps.route.another.button', 'Install on another database')}
            </Button>
          ) : null}

          {step === 'bundle' && staged !== null && !quick && route === 'update' && remaining.length === 0 ? (
            <Button onClick={onClose}>{t('studio:hostedApps.install.finish', 'Manage apps')}</Button>
          ) : null}

          {step === 'bundle' && staged === null && refusal === null ? (
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
                setSharePicks({});
                setPagePicks({});
                setUseExisting(false);
                setInstanceAnswers(NO_INSTANCE_ANSWERS);
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

          {step === 'plan' && !refusedHere && !(checking && (dirty || stopped !== null || install.isPending)) ? (
            <Button
              disabled={busy || plan === null || (!plan.installable && !onlyFetchHolds) || (addOnHint !== null && !onlyFetchHolds) || hold !== null}
              aria-describedby={hold === null ? undefined : holdId}
              onClick={() => (onlyFetchHolds ? void fetchThenInstall() : install.mutate())}
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

      {/* Only an upload unpacks anything: a shelf or catalogue app was already
          on disk, and its files were never counted here. */}
      {upload.data === undefined ? null : (
        <p className="sr-only" role="status">
          {t('studio:hostedApps.install.staged', 'Files unpacked: {files}', {
            files: upload.data.files,
          })}
        </p>
      )}
    </section>
  );
}

/**
 * The plan's refusals and its page warnings. A taken table's own problem is
 * left to its card on the check step, where the answer to it is — and so is a
 * required add-on's, to the Add-ons card and the footer's hint.
 */
/** The problems a review card answers or says itself: a page address to choose for, a table that can't be used, a file saved here. */
const REVIEW_CARD_PROBLEMS: ReadonlySet<string> = new Set(['PAGE_SLUG_UNANSWERED', 'EXISTING_TABLE_UNUSABLE', 'SAVED_FROM_HERE']);

function PlanAlerts({
  plan,
  appName,
  connections,
  copies,
}: {
  plan: AppInstallPlan;
  appName: string;
  connections: readonly { id: string; name: string }[];
  /** The databases with a copy of the app, and the version each runs. */
  copies: ReadonlyMap<string, string>;
}) {
  const problems = plan.problems.filter((problem) => !isCardProblem(plan, problem) && !isAddOnCardProblem(plan, problem) && !(hasTables(plan) && REVIEW_CARD_PROBLEMS.has(problem.code)));
  // Every copy runs one version: said per database, with the version that copy runs.
  const said = (problem: AppInstallPlan['problems'][number]): string =>
    problem.code === 'ONE_VERSION_PER_APP' && problem.connectionId !== undefined
      ? t(
          'studio:hostedApps.install.plan.oneVersion',
          '{database} has {app} {version}, and every copy of an app runs one version. Update the copies first, then install this one here.',
          {
            app: appName === '' ? problem.table : appName,
            database: connections.find((connection) => connection.id === problem.connectionId)?.name ?? problem.connectionId,
            version: copies.get(problem.connectionId) ?? '',
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

/** A required add-on's refusal, said by the Add-ons card on the check step (the one with tables). */
function isAddOnCardProblem(plan: AppInstallPlan, problem: AppInstallPlan['problems'][number]): boolean {
  return hasTables(plan) && problem.code.startsWith('ADD_ON_') && (plan.addOns ?? []).some((row) => row.key === problem.table);
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

/** "Open the app's page", where its After you install list waits. */
function OpenAppPage({ appKey }: { appKey: string }) {
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | null;
  const href = `/studio/apps/${encodeURIComponent(appKey)}`;
  return (
    <a
      href={href}
      data-part="open-app-page"
      className="inline-flex items-center gap-2 self-start rounded-[11px] border border-border-strong bg-surface px-4 py-2.5 text-[13.5px] font-bold hover:border-fg-subtle"
      onClick={(event) => {
        if (router === null) return;
        event.preventDefault();
        void router.navigate({ to: '/studio/apps/$key', params: { key: appKey } });
      }}
    >
      {t('studio:hostedApps.install.done.openPage', 'Open the app’s page')}
      <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
    </a>
  );
}

/**
 * Where an uploaded file goes when its key is installed already: newer than
 * every copy, it updates each of them; the same version, it goes onto another
 * database. Built from notes, in the bundle step's own anatomy: the app's
 * card, then its copies, each with its database and version.
 */
export function UploadRoute({
  staged,
  route,
  copies,
  updatedIds,
  onBack,
  busy,
}: {
  staged: StagedApp;
  route: 'update' | 'install-another';
  copies: readonly StagedInstall[];
  updatedIds: readonly string[];
  onBack: () => void;
  busy: boolean;
}) {
  const names = namesList(copies.map((copy) => copy.connectionName));
  if (route === 'install-another' && (staged.databasesFree ?? 0) === 0) {
    return (
      <RefusalCard title={t('studio:hostedApps.refusal.everywhere.title', 'Installed on every database')} onBack={onBack}>
        {t('studio:hostedApps.refusal.everywhere.body', '{app} {version} is already installed on every database here.', { app: staged.name, version: staged.version })}
      </RefusalCard>
    );
  }
  const allDone = route === 'update' && copies.every((copy) => updatedIds.includes(copy.installId));
  return (
    <div data-part="upload-route" className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold tracking-tight">
          {route === 'update'
            ? t('studio:hostedApps.route.update.title', 'Update {app} to {version}', { app: staged.name, version: staged.version })
            : t('studio:hostedApps.route.another.title', 'Install {app} on another database', { app: staged.name })}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          {route === 'update'
            ? t(
                'studio:hostedApps.route.update.body',
                'This file is newer than every copy on this server. Every copy runs one version, so each one is updated, with its own review.',
              )
            : t('studio:hostedApps.route.another.body', '{app} {version} is installed on {databases}. Each database can have its own copy.', {
                app: staged.name,
                version: staged.version,
                databases: names,
              })}
        </p>
      </div>
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <IconTile>
              <Package aria-hidden className="size-5" />
            </IconTile>
            <span className="flex-1 text-sm font-bold">{staged.name}</span>
            <MonoText className="text-xs text-fg-muted">{staged.version}</MonoText>
          </div>
          <ul className="flex flex-col border-t border-border">
            {copies.map((copy) => {
              const done = updatedIds.includes(copy.installId);
              return (
                <li key={copy.installId} data-testid={`copy-${copy.connectionName}`} className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
                  <Database aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                  <MonoText className="flex-1 text-[13px] font-semibold">{copy.connectionName}</MonoText>
                  <MonoText className="text-xs text-fg-muted">{done ? staged.version : copy.version}</MonoText>
                  <Badge tone={route === 'install-another' ? 'neutral' : done ? 'pos' : 'warn'}>
                    {route === 'install-another'
                      ? sentence('studio:hostedApps.install.database.installed', 'Installed · {version}', { version: <MonoText>{copy.version}</MonoText> })
                      : done
                        ? t('studio:hostedApps.route.update.updated', 'Updated')
                        : t('studio:hostedApps.route.update.waiting', 'Not updated yet')}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
      {allDone ? (
        <p role="status" className="flex items-center gap-2 text-sm font-semibold text-pos">
          <Check aria-hidden className="size-4" />
          {t('studio:hostedApps.route.update.done', '{app} is on {version} on every database.', { app: staged.name, version: staged.version })}
        </p>
      ) : null}
      <Button variant="ghost" size="sm" className="self-start" disabled={busy} onClick={onBack}>
        <FileUp aria-hidden className="size-4" />
        {t('studio:hostedApps.install.uploaded.replace', 'Upload a different bundle')}
      </Button>
    </div>
  );
}
