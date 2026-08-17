import { Badge, IconButton, MonoText, Switch, Tag } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  codeSnippetBlockConfigSchema,
  codeSnippetBlockDemoData,
  OPS_DEMO_NOW_MS,
  resourceApiCardConfigSchema,
  resourceApiCardDemoData,
  webhookEndpointsListConfigSchema,
  webhookEndpointsListDemoData,
} from './domain-ops-config.js';
import type {
  CodeSnippetBlockConfig,
  ResourceApiCardConfig,
  WebhookEndpointsListConfig,
} from './domain-ops-config.js';
import {
  METHOD_TONE,
  booleanField,
  countField,
  formatCompact,
  formatCount,
  formatSince,
  httpMethodOf,
  instantField,
  interpolate,
  labelField,
  numberArrayField,
  opsBindingSourceOf,
  opsRowOf,
  opsRowsOf,
  resolveNow,
  stringArrayField,
} from './domain-ops-lib.js';
import type { ResourceApi, WebhookEndpoint } from './domain-ops-types.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetProps } from '../../registry/types.js';

export {
  codeSnippetBlockConfigSchema,
  codeSnippetBlockDemoData,
  resourceApiCardConfigSchema,
  resourceApiCardDemoData,
  webhookEndpointsListConfigSchema,
  webhookEndpointsListDemoData,
};
export type { CodeSnippetBlockConfig, ResourceApiCardConfig, WebhookEndpointsListConfig };

/**
 * TRACK OPS — the API-SURFACE half of the annex §13 ops cards, grouped in one
 * module because all three describe the same thing (the resources an API
 * exposes) and share the mono/method-chip vocabulary:
 *
 *   `code-snippet-block`, `webhook-endpoints-list`, `resource-api-card`.
 *
 * NO SYNTAX HIGHLIGHTER, deliberately (see `codeSnippetBlockConfigSchema`'s
 * note): a tokenizer would be a highlighter dependency in every bundle that
 * mounts an API page, bought for a read-only snippet nobody edits. The block is
 * a mono surface + a language chip + a copy button. Highlighting, if it is ever
 * wanted, arrives as a lazily-loaded decorator — not as a static dep on this
 * family's chunk (04 §2.3 / qa/chunk-budget.test.ts).
 *
 * NEVER WRITES: the webhook enable toggle emits a `mutate` intent the host runs
 * through the CRUD API with undo + audit (04 §2.1). Unbound → the toggle renders
 * read-only rather than lying about a state it cannot persist.
 */

/**
 * Copy-to-clipboard with a confirmation, shared by the snippet block and the
 * resource card.
 *
 * `navigator.clipboard` is undefined under plain HTTP and in the happy-dom test
 * environment, so the write is optional-chained and the confirmation is driven
 * by our own state either way: the button must stay honest rather than throw.
 * The reset is a plain `setTimeout` — the annex pins the window, and a
 * `clearTimeout` on unmount keeps a copied-then-unmounted block from setting
 * state on a dead component.
 */
function useCopy(resetMs: number): { copied: boolean; copy: (value: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = (value: string): void => {
    void globalThis.navigator?.clipboard?.writeText?.(value)?.catch?.(() => {});
    setCopied(true);
    // Restart the window on a re-copy rather than letting the first timer cut
    // the second confirmation short.
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), resetMs);
  };

  return { copied, copy };
}

// ── code-snippet-block ──────────────────────────────────────────────────────

export interface CodeSnippetBlockViewProps {
  code: string;
  language?: string | undefined;
  /** Language tabs; a single entry (or none) hides the tab row. */
  languages?: readonly string[] | undefined;
  activeLanguage?: string | undefined;
  onLanguageChange?: ((language: string) => void) | undefined;
  copyButton?: boolean | undefined;
  copyLabel?: string | undefined;
  copiedLabel?: string | undefined;
  testId?: string | undefined;
}

