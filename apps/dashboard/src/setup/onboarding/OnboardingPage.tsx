// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The six-step first-run wizard, assembled (45-onboarding.md §2).
 *
 * This is the only piece that holds state: which step is showing, the two
 * answers collected before the account existed (`heldAnswers.ts`), the account
 * fields, and what the step-3 transition learned. Every step body is
 * presentational and every rule about the ORDER lives in `wizardState.ts`, so
 * what is left here is the wiring — and the one piece of judgement that cannot
 * live anywhere else: what Continue means on each step.
 *
 * NOT YET ROUTED. `/setup` still renders `FirstRunWizard`; 45-T10 makes the
 * swap, once steps 4–6 carry their real bodies (45-T05…T07). Wiring the route
 * to a wizard with three empty screens would be worse than the two-step one it
 * replaces.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { hasPendingBridgeTicket } from '../../studio/connect/bridgeSeed.js';
import { studioApi, waitForRestart } from '../../studio/api.js';
import {
  INITIAL_WIZARD_STATE,
  saveWizardState,
} from '../../studio/connect/wizardState.js';
import { setTelemetry } from '../../about/desktopAbout.js';
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
import { DEFAULT_HELD_ANSWERS, type HeldAnswers } from './heldAnswers.js';
import { submitHeldAnswers, type LandedConnection } from './submitHeldAnswers.js';
import { stepAfter, stepBefore, type OnboardingStepId } from './wizardState.js';

/** Both OFF — the wizard never pre-checks a consent (`TelemetryConsent`). */
const NO_CONSENT: SetupConsent = { telemetry: false, updateCheck: false };

export interface OnboardingPageProps {
  passwordMinLength: number;
}

export function OnboardingPage({ passwordMinLength }: OnboardingPageProps): ReactNode {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStepId>('start');
  const [held, setHeld] = useState<HeldAnswers>(DEFAULT_HELD_ANSWERS);
  const [account, setAccount] = useState<AccountValues>(EMPTY_ACCOUNT);
  const [accountErrors, setAccountErrors] = useState<AccountErrors>({});
  const [consent, setConsent] = useState<SetupConsent>(NO_CONSENT);
  const [invited, setInvited] = useState<readonly InvitedPerson[]>([]);
  const [connection, setConnection] = useState<LandedConnection | null>(null);
  /** Everything after step 3 runs signed in; before it, nothing has been sent. */
  const signedIn = connection !== null || step === 'meta' || step === 'team' || step === 'done';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageChoice>('local');
  const [separateDsn, setSeparateDsn] = useState('');
  const [separateTested, setSeparateTested] = useState(false);
  const [relocating, setRelocating] = useState<'copying' | 'restarting' | null>(null);

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

  function goto(next: OnboardingStepId | null): void {
    if (next === null) return;
    setError(null);
    setStep(next);
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
    void submitHeldAnswers({ account, consent: NO_CONSENT, held })
      .then((outcome) => {
        setBusy(false);
        if (outcome.kind === 'ok') {
          // A fresh session: drop every cached query before going on.
          router.options.context.queryClient.clear();
          setConnection(outcome.connection);
          goto('meta');
          return;
        }
        if (outcome.kind === 'account-failed') {
          setError(accountErrorCopy(outcome.cause));
          return;
        }
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
      .relocateMeta(target)
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
          cause instanceof Error
            ? cause.message
            : t('onboarding:meta.moving.failed', 'Could not move Adminium’s data — retry.'),
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
    const leave = (): void => {
      setBusy(false);
      router.history.push(handOffPath());
    };
    void setTelemetry({ telemetry: consent.telemetry, updateCheck: consent.updateCheck })
      .then(leave)
      .catch(leave);
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
    });
    return '/studio/connect';
  }

  function onNext(): void {
    if (step === 'account') {
      submitAccount();
      return;
    }
    if (step === 'meta') {
      submitStorage();
      return;
    }
    if (step === 'done') {
      finish();
      return;
    }
    goto(stepAfter(step));
  }

  const dsnError = connectDsnError(held.dsn);

  return (
    <OnboardingWizard
      step={step}
      busy={busy}
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
        if (signedIn && (target === 'start' || target === 'connect' || target === 'account')) return;
        goto(target);
      }}
      onBack={() => goto(stepBefore(step))}
      onSkip={() => goto(stepAfter(step))}
      onNext={onNext}
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
          onChange={(patch) => setHeld({ ...held, ...patch })}
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
    cause instanceof ApiError
      ? cause.message
      : typeof cause === 'object' && cause !== null && 'message' in cause
        ? String((cause as { message: unknown }).message)
        : t('onboarding:error.connectionUnknown', 'the database did not answer');
  return t(
    'onboarding:error.connectionFailed',
    'Your account was created and you are signed in — but that database could not be reached: {detail}',
    { detail },
  );
}
