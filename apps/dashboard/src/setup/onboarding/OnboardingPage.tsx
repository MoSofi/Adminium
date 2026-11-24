// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The six-step first-run wizard, assembled.
 *
 * This is the only piece that holds state: which step is showing, the two
 * answers collected before the account existed (`heldAnswers.ts`), the account
 * fields, and what the step-3 transition learned. Every step body is
 * presentational and every rule about the ORDER lives in `wizardState.ts`, so
 * what is left here is the wiring — and the one piece of judgement that cannot
 * live anywhere else: what Continue means on each step.
 *
 * NOT YET ROUTED. `/setup` still renders `FirstRunWizard`; a later step makes the
 * swap, once steps 4–6 carry their real bodies (…T07). Wiring the route to a
 * wizard with three empty screens would be worse than the two-step one it
 * replaces.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { engineForDsn } from '@adminium/widgets';

import { api, ApiError } from '../../app/api.js';
import { systemInfoQuery, type SystemInfo } from '../../app/capabilities.js';
import { useCommonWords } from '../../i18n/commonWords.js';
import { t } from '../../i18n/t.js';
import { hasPendingBridgeTicket } from '../../studio/connect/bridgeTicket.js';
import { studioApi, waitForRestart } from '../../studio/api.js';
import {
  INITIAL_WIZARD_STATE,
  saveWizardState,
} from '../../studio/connect/wizardState.js';
import { setTelemetry } from '../../about/desktopAbout.js';
import { offByOperatorText, useOperatorSwitch } from '../../settings/OffByOperator.js';
import { adoptStore, probeStore, takeWelcomeEmail } from '../setupApi.js';
import {
  EMPTY_ACCOUNT,
  validateAccount,
  type AccountErrors,
  type AccountValues,
} from '../accountValidation.js';
import type { SetupConsent } from '../setupApi.js';
import { OnboardingWizard } from './OnboardingWizard.js';
import { AccountStep } from './steps/AccountStep.js';
import { ConnectStep, connectDsnError } from './steps/ConnectStep.js';
import { StartStep } from './steps/StartStep.js';
import { StorageStep, separateDsnError, type StorageChoice } from './steps/StorageStep.js';
import { TeamStep, type InvitedPerson } from './steps/TeamStep.js';
import { DoneStep } from './steps/DoneStep.js';
import { connectionNameFromDsn } from './submitHeldAnswers.js';
import { DEFAULT_HELD_ANSWERS, ONBOARDING_ENGINES, type HeldAnswers } from './heldAnswers.js';
import { submitHeldAnswers, type LandedConnection } from './submitHeldAnswers.js';
import type { ConnectedDatabase } from './steps/DoneStep.js';
import {
  onboardingStepIds,
  stepAfter,
  stepBefore,
  type OnboardingStepId,
} from './wizardState.js';

/** Long enough that typing a DSN is one probe, short enough that waiting on it is cheap. */
const PROBE_DEBOUNCE_MS = 400;

/** Both OFF — the wizard never pre-checks a consent (`TelemetryConsent`). */
const NO_CONSENT: SetupConsent = { telemetry: false, updateCheck: false };

export interface OnboardingPageProps {
  passwordMinLength: number;
  /**
   * The server connected a database before anyone signed in — a project's
   * `databases.main`, or the first-boot source seed (`GET /setup/state`). The
   * wizard then opens on the account and leaves out the starting-point and
   * connect steps (walkthrough finding V7).
   */
  databaseConnected?: boolean | undefined;
}

