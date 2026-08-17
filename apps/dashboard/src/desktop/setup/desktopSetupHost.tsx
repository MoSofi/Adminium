// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/desktop/setup` — the first-run wizard's host (11-electron.md §6, task
 * 11-T07).
 *
 * The four steps are `steps/`; the rules are `desktopSetupState.ts`; this is the
 * thing that owns the state, the async, and the order. Same split as
 * `studio/connect/ConnectWizard.tsx`, and the step components were written
 * against it.
 *
 * ─── THIS IS THE APP'S FRONT DOOR ────────────────────────────────────────────
 *
 * `main/index.ts`'s `appUrl({ firstRun: true })` navigates the BrowserWindow
 * straight to `/desktop/setup` on every launch with no `config.json` (§2.2
 * step 8), and `config.json` is not written until this wizard finishes. So if
 * this screen does not render, the app has no way to become usable — the user
 * cannot create the super-admin, so `firstRun` stays true, so the next launch
 * lands in exactly the same place.
 *
 * That is not hypothetical: this module was missing and `router.tsx` had no
 * `/desktop/setup` route, so the shipped tree navigated every fresh install to
 * the branded 404. `main/index.test.ts` asserted `appUrl(...)` equalled
 * `'http://127.0.0.1:4600/desktop/setup'` and PASSED, because a string-compare
 * on a URL builder never asks whether the route exists. Hence
 * `router.test.tsx`'s route-tree assertion: it renders the real router at this
 * path and requires something other than the 404.
 *
 * ─── WHY THE STEPS DO NOT MATCH THE CALLS ────────────────────────────────────
 *
 * See `desktopSetupState.ts`'s header, which is the authority. Short version:
 * every create endpoint is behind `system:connections:manage`, no user exists
 * until step 3, so step 2 collects a CHOICE and step 4 executes it.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Stepper, useThemePrefs } from '@adminium/ui';

import { ApiError, hasCsrfToken } from '../../app/api.js';
import { bootstrapQuery } from '../../app/bootstrap.js';
import { useCapabilities } from '../../app/capabilities.js';
import { t } from '../../i18n/t.js';
import { AuthScreenLayout } from '../../auth/AuthScreenLayout.js';
import { validateAccount, type AccountErrors } from '../../setup/FirstRunWizard.js';
import { createSuperAdmin, setupStateQuery } from '../../setup/setupApi.js';
import { studioApi } from '../../studio/api.js';
import { chooseDataDir, commitDataDir, readDataDir } from './dataDirBridge.js';
import {
  DESKTOP_SETUP_STEP_IDS,
  INITIAL_DESKTOP_SETUP_STATE,
  clearDesktopSetupState,
  desktopSetupStepLabel,
  loadDesktopSetupState,
  localeFromNavigator,
  nameFromSqlitePath,
  saveDesktopSetupState,
  sourceCardValid,
  sqliteDsn,
  type CloudSyncBlock,
  type DesktopSetupState,
  type DesktopSetupStepId,
} from './desktopSetupState.js';
import { createDemoDatabase, createLocalDatabase, demoConflictConnectionId } from './setupApi.js';
import { AccountStep, EMPTY_ACCOUNT, type AccountValues } from './steps/AccountStep.js';
import { DataLocationStep } from './steps/DataLocationStep.js';
import { GenerateStep, type PreparePhase } from './steps/GenerateStep.js';
import { SourceStep } from './steps/SourceStep.js';

/** The native picker's file filter for card 2 (§6: `.sqlite`, `.db`, `.sqlite3`). */
const SQLITE_PICKER = { kind: 'sqlite' } as const;

