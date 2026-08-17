// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Button, Input, MonoText, Tag } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Play } from 'lucide-react';
import { useMemo, useState } from 'react';

import { apiPlaygroundConfigSchema, apiPlaygroundDemoData } from './domain-ops-config.js';
import type { ApiPlaygroundConfig } from './domain-ops-config.js';
import {
  METHOD_TONE,
  countField,
  formatMs,
  httpMethodOf,
  labelField,
  opsBindingSourceOf,
  opsRowOf,
} from './domain-ops-lib.js';
import type { HttpMethod, PlaygroundEndpoint } from './domain-ops-types.js';
import { asRecord } from './domain-lib.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `api-playground` (annex §13) — the request composer (method, path, editable
 * query params / body fields) feeding the response viewer: a dark terminal block
 * with the body and a status pill. Evidence: API & Backend.
 *
 * IT DOES NOT MAKE REQUESTS. This is a security boundary, not a shortcut:
 * a widget that could issue arbitrary authenticated calls from a dashboard cell
 * — with the viewer's session, against a path the stored page config chose — is
 * a confused deputy. So Send does exactly two things:
 *   1. reveals the response pane, rendering the CANNED body from the bound
 *      payload (annex: "simulated/real Send with latency"; simulated is what
 *      this implements, and `sandboxMode` defaults true);
 *   2. for a WRITE method, emits a `mutate` intent describing the composed
 *      request, which the host executes through the CRUD API with its
 *      permission checks, undo and audit — the same contract every editing
 *      widget follows (04 §2.1). A GET has nothing to mutate and emits nothing.
 * Unbound → no intent either way; the pane still previews, which is the whole
 * point of a playground.
 *
 * SYNTAX HIGHLIGHTING is out of scope (see `code-snippet-block`): the response
 * is a mono block, not a tokenized one. The status pill and the latency carry
 * the signal a reader actually scans for.
 *
 * DIRECTION: the response body is a fixed-LTR island — it is CODE. JSON is
 * left-to-right in every locale, so the pane sets `dir="ltr"` explicitly rather
 * than inheriting an RTL page's direction, which would scatter braces and
 * punctuation to the wrong ends of each line (10-i18n-theming.md §5.5). The
 * chrome around it — labels, params, the Send button — mirrors normally.
 */

export { apiPlaygroundConfigSchema, apiPlaygroundDemoData };
export type { ApiPlaygroundConfig };

export interface ApiPlaygroundViewProps {
  endpoint: PlaygroundEndpoint;
  paradigm?: 'REST' | 'GraphQL' | undefined;
  locale?: string | undefined;
  sendLabel?: string | undefined;
  requestLabel?: string | undefined;
  responseLabel?: string | undefined;
  paramsLabel?: string | undefined;
  responsePlaceholder?: string | undefined;
  /** Called on Send with the composed params (a write method only). */
  onSend?: ((values: Record<string, string>) => void) | undefined;
  testId?: string | undefined;
}

/** Write methods carry a body the host could actually execute. */
const WRITE_INTENT: Partial<Record<HttpMethod, 'insert' | 'update' | 'delete'>> = {
  POST: 'insert',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
};

/** Stable pretty-print for the canned body. */
function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    // A payload with a cycle (or a BigInt) must not take the widget down.
    return String(value);
  }
}