export function OnboardingPage({
  passwordMinLength,
  databaseConnected = false,
}: OnboardingPageProps): ReactNode {
  // The account step's checks are worded by a deferred group (`setup`).
  useCommonWords();
  const router = useRouter();
  const queryClient = useQueryClient();
  // A trial leaves out storage and team (`wizardState.ts`): the operator fixes the one, the owner invites people later.
  const trial = useQuery(systemInfoQuery()).data?.trial?.on === true;
  const steps = onboardingStepIds(databaseConnected, trial);
  const [step, setStep] = useState<OnboardingStepId>(steps[0] ?? 'start');
  const [held, setHeld] = useState<HeldAnswers>(DEFAULT_HELD_ANSWERS);
  // The address the trial's welcome link was sent to, filled in for its owner.
  const [account, setAccount] = useState<AccountValues>(() => ({ ...EMPTY_ACCOUNT, email: takeWelcomeEmail() ?? '' }));
  /** The operator's start prompt at the last step: it could not start (Try again), or it waits for the AI's cap. */
  const [prompt, setPrompt] = useState<{ kind: 'failed'; detail: string } | { kind: 'waiting'; until: number } | null>(null);
  const [accountErrors, setAccountErrors] = useState<AccountErrors>({});
  const [consent, setConsent] = useState<SetupConsent>(NO_CONSENT);
  const [invited, setInvited] = useState<readonly InvitedPerson[]>([]);
  const [connection, setConnection] = useState<LandedConnection | null>(null);
  /**
   * The account exists. Set on BOTH outcomes that create one — including the
   * failure, where the connection is what did not take.
   */
  const [accountCreated, setAccountCreated] = useState(false);
  /** Everything after step 3 runs signed in; before it, nothing has been sent. */
  const signedIn = connection !== null || step === 'meta' || step === 'team' || step === 'done';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageChoice>('local');
  const [separateDsn, setSeparateDsn] = useState('');
  const [separateTested, setSeparateTested] = useState(false);
  const [relocating, setRelocating] = useState<'copying' | 'restarting' | null>(null);
  const [adopting, setAdopting] = useState<'writing' | 'restarting' | null>(null);

  /**
   * Ask what is already in the database the connect step was given.
   *
   * Debounced and fire-and-forget: it runs while someone is still typing, its
   * answer only ever ADDS a choice, and a probe that fails leaves the wizard
   * exactly as it was — the DSN is tested for real at the step-3 transition
   * either way. Keyed on the trimmed string, so re-typing the same DSN does not
   * re-ask and every edit invalidates the previous answer.
   */
  const inFlight = useRef<string | null>(null);
  // Trial mode: the operator fixes the meta store, so there is no store to find and adopt here (the server refuses the probe).
  const metaFixed = useOperatorSwitch('metaStoreRoutes');
  const sqlite = useOperatorSwitch('sqliteSources');
  useEffect(() => {
    const dsn = held.dsn.trim();
    if (metaFixed.off || step !== 'connect' || dsn === '' || connectDsnError(dsn) !== null) return;
    if (held.probedDsn === dsn || inFlight.current === dsn) return;
    const timer = window.setTimeout(() => {
      inFlight.current = dsn;
      void probeStore(dsn)
        .then((probe) => {
          setHeld((current) =>
            current.dsn.trim() !== dsn
              ? current // a later keystroke moved on while this was in flight
              : {
                  ...current,
                  existing:
                    probe.reachable && probe.occupied.length > 0
                      ? { occupied: probe.occupied, secretMatches: probe.secretMatches }
                      : null,
                  probedDsn: dsn,
                  park: false,
                },
          );
        })
        .catch(() => {
          // A probe that cannot answer must not hold the wizard: record the
          // question as asked, say nothing, and let the step-3 transition test
          // the DSN properly. Blocking Continue on a failed probe would make an
          // advisory check into a gate on something it cannot see.
          setHeld((current) =>
            current.dsn.trim() === dsn ? { ...current, existing: null, probedDsn: dsn } : current,
          );
        })
        .finally(() => {
          if (inFlight.current === dsn) inFlight.current = null;
        });
    }, PROBE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [step, held.dsn, held.probedDsn, metaFixed.off]);

  /**
   * A DSN worth asking about, whose answer has not arrived. Covers the debounce
   * window as well as the request, because both are time in which pressing
   * Continue would out-run the check.
   */
  const dsnTrimmed = held.dsn.trim();
  const probing =
    !metaFixed.off &&
    step === 'connect' &&
    dsnTrimmed !== '' &&
    connectDsnError(dsnTrimmed) === null &&
    held.probedDsn !== dsnTrimmed;

  /**
   * Continue pressed while the check is still out. Pasting a string and
   * pressing Continue at once is the ordinary way through this step, and a
   * Continue that was disabled for those 400 ms swallowed the press, so the
   * person had to press it again. Held instead: the button shows busy, and the
   * step moves on by itself once the answer is in, unless the answer is an
   * Adminium already in there, whose choices this screen then shows.
   */
  const [continueHeld, setContinueHeld] = useState(false);
  useEffect(() => {
    if (!continueHeld || probing) return;
    setContinueHeld(false);
    if (step !== 'connect' || held.existing !== null || connectDsnError(held.dsn.trim()) !== null) return;
    onNext();
  });

  /**
   * Where the meta store lives. Fetched only once the account exists — the
   * route needs a session, and before step 3 there is none. `enabled` is what
   * keeps this from firing a 401 behind the first two screens.
   */
  const placement = useQuery({
    queryKey: ['setup', 'meta-placement'],
    queryFn: () => studioApi.getMetaPlacement(),
    enabled: signedIn,
    retry: false,
  });

  /**
   * What the server connected and generated before the wizard opened, for the
   * last screen. Read once signed in, for the same reason as `placement`.
   */
  const preconnected = useQuery({
    queryKey: ['setup', 'preconnected'],
    queryFn: () => studioApi.listConnections(),
    enabled: databaseConnected && signedIn,
    retry: false,
  });
  const connectedDatabases: readonly ConnectedDatabase[] | undefined = databaseConnected
    ? (preconnected.data ?? []).map((dto) => ({
        name: dto.name,
        status: dto.status,
        tableCount: dto.tableCount,
        pageCount: dto.pageCount,
      }))
    : undefined;

  function goto(next: OnboardingStepId | null): void {
    if (next === null) return;
    setError(null);
    // The account step is behind us once it has run: a second submit would 409
    // against the instance's own admin. Anything aimed at it — Continue, Skip,
    // the rail — lands on the step after instead.
    setStep(next === 'account' && accountCreated ? (stepAfter('account', steps) ?? 'done') : next);
  }

  /**
   * The account submit. The account is created once and only once: after it
   * succeeds this step is behind us, and a failure that left it standing
   * (`connection-failed`) sends the wizard back to the connect step rather than
   * here, because retrying the account would 409 against the instance's own
   * new admin.
   */
  function submitAccount(): void {
    const found = validateAccount(account, passwordMinLength);
    setAccountErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setError(null);
    // NO_CONSENT, deliberately, and not the state: the question is asked on
    // step 6, three screens after this runs. Creating the account with both
    // answers off is what keeps "nothing is sent until you say so" true for the
    // window in between.
    void submitHeldAnswers({ account, consent: NO_CONSENT, held, accountExists: accountCreated })
      .then((outcome) => {
        setBusy(false);
        if (outcome.kind === 'ok') {
          // A fresh session: drop every cached query before going on.
          router.options.context.queryClient.clear();
          setAccountCreated(true);
          setConnection(outcome.connection);
          setError(null);
          setStep(stepAfter('account', steps) ?? 'done');
          return;
        }
        if (outcome.kind === 'account-failed') {
          setError(accountErrorCopy(outcome.cause));
          return;
        }
        // The account stands — that is what makes this recoverable, and what
        // the next attempt must not try to repeat.
        setAccountCreated(true);
        setError(connectionErrorCopy(outcome.cause));
        setStep('connect');
      })
      .catch((cause: unknown) => {
        setBusy(false);
        setError(accountErrorCopy(cause));
      });
  }

  /**
   * Carry out the storage choice, which for two of the three answers means
   * moving the store and restarting the server onto it. The reply to
   * `relocateMeta` means the COPY committed, not that the server is back —
   * `waitForRestart` is the second half, and skipping it would advance the
   * wizard into a screen whose first request hits a dead port.
   */
  function submitStorage(): void {
    if (storage === 'local') {
      goto('team');
      return;
    }
    // `same-db` means the database step 2 collected — still in memory, exactly
    // as the Studio's meta step still holds its own wizard state. It is never
    // read back from the server: the stored copy is encrypted, and asking for
    // it in the clear would be a worse door than keeping it in the tab that
    // typed it.
    const target = storage === 'same-db' ? held.dsn.trim() : separateDsn.trim();
    if (target === '') {
      goto('team');
      return;
    }

    setRelocating('copying');
    setError(null);
    setBusy(true);
    void studioApi
      .relocateMeta(target, { park: held.park })
      .then(async (result) => {
        // The reply means the COPY committed, not that the server is back — it
        // restarts immediately after flushing it. Advancing here would land the
        // next screen's first request on a dead port.
        setRelocating('restarting');
        const back = await waitForRestart(result.healthPath);
        if (!back) {
          throw new Error(
            t(
              'onboarding:meta.moving.timeout',
              'Adminium moved its data but has not come back yet. It is safe in the new database — reload this page in a moment.',
            ),
          );
        }
        goto('team');
      })
      .catch((cause: unknown) => {
        setError(
          offByOperatorText(cause) ??
            (cause instanceof Error ? cause.message : t('onboarding:meta.moving.failed', 'Could not move Adminium’s data — retry.')),
        );
      })
      .finally(() => {
        setRelocating(null);
        setBusy(false);
      });
  }

  /**
   * Leave the wizard.
   *
   * The consent answers are written here rather than at the account submit
   * because that is where they were ASKED (step 6). Failing to write them must
   * not trap anyone in the wizard — the setting defaults to off and Studio
   * settings can flip it — so the navigation happens either way.
   */
  function finish(): void {
    setBusy(true);
    const leave = (to: string): void => {
      setBusy(false);
      router.history.push(to);
    };
    setError(null);
    void setTelemetry({ telemetry: consent.telemetry, updateCheck: consent.updateCheck })
      .catch(() => undefined)
      .then(startPrompt)
      .then((started) => {
        if ('to' in started) {
          leave(started.to);
          return;
        }
        // It could not start, or it waits: said here, and the person chooses.
        setBusy(false);
        setPrompt(started);
        setError(started.kind === 'failed' ? t('onboarding:done.startPrompt.failed', 'Your first build could not start: {detail}', { detail: started.detail }) : null);
      });
  }

  /** Leave without the start prompt: it stays for later where it can (the server keeps its wait). */
  function leaveWithoutPrompt(): void {
    router.history.push(handOffPath());
  }

  /**
   * The operator's start prompt (`ADMINIUM_DESIGNER_START_PROMPT_B64`), where the server has one that has not run
   * (`/system/info` says so): the Designer opens on the dashboard it starts building. Anywhere else nothing is asked,
   * and where it cannot start (no model) the server says no: the wizard lets go as it always does.
   */
  async function startPrompt(): Promise<{ to: string } | { kind: 'failed'; detail: string } | { kind: 'waiting'; until: number }> {
    let info: SystemInfo;
    try {
      info = await queryClient.fetchQuery({ ...systemInfoQuery(), staleTime: 0 });
    } catch {
      return { to: handOffPath() };
    }
    // Refused at the operator's AI cap: the server starts it by itself at its time.
    const until = info.designer?.startPromptWaitsUntil;
    if (typeof until === 'number') return { kind: 'waiting', until };
    if (info.designer?.startPrompt !== true) return { to: handOffPath() };
    try {
      const started = await api.post<{ sessionId: string }>('/api/v1/designer/start-prompt', {});
      return { to: `/design/${encodeURIComponent(started.sessionId)}` };
    } catch (cause) {
      const details = cause instanceof ApiError ? (cause.details as { reason?: unknown; until?: unknown } | null | undefined) : undefined;
      if (details?.reason === 'START_PROMPT_WAITING' && typeof details.until === 'number') return { kind: 'waiting', until: details.until };
      // Another tab started it: nothing to say.
      if (details?.reason === 'START_PROMPT_RAN') return { to: handOffPath() };
      return { kind: 'failed', detail: offByOperatorText(cause) ?? (cause instanceof Error ? cause.message : t('onboarding:error.connectionUnknown', 'the database did not answer')) };
    }
  }

  /**
   * Where the wizard lets go.
   *
   * A pending adminium.dev ticket goes to the Studio wizard, which is the only
   * surface that can redeem it (45 DEP-17). So does a connection that was asked
   * to generate something: 45 R4 gives tables → enrich → generate to that
   * wizard, and seeding its own persisted state is how it resumes at the tables
   * step instead of asking for the database a second time.
   */
  function handOffPath(): string {
    if (hasPendingBridgeTicket()) return '/studio/connect';
    // "Connect Supabase" was picked before the account existed: Studio's wizard starts the sign-in now.
    if (held.provider === 'supabase' && held.dsn.trim() === '') {
      saveWizardState({
        ...INITIAL_WIZARD_STATE,
        step: 'source',
        intent: held.start,
        metaAsked: true,
        providerStart: 'supabase',
      });
      return '/studio/connect';
    }
    if (connection === null || held.start === 'blank') return '/';
    saveWizardState({
      ...INITIAL_WIZARD_STATE,
      step: 'tables',
      intent: held.start,
      engine: connection.engine,
      name: connectionNameFromDsn(held.dsn, connection.engine),
      dsn: held.dsn,
      connectionId: connection.connectionId,
      readOnly: connection.readOnly,
      privileges: connection.privileges,
      // Asked on this wizard's storage step: the Studio's must not ask again.
      metaAsked: true,
    });
    return '/studio/connect';
  }

  /**
   * Point this instance at the store that is already there, and go and sign in.
   *
   * No account is created and nothing is copied: the bootstrap file is written,
   * the server restarts onto that store, and the operator lands on `/login`
   * where their existing account is. Only reachable from the connect step —
   * before this wizard has made anything of its own to strand.
   */
  function adopt(): void {
    setAdopting('writing');
    setError(null);
    void adoptStore(held.dsn.trim())
      .then(async (result) => {
        setAdopting('restarting');
        const back = await waitForRestart(result.healthPath);
        if (!back) {
          throw new Error(
            t(
              'onboarding:connect.existing.timeout',
              'Adminium is pointed at that database but has not come back yet — reload this page in a moment.',
            ),
          );
        }
        router.options.context.queryClient.clear();
        router.history.push('/login');
      })
      .catch((cause: unknown) => {
        setAdopting(null);
        setError(
          cause instanceof Error
            ? cause.message
            : t('onboarding:connect.existing.failed', 'Could not point this instance at that database.'),
        );
      });
  }

  function onNext(): void {
    if (probing) {
      setContinueHeld(true);
      return;
    }
    if (step === 'account') {
      submitAccount();
      return;
    }
    // Continuing from the connect step AFTER the account exists is the retry of
    // a database that would not answer: land the connection, skip the account.
    if (step === 'connect' && accountCreated) {
      submitAccount();
      return;
    }
    if (step === 'meta') {
      submitStorage();
      return;
    }
    if (step === 'done') {
      // Waiting for the AI's cap: on to the dashboard; the build starts by itself.
      if (prompt?.kind === 'waiting') {
        leaveWithoutPrompt();
        return;
      }
      finish();
      return;
    }
    goto(stepAfter(step, steps));
  }

  // A SQLite string where the operator allows none: the step says why, and Continue waits.
  const dsnError = connectDsnError(held.dsn) ?? (sqlite.off && engineForDsn(held.dsn, ONBOARDING_ENGINES) === 'sqlite' ? sqlite.reason : null);

  return (
    <OnboardingWizard
      step={step}
      steps={steps}
      busy={busy || continueHeld}
      error={error}
      nextDisabled={
        (step === 'connect' && dsnError !== null) ||
        // A database of its own has to be PROVEN before the store moves into
        // it: a failed relocation is the one failure here with no way back.
        (step === 'meta' &&
          storage === 'separate' &&
          (!separateTested || separateDsnError(separateDsn) !== null))
      }
      onStepSelect={(target) => {
        // The rail may not walk BACK into the account step once it has run:
        // the account exists, and the server would 409 a second submit.
        if (accountCreated && target === 'account') return;
        if (signedIn && (target === 'start' || target === 'connect')) return;
        goto(target);
      }}
      onBack={() => goto(stepBefore(step, steps))}
      onSkip={() => goto(stepAfter(step, steps))}
      onNext={onNext}
      notice={
        step === 'done' && prompt?.kind === 'waiting'
          ? t('onboarding:done.startPrompt.waiting', 'The AI included with this server is busy for now. Your build starts by itself at {time}.', {
              time: new Date(prompt.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            })
          : null
      }
      {...(step === 'done' && prompt?.kind === 'failed'
        ? {
            nextLabel: t('onboarding:done.startPrompt.retry', 'Try again'),
            secondary: { label: t('onboarding:done.startPrompt.skip', 'Continue without it'), onClick: leaveWithoutPrompt },
          }
        : {})}
      {...(step === 'account'
        ? { nextLabel: t('onboarding:account.submit', 'Create account') }
        : {})}
    >
      {step === 'start' ? (
        <StartStep value={held.start} onChange={(start) => setHeld({ ...held, start })} />
      ) : null}
      {step === 'connect' ? (
        <ConnectStep
          engine={held.engine}
          dsn={held.dsn}
          existing={held.existing}
          probing={probing}
          park={held.park}
          adopting={adopting}
          onPark={() => setHeld({ ...held, park: true })}
          onAdopt={adopt}
          onChange={(patch) =>
            // Any edit to the string invalidates what the probe said about the
            // old one — and un-parks, because the choice was about that database.
            // Typing one also un-picks "Connect Supabase": the string is the answer now.
            setHeld({
              ...held,
              ...patch,
              ...(patch.dsn === undefined ? {} : { existing: null, probedDsn: null, park: false, ...(patch.dsn.trim() === '' ? {} : { provider: null }) }),
            })
          }
          provider={held.provider}
          onPickProvider={() => {
            // The pick is the answer: no string, so the account is made without a connection, and the
            // wizard ends in Studio's connect wizard, which starts the Supabase sign-in (`handOffPath`).
            setHeld({ ...held, dsn: '', existing: null, probedDsn: null, park: false, provider: 'supabase' });
            goto(stepAfter('connect', steps));
          }}
        />
      ) : null}
      {step === 'account' ? (
        <AccountStep
          values={account}
          errors={accountErrors}
          passwordMinLength={passwordMinLength}
          onChange={setAccount}
          onSubmit={submitAccount}
        />
      ) : null}
      {step === 'meta' ? (
        <StorageStep
          value={storage}
          onChange={setStorage}
          separateDsn={separateDsn}
          onSeparateDsnChange={setSeparateDsn}
          separateTested={separateTested}
          onSeparateTested={setSeparateTested}
          placement={placement.data ?? null}
          connection={connection}
          alreadyConnected={databaseConnected}
          existing={held.existing}
          park={held.park}
          relocating={relocating}
        />
      ) : null}
      {step === 'team' ? (
        <TeamStep
          invited={invited}
          onInvited={(person) => setInvited((current) => [...current, person])}
        />
      ) : null}
      {step === 'done' ? (
        <DoneStep
          connection={connection}
          connectedDatabases={connectedDatabases}
          storage={storage}
          start={held.start}
          invitedCount={invited.length}
          consent={consent}
          onConsentChange={setConsent}
        />
      ) : null}
    </OnboardingWizard>
  );
}

function accountErrorCopy(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 409) {
    return t(
      'onboarding:error.alreadyCompleted',
      'This instance has already been set up. Sign in with the existing admin account.',
    );
  }
  if (cause instanceof ApiError && cause.code === 'SETUP_TOKEN_INVALID') {
    return t(
      'onboarding:error.setupToken',
      'The server no longer accepts the setup token you entered. Reload this page and enter the one in its latest log.',
    );
  }
  if (cause instanceof ApiError && cause.status === 422) {
    return t(
      'onboarding:error.rejected',
      'The server rejected those details. Check the email and password and try again.',
    );
  }
  return t(
    'onboarding:error.failed',
    'Setup failed. Check your connection and try again.',
  );
}

/**
 * The account survived; the database did not answer. Say both, because a
 * message that only mentions the failure reads as though setup was lost.
 */
function connectionErrorCopy(cause: unknown): string {
  const detail =
    offByOperatorText(cause) ??
    (cause instanceof ApiError
      ? cause.message
      : typeof cause === 'object' && cause !== null && 'message' in cause
        ? String((cause as { message: unknown }).message)
        : t('onboarding:error.connectionUnknown', 'the database did not answer'));
  return t(
    'onboarding:error.connectionFailed',
    'Your account was created and you are signed in — but that database could not be reached: {detail}',
    { detail },
  );
}
