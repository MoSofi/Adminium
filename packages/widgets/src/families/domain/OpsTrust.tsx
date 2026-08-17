import { Avatar, Badge, IconButton, MonoText, Switch, Tag } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Check, Copy, Quote } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ipAllowlistCardConfigSchema,
  ipAllowlistCardDemoData,
  policyListConfigSchema,
  policyListDemoData,
  testimonialCardConfigSchema,
  testimonialCardDemoData,
  trustBadgesConfigSchema,
  trustBadgesDemoData,
} from './domain-ops-config.js';
import type {
  IpAllowlistCardConfig,
  PolicyListConfig,
  TestimonialCardConfig,
  TrustBadgesConfig,
} from './domain-ops-config.js';
import {
  booleanField,
  labelField,
  opsBindingSourceOf,
  opsRowOf,
  opsRowsOf,
} from './domain-ops-lib.js';
import type { RlsPolicy, Testimonial } from './domain-ops-types.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetProps } from '../../registry/types.js';

export {
  ipAllowlistCardConfigSchema,
  ipAllowlistCardDemoData,
  policyListConfigSchema,
  policyListDemoData,
  testimonialCardConfigSchema,
  testimonialCardDemoData,
  trustBadgesConfigSchema,
  trustBadgesDemoData,
};
export type { IpAllowlistCardConfig, PolicyListConfig, TestimonialCardConfig, TrustBadgesConfig };

/**
 * TRACK OPS — the ACCESS/ASSURANCE half of the annex §13 ops cards, grouped in
 * one module because all four are read-mostly statements about who may do what,
 * and three of them share the same tiny list-of-claims shape:
 *
 *   `policy-list`, `ip-allowlist-card`, `trust-badges`, `testimonial-card`.
 *
 * NEVER WRITES: `policy-list`'s enable toggle emits a `mutate` intent the host
 * runs through the CRUD API with undo + audit (04 §2.1) — disabling an RLS
 * policy is exactly the kind of change that must be audited and reversible, so
 * the widget describes the intent and the host owns the consequence. Unbound →
 * the toggle renders read-only rather than lying about a state it cannot persist.
 *
 * `testimonial-card` / `trust-badges` are the marketing pair (annex: "Kept for
 * adminium.dev landing/marketplace pages"): presentational, no intents, no
 * writes.
 */

// ── policy-list ─────────────────────────────────────────────────────────────

/**
 * SQL command → tone. Read is informational; the mutating commands escalate, and
 * `ALL` is the widest grant there is, so it reads danger — a policy list where
 * "ALL" looked as calm as "SELECT" would bury the one row most worth noticing.
 */
const CMD_TONE: Record<string, Tone> = {
  SELECT: 'info',
  INSERT: 'pos',
  UPDATE: 'warn',
  DELETE: 'danger',
  ALL: 'danger',
};

export interface PolicyListViewProps {
  policies: readonly RlsPolicy[];
  enableLabel?: string | undefined;
  onToggle?: ((policy: RlsPolicy, enabled: boolean) => void) | undefined;
  testId?: string | undefined;
}

export function PolicyListView({ policies, enableLabel, onToggle, testId }: PolicyListViewProps) {
  return (
    <ul
      data-widget="policy-list"
      data-testid={testId}
      className="flex h-full flex-col gap-1.5 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      {policies.map((policy) => (
        <li
          key={policy.id}
          data-part="policy-row"
          data-enabled={policy.enabled ? '' : undefined}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2.5"
        >
          <div className={`flex min-w-0 flex-1 items-center gap-2 ${policy.enabled ? '' : 'opacity-50'}`}>
            <Tag mono tone={CMD_TONE[policy.cmd] ?? 'neutral'} className="shrink-0" data-part="policy-cmd">
              {policy.cmd}
            </Tag>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm text-fg" data-part="policy-name">
                {policy.name}
              </p>
              <MonoText className="block truncate text-caption text-fg-subtle" data-part="policy-role">
                {policy.role}
              </MonoText>
            </div>
          </div>
          <Switch
            data-part="policy-toggle"
            checked={policy.enabled}
            aria-label={enableLabel ?? policy.name}
            className="shrink-0"
            {...(onToggle === undefined
              ? { disabled: true }
              : { onCheckedChange: (checked: boolean) => onToggle(policy, checked) })}
          />
        </li>
      ))}
    </ul>
  );
}

/** Project the bound `record-list` onto the policy model. */
function policiesOf(config: PolicyListConfig, data: unknown): RlsPolicy[] {
  return opsRowsOf(data).map((row, index) => ({
    id: labelField(row, config.idField, `p${index}`),
    name: labelField(row, config.nameField, ''),
    // Uppercased so a pg catalog's lowercase `cmd` still hits the tone map — the
    // vocabulary is SQL's, and SQL commands are conventionally upper-cased here.
    cmd: labelField(row, config.cmdField, '').toUpperCase(),
    role: labelField(row, config.roleField, ''),
    enabled: booleanField(row, config.enabledField) ?? false,
  }));
}