export function ApiPlaygroundView({
  endpoint,
  paradigm = 'REST',
  locale,
  sendLabel,
  requestLabel,
  responseLabel,
  paramsLabel,
  responsePlaceholder,
  onSend,
  testId,
}: ApiPlaygroundViewProps) {
  const t = useMaybeT();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(endpoint.params.map((param) => [param.key, param.value])),
  );
  const [sent, setSent] = useState(false);

  const statusTone = endpoint.status >= 500 ? 'danger' : endpoint.status >= 400 ? 'warn' : 'pos';
  const resolvedResponseLabel = responseLabel ?? t('ui:widgets.domain.apiPlayground.responseLabel', 'Response');

  return (
    <div
      data-widget="api-playground"
      data-testid={testId}
      data-paradigm={paradigm}
      className="flex h-full flex-col gap-3 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <section className="flex flex-col gap-2" aria-label={requestLabel ?? t('ui:widgets.domain.apiPlayground.requestLabel', 'Request')}>
        <div className="flex items-center gap-2">
          <Tag mono tone={METHOD_TONE[endpoint.method]} data-part="playground-method">
            {endpoint.method}
          </Tag>
          {/* The path is a URL — an LTR island for the same reason as the body. */}
          <MonoText dir="ltr" className="min-w-0 flex-1 truncate text-body-sm text-fg" data-part="playground-path">
            {endpoint.path}
          </MonoText>
          <Button
            size="sm"
            iconLeft={<Play className="size-3.5" />}
            data-part="playground-send"
            onClick={() => {
              setSent(true);
              onSend?.(values);
            }}
          >
            {sendLabel ?? t('ui:widgets.domain.apiPlayground.sendLabel', 'Send')}
          </Button>
        </div>

        {endpoint.params.length === 0 ? null : (
          <div className="flex flex-col gap-1.5">
            <p className="text-caption font-semibold text-fg-subtle">{paramsLabel ?? t('ui:widgets.domain.apiPlayground.paramsLabel', 'Parameters')}</p>
            {endpoint.params.map((param) => (
              <label key={param.key} className="flex items-center gap-2" data-part="playground-param">
                <MonoText className="w-28 shrink-0 truncate text-caption text-fg-muted">{param.key}</MonoText>
                <Input
                  mono
                  value={values[param.key] ?? ''}
                  data-param={param.key}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [param.key]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-1.5" aria-label={resolvedResponseLabel}>
        <div className="flex items-center gap-2">
          <p className="text-caption font-semibold text-fg-subtle">{resolvedResponseLabel}</p>
          {!sent ? null : (
            <>
              <Badge tone={statusTone} dot data-part="playground-status">
                {String(endpoint.status)}
              </Badge>
              <MonoText className="text-caption text-fg-subtle" data-part="playground-latency">
                {formatMs(endpoint.latencyMs, locale)}
              </MonoText>
            </>
          )}
        </div>
        <div
          dir="ltr"
          data-testid="playground-response"
          className="min-h-24 flex-1 overflow-auto rounded-lg bg-fg p-3"
        >
          {sent ? (
            <MonoText asChild>
              <pre className="whitespace-pre-wrap break-words text-caption text-bg">{prettyJson(endpoint.sample)}</pre>
            </MonoText>
          ) : (
            <p className="text-caption text-bg/60">
              {responsePlaceholder ?? t('ui:widgets.domain.apiPlayground.responsePlaceholder', 'Send the request to see the response.')}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

/** Project the bound `record` onto the endpoint model. */
function endpointOf(config: ApiPlaygroundConfig, data: unknown): PlaygroundEndpoint | null {
  const row = opsRowOf(data);
  if (row === null) return null;
  const rawParams = row[config.paramsField];
  const params: { key: string; value: string }[] = [];
  if (Array.isArray(rawParams)) {
    for (const entry of rawParams) {
      const param = asRecord(entry);
      if (param === null || typeof param.key !== 'string') continue;
      params.push({ key: param.key, value: param.value === undefined ? '' : String(param.value) });
    }
  }
  return {
    method: httpMethodOf(row[config.methodField]),
    path: labelField(row, config.pathField, '/'),
    params,
    sample: row[config.sampleField] ?? null,
    status: countField(row, config.statusField, 200),
    latencyMs: countField(row, config.latencyField, 0),
  };
}

export function ApiPlaygroundWidget({ config, data, onEvent }: WidgetProps<ApiPlaygroundConfig>) {
  const t = useMaybeT();
  const endpoint = useMemo(() => endpointOf(config, data), [config, data]);
  const source = useMemo(() => opsBindingSourceOf(config.binding), [config.binding]);

  if (endpoint === null) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.apiPlayground.emptyTitle', 'No endpoint selected')}
        body={config.emptyBody ?? t('ui:widgets.domain.apiPlayground.emptyBody', 'Pick an endpoint to compose a request against it.')}
      />
    );
  }

  const intent = WRITE_INTENT[endpoint.method];

  return (
    <ApiPlaygroundView
      endpoint={endpoint}
      paradigm={config.paradigm}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.sendLabel === undefined ? {} : { sendLabel: config.sendLabel })}
      {...(config.requestLabel === undefined ? {} : { requestLabel: config.requestLabel })}
      {...(config.responseLabel === undefined ? {} : { responseLabel: config.responseLabel })}
      {...(config.paramsLabel === undefined ? {} : { paramsLabel: config.paramsLabel })}
      {...(config.responsePlaceholder === undefined ? {} : { responsePlaceholder: config.responsePlaceholder })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      // See the header note: a GET emits nothing (there is nothing to mutate),
      // an unbound widget emits nothing (there is nowhere to send it).
      {...(source === null || intent === undefined
        ? {}
        : {
            onSend: (values: Record<string, string>) => {
              void onEvent({
                type: 'mutate',
                intent,
                connectionId: source.connectionId,
                table: source.table,
                values,
              });
            },
          })}
    />
  );
}