export function CodeSnippetBlockView({
  code,
  language,
  languages,
  activeLanguage,
  onLanguageChange,
  copyButton = true,
  copyLabel,
  copiedLabel,
  testId,
}: CodeSnippetBlockViewProps) {
  const t = useMaybeT();
  const { copied, copy } = useCopy(1400);
  const tabs = languages ?? [];

  return (
    <div
      data-widget="code-snippet-block"
      data-testid={testId}
      className="flex h-full flex-col gap-2 overflow-hidden px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <div className="flex items-center gap-1.5">
        {tabs.length > 1 ? (
          <div role="tablist" className="flex min-w-0 flex-wrap items-center gap-1">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                data-part="snippet-tab"
                aria-selected={tab === activeLanguage}
                className={`rounded-md px-2 py-0.5 text-caption transition-colors ${
                  tab === activeLanguage
                    ? 'bg-accent-soft font-semibold text-accent'
                    : 'text-fg-muted hover:bg-surface-3 hover:text-fg'
                }`}
                onClick={() => onLanguageChange?.(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        ) : language === undefined ? null : (
          <Tag mono tone="neutral" data-part="snippet-language">
            {language}
          </Tag>
        )}

        {!copyButton ? null : (
          <IconButton
            size="sm"
            variant="ghost"
            className="ms-auto"
            data-part="snippet-copy"
            label={
              copied
                ? (copiedLabel ?? t('ui:widgets.domain.codeSnippetBlock.copiedLabel', 'Copied'))
                : (copyLabel ?? t('ui:widgets.domain.codeSnippetBlock.copyLabel', 'Copy'))
            }
            onClick={() => copy(code)}
          >
            {copied ? <Check className="size-3.5 text-pos" /> : <Copy className="size-3.5" />}
          </IconButton>
        )}
      </div>

      {/*
        The snippet is an LTR ISLAND (10-i18n-theming.md §5.5): code is written
        left-to-right in every locale, so `dir="ltr"` stays on the <pre> even
        under an RTL page — mirroring it would reorder the tokens of a shell
        command into something that does not run. The chrome above mirrors; the
        code does not.
      */}
      <pre
        dir="ltr"
        data-part="snippet-code"
        className="min-h-0 flex-1 overflow-auto rounded-lg bg-surface-3 p-3 text-caption leading-relaxed"
      >
        <MonoText asChild className="whitespace-pre text-fg">
          <code>{code}</code>
        </MonoText>
      </pre>
    </div>
  );
}

export function CodeSnippetBlockWidget({ config, data }: WidgetProps<CodeSnippetBlockConfig>) {
  const t = useMaybeT();
  const row = useMemo(() => opsRowOf(data), [data]);
  /*
    Language tabs come from `languages`, else from the `templates` map's keys —
    a host that supplied per-language templates has already declared the tab set,
    and making it repeat itself in `languages` is a config trap.
  */
  const tabs = useMemo(
    () => config.languages ?? (config.templates === undefined ? [] : Object.keys(config.templates)),
    [config.languages, config.templates],
  );
  const [active, setActive] = useState<string | undefined>(() => tabs[0]);

  /*
    Absent row AND empty column both normalize to `undefined` here, so the `??`
    chains below fall through to config. Collapsing the two cases at the source
    is the point: reading "no row" as a distinct state from "empty string" is how
    a static-config snippet ends up rendering with no language chip.
  */
  const boundCode = row === null ? undefined : labelField(row, config.codeField, '') || undefined;
  const boundLanguage = row === null ? undefined : labelField(row, config.languageField, '') || undefined;
  /*
    Resolution order — the template for the ACTIVE tab wins, then the bound row's
    code column, then the static `code` config (the annex's "or static string").
    A tabbed block whose templates went missing must not silently render the
    bound snippet under the wrong language chip, so an active tab with no
    template resolves to empty and empty-states below.
  */
  const templated = active === undefined ? undefined : config.templates?.[active];
  const code = (tabs.length > 0 ? templated : boundCode) ?? config.code ?? '';
  const language = tabs.length > 0 ? active : (boundLanguage ?? config.language);

  if (code === '') {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.codeSnippetBlock.emptyTitle', 'No snippet')}
        body={config.emptyBody ?? t('ui:widgets.domain.codeSnippetBlock.emptyBody', 'Bind a code column or set a static snippet in config.')}
      />
    );
  }

  return (
    <CodeSnippetBlockView
      code={code}
      copyButton={config.copyButton}
      {...(language === undefined ? {} : { language })}
      {...(tabs.length === 0 ? {} : { languages: tabs, activeLanguage: active, onLanguageChange: setActive })}
      {...(config.copyLabel === undefined ? {} : { copyLabel: config.copyLabel })}
      {...(config.copiedLabel === undefined ? {} : { copiedLabel: config.copiedLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}

// ── webhook-endpoints-list ──────────────────────────────────────────────────

export interface WebhookEndpointsListViewProps {
  hooks: readonly WebhookEndpoint[];
  /** Epoch ms "now" for the last-fired stamps. */
  now: number;
  locale?: string | undefined;
  neverFiredLabel?: string | undefined;
  lastFiredLabel?: string | undefined;
  enableLabel?: string | undefined;
  onToggle?: ((hook: WebhookEndpoint, enabled: boolean) => void) | undefined;
  testId?: string | undefined;
}

export function WebhookEndpointsListView({
  hooks,
  now,
  locale,
  neverFiredLabel,
  lastFiredLabel,
  enableLabel,
  onToggle,
  testId,
}: WebhookEndpointsListViewProps) {
  const t = useMaybeT();
  return (
    <ul
      data-widget="webhook-endpoints-list"
      data-testid={testId}
      className="flex h-full flex-col gap-1.5 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      {hooks.map((hook) => {
        const since = formatSince(hook.lastFired, locale, now);
        return (
          <li
            key={hook.id}
            data-part="webhook-row"
            data-enabled={hook.enabled ? '' : undefined}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2.5"
          >
            {/*
              The annex's "icon dims when off" — a disabled hook's identity is
              muted so a glance down the list separates live from dormant without
              reading a single toggle.
            */}
            <div className={`flex min-w-0 flex-1 flex-col gap-1 ${hook.enabled ? '' : 'opacity-50'}`}>
              {/* `Tag mono` is the schema/event-chip form (design-system §3 Tier 1) — `Badge` has no mono variant. */}
              <Tag mono tone="info" className="self-start" data-part="webhook-event">
                {hook.event}
              </Tag>
              <MonoText dir="ltr" className="truncate text-caption text-fg-muted" data-part="webhook-url">
                {hook.url}
              </MonoText>
              <span className="text-caption text-fg-subtle" data-part="webhook-last-fired">
                {since === undefined
                  ? (neverFiredLabel ?? t('ui:widgets.domain.webhookEndpointsList.neverFiredLabel', 'Never fired'))
                  : lastFiredLabel !== undefined
                    ? interpolate(lastFiredLabel, { since })
                    : t('ui:widgets.domain.webhookEndpointsList.lastFiredLabel', 'Last fired {since}', { since })}
              </span>
            </div>
            <Switch
              data-part="webhook-toggle"
              checked={hook.enabled}
              aria-label={enableLabel ?? hook.event}
              className="shrink-0"
              {...(onToggle === undefined
                ? { disabled: true }
                : { onCheckedChange: (checked: boolean) => onToggle(hook, checked) })}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** Project the bound `record-list` onto the hook model. */
function hooksOf(config: WebhookEndpointsListConfig, data: unknown): WebhookEndpoint[] {
  return opsRowsOf(data).map((row, index) => ({
    id: labelField(row, config.idField, `wh${index}`),
    event: labelField(row, config.eventField, ''),
    url: labelField(row, config.urlField, ''),
    lastFired: instantField(row, config.lastFiredField),
    enabled: booleanField(row, config.enabledField) ?? false,
  }));
}

export function WebhookEndpointsListWidget({ config, data, onEvent }: WidgetProps<WebhookEndpointsListConfig>) {
  const t = useMaybeT();
  const hooks = useMemo(() => hooksOf(config, data), [config, data]);
  const source = useMemo(() => opsBindingSourceOf(config.binding), [config.binding]);
  // Captured ONCE — never a per-render `Date.now()`, which would make the
  // relative stamps change on every re-render and defeat snapshotting.
  const [mountedAt] = useState(() => OPS_DEMO_NOW_MS);
  const now = resolveNow(config.format?.referenceTime, mountedAt);

  if (hooks.length === 0) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.webhookEndpointsList.emptyTitle', 'No endpoints')}
        body={config.emptyBody ?? t('ui:widgets.domain.webhookEndpointsList.emptyBody', 'Add a webhook endpoint to receive table events.')}
      />
    );
  }

  return (
    <WebhookEndpointsListView
      hooks={hooks}
      now={now}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.neverFiredLabel === undefined ? {} : { neverFiredLabel: config.neverFiredLabel })}
      {...(config.lastFiredLabel === undefined ? {} : { lastFiredLabel: config.lastFiredLabel })}
      {...(config.enableLabel === undefined ? {} : { enableLabel: config.enableLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(source === null
        ? {}
        : {
            onToggle: (hook: WebhookEndpoint, enabled: boolean) =>
              void onEvent({
                type: 'mutate',
                intent: 'update',
                connectionId: source.connectionId,
                table: source.table,
                recordId: hook.id,
                values: { [config.enabledField]: enabled },
              }),
          })}
    />
  );
}

// ── resource-api-card ───────────────────────────────────────────────────────

export interface ResourceApiCardViewProps {
  resource: ResourceApi;
  locale?: string | undefined;
  rlsLabel?: string | undefined;
  publicLabel?: string | undefined;
  rowsLabel?: string | undefined;
  perDayLabel?: string | undefined;
  testId?: string | undefined;
}

export function ResourceApiCardView({
  resource,
  locale,
  rlsLabel,
  publicLabel,
  rowsLabel,
  perDayLabel,
  testId,
}: ResourceApiCardViewProps) {
  const t = useMaybeT();
  // Peak-relative bar heights. A flat-zero series would divide by zero, so the
  // denominator floors at 1 and the strip renders flat rather than NaN-tall.
  const peak = Math.max(1, ...resource.requests);

  return (
    <div
      data-widget="resource-api-card"
      data-testid={testId}
      className="flex h-full flex-col gap-2.5 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <div className="flex items-center gap-2">
        <MonoText className="min-w-0 flex-1 truncate text-body-sm font-bold text-fg" data-part="resource-name">
          {resource.name}
        </MonoText>
        {/*
          RLS on = protected (pos); RLS off = the table is world-readable through
          the API, which is a WARNING, not a neutral fact. Toning it neutral would
          make the riskier of the two states the quieter one.
        */}
        <Badge tone={resource.rls ? 'pos' : 'warn'} data-part="resource-rls">
          {resource.rls
            ? (rlsLabel ?? t('ui:widgets.domain.resourceApiCard.rlsLabel', 'RLS'))
            : (publicLabel ?? t('ui:widgets.domain.resourceApiCard.publicLabel', 'Public'))}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {resource.methods.map((method) => {
          const normalized = httpMethodOf(method);
          return (
            <Tag key={method} mono tone={METHOD_TONE[normalized]} data-part="resource-method">
              {normalized}
            </Tag>
          );
        })}
      </div>

      <p className="text-caption text-fg-subtle">
        <MonoText className="font-semibold text-fg">{formatCompact(resource.rowCount, locale)}</MonoText>{' '}
        {rowsLabel ?? t('ui:widgets.domain.resourceApiCard.rowsLabel', 'rows')}
      </p>

      {/*
        Request sparkline. Decorative for AT — the req/day figure below states the
        same fact in text, and 14 announced bars would be noise. Mirrors as a
        plain flex row under RTL (no axis, no origin: nothing anchors it to
        "left = older"), keeping "most recent" at the reading END either way.
      */}
      <div aria-hidden="true" data-testid="resource-sparkline" className="flex h-6 items-end gap-px">
        {resource.requests.map((value, index) => (
          <span
            key={`${index}-${value}`}
            data-part="resource-bar"
            className="h-[var(--bar-h)] min-w-px flex-1 rounded-xs bg-accent"
            style={{ '--bar-h': `${Math.max(4, (value / peak) * 100)}%` }}
          />
        ))}
      </div>

      <p className="mt-auto text-caption text-fg-subtle" data-part="resource-per-day">
        {perDayLabel !== undefined
          ? interpolate(perDayLabel, { count: formatCount(resource.perDay, locale) })
          : t('ui:widgets.domain.resourceApiCard.perDayLabel', '{count}/day', {
              count: formatCount(resource.perDay, locale),
            })}
      </p>
    </div>
  );
}

/** Project the bound `record` onto the resource model (config-driven columns). */
function resourceOf(config: ResourceApiCardConfig, data: unknown): ResourceApi | null {
  const row = opsRowOf(data);
  if (row === null) return null;
  const methods = stringArrayField(row, config.methodsField);
  return {
    name: labelField(row, config.nameField, 'table'),
    rowCount: countField(row, config.rowCountField, 0),
    rls: booleanField(row, config.rlsField) ?? false,
    // Config `methods` is the fallback for a table with no methods column
    // (annex: "Config: methods"), not an override of a real one.
    methods: methods.length > 0 ? methods : config.methods,
    requests: numberArrayField(row, config.requestsField),
    perDay: countField(row, config.perDayField, 0),
  };
}

export function ResourceApiCardWidget({ config, data }: WidgetProps<ResourceApiCardConfig>) {
  const t = useMaybeT();
  const resource = useMemo(() => resourceOf(config, data), [config, data]);

  if (resource === null) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.resourceApiCard.emptyTitle', 'No resource')}
        body={config.emptyBody ?? t('ui:widgets.domain.resourceApiCard.emptyBody', 'Bind a table to show its generated API surface.')}
      />
    );
  }

  return (
    <ResourceApiCardView
      resource={resource}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.rlsLabel === undefined ? {} : { rlsLabel: config.rlsLabel })}
      {...(config.publicLabel === undefined ? {} : { publicLabel: config.publicLabel })}
      {...(config.rowsLabel === undefined ? {} : { rowsLabel: config.rowsLabel })}
      {...(config.perDayLabel === undefined ? {} : { perDayLabel: config.perDayLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
