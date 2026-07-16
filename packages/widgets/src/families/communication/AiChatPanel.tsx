import { Button, EmptyState, IconTile, Input, Spinner } from '@adminium/ui';
import { KeyRound, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import {
  chatRowsOf,
  fmtClock,
  formatAbsoluteTime,
  localeOf,
  sortBySentAt,
  sourceOf,
  stringField,
  CHAT_DEMO_EPOCH,
} from './chat-lib.js';
import type { AiChatPanelConfig } from './communication-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure
// `communication-config` module so the registry metadata graph never eagerly
// pulls this component's @adminium/ui deps (acceptance #3); re-exported here so
// the family barrel, stories, and tests keep one import point per widget.
export { aiChatPanelConfigSchema, aiChatPanelDemoData } from './communication-config.js';
export type { AiChatPanelConfig };

/**
 * `ai-chat-panel` (annex §9) — the assistant panel SHELL used for the LLM
 * schema-assist (04 §11) and in-dashboard AI querying (06 §10): sparkles-avatar
 * assistant bubbles, accent user bubbles, suggestion chips, and a send input.
 *
 * THIS WIDGET NEVER CALLS A PROVIDER. The M6 LLM layer is server-owned
 * (@adminium/llm behind `/api/v1/llm` — keys live server-side and never reach
 * the browser, 06 §4); this component is pure presentation wired to props and
 * callbacks. `providerConfigured={false}` renders the configure-a-provider
 * empty state whose CTA drills through to Studio → Settings → AI, and `onSend`
 * hands the prompt to the host, which owns the run lifecycle.
 *
 * Alignment is logical, same contract as `chat-thread`: user turns dock to the
 * inline-end edge via `justify-end` and mirror under `dir="rtl"`.
 */

export interface AiTurn {
  id: string | number;
  role: 'user' | 'assistant';
  body: string;
  /** ISO 8601 timestamp; optional — the panel renders fine without stamps. */
  sentAt?: string | undefined;
}

export interface AiChatPanelProps {
  turns: readonly AiTurn[];
  suggestions?: readonly string[] | undefined;
  /** False → the configure-a-provider empty state instead of the transcript. */
  providerConfigured?: boolean | undefined;
  providerLabel?: string | undefined;
  assistantName?: string | undefined;
  composerPlaceholder?: string | undefined;
  sendLabel?: string | undefined;
  pending?: boolean | undefined;
  pendingLabel?: string | undefined;
  configureTitle?: string | undefined;
  configureBody?: string | undefined;
  configureCtaLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onSend?: ((prompt: string) => void) | undefined;
  onConfigure?: (() => void) | undefined;
  locale?: string | undefined;
  dir?: 'ltr' | 'rtl' | undefined;
  testId?: string | undefined;
}

export function AiChatPanel({
  turns,
  suggestions = [],
  providerConfigured = true,
  providerLabel,
  assistantName,
  composerPlaceholder,
  sendLabel,
  pending = false,
  pendingLabel,
  configureTitle,
  configureBody,
  configureCtaLabel,
  emptyTitle,
  emptyBody,
  onSend,
  onConfigure,
  locale: localeProp,
  dir,
  testId,
}: AiChatPanelProps) {
  // `format.locale` is a free-string in the shared config, so '' / 'x-1' are
  // schema-valid and would throw out of every Intl call. Normalize at the edge.
  const locale = localeOf(localeProp);
  const [draft, setDraft] = useState('');
  const ordered = sortBySentAt(
    turns.map((turn) => ({ ...turn, own: turn.role === 'user', sentAt: turn.sentAt ?? '' })),
  ) as (AiTurn & { own: boolean })[];

  const send = (prompt: string): void => {
    const body = prompt.trim();
    if (body === '') return;
    onSend?.(body);
    setDraft('');
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    send(draft);
  };

  return (
    <div
      data-widget="ai-chat-panel"
      data-testid={testId}
      data-provider-configured={providerConfigured ? '' : undefined}
      {...(dir === undefined ? {} : { dir })}
      className="flex h-full flex-col"
    >
      <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
        <IconTile size="sm" tone="accent" icon={<Sparkles />} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-sm font-bold text-fg">{assistantName ?? 'Assistant'}</div>
          {providerLabel !== undefined && (
            <div className="truncate font-mono text-caption text-fg-subtle">{providerLabel}</div>
          )}
        </div>
      </div>

      {!providerConfigured ? (
        // No provider → the panel is inert by design: no composer, no callbacks
        // that could imply a request is possible (06 §4 — the server owns keys).
        <div data-part="configure-provider" className="flex-1">
          <EmptyState
            compact
            icon={<KeyRound />}
            tone="warn"
            title={configureTitle ?? 'No AI provider configured'}
            body={
              configureBody ??
              'Add an Anthropic or OpenAI key — or point Adminium at your own endpoint — to ask questions about your schema.'
            }
            actions={
              onConfigure === undefined ? undefined : (
                <Button variant="primary" size="sm" onClick={onConfigure}>
                  {configureCtaLabel ?? 'Configure a provider'}
                </Button>
              )
            }
          />
        </div>
      ) : (
        <>
          {ordered.length === 0 ? (
            <div className="flex-1">
              <EmptyState
                compact
                icon={<Sparkles />}
                tone="accent"
                title={emptyTitle ?? 'Ask about your data'}
                body={emptyBody ?? 'Ask a question about your schema, tables, or metrics to get started.'}
              />
            </div>
          ) : (
            <div data-part="ai-transcript" className="flex flex-1 flex-col gap-2 overflow-auto p-4">
              {ordered.map((turn) => (
                <AiBubble key={turn.id} turn={turn} locale={locale} />
              ))}
              {pending && (
                <div data-part="ai-pending" className="flex items-center gap-2 py-1">
                  <Spinner size="sm" />
                  <span className="text-caption italic text-fg-subtle">{pendingLabel ?? 'Thinking…'}</span>
                </div>
              )}
            </div>
          )}

          {suggestions.length > 0 && (
            <ul data-part="suggestion-chips" className="flex flex-wrap gap-1.5 px-4 pb-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    data-part="suggestion-chip"
                    disabled={pending}
                    onClick={() => send(suggestion)}
                    className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-caption font-semibold text-fg-muted hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form data-part="composer" onSubmit={submit} className="flex items-center gap-2 border-t border-border/60 p-3">
            <Input
              aria-label={composerPlaceholder ?? 'Ask a question'}
              placeholder={composerPlaceholder ?? 'Ask a question…'}
              value={draft}
              disabled={pending}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
            <button
              type="submit"
              data-part="send-button"
              aria-label={sendLabel ?? 'Send'}
              disabled={pending || draft.trim() === ''}
              className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-fg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
            >
              <Send className="size-4 rtl:-scale-x-100" aria-hidden="true" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function AiBubble({ turn, locale }: { turn: AiTurn & { own: boolean }; locale: string }) {
  const own = turn.own;
  const stamp = turn.sentAt !== undefined && turn.sentAt !== '' ? turn.sentAt : undefined;
  return (
    <div
      data-part="ai-turn"
      data-role={turn.role}
      className={`flex items-start gap-2 ${own ? 'justify-end' : 'justify-start'}`}
    >
      {!own && <IconTile size="sm" tone="accent" icon={<Sparkles />} className="mt-0.5 shrink-0" />}
      <div
        data-part="ai-bubble"
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-body-sm leading-relaxed ${
          own ? 'rounded-ee-sm bg-accent text-accent-fg' : 'rounded-es-sm border border-border bg-surface text-fg'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{turn.body}</p>
        {stamp !== undefined && (
          <time
            dateTime={stamp}
            title={formatAbsoluteTime(stamp, locale)}
            data-part="ai-time"
            className={`mt-1 block font-mono text-[9.5px] tabular-nums ${
              own ? 'text-end text-accent-fg/70' : 'text-start text-fg-subtle'
            }`}
          >
            {fmtClock(locale, stamp)}
          </time>
        )}
      </div>
    </div>
  );
}

function turnsOf(data: unknown, config: AiChatPanelConfig): AiTurn[] {
  return chatRowsOf(data).map((row, index) => {
    const sentAt = stringField(row, config.sentAtField);
    return {
      id: (row['id'] as string | number | undefined) ?? index,
      role: stringField(row, config.roleField) === 'user' ? ('user' as const) : ('assistant' as const),
      body: stringField(row, config.bodyField) ?? '',
      sentAt: sentAt ?? new Date(CHAT_DEMO_EPOCH).toISOString(),
    };
  });
}

export function AiChatPanelWidget({ config, data, onEvent }: WidgetProps<AiChatPanelConfig>) {
  const turns = turnsOf(data, config);
  const source = sourceOf(config.binding);
  return (
    <AiChatPanel
      turns={turns}
      suggestions={config.suggestions}
      providerConfigured={config.providerConfigured}
      pending={config.pending}
      {...(config.providerLabel === undefined ? {} : { providerLabel: config.providerLabel })}
      {...(config.assistantName === undefined ? {} : { assistantName: config.assistantName })}
      {...(config.composerPlaceholder === undefined ? {} : { composerPlaceholder: config.composerPlaceholder })}
      {...(config.sendLabel === undefined ? {} : { sendLabel: config.sendLabel })}
      {...(config.pendingLabel === undefined ? {} : { pendingLabel: config.pendingLabel })}
      {...(config.configureTitle === undefined ? {} : { configureTitle: config.configureTitle })}
      {...(config.configureBody === undefined ? {} : { configureBody: config.configureBody })}
      {...(config.configureCtaLabel === undefined ? {} : { configureCtaLabel: config.configureCtaLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      // The host owns the LLM run (POST /api/v1/llm/…): the widget only reports
      // the prompt as an insert intent against the transcript table.
      onSend={(prompt) => {
        onEvent({
          type: 'mutate',
          intent: 'insert',
          ...(source.connectionId === undefined ? {} : { connectionId: source.connectionId }),
          table: source.table,
          values: { [config.roleField]: 'user', [config.bodyField]: prompt },
        });
      }}
      {...(config.configureHref === undefined
        ? {}
        : {
            onConfigure: () => {
              onEvent({ type: 'drill-through', href: config.configureHref as string });
            },
          })}
    />
  );
}