export function PolicyListWidget({ config, data, onEvent }: WidgetProps<PolicyListConfig>) {
  const t = useMaybeT();
  const policies = useMemo(() => policiesOf(config, data), [config, data]);
  const source = useMemo(() => opsBindingSourceOf(config.binding), [config.binding]);

  if (policies.length === 0) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.policyList.emptyTitle', 'No policies')}
        body={config.emptyBody ?? t('ui:widgets.domain.policyList.emptyBody', 'This table has no row-level security policies yet.')}
      />
    );
  }

  return (
    <PolicyListView
      policies={policies}
      {...(config.enableLabel === undefined ? {} : { enableLabel: config.enableLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(source === null
        ? {}
        : {
            onToggle: (policy: RlsPolicy, enabled: boolean) =>
              void onEvent({
                type: 'mutate',
                intent: 'update',
                connectionId: source.connectionId,
                table: source.table,
                recordId: policy.id,
                values: { [config.enabledField]: enabled },
              }),
          })}
    />
  );
}

// ── ip-allowlist-card ───────────────────────────────────────────────────────

/** One egress IP row, post-projection. */
export interface AllowlistEntry {
  ip: string;
  label?: string | undefined;
}

export interface IpAllowlistCardViewProps {
  entries: readonly AllowlistEntry[];
  /** Ms the "Copied ✓" confirmation stays up (annex pins 1.4s). */
  copyResetMs?: number | undefined;
  copyLabel?: string | undefined;
  copiedLabel?: string | undefined;
  testId?: string | undefined;
}

export function IpAllowlistCardView({
  entries,
  copyResetMs = 1400,
  copyLabel,
  copiedLabel,
  testId,
}: IpAllowlistCardViewProps) {
  const t = useMaybeT();
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * The annex's "Copy → 'Copied ✓' (1.4s)". `navigator.clipboard` is undefined
   * under plain HTTP and in happy-dom, so the write is optional-chained and the
   * confirmation is driven by our own state either way — the button stays honest
   * rather than throwing. Copying a SECOND row restarts the window instead of
   * inheriting the first row's timer.
   */
  const copy = (ip: string): void => {
    void globalThis.navigator?.clipboard?.writeText?.(ip)?.catch?.(() => {});
    setCopied(ip);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), copyResetMs);
  };

  return (
    <ul
      data-widget="ip-allowlist-card"
      data-testid={testId}
      className="flex h-full flex-col gap-1 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      {entries.map((entry) => (
        <li
          key={entry.ip}
          data-part="allowlist-row"
          className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5"
        >
          {/*
            An IPv4/IPv6 literal is an LTR ISLAND (10-i18n-theming.md §5.5): it is
            a dotted numeric address, not prose, and letting it reorder under an
            RTL page would render an address that does not resolve.
          */}
          <MonoText dir="ltr" className="min-w-0 flex-1 truncate text-caption text-fg" data-part="allowlist-ip">
            {entry.ip}
          </MonoText>
          {entry.label === undefined ? null : (
            <Badge tone="neutral" className="shrink-0" data-part="allowlist-label">
              {entry.label}
            </Badge>
          )}
          <IconButton
            size="sm"
            variant="ghost"
            className="shrink-0"
            data-part="allowlist-copy"
            label={
              copied === entry.ip
                ? (copiedLabel ?? t('ui:widgets.domain.ipAllowlistCard.copiedLabel', 'Copied'))
                : (copyLabel ?? t('ui:widgets.domain.ipAllowlistCard.copyLabel', 'Copy'))
            }
            onClick={() => copy(entry.ip)}
          >
            {copied === entry.ip ? <Check className="size-3.5 text-pos" /> : <Copy className="size-3.5" />}
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

export function IpAllowlistCardWidget({ config, data }: WidgetProps<IpAllowlistCardConfig>) {
  const t = useMaybeT();
  const entries = useMemo(
    () =>
      opsRowsOf(data)
        .map((row) => ({
          ip: labelField(row, config.ipField, ''),
          label: row[config.labelFieldName] === undefined ? undefined : labelField(row, config.labelFieldName, ''),
        }))
        // An allowlist row with no address is not a row — it is a copy button
        // that would put an empty string on the clipboard.
        .filter((entry) => entry.ip !== ''),
    [config, data],
  );

  if (entries.length === 0) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.ipAllowlistCard.emptyTitle', 'No egress IPs')}
        body={config.emptyBody ?? t('ui:widgets.domain.ipAllowlistCard.emptyBody', 'Egress addresses appear here once the connection is provisioned.')}
      />
    );
  }

  return (
    <IpAllowlistCardView
      entries={entries}
      copyResetMs={config.copyResetMs}
      {...(config.copyLabel === undefined ? {} : { copyLabel: config.copyLabel })}
      {...(config.copiedLabel === undefined ? {} : { copiedLabel: config.copiedLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}

// ── trust-badges ────────────────────────────────────────────────────────────

export interface TrustBadgesViewProps {
  badges: readonly string[];
  testId?: string | undefined;
}

export function TrustBadgesView({ badges, testId }: TrustBadgesViewProps) {
  return (
    <ul
      data-widget="trust-badges"
      data-testid={testId}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-[var(--widget-pad)] pb-[var(--widget-pad)] text-caption text-fg-muted"
    >
      {badges.map((badge, index) => (
        <li key={badge} className="flex items-center gap-2" data-part="trust-badge">
          {/*
            The annex's "dot-separated compliance claims row". The separator is
            `aria-hidden` and rides BEFORE each item after the first: a `·`
            announced between every claim is noise, and a CSS `::before` would put
            the same character beyond the reach of the a11y tree either way.
            Using flex + a real element keeps it mirroring correctly under RTL,
            where the dot must sit on the other side.
          */}
          {index === 0 ? null : (
            <span aria-hidden="true" className="text-fg-subtle">
              ·
            </span>
          )}
          <span>{badge}</span>
        </li>
      ))}
    </ul>
  );
}

export function TrustBadgesWidget({ config, data }: WidgetProps<TrustBadgesConfig>) {
  const t = useMaybeT();
  /*
    Host-supplied `badges` render INSTEAD of the bound rows (the schema's
    contract) — a marketing page states its own claims in config rather than
    binding a table for five strings.
  */
  const badges = useMemo(
    () =>
      config.badges ??
      opsRowsOf(data)
        .map((row) => labelField(row, config.labelFieldName, ''))
        .filter((label) => label !== ''),
    [config.badges, config.labelFieldName, data],
  );

  if (badges.length === 0) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.trustBadges.emptyTitle', 'No badges')}
        body={config.emptyBody ?? t('ui:widgets.domain.trustBadges.emptyBody', 'Add compliance claims in config or bind a badges table.')}
      />
    );
  }

  return (
    <TrustBadgesView badges={badges} {...(config.testId === undefined ? {} : { testId: config.testId })} />
  );
}

// ── testimonial-card ────────────────────────────────────────────────────────

export interface TestimonialCardViewProps {
  testimonial: Testimonial;
  locale?: string | undefined;
  testId?: string | undefined;
}

export function TestimonialCardView({ testimonial, locale, testId }: TestimonialCardViewProps) {
  const attribution = [testimonial.role, testimonial.company].filter((part) => part !== undefined && part !== '');

  return (
    <figure
      data-widget="testimonial-card"
      data-testid={testId}
      className="flex h-full flex-col gap-3 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <Quote aria-hidden="true" className="size-5 shrink-0 text-accent opacity-60" />
      <blockquote className="flex-1 text-body-sm leading-relaxed text-fg" data-part="testimonial-quote">
        {testimonial.quote}
      </blockquote>
      <figcaption className="flex items-center gap-2.5">
        {/*
          `Avatar` derives the initials AND the deterministic gradient from
          `name`, so the annex's "gradient avatar" needs no color config. An
          explicit `initials` override is honoured by passing it as the name the
          initials come from — but the label stays the real name, so the
          accessible name never degrades to two letters.
        */}
        <Avatar
          size="sm"
          name={testimonial.initials ?? testimonial.name}
          label={testimonial.name}
          data-part="testimonial-avatar"
          {...(locale === undefined ? {} : { locale })}
        />
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold text-fg" data-part="testimonial-name">
            {testimonial.name}
          </p>
          {attribution.length === 0 ? null : (
            <p className="truncate text-caption text-fg-subtle" data-part="testimonial-attribution">
              {attribution.join(' · ')}
            </p>
          )}
        </div>
      </figcaption>
    </figure>
  );
}

export function TestimonialCardWidget({ config, data }: WidgetProps<TestimonialCardConfig>) {
  const t = useMaybeT();
  const testimonial = useMemo((): Testimonial | null => {
    const row = opsRowOf(data);
    if (row === null) return null;
    const quote = labelField(row, config.quoteField, '');
    // A testimonial with no quote is not a testimonial — it is an avatar and a
    // name, which says nothing. Empty-state instead.
    if (quote === '') return null;
    return {
      quote,
      name: labelField(row, config.nameField, ''),
      role: row[config.roleField] === undefined ? undefined : labelField(row, config.roleField, ''),
      company: row[config.companyField] === undefined ? undefined : labelField(row, config.companyField, ''),
      initials: row[config.initialsField] === undefined ? undefined : labelField(row, config.initialsField, ''),
    };
  }, [config, data]);

  if (testimonial === null) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.testimonialCard.emptyTitle', 'No testimonial')}
        body={config.emptyBody ?? t('ui:widgets.domain.testimonialCard.emptyBody', 'Bind a quote row to show a customer testimonial.')}
      />
    );
  }

  return (
    <TestimonialCardView
      testimonial={testimonial}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
