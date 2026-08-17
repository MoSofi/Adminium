/**
 * `/studio/settings/ai` — Settings → AI (06-llm-assist.md §10.1). The one place
 * an Admin configures the direct-API provider used to enrich a schema, reads the
 * BYO (copy-paste) round-trip guarantee, and reviews past enrichment runs.
 *
 * Seed patterns (§10): `API Keys.dc.html` (write-only key entry → masked
 * `sk-…last4` + Replace) and `Integrations.dc.html` (provider connect
 * cards). RBAC is enforced one level up by `StudioGuard` (Admin + Super-Admin) and
 * again by every `/api/v1/llm/*` route — Editors/Viewers never reach this surface
 * and see no AI navigation (acceptance #13).
 *
 * The API key is WRITE-ONLY end to end: `getConfig` only ever returns `apiKeySet`
 * + `apiKeyLast4`, `putConfig` sends a key but no reply echoes it (§3.2), so the
 * raw key never lives in this component's state after a save.
 */
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { getFormatters } from '@adminium/i18n';
import { CheckCircle2, KeyRound, PlugZap, ScrollText, Sparkles } from 'lucide-react';
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
  Select,
  Spinner,
  StatusPill,
  Tag,
  type Tone,
} from '@adminium/ui';

import { llmAffordances, systemInfoQuery } from '../../app/capabilities.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { connectionsQuery } from '../hub/ConnectionsHub.js';
import { PageSurface } from '../../shell/PageSurface.js';
import type { ConnectionDto } from '../api.js';
import {
  aiApi,
  type LlmConfig,
  type LlmConfigTestResult,
  type LlmModelInfo,
  type LlmRunDto,
  type LlmRunStatus,
} from './api.js';
import {
  CONFIGURABLE_PROVIDERS,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  isConfigurableProvider,
  providerCatalogEntry,
  type ConfigurableProvider,
} from './providerCatalog.js';

// ── Queries ──────────────────────────────────────────────────────────────────

const CONFIG_QUERY_KEY = ['llm', 'config'] as const;

function aiConfigQuery() {
  return queryOptions({ queryKey: CONFIG_QUERY_KEY, queryFn: () => aiApi.getConfig() });
}

/** Locale-bound Intl formatters, test-safe (ConnectionsHub precedent). */
function fmt() {
  return getFormatters(getI18nInstance()?.language ?? 'en-US');
}

// ── Provider display copy ──────────────────────────────────────────────────────

function providerLabel(id: ConfigurableProvider): string {
  switch (id) {
    case 'anthropic':
      return t('studio.settingsAi.provider.anthropic.label', 'Anthropic');
    case 'openai':
      return t('studio.settingsAi.provider.openai.label', 'OpenAI');
    case 'openai-compatible':
      return t('studio.settingsAi.provider.openaiCompatible.label', 'OpenAI-compatible');
    case 'ollama':
      return t('studio.settingsAi.provider.ollama.label', 'Ollama (local)');
  }
}

function providerDescription(id: ConfigurableProvider): string {
  switch (id) {
    case 'anthropic':
      return t('studio.settingsAi.provider.anthropic.desc', 'Claude models via the Anthropic API.');
    case 'openai':
      return t('studio.settingsAi.provider.openai.desc', 'GPT models via the OpenAI API.');
    case 'openai-compatible':
      return t(
        'studio.settingsAi.provider.openaiCompatible.desc',
        'Any endpoint that speaks the OpenAI wire format — Groq, Together, vLLM, LM Studio.',
      );
    case 'ollama':
      return t('studio.settingsAi.provider.ollama.desc', 'Models running locally through Ollama — no key, no cloud.');
  }
}

// ── Run status → pill tone/label ───────────────────────────────────────────────

const RUN_STATUS_TONE: Record<LlmRunStatus, Tone> = {
  draft: 'neutral',
  running: 'info',
  awaiting_response: 'warn',
  validated: 'accent',
  applied: 'pos',
  partially_applied: 'pos',
  failed: 'danger',
  discarded: 'neutral',
};

