// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The AI-provider configuration form (06-llm-assist.md §3.2, §10.1) — provider
 * choice, base URL, model, the write-only API key, Save and Test connection.
 *
 * ONE FORM, TWO HOSTS (46-enrich-provider-inline.md R3). Settings → AI
 * (`StudioAiPage`) has always rendered it; the connect wizard's "Enrich with AI"
 * step renders the same component inline, so an operator who lands there with no
 * provider configured can set one up without leaving the wizard and losing the
 * section toggles, locales and sampling opt-in they have already chosen. It is
 * extracted rather than copied for the obvious reason: a fix to the key contract,
 * the model list or the test button has to reach both places, and a second copy
 * is a second thing to forget.
 *
 * The API key is WRITE-ONLY end to end: `getConfig` only ever returns
 * `apiKeySet` + `apiKeyLast4`, `putConfig` sends a key but no reply echoes it
 * (§3.2), so the raw key never lives in this component's state after a save.
 *
 * Seed patterns (§10): `API Keys.dc.html` (write-only key entry → masked
 * `sk-…last4` + Replace) and `Integrations.dc.html` (provider connect cards).
 * RBAC is enforced by the hosts' route guards and again by every
 * `/api/v1/llm/*` route — Editors/Viewers never reach either surface.
 */
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { getFormatters } from '@adminium/i18n';
import { CheckCircle2, PlugZap } from 'lucide-react';
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
  Tag,
} from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import {
  aiApi,
  type LlmConfig,
  type LlmConfigTestResult,
  type LlmModelInfo,
} from './api.js';
import {
  CONFIGURABLE_PROVIDERS,
  isConfigurableProvider,
  providerCatalogEntry,
  type ConfigurableProvider,
} from './providerCatalog.js';

// ── Queries ──────────────────────────────────────────────────────────────────

const CONFIG_QUERY_KEY = ['llm', 'config'] as const;

/**
 * The provider config, held under one key both hosts share: Settings suspends
 * on it, the wizard's inline panel reads it without suspending, and a save from
 * either seeds the other.
 */
export function aiConfigQuery() {
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
      return t('studio:settingsAi.provider.anthropic.label', 'Anthropic');
    case 'openai':
      return t('studio:settingsAi.provider.openai.label', 'OpenAI');
    case 'openai-compatible':
      return t('studio:settingsAi.provider.openaiCompatible.label', 'OpenAI-compatible');
    case 'ollama':
      return t('studio:settingsAi.provider.ollama.label', 'Ollama (local)');
  }
}

