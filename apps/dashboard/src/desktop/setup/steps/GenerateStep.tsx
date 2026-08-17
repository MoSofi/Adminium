// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 4 — "Generate" (11-electron.md §6): "Introspection + generation,
 * identical to Studio M5."
 *
 * ─── WHY THE SOURCE IS CREATED HERE ──────────────────────────────────────────
 *
 * See `desktopSetupState.ts`'s header. Step 2 could not call anything — no user
 * existed yet — so this step runs the whole pipeline the session from step 3
 * finally authorizes: create → introspect → (enrich) → generate.
 *
 * ─── "IDENTICAL TO STUDIO M5", LITERALLY ─────────────────────────────────────
 *
 * The enrich and generate screens below are Studio's own `EnrichStep` and
 * `GenerateStep` components, not desktop copies of them. They read a small,
 * well-defined slice of `WizardState` (`connectionId`, `intent`, `mode`, and the
 * five `enrich*` fields), so {@link toWizardState} adapts this wizard's state
 * onto that shape and hands it over. Re-implementing them would have produced a
 * second BYO round-trip, a second job poller, and a second place for the LLM
 * flow to drift from 06-llm-assist.md — for a screen whose spec is the word
 * "identical".
 *
 * The BYO-first default §6 asks for is already `EnrichStep`'s behavior on
 * desktop: 11-T10 made it lead with the copy/paste round-trip and label the
 * provider-API card "requires internet", driven by `system/info`'s
 * `networkFeaturesAllowed`. Setting it here too would be a second answer to a
 * question that already has one.
 */
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, MonoText } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { EnrichStep } from '../../../studio/connect/steps/EnrichStep.js';
import { GenerateStep as StudioGenerateStep } from '../../../studio/connect/steps/GenerateStep.js';
import { INITIAL_WIZARD_STATE, type WizardState } from '../../../studio/connect/wizardState.js';
import type { DesktopSetupState } from '../desktopSetupState.js';

/** What the source pipeline is doing, for the progress copy. */
export type PreparePhase = 'idle' | 'creating' | 'introspecting' | 'ready' | 'error';

export interface GenerateStepProps {
  state: DesktopSetupState;
  onPatch: (patch: Partial<DesktopSetupState>) => void;
  phase: PreparePhase;
  error: string | null;
  /** Re-run create → introspect after a failure. */
  onRetry: () => void;
  onOpenApp: () => void;
  onOpenReview: (runId: string) => void;
  /** Test seams, forwarded to the Studio components unchanged. */
  lineDelayMs?: number | undefined;
  pollIntervalMs?: number | undefined;
}

/**
 * This wizard's state onto the slice Studio's steps read.
 *
 * `mode: 'dsn'` unconditionally, and it is not a shrug: `mode` gates exactly one
 * behavior in those components — the `'file'` branch, which means "a schema file
 * was parsed and there is no live database to introspect or enrich". Every
 * desktop source ends as a real, connected database, INCLUDING the schema-file
 * one (the server applies the DDL to a new SQLite file and connects to it), so
 * `'file'` would be the wrong answer for all four cards.
 */
export function toWizardState(state: DesktopSetupState): WizardState {
  return {
    ...INITIAL_WIZARD_STATE,
    mode: 'dsn',
    step: 'generate',
    intent: state.intent,
    connectionId: state.connectionId,
    enrichIntent: state.enrichIntent,
    enrichSections: state.enrichSections,
    enrichLocales: state.enrichLocales,
    enrichSampling: state.enrichSampling,
  };
}

function phaseLabel(phase: PreparePhase): string {
  switch (phase) {
    case 'creating':
      return t('desktop.setup.generate.creating', 'Setting up your database…');
    case 'introspecting':
      return t('desktop.setup.generate.introspecting', 'Reading your schema — tables, columns and relationships…');
    case 'idle':
    case 'ready':
    case 'error':
      return t('desktop.setup.generate.working', 'Working…');
  }
}

export function GenerateStep(props: GenerateStepProps): ReactNode {
  const wizardState = toWizardState(props.state);

  if (props.phase === 'error') {
    return (
      <Alert
        tone="danger"
        role="alert"
        title={t('desktop.setup.generate.failedTitle', 'Adminium could not set that database up')}
        body={props.error ?? t('desktop.setup.generate.failedBody', 'Something went wrong. Try again.')}
        action={
          <Button variant="outline" onClick={props.onRetry}>
            {t('desktop.setup.generate.retry', 'Try again')}
          </Button>
        }
      />
    );
  }

  if (props.phase !== 'ready') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 aria-hidden className="size-5 animate-spin text-accent" />
        <p className="text-body text-fg">{phaseLabel(props.phase)}</p>
        <MonoText className="text-body-sm text-fg-muted">
          {t('desktop.setup.generate.offlineNote', 'All of this happens on this computer.')}
        </MonoText>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Studio's own step — including §6's BYO-first default and the
          "Requires internet & an API key" label on the provider card. */}
      <EnrichStep
        state={wizardState}
        onPatch={(patch) => {
          // Only the enrich slice can come back — the rest of `WizardState` is
          // an adapter artifact and writing it into this wizard's state would
          // be laundering Studio's defaults in through the back door.
          props.onPatch({
            ...(patch.enrichIntent === undefined ? {} : { enrichIntent: patch.enrichIntent }),
            ...(patch.enrichSections === undefined ? {} : { enrichSections: patch.enrichSections }),
            ...(patch.enrichLocales === undefined ? {} : { enrichLocales: patch.enrichLocales }),
            ...(patch.enrichSampling === undefined ? {} : { enrichSampling: patch.enrichSampling }),
          });
        }}
        onOpenReview={props.onOpenReview}
        {...(props.pollIntervalMs === undefined ? {} : { pollIntervalMs: props.pollIntervalMs })}
      />

      {/* §6: "Skipping LLM assist entirely is always allowed; heuristic
          classification proceeds." So generation is always reachable from here
          — it is never gated on an enrichment choice. */}
      <StudioGenerateStep
        state={wizardState}
        onOpenApp={props.onOpenApp}
        {...(props.lineDelayMs === undefined ? {} : { lineDelayMs: props.lineDelayMs })}
      />
    </div>
  );
}