function runStatusLabel(status: LlmRunStatus): string {
  switch (status) {
    case 'draft':
      return t('studio.settingsAi.runStatus.draft', 'Draft');
    case 'running':
      return t('studio.settingsAi.runStatus.running', 'Running');
    case 'awaiting_response':
      return t('studio.settingsAi.runStatus.awaitingResponse', 'Awaiting response');
    case 'validated':
      return t('studio.settingsAi.runStatus.validated', 'Validated');
    case 'applied':
      return t('studio.settingsAi.runStatus.applied', 'Applied');
    case 'partially_applied':
      return t('studio.settingsAi.runStatus.partiallyApplied', 'Partially applied');
    case 'failed':
      return t('studio.settingsAi.runStatus.failed', 'Failed');
    case 'discarded':
      return t('studio.settingsAi.runStatus.discarded', 'Discarded');
  }
}

// ── Provider config panel ──────────────────────────────────────────────────────

interface DraftState {
  provider: ConfigurableProvider;
  model: string;
  baseUrl: string;
  /** Non-empty ⇒ the user typed a new key to store; empty ⇒ keep the stored one. */
  keyDraft: string;
  /** Whether the key input is shown even though a key is already stored. */
  replacingKey: boolean;
}

function initialDraft(provider: ConfigurableProvider, config: LlmConfig): DraftState {
  const entry = providerCatalogEntry(provider);
  const savedForProvider = config.provider === provider;
  return {
    provider,
    model: savedForProvider ? (config.model ?? '') : '',
    baseUrl: savedForProvider ? (config.baseUrl ?? entry.baseUrlDefault ?? '') : (entry.baseUrlDefault ?? ''),
    keyDraft: '',
    replacingKey: false,
  };
}

