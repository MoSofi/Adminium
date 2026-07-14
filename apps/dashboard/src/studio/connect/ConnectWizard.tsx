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
import { studioApi, type SchemaTable } from '../api.js';
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
  /** Storytelling stagger; tests pass 0. */
  lineDelayMs?: number | undefined;
  pollIntervalMs?: number | undefined;
}

export function ConnectWizard({ onOpenApp, onOpenReview, lineDelayMs, pollIntervalMs }: ConnectWizardProps) {
  const [state, setState] = useState<WizardState>(() => loadWizardState());
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  /** Parsed schema-file tables — memory only (the model is too big for sessionStorage). */
  const [fileTables, setFileTables] = useState<SchemaTable[] | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);

  useEffect(() => {
    saveWizardState(state);
  }, [state]);

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
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col gap-6 p-6">
      <header className="flex flex-col gap-4">
        <h1 className="text-page-title text-fg">{t('studio.wizard.title', 'New connection')}</h1>
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
        {state.step === 'meta' ? <MetaStep state={state} onPatch={patch} /> : null}
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

      <footer className="sticky bottom-0 -mx-6 mt-auto flex items-center justify-between border-t border-border bg-surface px-6 py-3.5">
        <Button variant="ghost" onClick={back} disabled={stepIndex === 0}>
          {t('studio.wizard.back', 'Back')}
        </Button>
        {state.step !== 'generate' ? (
          <Button onClick={advance} disabled={!continueEnabled} loading={persisting}>
            {t('studio.wizard.continue', 'Continue')}
          </Button>
        ) : null}
      </footer>
    </div>
  );
}

export { INITIAL_WIZARD_STATE };