export function DesktopSetupHost(): ReactNode {
  const router = useRouter();
  const capabilities = useCapabilities();
  // `useThemePrefs`, not `useTheme`: §6 step 3's picker sets a PREFERENCE, and
  // `system` is one of its three answers. `useTheme` hands back the RESOLVED
  // mode, which has already collapsed `system` into light/dark — seeding the
  // picker from it would silently turn "follow the OS" into whatever the OS
  // happened to be at first run.
  const { prefs } = useThemePrefs();

  const [state, setState] = useState<DesktopSetupState>(() => loadDesktopSetupState());
  const patch = useCallback((next: Partial<DesktopSetupState>): void => {
    setState((current) => {
      const merged = { ...current, ...next };
      saveDesktopSetupState(merged);
      return merged;
    });
  }, []);

  // Step 1's live values. `currentDataDir` is the directory the app BOOTED
  // against, which only the bridge knows (`dataDirBridge.ts`).
  const [currentDataDir, setCurrentDataDir] = useState<string | null>(null);
  const [cloudSync, setCloudSync] = useState<CloudSyncBlock | null>(null);
  const [unusableReason, setUnusableReason] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readDataDir().then((dir) => {
      if (live) setCurrentDataDir(dir);
    });
    return () => {
      live = false;
    };
  }, []);

  // Step 3's form. NOT persisted — a password in sessionStorage is a defect
  // however convenient a refresh-safe wizard is (`desktopSetupState.ts`).
  const [account, setAccount] = useState<AccountValues>(EMPTY_ACCOUNT);
  const [accountErrors, setAccountErrors] = useState<AccountErrors>({});

  // The schema file for card 1's "From a schema file". In memory for the same
  // reason: it is megabytes and would blow the storage quota.
  const [schemaFile, setSchemaFile] = useState<{ name: string; content: string } | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PreparePhase>('idle');

  // The server's password policy — the SAME probe the M10 self-host wizard uses,
  // so the two agree about the same server's rule rather than each guessing.
  const setupState = useQuery(setupStateQuery());
  const passwordMinLength = setupState.data?.passwordMinLength ?? 8;

  /**
   * ─── THE CSRF TOKEN, ON A RESUME ───────────────────────────────────────────
   *
   * Everything step 4 does mutates with the session step 3 created, and §7 item
   * 4 requires the session-bound token from any such call (`app/api.ts`). This
   * route never runs `appRoute`'s bootstrap — that is the whole reason it hangs
   * off the router root — so the token reaches it by exactly two paths.
   *
   * On the straight-line walk it arrives with step 3's own reply
   * (`setup/setupApi.ts`), and `await`ing here is then a no-op.
   *
   * A RESUME has no step 3. `desktopSetupState.ts` restores the wizard from
   * sessionStorage, so a refresh mid-step-4 re-mounts straight onto this step
   * with the account already made, the session still in the cookie jar, and an
   * empty holder — the module-level token died with the page, and the password
   * was deliberately never persisted, so there is no re-auth path either.
   * Without this, the first thing the resumed wizard does is 403.
   *
   * `/bootstrap` is the other issuer and it answers here (there is a user by
   * now, even though there are no pages yet). It is AWAITED rather than fired
   * from an effect because the call it protects starts in the same commit: a
   * fire-and-forget prime is a race, and it is a race step 4 loses, since
   * `prepare()` dispatches its first mutation immediately on mount. A 401 means
   * the cookie is gone — no session, so nothing the server's check applies to —
   * and is swallowed. `ensureQueryData` de-dupes, so the components below that
   * read the same query share this one request rather than adding another.
   */
  const queryClient = router.options.context.queryClient;
  const primeCsrfToken = useCallback(async (): Promise<void> => {
    if (hasCsrfToken()) return;
    try {
      await queryClient.ensureQueryData(bootstrapQuery());
    } catch {
      // See above: no session ⇒ nothing to prime, and nothing to refuse either.
    }
  }, [queryClient]);

  // §6 step 3: "Locale/theme pickers pre-filled from OS locale + system theme".
  // Seeded once, and only into a field the user has not touched (`null` means
  // untouched) — re-deriving on every render would fight the picker.
  const locale = state.locale ?? localeFromNavigator() ?? 'en_US';
  const themePref = state.theme ?? prefs.theme;

  const stepIndex = DESKTOP_SETUP_STEP_IDS.indexOf(state.step);
  const steps = useMemo(
    () => DESKTOP_SETUP_STEP_IDS.map((id) => ({ id, label: desktopSetupStepLabel(id) })),
    [],
  );

  // ─── Step 1 ────────────────────────────────────────────────────────────────

  const onChooseDataDir = (): void => {
    void chooseDataDir(state.pendingDataDir ?? currentDataDir).then((dir) => {
      if (dir === null) return; // cancelled, or no bridge — nothing was chosen.
      // A confirmation is about ONE folder, so a new pick clears the old answer.
      setCloudSync(null);
      setUnusableReason(null);
      patch({ pendingDataDir: dir, cloudSyncAcknowledged: false });
    });
  };

  const commit = useMutation({
    mutationFn: (input: { dir: string; acknowledge: boolean }) =>
      commitDataDir(input.dir, input.acknowledge),
    onSuccess: (result) => {
      // `null` ⇒ no bridge. Unreachable in the desktop app (the route only
      // renders there), reachable in a jsdom test — carry on rather than trap.
      if (result === null || result.status === 'applied') {
        setCloudSync(null);
        setUnusableReason(null);
        goTo('database');
        return;
      }
      if (result.status === 'cloud-sync-blocked') {
        // The main process REFUSED and wrote nothing. Render its verdict; the
        // acknowledge button calls again with the flag §6 requires.
        setCloudSync(result.warning);
        return;
      }
      setUnusableReason(result.reason);
    },
    onError: (error: unknown) => {
      setFormError(messageOf(error, t('desktop.setup.dataDir.failed', 'Adminium could not use that folder.')));
    },
  });

  /**
   * Step 1's Continue.
   *
   * Committing an UNCHANGED directory is a no-op the main process short-circuits
   * (`setDataDir` returns `applied` without relaunching), so this always calls
   * rather than branching on `pendingDataDir === null`: the check for "is this
   * folder safe?" lives on the trusted side, and asking it every time is how the
   * wizard stays out of the business of deciding.
   */
  const onCommitDataDir = (acknowledge: boolean): void => {
    const dir = state.pendingDataDir ?? currentDataDir;
    if (dir === null) {
      goTo('database'); // No bridge, so no directory to commit.
      return;
    }
    commit.mutate({ dir, acknowledge });
  };

  // ─── Step 3 ────────────────────────────────────────────────────────────────

  const onAccountSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const found = validateAccount(account, passwordMinLength);
    setAccountErrors(found);
    if (Object.keys(found).length > 0) return;
    setFormError(null);
    createAdmin.mutate();
  };

  const createAdmin = useMutation({
    mutationFn: () =>
      createSuperAdmin({
        email: account.email.trim(),
        password: account.password,
        name: account.name.trim(),
        // §6 does not put the telemetry screen in this wizard — desktop's answer
        // lives in Settings → About (§13), and `config.telemetryOptIn` defaults
        // off (§2.3). Both OFF here is that default, stated rather than implied.
        consent: { telemetry: false, updateCheck: false },
      }),
    onSuccess: () => {
      // A fresh session: every cached query predates the account that now
      // exists. The M10 wizard does the same, for the same reason.
      router.options.context.queryClient.clear();
      goTo('generate');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        setFormError(
          t(
            'desktop.setup.account.alreadyExists',
            'This copy of Adminium already has an account. Sign in with it instead.',
          ),
        );
        return;
      }
      setFormError(
        messageOf(error, t('desktop.setup.account.failed', 'Adminium could not create that account.')),
      );
    },
  });

  // ─── Step 4 ────────────────────────────────────────────────────────────────

  /**
   * §6 step 4's front half: create the source the user chose in step 2, then
   * introspect it. The session from step 3 is what finally authorizes this.
   *
   * ─── RUN EXACTLY ONCE, AND WHY THAT NEEDS SAYING ─────────────────────────
   *
   * This CREATES A DATABASE. Running it twice creates two, and there is no undo
   * — so "once" is a correctness property, not an optimisation. Two guards, for
   * two different repeats:
   *
   *  - `startedRef` stops the EFFECT below from firing it again on any re-render
   *    while it is still in flight (the window where `connectionId` is still
   *    null and a second call would create a second database).
   *  - `state.connectionId` stops it after a SUCCESS, including across a
   *    sessionStorage-restored refresh — the resume point.
   *
   * A plain function, not a `useCallback`: it is invoked from the effect and
   * from Retry, never passed as a prop, so a stable identity buys nothing. It
   * closes over the state as of the render that started it, which is the right
   * answer — by the time step 4 renders, steps 1–3 are finished and the source
   * choice is frozen. The only fields that still change here are the `enrich*`
   * ones, which this does not read.
   */
  const prepare = async (): Promise<void> => {
    // BEFORE the early return, not after: on a resume the connection already
    // exists, this returns straight to `ready`, and the button that renders
    // there mutates too. See {@link primeCsrfToken}.
    await primeCsrfToken();
    if (state.connectionId !== null) {
      setPhase('ready');
      return;
    }
    setPhase('creating');
    setFormError(null);
    try {
      const connectionId = await createSource();
      patch({ connectionId });
      setPhase('introspecting');
      await studioApi.introspect(connectionId);
      setPhase('ready');
    } catch (error) {
      const conflict = error instanceof ApiError ? demoConflictConnectionId(error.details) : null;
      if (conflict !== null) {
        // §6 card 4's 409: a connection already points at the demo file. No
        // retry can ever succeed, so adopt it rather than offer a dead button.
        patch({ connectionId: conflict });
        setPhase('ready');
        return;
      }
      setFormError(messageOf(error, t('desktop.setup.generate.failedBody', 'Something went wrong. Try again.')));
      setPhase('error');
    }
  };

  /** The four cards, each ending as a connection id. */
  async function createSource(): Promise<string> {
    switch (state.source) {
      case 'local': {
        const result = await createLocalDatabase({
          name: state.localName.trim(),
          ...(state.localSchema === 'file' && schemaFile !== null
            ? { schemaFile: { content: schemaFile.content, fileName: schemaFile.name } }
            : {}),
          placeholderRows: state.localSchema === 'file' && state.placeholderRows,
        });
        return result.connectionId;
      }
      case 'open-sqlite': {
        // Cards 2 and 3 are `POST /connections` with a DSN — the same call
        // self-host makes. See `setupApi.ts`'s header on why they have no route.
        if (state.sqliteFile === null) throw new Error('no file chosen');
        const connection = await studioApi.createConnection({
          name: nameFromSqlitePath(state.sqliteFile),
          engine: 'sqlite',
          dsn: sqliteDsn(state.sqliteFile),
          settings: { intent: state.intent },
        });
        return connection.id;
      }
      case 'remote': {
        const connection = await studioApi.createConnection({
          name: state.remoteName.trim(),
          engine: state.remoteEngine,
          dsn: state.remoteDsn.trim(),
          settings: { intent: state.intent },
        });
        return connection.id;
      }
      case 'demo': {
        const result = await createDemoDatabase();
        return result.connectionId;
      }
      case null:
        throw new Error('no source chosen');
    }
  }

  /** Has the create→introspect pipeline been kicked off? See {@link prepare}. */
  const startedRef = useRef(false);

  useEffect(() => {
    if (state.step !== 'generate') return;
    if (startedRef.current) return;
    startedRef.current = true;
    void prepare();
    // `prepare` is deliberately NOT a dependency: it is re-created every render,
    // so an effect keyed on its identity would fire on every keystroke — and the
    // thing it fires creates a database. `startedRef` above, not the dependency
    // array, is what makes this run once.
  }, [state.step]);

  /**
   * §6: "Finish writes `config.json` and lands on the Generated App dashboard."
   *
   * The WRITE is `setSingleUser` — `config.json` is the main process's file
   * (§2.3) and this is the only value in it §6 asks the wizard for. Everything
   * else in that file is either already correct (the dataDir, committed in step
   * 1) or a default the About screen owns.
   */
  const finish = (): void => {
    clearDesktopSetupState();
    router.options.context.queryClient.clear();
    router.history.push('/');
  };

  // ─── Navigation ────────────────────────────────────────────────────────────

  function goTo(step: DesktopSetupStepId): void {
    setFormError(null);
    patch({ step });
  }

  const busy = commit.isPending || createAdmin.isPending;

  const onContinue = (): void => {
    switch (state.step) {
      case 'location':
        onCommitDataDir(state.cloudSyncAcknowledged);
        return;
      case 'database':
        goTo('account');
        return;
      case 'account':
      case 'generate':
        // Both have their own submit affordance — the account form's button and
        // the generate step's own flow. There is no Continue to press.
        return;
    }
  };

  const continueDisabled =
    busy || (state.step === 'database' && !sourceCardValid(state)) || (state.step === 'location' && cloudSync !== null);

  return (
    <AuthScreenLayout>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h2 font-extrabold tracking-[-0.02em] text-fg">
            {t('desktop.setup.title', 'Welcome to Adminium')}
          </h1>
          <p className="text-body-sm text-fg-muted">
            {t(
              'desktop.setup.subtitle',
              'Four short steps and Adminium will have built an admin app from your database. Everything stays on this computer.',
            )}
          </p>
        </div>

        <Stepper steps={steps} activeIndex={stepIndex} label={t('desktop.setup.progress', 'Setup progress')} />

        {formError === null ? null : <Alert tone="danger" role="alert" title={formError} />}

        {state.step === 'location' ? (
          <DataLocationStep
            currentDataDir={currentDataDir}
            pendingDataDir={state.pendingDataDir}
            cloudSync={cloudSync}
            unusableReason={unusableReason}
            busy={busy}
            onChoose={onChooseDataDir}
            onRevert={() => {
              setCloudSync(null);
              setUnusableReason(null);
              patch({ pendingDataDir: null, cloudSyncAcknowledged: false });
            }}
            onAcknowledgeCloudSync={() => {
              patch({ cloudSyncAcknowledged: true });
              onCommitDataDir(true);
            }}
          />
        ) : null}

        {state.step === 'database' ? (
          <SourceStep
            state={state}
            onPatch={patch}
            busy={busy}
            schemaFileName={schemaFile?.name ?? null}
            onPickSchemaFile={(file) => {
              void file.text().then((content) => {
                setSchemaFile({ name: file.name, content });
              });
            }}
            onPickSqliteFile={() => {
              void pickSqliteFile().then((file) => {
                if (file !== null) patch({ sqliteFile: file });
              });
            }}
            // §8.2's rule, and the reason this reads `resolved`: a build with no
            // seed script has no demo route, and "we have not asked yet" is not
            // "there is no demo". Until the probe answers, the card explains
            // itself rather than offering a button that would 404.
            demoAvailable={capabilities.resolved && capabilities.flags.desktopDemo}
          />
        ) : null}

        {state.step === 'account' ? (
          <AccountStep
            values={account}
            errors={accountErrors}
            passwordMinLength={passwordMinLength}
            singleUser={state.singleUser}
            locale={locale}
            theme={themePref}
            busy={busy}
            onChange={setAccount}
            onSingleUserChange={(value) => patch({ singleUser: value })}
            onLocaleChange={(value) => patch({ locale: value })}
            onThemeChange={(value) => patch({ theme: value })}
            onSubmit={onAccountSubmit}
          />
        ) : null}

        {state.step === 'generate' ? (
          <GenerateStep
            state={state}
            onPatch={patch}
            phase={phase}
            error={formError}
            onRetry={() => {
              // The user asking again is the one legitimate second run — and it
              // is safe for the same reason the first was: `prepare` still bails
              // when `connectionId` is set, so a retry after a FAILED introspect
              // re-introspects rather than creating another database.
              setPhase('idle');
              void prepare();
            }}
            onOpenApp={finish}
            onOpenReview={(runId) => {
              router.history.push(`/studio/llm/${runId}`);
            }}
          />
        ) : null}

        <StepFooter
          step={state.step}
          busy={busy}
          continueDisabled={continueDisabled}
          onBack={() => {
            const previous = DESKTOP_SETUP_STEP_IDS[stepIndex - 1];
            if (previous !== undefined) goTo(previous);
          }}
          onContinue={onContinue}
          onSubmitAccount={() => {
            createAdmin.mutate();
          }}
        />
      </div>
    </AuthScreenLayout>
  );
}