function ProviderConfigForm({ config, networkAllowed }: { config: LlmConfig; networkAllowed: boolean }): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();

  const initialProvider: ConfigurableProvider | null = isConfigurableProvider(config.provider)
    ? config.provider
    : null;
  const [draft, setDraft] = useState<DraftState | null>(() =>
    initialProvider === null ? null : initialDraft(initialProvider, config),
  );

  const entry = draft === null ? null : providerCatalogEntry(draft.provider);
  const savedForSelected = draft !== null && config.provider === draft.provider;
  const hasStoredKey = savedForSelected && config.apiKeySet;

  // Live model list only reflects the *saved* provider (the API has no provider
  // param), so gate the fetch on the selection matching what is persisted (§10.1).
  const modelsQuery = useQuery({
    queryKey: ['llm', 'models', config.provider] as const,
    queryFn: () => aiApi.listModels(),
    enabled: savedForSelected && entry !== null && !entry.freeTextModel,
    staleTime: 5 * 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: (next: DraftState) => {
      const catalog = providerCatalogEntry(next.provider);
      return aiApi.putConfig({
        provider: next.provider,
        model: next.model.trim() === '' ? null : next.model.trim(),
        baseUrl: catalog.baseUrl === 'none' ? null : next.baseUrl.trim() === '' ? null : next.baseUrl.trim(),
        // Only send the key when the user typed one; never for keyless providers.
        ...(catalog.key !== 'none' && next.keyDraft.length > 0 ? { apiKey: next.keyDraft } : {}),
      });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(CONFIG_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: ['llm', 'models'] });
      // Drop the raw key from local state the instant it is stored (§3.2).
      setDraft((prev) => (prev === null ? prev : { ...prev, keyDraft: '', replacingKey: false }));
      toasts.push({ variant: 'success', title: t('studio.settingsAi.saved', 'AI provider saved') });
    },
    onError: () => {
      toasts.push({
        variant: 'error',
        title: t('studio.settingsAi.saveFailed', 'Could not save the AI provider. Try again.'),
      });
    },
  });

  const testMutation = useMutation({ mutationFn: () => aiApi.testConfig() });

  function selectProvider(provider: ConfigurableProvider): void {
    setDraft(initialDraft(provider, config));
    testMutation.reset();
  }

  function patch(partial: Partial<DraftState>): void {
    setDraft((prev) => (prev === null ? prev : { ...prev, ...partial }));
    testMutation.reset();
  }

  // Derived validity + dirtiness.
  const derived = useMemo(() => {
    if (draft === null || entry === null) return { valid: false, dirty: false };
    const modelOk = draft.model.trim().length > 0;
    const baseUrlOk = entry.baseUrl !== 'required' || draft.baseUrl.trim().length > 0;
    const keyOk =
      entry.key !== 'required' || draft.keyDraft.length > 0 || (hasStoredKey && !draft.replacingKey);
    const valid = modelOk && baseUrlOk && keyOk;

    const baseUrlDefault = entry.baseUrlDefault ?? '';
    const savedBaseUrl = savedForSelected ? (config.baseUrl ?? baseUrlDefault) : baseUrlDefault;
    const dirty =
      config.provider !== draft.provider ||
      draft.model.trim() !== (savedForSelected ? (config.model ?? '') : '') ||
      draft.baseUrl.trim() !== savedBaseUrl.trim() ||
      draft.keyDraft.length > 0;
    return { valid, dirty };
  }, [draft, entry, hasStoredKey, savedForSelected, config]);

  const canTest = savedForSelected && !derived.dirty && (config.model ?? '') !== '';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-section text-fg">{t('studio.settingsAi.provider.heading', 'AI provider')}</h2>
          {/* 11-electron.md §8.2, LLM row: provider-API mode is "Available,
              LABELED". §6 step 4 gives the label its words. It rides beside the
              heading in every runtime, not just desktop — the direct path needs
              the internet on a self-host too, and a self-host admin choosing
              between the two paths deserves the same fact. */}
          <Tag>{t('studio.settingsAi.provider.requiresNetwork', 'Requires internet & an API key')}</Tag>
        </div>
        <p className="mt-0.5 text-body-sm text-fg-muted">
          {t(
            'studio.settingsAi.provider.subtitle',
            'Choose how Adminium reaches a model to enrich your schema. Keys are stored encrypted and never shown again.',
          )}
        </p>
      </div>

      {/* Never hide, always explain (`Empty States.dc.html`): an
          air-gapped install keeps the whole form visible and readable, and says
          why saving a key here would buy nothing. The copy-paste round-trip
          below is the path that works, and still does. */}
      {networkAllowed ? null : (
        <Alert
          tone="info"
          title={t('studio.settingsAi.provider.networkDisabledTitle', 'Direct AI providers are turned off on this install')}
          body={t(
            'studio.settingsAi.provider.networkDisabledBody',
            'This Adminium is configured with no outbound internet access, so it cannot reach a provider API. Use the copy-paste round-trip below — it needs no key and no network.',
          )}
        />
      )}

      <RadioGroup
        aria-label={t('studio.settingsAi.provider.heading', 'AI provider')}
        value={draft?.provider ?? ''}
        onValueChange={(next) => selectProvider(next as ConfigurableProvider)}
        className="grid gap-2.5 sm:grid-cols-2"
      >
        {CONFIGURABLE_PROVIDERS.map((id) => {
          const providerEntry = providerCatalogEntry(id);
          const Icon = providerEntry.icon;
          const isActive = config.provider === id;
          return (
            <RadioCard
              key={id}
              value={id}
              title={providerLabel(id)}
              description={providerDescription(id)}
              icon={<Icon />}
              {...(isActive
                ? {
                    trailing: (
                      <Badge tone="pos">{t('studio.settingsAi.provider.active', 'Active')}</Badge>
                    ),
                  }
                : {})}
            />
          );
        })}
      </RadioGroup>

      {draft !== null && entry !== null ? (
        <Card>
          <CardHeader className="flex items-center gap-3">
            <IconTile tone="accent" size="md" icon={<PlugZap />} />
            <div className="min-w-0 flex-1">
              <h3 className="text-section text-fg">
                {t('studio.settingsAi.configure.heading', 'Configure {provider}', {
                  provider: providerLabel(draft.provider),
                })}
              </h3>
              <p className="text-caption text-fg-subtle">
                {providerDescription(draft.provider)}
              </p>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {entry.baseUrl !== 'none' ? (
              <FormField
                label={t('studio.settingsAi.field.baseUrl', 'Base URL')}
                required={entry.baseUrl === 'required'}
                helper={
                  entry.baseUrl === 'optional'
                    ? t('studio.settingsAi.field.baseUrlOptional', 'Leave as-is unless Ollama runs on another host.')
                    : t('studio.settingsAi.field.baseUrlHelper', 'The endpoint root that serves /chat/completions.')
                }
              >
                <Input
                  mono
                  value={draft.baseUrl}
                  onChange={(event) => patch({ baseUrl: event.currentTarget.value })}
                  placeholder={entry.baseUrlPlaceholder ?? ''}
                  autoComplete="off"
                  spellCheck={false}
                />
              </FormField>
            ) : null}

            <ModelField
              draft={draft}
              savedForSelected={savedForSelected}
              liveModels={savedForSelected ? modelsQuery.data?.models : undefined}
              liveSource={savedForSelected ? modelsQuery.data?.source : undefined}
              loadingModels={modelsQuery.isFetching}
              onChange={(model) => patch({ model })}
            />

            {entry.key !== 'none' ? (
              <KeyField
                config={config}
                draft={draft}
                hasStoredKey={hasStoredKey}
                optional={entry.key === 'optional'}
                onEnterReplace={() => patch({ replacingKey: true })}
                onChange={(keyDraft) => patch({ keyDraft })}
              />
            ) : (
              <Alert
                tone="info"
                title={t('studio.settingsAi.field.noKeyTitle', 'No API key needed')}
                body={t('studio.settingsAi.field.noKeyBody', 'Ollama runs locally, so nothing leaves this machine.')}
              />
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!derived.valid || !derived.dirty || saveMutation.isPending}
                loading={saveMutation.isPending}
                onClick={() => draft !== null && saveMutation.mutate(draft)}
              >
                {t('studio.settingsAi.save', 'Save provider')}
              </Button>
              <Button
                variant="secondary"
                disabled={!canTest || testMutation.isPending}
                loading={testMutation.isPending}
                onClick={() => testMutation.mutate()}
              >
                {t('studio.settingsAi.test', 'Test connection')}
              </Button>
              {!canTest && draft.provider === config.provider ? (
                <span className="text-caption text-fg-subtle">
                  {t('studio.settingsAi.testHintDirty', 'Save your changes before testing.')}
                </span>
              ) : null}
            </div>

            <TestResult mutation={testMutation} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

// ── Model field ────────────────────────────────────────────────────────────────

function ModelField({
  draft,
  savedForSelected,
  liveModels,
  liveSource,
  loadingModels,
  onChange,
}: {
  draft: DraftState;
  savedForSelected: boolean;
  liveModels: readonly LlmModelInfo[] | undefined;
  liveSource: 'live' | 'static' | undefined;
  loadingModels: boolean;
  onChange: (model: string) => void;
}): ReactNode {
  const entry = providerCatalogEntry(draft.provider);
  const options = savedForSelected && liveModels && liveModels.length > 0 ? liveModels : entry.staticModels;
  const useSelect = !entry.freeTextModel && options.length > 0;

  // Keep the persisted model selectable even if the live list has dropped it.
  const optionIds = new Set(options.map((m) => m.id));
  const extra: LlmModelInfo[] =
    draft.model.trim() !== '' && !optionIds.has(draft.model.trim())
      ? [{ id: draft.model.trim(), label: draft.model.trim() }]
      : [];

  return (
    <FormField
      label={t('studio.settingsAi.field.model', 'Model')}
      required
      helper={
        entry.freeTextModel
          ? t('studio.settingsAi.field.modelFreeText', 'Enter the exact model id your endpoint serves.')
          : useSelect && savedForSelected && liveSource === 'live'
            ? t('studio.settingsAi.field.modelLive', 'Loaded live from the provider.')
            : t('studio.settingsAi.field.modelStatic', 'A known-good list; type a custom id after saving to refresh it.')
      }
      {...(loadingModels ? { tag: <Tag>{t('studio.settingsAi.field.modelLoading', 'Loading…')}</Tag> } : {})}
    >
      {useSelect ? (
        <Select
          mono
          value={draft.model}
          onChange={(event) => onChange(event.currentTarget.value)}
          aria-label={t('studio.settingsAi.field.model', 'Model')}
        >
          <option value="">{t('studio.settingsAi.field.modelPlaceholder', 'Select a model…')}</option>
          {[...extra, ...options].map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          mono
          value={draft.model}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={entry.freeTextModel ? 'llama-3.1-70b' : ''}
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </FormField>
  );
}

// ── Key field (write-only) ─────────────────────────────────────────────────────

function KeyField({
  config,
  draft,
  hasStoredKey,
  optional,
  onEnterReplace,
  onChange,
}: {
  config: LlmConfig;
  draft: DraftState;
  hasStoredKey: boolean;
  optional: boolean;
  onEnterReplace: () => void;
  onChange: (keyDraft: string) => void;
}): ReactNode {
  // A key is already stored for this provider and the user has not chosen to
  // replace it: show the masked tail, never a value we could leak (§3.2).
  if (hasStoredKey && !draft.replacingKey) {
    return (
      <FormField
        label={t('studio.settingsAi.field.key', 'API key')}
        helper={t('studio.settingsAi.field.keyStored', 'Stored encrypted. Replace it to use a different key.')}
      >
        <div className="flex items-center gap-2">
          <MonoText
            data-testid="stored-key-mask"
            className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-body-sm text-fg"
          >
            {t('studio.settingsAi.field.keyMask', 'sk-…{last4}', { last4: config.apiKeyLast4 ?? '' })}
          </MonoText>
          <Button variant="secondary" size="sm" onClick={onEnterReplace}>
            {t('studio.settingsAi.field.keyReplace', 'Replace key')}
          </Button>
        </div>
      </FormField>
    );
  }

  return (
    <FormField
      label={t('studio.settingsAi.field.key', 'API key')}
      required={!optional}
      helper={
        optional
          ? t('studio.settingsAi.field.keyOptional', 'Optional — some endpoints need no key.')
          : t('studio.settingsAi.field.keyWriteOnly', 'Write-only: once saved it is never shown again.')
      }
    >
      <Input
        type="password"
        value={draft.keyDraft}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={providerCatalogEntry(draft.provider).keyPlaceholder ?? ''}
        autoComplete="off"
        spellCheck={false}
      />
    </FormField>
  );
}

// ── Test-connection result ──────────────────────────────────────────────────────

function TestResult({
  mutation,
}: {
  mutation: UseMutationResult<LlmConfigTestResult, unknown, void>;
}): ReactNode {
  if (mutation.isPending) {
    return (
      <div className="flex items-center gap-2 text-body-sm text-fg-muted" role="status">
        <Spinner size="sm" />
        {t('studio.settingsAi.testing', 'Pinging the provider…')}
      </div>
    );
  }
  if (mutation.isError) {
    return (
      <Alert
        tone="danger"
        role="alert"
        title={t('studio.settingsAi.testError', 'Test failed')}
        body={t('studio.settingsAi.testErrorBody', 'Could not reach the provider. Check the key and base URL.')}
      />
    );
  }
  const result = mutation.data;
  if (result === undefined) return null;

  if (result.ok) {
    const latency = result.latencyMs === null ? '—' : fmt().number(result.latencyMs);
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-pos/30 bg-pos-soft px-3 py-2 text-body-sm text-fg"
      >
        <CheckCircle2 className="size-4 shrink-0 text-pos" aria-hidden="true" />
        <span>
          {t('studio.settingsAi.testOk', 'Connected to {model} in {latency} ms', {
            model: result.model ?? t('studio.settingsAi.testUnknownModel', 'the provider'),
            latency,
          })}
        </span>
      </div>
    );
  }

  return (
    <Alert
      tone="danger"
      role="alert"
      title={t('studio.settingsAi.testError', 'Test failed')}
      body={result.error?.message ?? t('studio.settingsAi.testErrorBody', 'Could not reach the provider. Check the key and base URL.')}
    />
  );
}

// ── BYO explainer panel ─────────────────────────────────────────────────────────

/**
 * `highlighted` is §8.2's "highlighted first in desktop" — the visual half of
 * the same decision the page's ordering makes. It changes the accent, the tile
 * tone and the heading, because leading with a card that opens "No key?" would
 * still frame the round-trip as the consolation prize on the one runtime where
 * it is the recommendation (§6 step 4, §7's LLM row).
 */
function ByoPanel({ highlighted = false }: { highlighted?: boolean }): ReactNode {
  return (
    <Card className={highlighted ? 'border-accent/40' : undefined}>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone={highlighted ? 'accent' : 'neutral'} size="md" icon={<KeyRound />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">
            {highlighted
              ? t('studio.settingsAi.byo.headingRecommended', 'Use your own AI tool — no key needed')
              : t('studio.settingsAi.byo.heading', 'No key? Use your own AI tool')}
          </h3>
          <p className="text-caption text-fg-subtle">
            {t('studio.settingsAi.byo.subtitle', 'The copy-paste round-trip — nothing leaves this machine.')}
          </p>
        </div>
        {highlighted ? (
          <Badge tone="accent">{t('studio.settingsAi.byo.recommended', 'Recommended')}</Badge>
        ) : null}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-body-sm text-fg-muted">
          {t(
            'studio.settingsAi.byo.body',
            'Studio can generate a self-contained prompt from your schema. Run it in Claude Code, ChatGPT, or any tool you like, then paste the JSON it returns back into the connect wizard. Same validation, same review, same result as the direct path.',
          )}
        </p>
        <div>
          <p className="text-caption font-bold text-fg">
            {t('studio.settingsAi.byo.guaranteeTitle', 'Telemetry-free guarantee')}
          </p>
          <ul className="mt-1 flex list-none flex-col gap-1 p-0 text-caption text-fg-muted">
            <li>{t('studio.settingsAi.byo.guarantee1', 'The prompt carries only your schema and aggregate stats — never row data by default.')}</li>
            <li>{t('studio.settingsAi.byo.guarantee2', 'No credentials, instance URL, or identifiers are embedded.')}</li>
            <li>{t('studio.settingsAi.byo.guarantee3', 'BYO runs make zero network calls.')}</li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tag>
            {t('studio.settingsAi.byo.promptVersion', 'Prompt {version}', { version: PROMPT_VERSION })}
          </Tag>
          <Tag>
            {t('studio.settingsAi.byo.schemaVersion', 'Schema {version}', { version: SCHEMA_VERSION })}
          </Tag>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Run history ─────────────────────────────────────────────────────────────────

function RunSourceCell({ run }: { run: LlmRunDto }): ReactNode {
  if (run.mode === 'byo') {
    return <Badge tone="neutral">{t('studio.settingsAi.history.byo', 'BYO')}</Badge>;
  }
  const provider = run.provider ?? t('studio.settingsAi.history.directPath', 'Direct');
  return (
    <span className="min-w-0 truncate text-body-sm text-fg">
      <span className="font-semibold">{provider}</span>
      {run.model === null ? null : (
        <>
          {' '}
          <MonoText className="text-caption text-fg-muted">{run.model}</MonoText>
        </>
      )}
    </span>
  );
}

function RunHistoryTable({
  runs,
  onOpenReview,
}: {
  runs: readonly LlmRunDto[];
  onOpenReview: (runId: string) => void;
}): ReactNode {
  const numbers = fmt();
  return (
    <div className="flex flex-col">
      {/* Visual column headers; each row button carries a self-describing label. */}
      <div
        aria-hidden="true"
        className="grid grid-cols-[1.4fr_1.6fr_1fr_0.8fr] gap-3 border-b border-border px-3 pb-2 text-micro uppercase text-fg-subtle"
      >
        <span>{t('studio.settingsAi.history.colDate', 'Date')}</span>
        <span>{t('studio.settingsAi.history.colSource', 'Source')}</span>
        <span>{t('studio.settingsAi.history.colStatus', 'Status')}</span>
        <span className="text-end">{t('studio.settingsAi.history.colChunks', 'Chunks')}</span>
      </div>
      <div className="divide-y divide-border/70">
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => onOpenReview(run.id)}
            aria-label={t('studio.settingsAi.history.openReview', 'Open review for the run from {date}', {
              date: numbers.dateTime(run.createdAt),
            })}
            className="grid w-full grid-cols-[1.4fr_1.6fr_1fr_0.8fr] items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <span className="min-w-0 truncate text-body-sm text-fg">{numbers.relative(run.createdAt)}</span>
            <span className="min-w-0">
              <RunSourceCell run={run} />
            </span>
            <span>
              <StatusPill status={run.status} tone={RUN_STATUS_TONE[run.status]}>
                {runStatusLabel(run.status)}
              </StatusPill>
            </span>
            <span className="text-end tabular-nums text-body-sm text-fg-muted">
              {numbers.number(run.chunksReceived)}
              <span className="text-fg-subtle">/{numbers.number(run.chunksTotal)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RunHistoryForConnection({
  connectionId,
  onOpenReview,
}: {
  connectionId: string;
  onOpenReview: (runId: string) => void;
}): ReactNode {
  const runsQuery = useQuery({
    queryKey: ['llm', 'runs', connectionId] as const,
    queryFn: () => aiApi.listRuns(connectionId),
  });

  if (runsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }
  if (runsQuery.isError) {
    return (
      <Alert
        tone="danger"
        role="alert"
        title={t('studio.settingsAi.history.errorTitle', 'Could not load runs')}
        body={t('studio.settingsAi.history.errorBody', 'Refresh the page to try again.')}
      />
    );
  }
  const runs = runsQuery.data ?? [];
  if (runs.length === 0) {
    return (
      <p className="py-6 text-center text-body-sm text-fg-muted">
        {t('studio.settingsAi.history.empty', 'No enrichment runs yet. Enrich a schema from the connect wizard to see history here.')}
      </p>
    );
  }
  return <RunHistoryTable runs={runs} onOpenReview={onOpenReview} />;
}

function RunHistorySection({
  connections,
  onOpenReview,
}: {
  connections: readonly ConnectionDto[];
  onOpenReview: (runId: string) => void;
}): ReactNode {
  const [connectionId, setConnectionId] = useState<string | null>(() => connections[0]?.id ?? null);
  const selected = connections.find((c) => c.id === connectionId) ?? connections[0] ?? null;

  return (
    <Card padded={false}>
      <CardHeader className="flex flex-wrap items-center gap-3">
        <IconTile tone="accent" size="md" icon={<ScrollText />} />
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-fg">{t('studio.settingsAi.history.heading', 'Run history')}</h3>
          <p className="text-caption text-fg-subtle">
            {t('studio.settingsAi.history.subtitle', 'Past enrichment runs. Open one to review its suggestions.')}
          </p>
        </div>
        {connections.length > 1 && selected !== null ? (
          <label className="flex items-center gap-2 text-caption text-fg-muted">
            <span>{t('studio.settingsAi.history.connection', 'Connection')}</span>
            <Select
              value={selected.id}
              onChange={(event) => setConnectionId(event.currentTarget.value)}
              aria-label={t('studio.settingsAi.history.connection', 'Connection')}
              wrapperClassName="w-[200px]"
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </CardHeader>
      <CardBody>
        {selected === null ? (
          <p className="py-6 text-center text-body-sm text-fg-muted">
            {t('studio.settingsAi.history.noConnections', 'Connect a database first — enrichment runs are recorded per connection.')}
          </p>
        ) : (
          <RunHistoryForConnection connectionId={selected.id} onOpenReview={onOpenReview} />
        )}
      </CardBody>
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export interface StudioAiPageProps {
  /** Router-injected: opens `/studio/llm-runs/:id/review` (read-only once applied). */
  onOpenReview: (runId: string) => void;
}

export function StudioAiPage({ onOpenReview }: StudioAiPageProps): ReactNode {
  const { data: config } = useSuspenseQuery(aiConfigQuery());
  const { data: connections } = useSuspenseQuery(connectionsQuery());

  // 11-electron.md §8.2, LLM row: "BYO round-trip is the default and is
  // highlighted first in desktop".
  //
  // SUSPENDING, unlike this module's other capability reads, because this one
  // decides the ORDER OF THE PAGE. The unresolved runtime is `self-host`, so a
  // non-suspending read would paint provider-first and then visibly swap the two
  // panels the moment the probe lands — on desktop, i.e. on every single load of
  // the one runtime this ordering exists for. The page already suspends on
  // `aiConfigQuery` and `connectionsQuery`; joining them costs nothing and the
  // reader sees one layout.
  const { data: info } = useSuspenseQuery(systemInfoQuery());
  const { providerApi, byoFirst } = llmAffordances(info);

  const byo = <ByoPanel key="byo" highlighted={byoFirst} />;
  const provider = <ProviderConfigForm key="provider" config={config} networkAllowed={providerApi.enabled} />;

  return (
    <PageSurface width="narrow" className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <IconTile tone="accent" size="lg" icon={<Sparkles />} />
        <div>
          <h1 className="text-page-title text-fg">{t('studio.settingsAi.title', 'AI enrichment')}</h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            {t(
              'studio.settingsAi.subtitle',
              'Connect a model to let Adminium suggest labels, groups, relations and more — always reviewed as a diff before anything applies.',
            )}
          </p>
        </div>
      </header>

      {/* Order IS the recommendation — the top card is what an admin reads
          first and what they take to be the normal way. On desktop (and on any
          air-gapped install) that has to be the round-trip. Keyed so React moves
          the nodes rather than remounting them and dropping the provider draft. */}
      {byoFirst ? [byo, provider] : [provider, byo]}
      <RunHistorySection connections={connections} onOpenReview={onOpenReview} />
    </PageSurface>
  );
}
