// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/connect` — the connect wizard (M5-T01/T02/T03, 09 §8.2):
 * page-wizard pattern — `Stepper` header, one step body, sticky footer with
 * Back/Continue. State persists per keystroke to sessionStorage
 * (refresh-safe); abandoning after create leaves the connection resumable.
 *
 * Steps: intent → source (3 input modes) → test+introspect (progress log) →
 * table inclusion → meta placement → generate/success.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Stepper, type Step } from '@adminium/ui';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { studioApi, waitForRestart, type MetaStoreLocation, type SchemaTable } from '../api.js';
import { redeemBridgeSeed } from './bridgeSeed.js';
import { wizardCapabilitySource } from './capabilityNotes.js';
import { EnrichStep } from './steps/EnrichStep.js';
import { GenerateStep } from './steps/GenerateStep.js';
import { IntentStep } from './steps/IntentStep.js';
import { MetaStep } from './steps/MetaStep.js';
import { SourceStep } from './steps/SourceStep.js';
import { TablesStep } from './steps/TablesStep.js';
import { TestStep, type TestStatus } from './steps/TestStep.js';
import {
  INITIAL_WIZARD_STATE,
  WIZARD_STEP_IDS,
  loadWizardState,
  saveWizardState,
  effectiveDsn,
  engineForDsn,
  sameDbDisabledReason,
  sourceStepValid,
  wizardStepLabel,
  type WizardState,
  type WizardStepId,
} from './wizardState.js';

export interface ConnectWizardProps {
  /** Navigate into the generated app after success (router injects). */
  onOpenApp: () => void;
  /** Navigate to the LLM run review screen after an AI enrichment run (router injects). */
  onOpenReview?: ((runId: string) => void) | undefined;
  /**
   * A one-time local-bridge ticket, when the user arrived from adminium.dev
   * after pasting a connection string there (`./bridgeSeed.ts`). Redeemed once,
   * on mount, to PREFILL the source step — never to skip it.
   */
  bridgeTicket?: string | null | undefined;
  /** Storytelling stagger; tests pass 0. */
  lineDelayMs?: number | undefined;
  pollIntervalMs?: number | undefined;
}