/**
 * Back/Continue.
 *
 * NO BACK past step 3, and it is not an oversight. Step 3 creates the super
 * admin — a one-way door the server enforces with a 409 — and step 4 has already
 * created a database by the time it renders. A Back button there would offer to
 * undo something nothing can undo.
 */
function StepFooter(props: {
  step: DesktopSetupStepId;
  busy: boolean;
  continueDisabled: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSubmitAccount: () => void;
}): ReactNode {
  if (props.step === 'generate') return null;

  return (
    <div className="flex items-center gap-3">
      {props.step === 'location' ? null : (
        <Button variant="outline" size="lg" onClick={props.onBack} disabled={props.busy}>
          {t('desktop.setup.back', 'Back')}
        </Button>
      )}
      {props.step === 'account' ? (
        <Button size="lg" className="flex-1" onClick={props.onSubmitAccount} loading={props.busy}>
          {t('desktop.setup.createAccount', 'Create account and continue')}
        </Button>
      ) : (
        <Button size="lg" className="flex-1" onClick={props.onContinue} disabled={props.continueDisabled}>
          {t('desktop.setup.continue', 'Continue')}
        </Button>
      )}
    </div>
  );
}

/** Card 2's native picker. `null` off-desktop, exactly as the bridge reports. */
async function pickSqliteFile(): Promise<string | null> {
  const { getDesktopApi } = await import('../../lib/desktop-runtime.js');
  const api = getDesktopApi();
  if (api === null) return null;
  return api.openFile(SQLITE_PICKER);
}

/** An `ApiError`'s message, or a localized fallback — never `[object Object]`. */
function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

export { INITIAL_DESKTOP_SETUP_STATE };
