// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rules column and the flow header (195-248, 470-500, 601-616).
 *
 * The KPI strip, the three filter pills, the rule cards and the flow's own
 * header, in the comp's geometry. Three things the comp draws that need a
 * word:
 *
 *  - **The delta pills** (200). They are computed from the runs history
 *    (D22); FILL F7 hides one when the previous period has no data, because
 *    "+100%" against nothing is not a fact.
 *  - **"saves 3m / run"** (241). Nothing in the product knows minutes, so
 *    FILL F6 makes it an optional number on the trigger, and the segment
 *    disappears when nobody has typed one. A workspace that never does sees
 *    "—" in the KPI. That is the truth, not a bug.
 *  - **The rule ICON** (330-345). The comp gives each rule a hand-picked
 *    glyph and no picker. FILL F2 derives it from the trigger kind, which is
 *    the only thing about a rule the product can read.
 */

import {
  AutosaveIndicator,
  DeltaPill,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
} from '@adminium/ui';
import type { ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import { automationIcon } from '../icons.js';
import type { RuleView } from '../api.js';
import { formatRelative } from '../logs/parts.js';

// --- the KPI strip (comp 195-206, 470-477) ---------------------------------

export interface RulesKpi {
  icon: string;
  label: string;
  value: string;
  /** Formatted delta, or null when the previous period has no data (F7). */
  delta: string | null;
  up: boolean;
}

export function RulesKpiStrip({ kpis }: { kpis: readonly RulesKpi[] }): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="rules-kpis">
      {kpis.map((kpi) => {
        const Icon = automationIcon(kpi.icon);
        return (
          <div key={kpi.label} className="rounded-[14px] border border-border bg-surface p-[18px] shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex size-[34px] items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                <Icon aria-hidden className="size-[17px]" />
              </div>
              {kpi.delta === null ? null : (
                <DeltaPill trend={kpi.up ? 'up' : 'down'}>{kpi.delta}</DeltaPill>
              )}
            </div>
            <div className="font-mono text-2xl font-extrabold tracking-[-0.03em]">{kpi.value}</div>
            <div className="mt-[3px] text-[12.5px] text-fg-muted">{kpi.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// --- one rule card (comp 217-233, 489-500) ---------------------------------

/** FILL F2 — the icon a rule gets, derived from what fires it. */
export function ruleIcon(rule: RuleView): string {
  if (rule.trigger.kind === 'schedule') return 'clock';
  return rule.trigger.event === 'deleted' ? 'circle-x' : 'zap';
}

export function RuleCard({
  rule,
  selected,
  triggerLine,
  onSelect,
  onToggle,
  now,
  owner,
}: {
  rule: RuleView;
  selected: boolean;
  triggerLine: string;
  onSelect: () => void;
  onToggle: () => void;
  now: number;
  /** The app or add-on the rule came with, shown as a chip; and whether the owner has changed it since. */
  owner?: { name: string; edited: boolean } | undefined;
}): ReactNode {
  const Icon = automationIcon(ruleIcon(rule));
  const Zap = automationIcon('zap');
  const rate = rule.stats.successRate30d;
  const percent = rate === null ? '—' : `${Math.round(rate * 100)}%`;
  const rateClass =
    rate === null ? 'text-fg-subtle' : rate >= 0.9 ? 'text-pos' : rate >= 0.8 ? 'text-warn' : 'text-danger';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect();
      }}
      data-testid={`rule-card-${rule.id}`}
      className={`cursor-pointer rounded-[14px] border bg-surface px-4 py-[15px] ${
        selected ? 'border-accent ring-[3px] ring-accent/15' : 'border-border shadow-sm hover:border-border-strong'
      }`}
    >
      <div className="flex items-start gap-[11px]">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${
            rule.enabled ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-fg-subtle'
          }`}
        >
          <Icon aria-hidden className="size-[17px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold tracking-[-0.01em]">{rule.name}</div>
          <div className="mt-0.5 flex items-center gap-[5px] text-[11.5px] text-fg-muted">
            <Zap aria-hidden className="size-[11px]" />
            <span className="truncate">{triggerLine}</span>
          </div>
          {owner === undefined ? null : (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span data-part="rule-owner" className="rounded-full bg-surface-3 px-2 py-0.5 text-[10.5px] font-bold text-fg-muted">
                {owner.name}
              </span>
              {owner.edited ? (
                <span data-part="rule-edited" className="rounded-full bg-warn-soft-solid px-2 py-0.5 text-[10.5px] font-bold text-warn">
                  {t('automations:shipped.edited', 'Changed by you')}
                </span>
              ) : null}
            </div>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={t('automations:card.toggle', 'Toggle')}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          data-testid={`rule-toggle-${rule.id}`}
          className={`flex h-[21px] w-9 shrink-0 items-center rounded-full p-0.5 ${
            rule.enabled ? 'justify-end bg-accent' : 'justify-start bg-surface-3'
          }`}
        >
          <span className="block size-[17px] rounded-full bg-white shadow" />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3.5 border-t border-border pt-[11px]">
        <div className="flex items-center gap-[5px]">
          <span className="font-mono text-[13px] font-extrabold">{rule.stats.runs30d}</span>
          <span className="text-[10.5px] text-fg-subtle">{t('automations:card.runs', 'runs')}</span>
        </div>
        <div className="flex items-center gap-[5px]">
          <span className={`font-mono text-[13px] font-extrabold ${rateClass}`}>{percent}</span>
          <span className="text-[10.5px] text-fg-subtle">{t('automations:card.success', 'success')}</span>
        </div>
        <span className="ms-auto text-[10.5px] text-fg-subtle">
          {rule.stats.lastRunAt === null
            ? t('automations:card.never', 'Never run')
            : formatRelative(rule.stats.lastRunAt, now)}
        </span>
      </div>
    </div>
  );
}

export function RulesEmpty(): ReactNode {
  return (
    <EmptyState
      compact
      preset="no-data"
      title={t('automations:rules.empty.title', 'No rules yet')}
      body={t(
        'automations:rules.empty.body',
        'Create a rule to run steps automatically when something happens.',
      )}
    />
  );
}

// --- the flow header (comp 237-248, 601-616) -------------------------------

export interface FlowHeaderProps {
  rule: RuleView;
  stepCount: number;
  /** FILL F6 — the "saves" segment appears only when somebody typed minutes. */
  timeSaved: string | null;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  testing: boolean;
  onSave: () => void;
  onTest: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /**
   * The rule came with an app or an add-on: its flow is shown, not changed.
   * No save, no rename, no delete — a switch on its card, and a copy to edit.
   */
  shipped?: { owner: string; copying: boolean; onCopy: () => void } | undefined;
}

export function FlowHeader(props: FlowHeaderProps): ReactNode {
  const { rule } = props;
  const Play = automationIcon(props.testing ? 'loader' : 'play');
  const rate = rule.stats.successRate30d;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-[18px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[9px]">
          <span className="text-[15.5px] font-extrabold tracking-[-0.01em]">{rule.name}</span>
          <span
            className={`inline-flex items-center gap-[5px] rounded-full px-[9px] py-0.5 text-[10.5px] font-bold ${
              rule.enabled ? 'bg-pos-soft text-pos' : 'bg-surface-3 text-fg-muted'
            }`}
          >
            <span className={`size-1.5 rounded-full ${rule.enabled ? 'bg-pos' : 'bg-fg-subtle'}`} />
            {rule.enabled
              ? t('automations:status.active', 'Active')
              : t('automations:status.paused', 'Paused')}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-fg-subtle">
          {t('automations:flow.steps', '{count, plural, one {# step} other {# steps}}', {
            count: props.stepCount,
          })}
          {props.timeSaved === null
            ? ''
            : ` · ${t('automations:flow.saves', 'saves {time} / run', { time: props.timeSaved })}`}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-end">
          <div className="font-mono text-base font-extrabold">{rule.stats.runs30d}</div>
          <div className="text-[10px] uppercase tracking-[0.04em] text-fg-subtle">
            {t('automations:flow.runs30d', 'runs 30d')}
          </div>
        </div>
        <div className="text-end">
          <div className="font-mono text-base font-extrabold text-pos">
            {rate === null ? '—' : `${Math.round(rate * 100)}%`}
          </div>
          <div className="text-[10px] uppercase tracking-[0.04em] text-fg-subtle">
            {t('automations:flow.success', 'success')}
          </div>
        </div>

        {/* D11 — explicit save. The chip is the system's `AutosaveIndicator`
            re-labelled for it, the way the email and invoice editors label
            their own; the labels are namespace-local, which is why this is
            three lines here rather than a lifted component. */}
        {props.shipped === undefined ? null : (
          <button
            type="button"
            onClick={props.shipped.onCopy}
            disabled={props.shipped.copying}
            data-testid="rule-copy"
            className="rounded-[9px] border border-border bg-surface px-3.5 py-2 text-[12.5px] font-bold text-fg disabled:opacity-40"
          >
            {t('automations:shipped.copy', 'Edit a copy')}
          </button>
        )}
        {props.shipped !== undefined ? null : (
        <AutosaveIndicator
          status={props.saveError !== null ? 'error' : props.saving ? 'saving' : props.dirty ? 'dirty' : 'saved'}
          savingLabel={t('automations:save.saving', 'Saving…')}
          savedLabel={t('automations:save.saved', 'All changes saved')}
          dirtyLabel={t('automations:save.unsaved', 'Unsaved changes')}
          errorLabel={t('automations:save.unsaved', 'Unsaved changes')}
          data-testid="rule-save-chip"
        />
        )}
        {props.dirty && props.shipped === undefined ? (
          <button
            type="button"
            onClick={props.onSave}
            data-testid="rule-save"
            className="rounded-[9px] bg-accent px-3.5 py-2 text-[12.5px] font-bold text-accent-fg"
          >
            {t('automations:save.action', 'Save')}
          </button>
        ) : null}

        {props.shipped !== undefined ? null : (
          <RuleMenu
            onRename={props.onRename}
            onDuplicate={props.onDuplicate}
            onDelete={props.onDelete}
          />
        )}

        <button
          type="button"
          onClick={props.onTest}
          disabled={props.testing}
          data-testid="rule-test"
          className={`flex items-center gap-1.5 rounded-[9px] border px-[13px] py-2 text-[12.5px] font-bold ${
            props.testing
              ? 'border-transparent bg-accent-soft text-accent'
              : 'border-border bg-surface text-fg-muted'
          }`}
        >
          <Play aria-hidden className={`size-3.5 ${props.testing ? 'animate-spin' : ''}`} />
          {props.testing ? t('automations:flow.running', 'Running') : t('automations:flow.test', 'Test')}
        </button>
      </div>
    </div>
  );
}

/**
 * FILL F8 — the comp has no way to rename, duplicate or delete a rule. An
 * overflow menu in its own `DropdownMenu` anatomy, beside Test.
 */
function RuleMenu({
  onRename,
  onDuplicate,
  onDelete,
}: {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('automations:flow.menu', 'Rule actions')}
          data-testid="rule-menu"
          className="flex size-[34px] items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted"
        >
          ⋯
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>
          {t('automations:menu.rename', 'Rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>
          {t('automations:menu.duplicate', 'Duplicate')}
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={onDelete}>
          {t('automations:menu.delete', 'Delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- rules that came with an app or an add-on ------------------------------

/** The owner's own rules, and the ones an app or an add-on brought: listed apart, never mixed. */
export function splitShipped(all: readonly RuleView[]): { own: RuleView[]; shipped: RuleView[] } {
  const isShipped = (rule: RuleView): boolean => rule.managed !== null && rule.managed !== undefined;
  return { own: all.filter((rule) => !isShipped(rule)), shipped: all.filter(isShipped) };
}

/** The zone a rule by the clock runs in, said with its sentence: "Every day at 17:00 (Europe/Berlin)". */
export function withZone(sentence: string, trigger: RuleView['trigger']): string {
  if (trigger.kind !== 'schedule') return sentence;
  // "Every 15 minutes" has no clock, and so no zone.
  const zone = (trigger.schedule as { timezone?: string }).timezone;
  return zone === undefined || zone === '' ? sentence : `${sentence} (${zone})`;
}

/**
 * The rules an app or an add-on brought with it, apart from the owner's own:
 * one group per kind of owner, each rule with its owner's name, its schedule
 * with the zone it runs in, the same switch every rule has, and "Changed by
 * you" once it was. They are not in the main list, and nothing here deletes
 * one.
 */
export function ShippedRuleGroups({
  rules,
  selectedId,
  triggerLine,
  now,
  onSelect,
  onToggle,
}: {
  rules: readonly RuleView[];
  selectedId: string | null;
  triggerLine: (rule: RuleView) => string;
  now: number;
  onSelect: (rule: RuleView) => void;
  onToggle: (rule: RuleView) => void;
}): ReactNode {
  const groups = [
    { kind: 'add-on' as const, title: t('automations:shipped.addOns', 'From your add-ons') },
    { kind: 'app' as const, title: t('automations:shipped.apps', 'From your apps') },
  ];
  return (
    <>
      {groups.map((group) => {
        const mine = rules.filter((rule) => rule.managed?.kind === group.kind);
        if (mine.length === 0) return null;
        return (
          <section key={group.kind} aria-label={group.title} data-part={`rules-shipped-${group.kind}`} className="flex min-w-0 flex-col gap-3">
            <h3 className="mt-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-fg-subtle">{group.title}</h3>
            {mine.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                selected={rule.id === selectedId}
                triggerLine={withZone(triggerLine(rule), rule.trigger)}
                now={now}
                owner={{ name: rule.managed?.name ?? '', edited: rule.managed?.edited === true }}
                onSelect={() => onSelect(rule)}
                onToggle={() => onToggle(rule)}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}