export function ConnectWizard({
  onOpenApp,
  onOpenReview,
  bridgeTicket,
  lineDelayMs,
  pollIntervalMs,
}: ConnectWizardProps) {
  const [state, setState] = useState<WizardState>(() => loadWizardState());
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  /** Parsed schema-file tables — memory only (the model is too big for sessionStorage). */
  const [fileTables, setFileTables] = useState<SchemaTable[] | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);
  /**
   * The two halves of a meta-store move, distinguished because they fail
   * differently and the second one looks alarming: `restarting` is a stretch of
   * seconds during which the server is deliberately unreachable, and a UI that
   * called that "Saving…" would leave the operator watching a dead page with no
   * idea it was expected.
   */
  const [relocating, setRelocating] = useState<'copying' | 'restarting' | null>(null);
  /** Non-null once a bridge hand-off has been applied — renders the banner. */
  const [bridgeNotice, setBridgeNotice] = useState<'applied' | 'failed' | null>(null);

  useEffect(() => {
    saveWizardState(state);
  }, [state]);

  /**
   * Redeem the hand-off exactly once.
   *
   * Lands on `source` rather than further in: the point of the bridge is that
   * the string never left the user's machine, and the way that is made visible
   * is showing them the value in the field before anything connects. A ticket
   * that has expired or been used is a notice, not an error screen — the wizard
   * behind it is perfectly usable by hand.
   */
  useEffect(() => {
    if (bridgeTicket === null || bridgeTicket === undefined || bridgeTicket === '') return;
    let cancelled = false;
    void (async () => {
      try {
        const seed = await redeemBridgeSeed(bridgeTicket);
        if (cancelled) return;
        setState((current) => ({
          ...current,
          step: 'source',
          mode: 'dsn',
          dsn: seed.dsn,
          engine: seed.engine ?? engineForDsn(seed.dsn) ?? current.engine,
        }));
        setBridgeNotice('applied');
      } catch {
        // One `catch` around the whole thing, not a rejection handler on the
        // redeem: a throw from the state update would otherwise escape as an
        // unhandled rejection and leave the user staring at a wizard that
        // silently ignored the hand-off they just performed.
        if (!cancelled) setBridgeNotice('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridgeTicket]);

  /**
   * Where this instance's meta store actually lives. Fetched once, because it
   * decides whether the meta step is a REAL choice (an embedded store this
   * server can still move) or a compatibility check against a placement someone
   * already committed to. `null` covers both "still loading" and "route absent"
   * — a topology that cannot restart itself does not register it — and both
   * mean the same thing to this component: offer no move.
   */
  const [placement, setPlacement] = useState<MetaStoreLocation | null>(null);
  useEffect(() => {
    let cancelled = false;
    void studioApi
      .getMetaPlacement()
      .then((result) => {
        if (!cancelled) setPlacement(result);
      })
      .catch(() => {
        if (!cancelled) setPlacement(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** The store is embedded and this server can move it — the step can act. */
  const canMoveMetaStore = placement !== null && placement.embedded && placement.canRelocate;

  const patch = (partial: Partial<WizardState>) => setState((current) => ({ ...current, ...partial }));

  const stepIndex = WIZARD_STEP_IDS.indexOf(state.step);
  const steps: Step[] = useMemo(
    () => WIZARD_STEP_IDS.map((id) => ({ id, label: wizardStepLabel(id) })),
    [],
  );

  const goTo = (step: WizardStepId) => patch({ step });

  const continueEnabled = (() => {
    switch (state.step) {
      case 'intent':
        return true;
      case 'source':
        return sourceStepValid(state);
      case 'test':
        return testStatus === 'done';
      case 'tables':
        return state.includedTables === null || state.includedTables.length > 0 || state.mode === 'file';
      case 'meta': {
        if (state.metaPlacement === null) return false;
        if (state.metaPlacement === 'same-db') {
          return (
            sameDbDisabledReason({
              readOnly: state.readOnly,
              privileges: state.privileges,
              sourceIsFile: state.mode === 'file',
            }) === null
          );
        }
        return state.mode === 'file' ? state.separateMetaDsn.trim().length > 0 : state.separateMetaTested;
      }
      case 'enrich':
        // AI paths (provider/BYO) exit to the review screen from inside the
        // step; only "Skip" (or a file source with no snapshot) advances here.
        return state.enrichIntent === 'skip' || state.mode === 'file';
      case 'generate':
        return false; // terminal — SuccessState owns the exit
    }
  })();

  const advance = () => {
    const next = WIZARD_STEP_IDS[stepIndex + 1];
    if (next === undefined) return;

    // ── Leaving the meta step MOVES the store (01 §3.1) ───────────────────
    // This is the step that used to record an answer and do nothing with it:
    // the Studio is served by a running server, so a meta store already
    // existed by the time anyone could be asked where it should live, and
    // picking "same database" here left the embedded SQLite store in place.
    // Now the answer is carried out — copy, then restart onto the new store.
    if (state.step === 'meta' && canMoveMetaStore && state.metaPlacement !== null) {
      const target =
        state.metaPlacement === 'same-db' ? effectiveDsn(state) : state.separateMetaDsn.trim();
      setRelocating('copying');
      setPersistError(null);
      void studioApi
        .relocateMeta(target)
        .then(async (result) => {
          // The reply means the copy committed, not that the server is back —
          // it restarts immediately after flushing it.
          setRelocating('restarting');
          const back = await waitForRestart(result.healthPath);
          if (!back) {
            throw new Error(
              t(
                'studio.meta.move.timeout',
                'Adminium moved its tables but has not come back yet. Your data is safe in the new database — reload this page in a moment.',
              ),
            );
          }
          // Deliberately NOT re-fetching placement: the store has moved, the
          // step is done, and the next thing on screen is the enrich step.
          goTo(next);
        })
        .catch((cause: unknown) => {
          setPersistError(
            cause instanceof ApiError
              ? cause.message
              : cause instanceof Error
                ? cause.message
                : t('studio.meta.move.failed', 'Could not move Adminium’s tables — retry.'),
          );
        })
        .finally(() => setRelocating(null));
      return;
    }

    // Leaving the tables step persists inclusion + intent (M5-T02).
    if (state.step === 'tables' && state.connectionId !== null) {
      setPersisting(true);
      setPersistError(null);
      const settings = {
        intent: state.intent,
        ...(state.includedTables === null ? {} : { includedTables: state.includedTables }),
      };
      void studioApi
        .patchConnection(state.connectionId, { settings })
        .then(() => goTo(next))
        .catch((cause: unknown) => {
          setPersistError(
            cause instanceof ApiError
              ? cause.message
              : t('studio.wizard.persistFailed', 'Could not save your table selection — retry.'),
          );
        })
        .finally(() => setPersisting(false));
      return;
    }
    goTo(next);
  };

  const back = () => {
    const previous = WIZARD_STEP_IDS[stepIndex - 1];
    if (previous !== undefined) goTo(previous);
  };

  return (
    <PageSurface width="page" className="flex min-h-full flex-col gap-6">
      <PageActions title={t('studio.wizard.title', 'New connection')} />
      <header className="flex flex-col gap-4">
        <Stepper
          steps={steps}
          activeIndex={stepIndex}
          label={t('studio.wizard.progress', 'Setup progress')}
          onStepClick={(index) => {
            // Back-navigation only — forward jumps go through Continue gating.
            if (index < stepIndex) {
              const target = WIZARD_STEP_IDS[index];
              if (target !== undefined) goTo(target);
            }
          }}
        />
      </header>

      <main className="flex-1">
        {bridgeNotice !== null ? (
          <div className="mb-4">
            {bridgeNotice === 'applied' ? (
              <Alert
                tone="info"
                title={t('studio.wizard.bridgeAppliedTitle', 'Connection string received')}
                body={t(
                  'studio.wizard.bridgeAppliedBody',
                  'Handed over from adminium.dev by your browser — it went straight to this machine and was never uploaded. Check it below, then continue.',
                )}
              />
            ) : (
              <Alert
                tone="warn"
                title={t('studio.wizard.bridgeFailedTitle', 'That hand-off could not be used')}
                body={t(
                  'studio.wizard.bridgeFailedBody',
                  'It has already been used or has expired. Paste your connection string below instead.',
                )}
              />
            )}
          </div>
        ) : null}
        {state.step === 'intent' ? (
          <IntentStep value={state.intent} onChange={(intent) => patch({ intent })} />
        ) : null}
        {state.step === 'source' ? (
          <SourceStep state={state} onPatch={patch} onFileTablesCapture={setFileTables} />
        ) : null}
        {state.step === 'test' ? (
          <TestStep
            state={state}
            onPatch={patch}
            status={testStatus}
            onStatus={setTestStatus}
            lineDelayMs={lineDelayMs}
            pollIntervalMs={pollIntervalMs}
          />
        ) : null}
        {state.step === 'tables' ? (
          <TablesStep
            connectionId={state.mode === 'file' ? null : state.connectionId}
            fileTables={fileTables}
            source={wizardCapabilitySource(state)}
            included={state.includedTables}
            onIncludedChange={(includedTables) => patch({ includedTables })}
          />
        ) : null}
        {state.step === 'meta' ? (
          <MetaStep state={state} onPatch={patch} placement={placement} relocating={relocating} />
        ) : null}
        {state.step === 'enrich' ? (
          <EnrichStep
            state={state}
            onPatch={patch}
            onOpenReview={onOpenReview ?? (() => undefined)}
            pollIntervalMs={pollIntervalMs}
          />
        ) : null}
        {state.step === 'generate' ? (
          <GenerateStep state={state} onOpenApp={onOpenApp} lineDelayMs={lineDelayMs} />
        ) : null}
        {persistError !== null ? (
          <div className="mt-4">
            <Alert tone="danger" role="alert" title={t('studio.wizard.persistFailedTitle', 'Save failed')} body={persistError} />
          </div>
        ) : null}
      </main>

      {/*
        Back is OMITTED on the first step rather than rendered disabled. A dead
        greyed control is the first thing the eye lands on in an otherwise empty
        bar, and it communicates nothing that the absence of the button doesn't
        — there is visibly no step to go back to.
      */}
      <footer
        className={`sticky bottom-0 -mx-6 mt-auto flex items-center border-t border-border bg-surface px-6 py-3.5 ${
          stepIndex === 0 ? 'justify-end' : 'justify-between'
        }`}
      >
        {stepIndex === 0 ? null : (
          // Back is hidden mid-move: the store is being copied or the server is
          // restarting, and there is no earlier step to return to that would
          // still describe reality.
          <Button variant="ghost" onClick={back} disabled={relocating !== null}>
            {t('studio.wizard.back', 'Back')}
          </Button>
        )}
        {state.step !== 'generate' ? (
          <Button
            onClick={advance}
            disabled={!continueEnabled || relocating !== null}
            loading={persisting || relocating !== null}
          >
            {relocating === 'copying'
              ? t('studio.meta.move.copying', 'Moving Adminium’s tables…')
              : relocating === 'restarting'
                ? t('studio.meta.move.restarting', 'Restarting…')
                : t('studio.wizard.continue', 'Continue')}
          </Button>
        ) : null}
      </footer>
    </PageSurface>
  );
}

export { INITIAL_WIZARD_STATE };
