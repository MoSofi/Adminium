/**
 * Provider catalog for Settings → AI (06-llm-assist.md §3.1 provider matrix,
 * §10.1 provider cards). Pure presentation metadata for the four self-host
 * direct-API providers — Anthropic, OpenAI, an OpenAI-compatible endpoint, and
 * local Ollama. `adminium-managed` (Cloud AI credits, §11) is intentionally
 * absent: it only appears on Cloud instances (M12) and this build is self-host.
 *
 * The dashboard cannot import `@adminium/llm` (01 §2.3, dep-cruiser), so the
 * static fallback model ids mirror `packages/llm/src/providers/model-catalog.ts`
 * and the contract-version strings mirror the constants in
 * `packages/llm/src/{prompt/templates/v1.ts,response/schema.ts}` — kept in sync
 * by hand, exactly as `studio/ai/api.ts` mirrors the route Zod schemas. They are
 * copy/labels only; the server remains the source of truth for what actually runs.
 */
import { Boxes, Server, Sparkles, Bot, type LucideIcon } from 'lucide-react';

import type { LlmModelInfo, LlmProvider } from './api.js';

/** The direct-API providers a self-host instance can configure (§3.1, minus Cloud-only). */
export type ConfigurableProvider = Exclude<LlmProvider, 'adminium-managed'>;

export const CONFIGURABLE_PROVIDERS: readonly ConfigurableProvider[] = [
  'anthropic',
  'openai',
  'openai-compatible',
  'ollama',
];

/** Contract version strings surfaced in the BYO panel (§4.3). Display-only mirrors. */
export const PROMPT_VERSION = 'adminium.prompt/v1.2';
export const SCHEMA_VERSION = 'adminium.llm/v1';

/** How a provider treats the API-key field. */
export type KeyRequirement = 'required' | 'optional' | 'none';
/** How a provider treats the base-URL field. */
export type BaseUrlRequirement = 'required' | 'optional' | 'none';

export interface ProviderCatalogEntry {
  id: ConfigurableProvider;
  icon: LucideIcon;
  key: KeyRequirement;
  baseUrl: BaseUrlRequirement;
  /** Pre-filled base URL for `optional` providers (Ollama localhost). */
  baseUrlDefault?: string;
  baseUrlPlaceholder?: string;
  keyPlaceholder?: string;
  /**
   * The model is always a free-text field (no catalog / live list to pick from) —
   * true for OpenAI-compatible endpoints (§10.1). Ollama has a live `/api/tags`
   * list but no static fallback, so it free-texts only when the live list is empty.
   */
  freeTextModel: boolean;
  /** Conservative offline/first-run model ids (mirror of the llm model-catalog). */
  staticModels: readonly LlmModelInfo[];
}

const ANTHROPIC_STATIC_MODELS: readonly LlmModelInfo[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

const OPENAI_STATIC_MODELS: readonly LlmModelInfo[] = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
];

const CATALOG: Record<ConfigurableProvider, ProviderCatalogEntry> = {
  anthropic: {
    id: 'anthropic',
    icon: Sparkles,
    key: 'required',
    baseUrl: 'none',
    keyPlaceholder: 'sk-ant-…',
    freeTextModel: false,
    staticModels: ANTHROPIC_STATIC_MODELS,
  },
  openai: {
    id: 'openai',
    icon: Bot,
    key: 'required',
    baseUrl: 'none',
    keyPlaceholder: 'sk-…',
    freeTextModel: false,
    staticModels: OPENAI_STATIC_MODELS,
  },
  'openai-compatible': {
    id: 'openai-compatible',
    icon: Boxes,
    key: 'optional',
    baseUrl: 'required',
    baseUrlPlaceholder: 'https://api.groq.com/openai/v1',
    keyPlaceholder: 'sk-…',
    freeTextModel: true,
    staticModels: [],
  },
  ollama: {
    id: 'ollama',
    icon: Server,
    key: 'none',
    baseUrl: 'optional',
    baseUrlDefault: 'http://localhost:11434',
    baseUrlPlaceholder: 'http://localhost:11434',
    freeTextModel: false,
    staticModels: [],
  },
};

export function providerCatalogEntry(id: ConfigurableProvider): ProviderCatalogEntry {
  return CATALOG[id];
}

/** True for providers the settings form can persist here (excludes Cloud-managed). */
export function isConfigurableProvider(id: LlmProvider | null): id is ConfigurableProvider {
  return id !== null && id !== 'adminium-managed';
}
