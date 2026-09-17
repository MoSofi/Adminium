// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step — "Enrich with AI". Three option cards ("Use my AI provider" / "Copy a
 * prompt to my own AI tool" / "Skip — use heuristics only"), a shared options
 * row (ten section toggles, instance-locale multi-select with en_US locked on,
 * sampling opt-in with an inline preview of exactly what leaves the machine),
 * then either the direct-path progress screen or the BYO round-trip panel. Both
 * AI paths land on the review screen; skipping advances to generation, never
 * penalized.
 *
 * When no provider is configured the step no longer just points at Settings: it
 * renders the SAME `ProviderConfigForm` that page does, inline, and the provider
 * card re-enables the moment a config saves (R3).
 *
 * RBAC: the whole connect wizard is Admin+ (StudioGuard), so this step inherits
 * the acceptance-#13 gate — Editor/Viewer never see it, and `/api/v1/llm/config`
 * is gated by the same permission the rest of this step's calls are.
 */
import { useQuery } from '@tanstack/react-query';
import { ClipboardCopy, CircleSlash, PlugZap, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Checkbox, Label, RadioCard, RadioGroup, Spinner, Switch } from '@adminium/ui';

import { ApiError } from '../../../app/api.js';
import { bootstrapQuery } from '../../../app/bootstrap.js';
import { llmAffordances, useCapabilities } from '../../../app/capabilities.js';
import { t } from '../../../i18n/t.js';
import { ProviderConfigForm, aiConfigQuery } from '../../ai/ProviderConfigForm.js';
import { aiApi, type LlmPromptChunk } from '../../ai/api.js';
import { EnrichByoPanel } from '../EnrichByoPanel.js';
import { EnrichDirectProgress } from '../EnrichDirectProgress.js';
import {
  ENRICH_LOCALES,
  ENRICH_SECTIONS,
  LOCKED_LOCALE,
  localeLabel,
  providerCardEnabled,
  runModeForIntent,
  sectionLabel,
  toCreateRunInput,
  toggleLocale,
  toggleSection,
  type EnrichIntent,
} from '../enrichState.js';
import type { WizardState } from '../wizardState.js';

/**
 * Why the "Use my AI provider" card is in the state it is — three different
 * facts, three different sentences, never one shrug.
 *
 * The air-gapped case is called out separately from the unconfigured case
 * because the advice differs completely: "configure a provider first" is a fix
 * for the second and a wild goose chase for the first, where no key will ever
 * help (LLM row, `Empty States.dc.html`'s never-hide-always-explain).
 */
function providerDescription(input: { providerAvailable: boolean; networkAllowed: boolean }): string {
  if (input.providerAvailable) {
    return t(
      'studio:enrich.provider.description',
      'Run enrichment now against your configured provider. You review every suggestion as a diff.',
    );
  }
  if (!input.networkAllowed) {
    return t(
      'studio:enrich.provider.networkDisabled',
      'This Adminium has no outbound internet access, so it cannot reach a provider API. Use the copy-paste round-trip instead — same prompt, same review.',
    );
  }
  return t(
    'studio:enrich.provider.unconfigured',
    'No AI provider is configured yet — set one up below, or copy a prompt to your own AI tool.',
  );
}

/** The disclosure panel's id — `aria-controls` on the button that opens it. */
const PROVIDER_CONFIG_PANEL_ID = 'enrich-provider-config';

/**
 * The Settings → AI provider form, rendered inside the wizard (46 R3).
 *
 * `useQuery`, NOT `useSuspenseQuery` as Settings uses: suspending here would
 * unmount the step while the config loads and take the operator's section
 * toggles, locales and sampling opt-in with it. The cost is this component
 * owning its own pending and error states, which it should anyway — it is one
 * panel on a live screen, not a whole route.
 *
 * Mounted only while the panel is open, so a wizard that never needs a provider
 * never asks for one.
 */
