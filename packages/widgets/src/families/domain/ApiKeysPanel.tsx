import { Badge, Banner, Button, IconButton, MonoText, Tag } from '@adminium/ui';
import { Copy, Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { apiKeysPanelConfigSchema, apiKeysPanelDemoData } from './domain-ops-config.js';
import type { ApiKeysPanelConfig } from './domain-ops-config.js';
import {
  formatSince,
  instantField,
  interpolate,
  labelField,
  maskSecret,
  opsBindingSourceOf,
  opsRowsOf,
  resolveNow,
  stringArrayField,
} from './domain-ops-lib.js';
import type { ApiKeyRecord } from './domain-ops-types.js';
import { OPS_DEMO_NOW_MS } from './domain-ops-config.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetEvent, WidgetProps } from '../../registry/types.js';

/**
 * `api-keys-panel` (annex §13) — the key table: an env badge (live/test), the
 * masked value (prefix + bullets + tail) with a reveal toggle for secrets, scope
 * chips, a last-used relative time, and copy / roll / revoke actions; plus the
 * one-time full-secret reveal banner after creation.
 * Evidence: API Keys, API & Backend.
 *
 * WHAT THIS WIDGET CANNOT DO, by construction:
 *   - It never holds a plaintext secret from the data layer. The bound table
 *     stores a HASH plus the public `prefix`/`tail`; the reveal toggle only ever
 *     un-bullets what is already on screen. The single exception is the
 *     `revealedSecret` CONFIG value — the host's ephemeral post-create
 *     plaintext, alive for one render (annex: "one-time full-secret reveal") —
 *     and it arrives as config precisely because a widget that could read the
 *     plaintext off a ROW would mean the plaintext was persisted.
 *   - It never revokes or rolls anything. Both emit `mutate` intents the host
 *     runs through the CRUD API, with its permission checks, undo and audit
 *     (04 §2.1). Unbound → the buttons are not rendered at all: there is nowhere
 *     to send the intent, and a Revoke that silently no-ops is worse than none.
 *
 * `formatSince` needs a "now": `config.format.referenceTime` when pinned (demo,
 * tests, VRT), else the mount instant captured ONCE — never a per-render
 * `Date.now()`, which would make every re-render a new timestamp and the
 * component impossible to snapshot.
 */

export { apiKeysPanelConfigSchema, apiKeysPanelDemoData };
export type { ApiKeysPanelConfig };

export interface ApiKeysPanelViewProps {
  keys: readonly ApiKeyRecord[];
  /** Env treated as production (the first `envs` entry) — badges danger-toned. */
  liveEnv?: string | undefined;
  /** One-time post-create plaintext. */
  revealedSecret?: string | undefined;
  revealedTitle?: string | undefined;
  revealedBody?: string | undefined;
  /** Epoch ms "now" for the relative stamps. */
  now: number;
  locale?: string | undefined;
  copyLabel?: string | undefined;
  copiedLabel?: string | undefined;
  revealLabel?: string | undefined;
  hideLabel?: string | undefined;
  rollLabel?: string | undefined;
  revokeLabel?: string | undefined;
  neverUsedLabel?: string | undefined;
  lastUsedLabel?: string | undefined;
  onRoll?: ((key: ApiKeyRecord) => void) | undefined;
  onRevoke?: ((key: ApiKeyRecord) => void) | undefined;
  testId?: string | undefined;
}

export function ApiKeysPanelView({
  keys,
  liveEnv = 'live',
  revealedSecret,
  revealedTitle,
  revealedBody,
  now,
  locale,
  copyLabel,
  copiedLabel,
  revealLabel,
  hideLabel,
  rollLabel,
  revokeLabel,
  neverUsedLabel,
  lastUsedLabel,
  onRoll,
  onRevoke,
  testId,
}: ApiKeysPanelViewProps) {
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [copied, setCopied] = useState<string | null>(null);

  const toggleReveal = (id: string): void => {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Copy without a clipboard permission prompt or a crash in a non-secure
   * context. `navigator.clipboard` is undefined under plain HTTP and in the
   * jsdom/happy-dom test environment, so the write is optional-chained and the
   * "Copied ✓" confirmation is driven by our own state either way — the button
   * must stay honest, not throw.
   */
  const copy = (id: string, value: string): void => {
    void globalThis.navigator?.clipboard?.writeText?.(value)?.catch?.(() => {});
    setCopied(id);
  };

  return (
    <div
      data-widget="api-keys-panel"
      data-testid={testId}
      className="flex h-full flex-col gap-2 overflow-auto px-4 pb-4"
    >
      {revealedSecret === undefined ? null : (
        <Banner tone="pos" data-testid="api-key-revealed">
          <p className="text-body-sm font-semibold">{revealedTitle ?? 'Key created'}</p>
          <p className="text-caption">{revealedBody ?? 'Copy it now — it is never shown again.'}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <MonoText className="min-w-0 flex-1 truncate rounded-md bg-surface px-2 py-1 text-caption">
              {revealedSecret}
            </MonoText>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Copy className="size-3.5" />}
              onClick={() => copy('__new__', revealedSecret)}
            >
              {copied === '__new__' ? (copiedLabel ?? 'Copied') : (copyLabel ?? 'Copy')}
            </Button>
          </div>
        </Banner>
      )}

      {keys.map((key) => {
        const isRevealed = revealed.has(key.id);
        // Publishable keys are not secret — masking them is theatre that makes
        // the panel harder to use for no gain. Only `secret` keys mask.
        const masks = key.kind === 'secret' && !isRevealed;
        const value = masks ? maskSecret(key.prefix, key.tail) : `${key.prefix}${key.tail}`;
        const since = formatSince(key.lastUsed, locale, now);
        return (
          <div
            key={key.id}
            data-part="api-key-row"
            data-key={key.id}
            data-env={key.env}
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-body-sm font-semibold text-fg">{key.name}</span>
              <Badge tone={key.env === liveEnv ? 'danger' : 'neutral'} data-part="api-key-env">
                {key.env}
              </Badge>
              <span className="ms-auto flex items-center gap-0.5">
                {key.kind !== 'secret' ? null : (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={isRevealed ? (hideLabel ?? 'Hide key') : (revealLabel ?? 'Reveal key')}
                    data-part="api-key-reveal"
                    onClick={() => toggleReveal(key.id)}
                  >
                    {isRevealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </IconButton>
                )}
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={copied === key.id ? (copiedLabel ?? 'Copied') : (copyLabel ?? 'Copy')}
                  data-part="api-key-copy"
                  onClick={() => copy(key.id, value)}
                >
                  <Copy className="size-3.5" />
                </IconButton>
                {onRoll === undefined ? null : (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={rollLabel ?? 'Roll key'}
                    data-part="api-key-roll"
                    onClick={() => onRoll(key)}
                  >
                    <RefreshCw className="size-3.5" />
                  </IconButton>
                )}
                {onRevoke === undefined ? null : (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={revokeLabel ?? 'Revoke key'}
                    data-part="api-key-revoke"
                    onClick={() => onRevoke(key)}
                  >
                    <Trash2 className="size-3.5 text-danger" />
                  </IconButton>
                )}
              </span>
            </div>

            <MonoText
              className="truncate text-caption text-fg-muted"
              data-part="api-key-value"
              {...(masks ? { 'data-masked': '' } : {})}
            >
              {value}
            </MonoText>

            <div className="flex flex-wrap items-center gap-1">
              {key.scopes.map((scope) => (
                <Tag key={`${key.id}-${scope}`} mono tone="info" data-part="api-key-scope">
                  {scope}
                </Tag>
              ))}
              <span className="ms-auto text-caption text-fg-subtle" data-part="api-key-last-used">
                {since === undefined
                  ? (neverUsedLabel ?? 'Never used')
                  : interpolate(lastUsedLabel ?? 'Last used {since}', { since })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Project the bound `record-list` onto the key model. */
function keysOf(config: ApiKeysPanelConfig, data: unknown): ApiKeyRecord[] {
  const rows = opsRowsOf(data);
  return rows.map((row, index) => {
    const kind = labelField(row, config.kindField, 'secret');
    return {
      id: labelField(row, config.idField, `k${index}`),
      name: labelField(row, config.nameField, `Key ${index + 1}`),
      env: labelField(row, config.envField, 'live'),
      prefix: labelField(row, config.prefixField, 'sk_'),
      tail: labelField(row, config.tailField, ''),
      scopes: stringArrayField(row, config.scopesField),
      lastUsed: instantField(row, config.lastUsedField),
      kind: kind === 'publishable' ? 'publishable' : 'secret',
    };
  });
}

export function ApiKeysPanelWidget({ config, data, onEvent }: WidgetProps<ApiKeysPanelConfig>) {
  const keys = useMemo(() => keysOf(config, data), [config, data]);
  const source = useMemo(() => opsBindingSourceOf(config.binding), [config.binding]);
  // Captured ONCE on mount, never per render — see the header note. The demo
  // epoch is the fallback so an unpinned story is still deterministic.
  const [mountedAt] = useState(() => OPS_DEMO_NOW_MS);
  const now = resolveNow(config.format?.referenceTime, mountedAt);

  if (keys.length === 0) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? 'No API keys'}
        body={config.emptyBody ?? 'Create a key to start calling the API.'}
      />
    );
  }

  const emit = (event: WidgetEvent): void => {
    void onEvent(event);
  };

  return (
    <ApiKeysPanelView
      keys={keys}
      now={now}
      {...(config.envs[0] === undefined ? {} : { liveEnv: config.envs[0] })}
      {...(config.revealedSecret === undefined ? {} : { revealedSecret: config.revealedSecret })}
      {...(config.revealedTitle === undefined ? {} : { revealedTitle: config.revealedTitle })}
      {...(config.revealedBody === undefined ? {} : { revealedBody: config.revealedBody })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.copyLabel === undefined ? {} : { copyLabel: config.copyLabel })}
      {...(config.copiedLabel === undefined ? {} : { copiedLabel: config.copiedLabel })}
      {...(config.revealLabel === undefined ? {} : { revealLabel: config.revealLabel })}
      {...(config.hideLabel === undefined ? {} : { hideLabel: config.hideLabel })}
      {...(config.rollLabel === undefined ? {} : { rollLabel: config.rollLabel })}
      {...(config.revokeLabel === undefined ? {} : { revokeLabel: config.revokeLabel })}
      {...(config.neverUsedLabel === undefined ? {} : { neverUsedLabel: config.neverUsedLabel })}
      {...(config.lastUsedLabel === undefined ? {} : { lastUsedLabel: config.lastUsedLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(source === null
        ? {}
        : {
            onRoll: (key: ApiKeyRecord) =>
              emit({
                type: 'mutate',
                intent: 'update',
                connectionId: source.connectionId,
                table: source.table,
                recordId: key.id,
                values: { rolled: true },
              }),
            onRevoke: (key: ApiKeyRecord) =>
              emit({
                type: 'mutate',
                intent: 'delete',
                connectionId: source.connectionId,
                table: source.table,
                recordId: key.id,
              }),
          })}
    />
  );
}