function providerDescription(id: ConfigurableProvider): string {
  switch (id) {
    case 'anthropic':
      return t('studio:settingsAi.provider.anthropic.desc', 'Claude models via the Anthropic API.');
    case 'openai':
      return t('studio:settingsAi.provider.openai.desc', 'GPT models via the OpenAI API.');
    case 'openai-compatible':
      return t(
        'studio:settingsAi.provider.openaiCompatible.desc',
        'Any endpoint that speaks the OpenAI wire format — Groq, Together, vLLM, LM Studio.',
      );
    case 'ollama':
      return t('studio:settingsAi.provider.ollama.desc', 'Models running locally through Ollama — no key, no cloud.');
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

export interface ProviderConfigFormProps {
  config: LlmConfig;
  /** False on an air-gapped install: the form stays, and says why a key buys nothing. */
  networkAllowed: boolean;
  /**
   * Where this form sits in its host's outline. Settings renders it as a
   * top-level section (`2`, the default); the connect wizard renders it under
   * the step's own "Enrich with AI" heading, so there it is `3` and the
   * per-provider card below follows one level down.
   */
  headingLevel?: 2 | 3;
}

export function ProviderConfigForm({
  config,
  networkAllowed,
  headingLevel = 2,
}: ProviderConfigFormProps): ReactNode {
  const SectionHeading = headingLevel === 3 ? 'h3' : 'h2';
  const CardHeading = headingLevel === 3 ? 'h4' : 'h3';
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
      // `bootstrap.llm.enabled` is "an admin has set llm.provider" (the server's
      // bootstrap handler reads the same settings row this PUT just wrote), and
      // it is what the ⌘K "Ask AI" affordance and the wizard's provider card
      // gate on. Held at `staleTime: Infinity`, so nothing refetches it on its
      // own: without this line the card the operator just enabled stays grey
      // until a reload — which is the whole point of the inline host (46 §2.2).
      void queryClient.invalidateQueries({ queryKey: bootstrapQuery().queryKey });
      // Drop the raw key from local state the instant it is stored (§3.2).
      setDraft((prev) => (prev === null ? prev : { ...prev, keyDraft: '', replacingKey: false }));
      toasts.push({ variant: 'success', title: t('studio:settingsAi.saved', 'AI provider saved') });
    },
    onError: () => {
      toasts.push({
        variant: 'error',
        title: t('studio:settingsAi.saveFailed', 'Could not save the AI provider. Try again.'),
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
          <SectionHeading className="text-section text-fg">
            {t('studio:settingsAi.provider.heading', 'AI provider')}
          </SectionHeading>
          {/* 11-electron.md §8.2, LLM row: provider-API mode is "Available,
              LABELED". §6 step 4 gives the label its words. It rides beside the
              heading in every runtime, not just desktop — the direct path needs
              the internet on a self-host too, and a self-host admin choosing
              between the two paths deserves the same fact. */}
          <Tag>{t('studio:settingsAi.provider.requiresNetwork', 'Requires internet & an API key')}</Tag>
        </div>
        <p className="mt-0.5 text-body-sm text-fg-muted">
          {t(
            'studio:settingsAi.provider.subtitle',
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
          title={t('studio:settingsAi.provider.networkDisabledTitle', 'Direct AI providers are turned off on this install')}
          body={t(
            'studio:settingsAi.provider.networkDisabledBody',
            'This Adminium is configured with no outbound internet access, so it cannot reach a provider API. Use the copy-paste round-trip below — it needs no key and no network.',
          )}
        />
      )}

      <RadioGroup
        aria-label={t('studio:settingsAi.provider.heading', 'AI provider')}
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
                      <Badge tone="pos">{t('studio:settingsAi.provider.active', 'Active')}</Badge>
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
              <CardHeading className="text-section text-fg">
                {t('studio:settingsAi.configure.heading', 'Configure {provider}', {
                  provider: providerLabel(draft.provider),
                })}
              </CardHeading>
              <p className="text-caption text-fg-subtle">
                {providerDescription(draft.provider)}
              </p>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {entry.baseUrl !== 'none' ? (
              <FormField
                label={t('studio:settingsAi.field.baseUrl', 'Base URL')}
                required={entry.baseUrl === 'required'}
                helper={
                  entry.baseUrl === 'optional'
                    ? t('studio:settingsAi.field.baseUrlOptional', 'Leave as-is unless Ollama runs on another host.')
                    : t('studio:settingsAi.field.baseUrlHelper', 'The endpoint root that serves /chat/completions.')
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
                title={t('studio:settingsAi.field.noKeyTitle', 'No API key needed')}
                body={t('studio:settingsAi.field.noKeyBody', 'Ollama runs locally, so nothing leaves this machine.')}
              />
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!derived.valid || !derived.dirty || saveMutation.isPending}
                loading={saveMutation.isPending}
                onClick={() => draft !== null && saveMutation.mutate(draft)}
              >
                {t('studio:settingsAi.save', 'Save provider')}
              </Button>
              <Button
                variant="secondary"
                disabled={!canTest || testMutation.isPending}
                loading={testMutation.isPending}
                onClick={() => testMutation.mutate()}
              >
                {t('studio:settingsAi.test', 'Test connection')}
              </Button>
              {!canTest && draft.provider === config.provider ? (
                <span className="text-caption text-fg-subtle">
                  {t('studio:settingsAi.testHintDirty', 'Save your changes before testing.')}
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
      label={t('studio:settingsAi.field.model', 'Model')}
      required
      helper={
        entry.freeTextModel
          ? t('studio:settingsAi.field.modelFreeText', 'Enter the exact model id your endpoint serves.')
          : useSelect && savedForSelected && liveSource === 'live'
            ? t('studio:settingsAi.field.modelLive', 'Loaded live from the provider.')
            : t('studio:settingsAi.field.modelStatic', 'A known-good list; type a custom id after saving to refresh it.')
      }
      {...(loadingModels ? { tag: <Tag>{t('studio:settingsAi.field.modelLoading', 'Loading…')}</Tag> } : {})}
    >
      {useSelect ? (
        <Select
          mono
          value={draft.model}
          onChange={(event) => onChange(event.currentTarget.value)}
          aria-label={t('studio:settingsAi.field.model', 'Model')}
        >
          <option value="">{t('studio:settingsAi.field.modelPlaceholder', 'Select a model…')}</option>
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
        label={t('studio:settingsAi.field.key', 'API key')}
        helper={t('studio:settingsAi.field.keyStored', 'Stored encrypted. Replace it to use a different key.')}
      >
        <div className="flex items-center gap-2">
          <MonoText
            data-testid="stored-key-mask"
            className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-body-sm text-fg"
          >
            {t('studio:settingsAi.field.keyMask', 'sk-…{last4}', { last4: config.apiKeyLast4 ?? '' })}
          </MonoText>
          <Button variant="secondary" size="sm" onClick={onEnterReplace}>
            {t('studio:settingsAi.field.keyReplace', 'Replace key')}
          </Button>
        </div>
      </FormField>
    );
  }

  return (
    <FormField
      label={t('studio:settingsAi.field.key', 'API key')}
      required={!optional}
      helper={
        optional
          ? t('studio:settingsAi.field.keyOptional', 'Optional — some endpoints need no key.')
          : t('studio:settingsAi.field.keyWriteOnly', 'Write-only: once saved it is never shown again.')
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
        {t('studio:settingsAi.testing', 'Pinging the provider…')}
      </div>
    );
  }
  if (mutation.isError) {
    return (
      <Alert
        tone="danger"
        role="alert"
        title={t('studio:settingsAi.testError', 'Test failed')}
        body={t('studio:settingsAi.testErrorBody', 'Could not reach the provider. Check the key and base URL.')}
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
          {t('studio:settingsAi.testOk', 'Connected to {model} in {latency} ms', {
            model: result.model ?? t('studio:settingsAi.testUnknownModel', 'the provider'),
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
      title={t('studio:settingsAi.testError', 'Test failed')}
      body={result.error?.message ?? t('studio:settingsAi.testErrorBody', 'Could not reach the provider. Check the key and base URL.')}
    />
  );
}