function InlineProviderConfig({ networkAllowed }: { networkAllowed: boolean }) {
  const configQuery = useQuery(aiConfigQuery());

  if (configQuery.data === undefined) {
    return configQuery.isError ? (
      <Alert
        tone="danger"
        role="alert"
        title={t(
          'studio:enrich.provider.configError',
          'Could not load the provider settings — set one up in Settings → AI, then come back to this step.',
        )}
      />
    ) : (
      <div className="flex items-center justify-center py-6">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <ProviderConfigForm config={configQuery.data} networkAllowed={networkAllowed} headingLevel={3} />
  );
}

export interface EnrichStepProps {
  state: WizardState;
  onPatch: (patch: Partial<WizardState>) => void;
  /** Both AI paths exit the wizard to the review screen (T14 route). */
  onOpenReview: (runId: string) => void;
  /** Test seam forwarded to the direct-path progress poller. */
  pollIntervalMs?: number | undefined;
}

interface CreatedRun {
  runId: string;
  path: 'provider' | 'byo';
  provider: string;
  model: string;
  chunks: LlmPromptChunk[];
  tokenEstimate: number;
}

export function EnrichStep({ state, onPatch, onOpenReview, pollIntervalMs }: EnrichStepProps) {
  const bootstrap = useQuery(bootstrapQuery());
  const providerConfigured = bootstrap.data?.llm.enabled ?? false;
  const sourceIsFile = state.mode === 'file';
  const connectionId = state.connectionId;

  // The LLM row: on desktop the BYO round-trip is the DEFAULT, and the direct
  // path is "available but labeled". This is the wizard half of the decision
  // `studio/ai/StudioAiPage.tsx` makes for Settings.
  //
  // Non-suspending, unlike that page: this step is one panel inside a live
  // wizard, and suspending would throw away the user's in-progress choices on
  // every remount. The card order can therefore settle a beat after first paint
  // — accepted here, and harmless now that `startRun` refuses a provider run
  // outright rather than trusting the order to have been right.
  const { flags } = useCapabilities();
  const { providerApi, byoFirst } = llmAffordances(flags);

  const [created, setCreated] = useState<CreatedRun | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /**
   * The inline provider form, opened by the operator and never by the step.
   *
   * It lives HERE, in the step, rather than inside the panel it controls: the
   * panel unmounts when it closes, and state that unmounts with the thing it
   * describes cannot remember that it was open. Nothing else in the wizard is
   * touched by opening it, which is the point — `onPatch` is never called, so
   * the section toggles, locales and sampling opt-in survive a provider save.
   */
  const [configOpen, setConfigOpen] = useState(false);

  const sections = state.enrichSections;
  const locales = state.enrichLocales;
  const sampling = state.enrichSampling;

  const providerAvailable = providerCardEnabled({
    providerConfigured,
    connectionId,
    sourceIsFile,
    networkAllowed: providerApi.enabled,
  });

  /**
   * The intent to RENDER, which is not always the one in wizard state.
   *
   * `state.enrichIntent` is persisted and outlives the conditions that made an
   * option pickable: the user can choose "Use my AI provider" before
   * `/system/info` reports the install air-gapped, or resume a wizard saved when
   * it wasn't. Reading `state.enrichIntent` directly then renders the whole
   * provider path — shared options, and a live "Start enrichment" button —
   * underneath a card that is greyed out and says the run cannot work. Treating
   * an unavailable `provider` as "nothing chosen yet" keeps the selection, the
   * disabled card, and the button telling one story. (`startRun` refuses it too:
   * this is the display half, that is the door.)
   */
  const intent =
    state.enrichIntent === 'provider' && !providerAvailable ? undefined : state.enrichIntent;

  const chooseIntent = (next: EnrichIntent) => {
    setCreated(null);
    setCreateError(null);
    onPatch({ enrichIntent: next });
  };

  const startRun = async (path: 'provider' | 'byo') => {
    if (connectionId === null) return;
    // THE GATE THAT ACTUALLY GATES. Disabling the option card is presentation;
    // `state.enrichIntent` is persisted wizard state that outlives it, so the
    // card being unpickable now does not mean 'provider' was never picked —
    // a wizard resumed with `enrichIntent: 'provider'`, or one where the user
    // chose it before `/system/info` answered, arrives here with the card grey
    // and the intent intact. Without this line an install that declares itself
    // air-gapped would still POST a provider run and make the outbound call
    // promises it never makes.
    if (path === 'provider' && !providerAvailable) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await aiApi.createRun(
        toCreateRunInput(connectionId, runModeForIntent(path), { sections, locales, sampling }),
      );
      setCreated({
        runId: result.run.id,
        path,
        provider: result.run.provider ?? t('studio:enrich.providerFallback', 'your AI provider'),
        model: result.run.model ?? '',
        chunks: result.prompt.chunks,
        tokenEstimate: result.prompt.tokenEstimate,
      });
    } catch (cause) {
      setCreateError(
        cause instanceof ApiError
          ? cause.message
          : t('studio:enrich.createFailed', 'Could not build the enrichment prompt — retry.'),
      );
    } finally {
      setCreating(false);
    }
  };

  const startOver = () => {
    setCreated(null);
    setCreateError(null);
  };

  const header = (
    <div>
      <h2 className="text-section text-fg">{t('studio:enrich.title', 'Enrich with AI')}</h2>
      <p className="mt-1 text-body-sm text-fg-muted">
        {t(
          'studio:enrich.subtitle',
          'Optionally refine the generated labels, groups, enums and dashboards with an LLM. The heuristic baseline works without it — this only adds suggestions you review before anything applies.',
        )}
      </p>
    </div>
  );

  // --- schema-file / no live connection: enrichment needs a snapshot ---------
  if (sourceIsFile || connectionId === null) {
    return (
      <section aria-label={t('studio:enrich.title', 'Enrich with AI')} className="flex flex-col gap-4">
        {header}
        <Alert
          tone="info"
          title={t('studio:enrich.fileTitle', 'AI enrichment needs a live database')}
          body={t(
            'studio:enrich.fileBody',
            'Schema-file sources have no snapshot to enrich yet. Connect a live database to use AI enrichment, or continue — the heuristic baseline still generates a complete app.',
          )}
        />
      </section>
    );
  }

  // --- direct-path progress --------------------------------------------------
  if (created !== null && created.path === 'provider') {
    return (
      <section aria-label={t('studio:enrich.title', 'Enrich with AI')} className="flex flex-col gap-4">
        <EnrichDirectProgress
          runId={created.runId}
          provider={created.provider}
          model={created.model}
          onContinueReview={onOpenReview}
          onCancel={startOver}
          pollIntervalMs={pollIntervalMs}
        />
      </section>
    );
  }

  // --- BYO round-trip --------------------------------------------------------
  if (created !== null && created.path === 'byo') {
    return (
      <section aria-label={t('studio:enrich.title', 'Enrich with AI')} className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          {header}
          <Button type="button" variant="ghost" size="sm" onClick={startOver}>
            {t('studio:enrich.startOver', 'Start over')}
          </Button>
        </div>
        <EnrichByoPanel
          runId={created.runId}
          chunks={created.chunks}
          tokenEstimate={created.tokenEstimate}
          onContinueReview={onOpenReview}
        />
      </section>
    );
  }

  // --- choose intent + shared options ----------------------------------------
  return (
    <section aria-label={t('studio:enrich.title', 'Enrich with AI')} className="flex flex-col gap-4">
      {header}

      <RadioGroup
        aria-label={t('studio:enrich.intentLabel', 'How would you like to enrich?')}
        value={intent ?? ''}
        onValueChange={(value) => chooseIntent(value as EnrichIntent)}
        className="grid gap-2.5"
      >
        {/* The LLM row: "BYO round-trip is the DEFAULT and is highlighted
            first in desktop". In a wizard, first IS the default — it is the card
            the eye lands on and the one a hurried admin picks. `skip` stays last
            in both orders: it is the escape hatch, never the lead. */}
        {(byoFirst ? ['byo', 'provider', 'skip'] : ['provider', 'byo', 'skip']).map((card) =>
          card === 'provider' ? (
            <RadioCard
              key="provider"
              value="provider"
              disabled={!providerAvailable}
              title={t('studio:enrich.provider.title', 'Use my AI provider')}
              description={providerDescription({ providerAvailable, networkAllowed: providerApi.enabled })}
              icon={<Sparkles />}
            />
          ) : card === 'byo' ? (
            <RadioCard
              key="byo"
              value="byo"
              title={
                byoFirst
                  ? t('studio:enrich.byo.cardTitleRecommended', 'Copy a prompt to my own AI tool — recommended')
                  : t('studio:enrich.byo.cardTitle', 'Copy a prompt to my own AI tool')
              }
              description={t(
                'studio:enrich.byo.cardDescription',
                'Copy a self-contained prompt into Claude Code, ChatGPT, anything — then paste the JSON back. No key needed, nothing leaves this machine automatically.',
              )}
              icon={<ClipboardCopy />}
            />
          ) : (
            <RadioCard
              key="skip"
              value="skip"
              title={t('studio:enrich.skip.title', 'Skip — use heuristics only')}
              description={t(
                'studio:enrich.skip.description',
                'Generate from the heuristic baseline. You can enrich later from Settings → AI — skipping is never penalized.',
              )}
              icon={<CircleSlash />}
            />
          ),
        )}
      </RadioGroup>

      {/* Only offer the fix that fixes it. When the provider card is off because
          this install has no outbound network, both a setup form and a link to
          Settings lead nowhere — no key will ever make that card work — so the
          whole affordance is gated on `providerApi.enabled`. The card above
          already explains, and BYO is right there.

          Once the form is open the row stays, whatever the card's state: it
          carries the only control that closes the panel again. */}
      {providerApi.enabled && (!providerAvailable || configOpen) ? (
        <div className="flex flex-col gap-2">
          {providerAvailable ? null : (
            <p className="text-caption text-fg-muted">
              {t('studio:enrich.provider.settingsHint', 'Want to run it directly?')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* `aria-controls` only while the panel is on the page: a reference
                to an id that does not exist is broken, not a hint. `aria-expanded`
                is always there — it is what makes this a disclosure. */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconLeft={<PlugZap />}
              aria-expanded={configOpen}
              {...(configOpen ? { 'aria-controls': PROVIDER_CONFIG_PANEL_ID } : {})}
              onClick={() => setConfigOpen((open) => !open)}
            >
              {configOpen
                ? t('studio:enrich.provider.setUpHide', 'Hide provider setup')
                : t('studio:enrich.provider.setUpHere', 'Set up a provider here')}
            </Button>
            {/* Settings → AI is still one click away: it is the same form plus
                the BYO explainer and the run history this step has no room for. */}
            <a className="text-caption font-semibold text-accent underline" href="/studio/settings/ai">
              {t('studio:enrich.provider.settingsLink', 'Configure a provider in Settings → AI')}
            </a>
          </div>
        </div>
      ) : null}

      {providerApi.enabled && configOpen ? (
        <div
          id={PROVIDER_CONFIG_PANEL_ID}
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-3.5"
        >
          {/* The card above went from grey to pickable while the operator was
              looking at this panel — say so, and say what to do with it. */}
          {providerAvailable ? (
            <Alert
              tone="pos"
              title={t('studio:enrich.provider.readyTitle', 'AI provider configured')}
              body={t(
                'studio:enrich.provider.readyBody',
                'Pick “Use my AI provider” above to run enrichment on this connection now.',
              )}
            />
          ) : null}
          <InlineProviderConfig networkAllowed={providerApi.enabled} />
        </div>
      ) : null}

      {intent === 'provider' || intent === 'byo' ? (
        <SharedOptions
          sections={sections}
          locales={locales}
          sampling={sampling}
          onToggleSection={(section) => onPatch({ enrichSections: toggleSection(sections, section) })}
          onToggleLocale={(locale) => onPatch({ enrichLocales: toggleLocale(locales, locale) })}
          onSampling={(value) => onPatch({ enrichSampling: value })}
        />
      ) : null}

      {intent === 'skip' ? (
        <Alert
          tone="info"
          title={t('studio:enrich.skip.confirmTitle', 'Continuing with heuristics')}
          body={t(
            'studio:enrich.skip.confirmBody',
            'The generated app will use the heuristic labels, groups and dashboards. Continue to generate — you can run AI enrichment any time from Settings → AI.',
          )}
        />
      ) : null}

      {createError !== null ? (
        <Alert tone="danger" role="alert" title={t('studio:enrich.createFailedTitle', 'Could not start')} body={createError} />
      ) : null}

      {intent === 'provider' || intent === 'byo' ? (
        <div>
          <Button
            type="button"
            loading={creating}
            disabled={sections.length === 0}
            onClick={() => void startRun(intent)}
          >
            {intent === 'provider'
              ? t('studio:enrich.startProvider', 'Start enrichment')
              : t('studio:enrich.generatePrompt', 'Generate prompt')}
          </Button>
          {sections.length === 0 ? (
            <p className="mt-2 text-caption text-danger">
              {t('studio:enrich.noSections', 'Select at least one decision group to enrich.')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// --- shared options row ---------------------------------------

interface SharedOptionsProps {
  sections: readonly (typeof ENRICH_SECTIONS)[number][];
  locales: readonly (typeof ENRICH_LOCALES)[number][];
  sampling: boolean;
  onToggleSection: (section: (typeof ENRICH_SECTIONS)[number]) => void;
  onToggleLocale: (locale: (typeof ENRICH_LOCALES)[number]) => void;
  onSampling: (value: boolean) => void;
}

function SharedOptions({ sections, locales, sampling, onToggleSection, onToggleLocale, onSampling }: SharedOptionsProps) {
  const sectionSet = new Set(sections);
  const localeSet = new Set(locales);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-3.5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-body-sm font-semibold text-fg">
          {t('studio:enrich.sectionsLegend', 'What should the AI decide?')}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ENRICH_SECTIONS.map((section) => (
            <div key={section} className="flex items-center gap-2">
              <Checkbox
                id={`enrich-section-${section}`}
                checked={sectionSet.has(section)}
                onCheckedChange={() => onToggleSection(section)}
              />
              <Label htmlFor={`enrich-section-${section}`} className="text-body-sm text-fg">
                {sectionLabel(section)}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-body-sm font-semibold text-fg">
          {t('studio:enrich.localesLegend', 'Translate labels into')}
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ENRICH_LOCALES.map((locale) => {
            const locked = locale === LOCKED_LOCALE;
            return (
              <div key={locale} className="flex items-center gap-2">
                <Checkbox
                  id={`enrich-locale-${locale}`}
                  checked={localeSet.has(locale)}
                  disabled={locked}
                  onCheckedChange={() => onToggleLocale(locale)}
                />
                <Label htmlFor={`enrich-locale-${locale}`} className="text-body-sm text-fg">
                  {localeLabel(locale)}
                  {locked ? (
                    <span className="ms-1 text-caption text-fg-subtle">
                      {t('studio:enrich.localeLocked', '(required)')}
                    </span>
                  ) : null}
                </Label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <Switch
            id="enrich-sampling"
            checked={sampling}
            onCheckedChange={(value) => onSampling(value === true)}
          />
          <Label htmlFor="enrich-sampling" className="flex flex-col gap-0.5">
            <span className="text-body-sm font-semibold text-fg">
              {t('studio:enrich.samplingTitle', 'Include sample values')}
            </span>
            <span className="text-caption text-fg-muted">
              {t('studio:enrich.samplingHint', 'Includes up to 20 real values per non-PII column in the prompt.')}
            </span>
          </Label>
        </div>
        {sampling ? (
          <Alert
            tone="warn"
            title={t('studio:enrich.samplingPreviewTitle', 'What leaves this machine')}
            body={t(
              'studio:enrich.samplingPreviewBody',
              'Up to 20 most-common values per non-PII column, plus min/max for numeric and date columns. PII-flagged columns are never sampled. Everything else stays aggregate-only. Review the exact prompt before copying (BYO) — nothing is sent without your action.',
            )}
          />
        ) : null}
      </div>
    </div>
  );
}
