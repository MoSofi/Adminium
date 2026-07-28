import { Badge, Button, ProgressBar, Tag } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Check, FilePlus2 } from 'lucide-react';
import { useMemo } from 'react';

import {
  onboardingChecklistConfigSchema,
  onboardingChecklistDemoData,
  starterTemplatePickerConfigSchema,
  starterTemplatePickerDemoData,
} from './domain-ops-config.js';
import type { OnboardingChecklistConfig, StarterTemplatePickerConfig } from './domain-ops-config.js';
import {
  booleanField,
  countField,
  formatMinutes,
  formatPct,
  interpolate,
  labelField,
  numberArrayField,
  opsBindingSourceOf,
  opsRowsOf,
} from './domain-ops-lib.js';
import type { OnboardingTask, StarterDef } from './domain-ops-types.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetProps } from '../../registry/types.js';

export {
  onboardingChecklistConfigSchema,
  onboardingChecklistDemoData,
  starterTemplatePickerConfigSchema,
  starterTemplatePickerDemoData,
};
export type { OnboardingChecklistConfig, StarterTemplatePickerConfig };

/**
 * TRACK OPS — the GETTING-STARTED half of the annex §13 ops cards, grouped in
 * one module because both render a set of do-this-next cards over a progress
 * readout:
 *
 *   `starter-template-picker`, `onboarding-checklist`.
 *
 * `onboarding-checklist` IS NOT the app's checklist. apps/dashboard/src/onboarding
 * already ships a reactive checklist (M5-T06) wired to real workspace state, and
 * this widget deliberately shares NO code with it: `@adminium/widgets` must never
 * import `apps/*` — the dependency would invert the architecture (01 §2.3), and
 * `pnpm check-deps` enforces it. So this is built from the DATA CONTRACT (steps +
 * done flags) and stays presentational; the app's copy stays the app's. The two
 * are expected to converge later on the APP's side, by the app mounting this
 * widget — not by this widget reaching into the app.
 *
 * NEVER WRITES: ticking a step emits a `mutate` intent through `onEvent`; the CTA
 * emits `drill-through`. The host owns both (04 §2.1). Unbound → a step renders
 * as a read-only state rather than a checkbox that forgets what it was told.
 */

// ── starter-template-picker ─────────────────────────────────────────────────

/** Localized kicker copy per builder — the annex's per-`docType` thumbnail kicker. */
const DOC_KICKER: Record<string, string> = {
  invoice: 'Invoice',
  report: 'Report',
  email: 'Email',
};

export interface StarterTemplatePickerViewProps {
  starters: readonly StarterDef[];
  docType?: string | undefined;
  blankLabel?: string | undefined;
  onSelect?: ((starter: StarterDef) => void) | undefined;
  testId?: string | undefined;
}

/**
 * The thumbnail's mini chart (annex: "mini chart from actual series"). Pure divs
 * — no chart dependency for a 7-bar glyph in a picker tile — and `aria-hidden`,
 * because the tile's real title is right below it and seven announced bars would
 * be noise.
 */
function StarterThumb({ series }: { series: readonly number[] }) {
  // A flat-zero series would divide by zero; the denominator floors at 1 so the
  // strip renders flat rather than NaN-tall.
  const peak = Math.max(1, ...series);
  return (
    <div aria-hidden="true" className="flex h-10 items-end gap-0.5" data-part="starter-thumb">
      {series.map((value, index) => (
        <span
          key={`${index}-${value}`}
          className="h-[var(--bar-h)] min-w-px flex-1 rounded-xs bg-accent opacity-70"
          style={{ '--bar-h': `${Math.max(6, (value / peak) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function StarterTemplatePickerView({
  starters,
  docType,
  blankLabel,
  onSelect,
  testId,
}: StarterTemplatePickerViewProps) {
  const t = useMaybeT();
  const rawKicker = docType === undefined ? undefined : DOC_KICKER[docType];
  const kicker =
    docType === undefined || rawKicker === undefined
      ? undefined
      : t(`ui:widgets.domain.starterTemplatePicker.kicker.${docType}`, rawKicker);

  return (
    <ul
      data-widget="starter-template-picker"
      data-testid={testId}
      className="grid h-full grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 overflow-auto px-4 pb-4"
    >
      {starters.map((starter) => (
        <li key={starter.id}>
          <button
            type="button"
            data-part="starter-card"
            data-starter={starter.id}
            data-blank={starter.blank ? '' : undefined}
            disabled={onSelect === undefined}
            onClick={() => onSelect?.(starter)}
            className={`flex h-full w-full flex-col gap-2 rounded-lg p-2.5 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default ${
              starter.blank
                ? 'border-2 border-dashed border-border-strong text-fg-muted hover:border-accent hover:text-accent'
                : 'border border-border bg-surface-2 hover:border-accent'
            }`}
          >
            {starter.blank ? (
              <span className="flex flex-1 flex-col items-center justify-center gap-1.5 py-2">
                <FilePlus2 aria-hidden="true" className="size-5" />
                <span className="text-caption font-semibold">{blankLabel ?? t('ui:widgets.domain.starterTemplatePicker.blankLabel', 'Blank')}</span>
              </span>
            ) : (
              <>
                {/* The annex's "kicker bar" — a tinted rule, not a label. */}
                <span aria-hidden="true" className="block h-1 w-8 shrink-0 rounded-full bg-accent" />
                <StarterThumb series={starter.series} />
                <span className="line-clamp-2 text-caption font-semibold text-fg" data-part="starter-title">
                  {starter.title}
                </span>
                <span className="mt-auto flex flex-wrap items-center gap-1">
                  {starter.category === undefined ? null : (
                    <Tag tone="neutral" data-part="starter-category">
                      {starter.category}
                    </Tag>
                  )}
                  {kicker === undefined ? null : (
                    <Tag tone="accent" data-part="starter-kicker">
                      {kicker}
                    </Tag>
                  )}
                </span>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function StarterTemplatePickerWidget({ config, data, onEvent }: WidgetProps<StarterTemplatePickerConfig>) {
  const t = useMaybeT();
  const source = useMemo(() => opsBindingSourceOf(config.binding), [config.binding]);

  const starters = useMemo((): StarterDef[] => {
    /*
      Host-supplied `defs` render INSTEAD of the bound rows (the schema's
      contract): a builder that ships its own starters does not also bind a
      starters table.
    */
    const fromConfig = config.defs?.map(
      (def): StarterDef => ({
        id: def.id,
        title: def.title,
        category: def.category,
        series: def.series ?? [],
        blank: false,
      }),
    );
    const fromRows = opsRowsOf(data).map(
      (row, index): StarterDef => ({
        id: labelField(row, config.idField, `st${index}`),
        title: labelField(row, config.titleField, ''),
        category: row[config.categoryField] === undefined ? undefined : labelField(row, config.categoryField, ''),
        series: numberArrayField(row, config.seriesField),
        blank: false,
      }),
    );
    const defs = fromConfig ?? fromRows;
    /*
      The annex's "+ blank card". It is appended AFTER the real starters and
      carries a reserved id: the blank tile seeds an empty doc rather than
      merging a starter over the base, so the host must be able to tell it apart
      from a row whose title happens to be "Blank".
    */
    return config.showBlank ? [...defs, { id: '__blank__', title: '', series: [], blank: true }] : defs;
  }, [config, data]);

  // `showBlank` alone is never content: a picker offering only the ghost tile has
  // no starters to pick, which is the empty state, not a one-card grid.
  const hasStarters = starters.some((starter) => !starter.blank);

  if (!hasStarters) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.starterTemplatePicker.emptyTitle', 'No starters')}
        body={config.emptyBody ?? t('ui:widgets.domain.starterTemplatePicker.emptyBody', 'Add starter definitions in config or bind a starters table.')}
      />
    );
  }

  return (
    <StarterTemplatePickerView
      starters={starters}
      docType={config.docType}
      {...(config.blankLabel === undefined ? {} : { blankLabel: config.blankLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(source === null
        ? {}
        : {
            /*
              Selection SEEDS a document (annex: "selection seeds a full doc") —
              an insert intent the host turns into a new doc from the starter.
              The blank tile seeds nothing but the base doc, so it carries no
              starter id.
            */
            onSelect: (starter: StarterDef) =>
              void onEvent({
                type: 'mutate',
                intent: 'insert',
                connectionId: source.connectionId,
                table: source.table,
                values: {
                  docType: config.docType,
                  ...(starter.blank ? {} : { starterId: starter.id }),
                },
              }),
          })}
    />
  );
}

// ── onboarding-checklist ────────────────────────────────────────────────────

export interface OnboardingChecklistViewProps {
  tasks: readonly OnboardingTask[];
  locale?: string | undefined;
  progressLabel?: string | undefined;
  celebrateOnComplete?: boolean | undefined;
  celebrateTitle?: string | undefined;
  celebrateBody?: string | undefined;
  onToggle?: ((task: OnboardingTask, done: boolean) => void) | undefined;
  onAction?: ((task: OnboardingTask) => void) | undefined;
  testId?: string | undefined;
}

/**
 * The annex's live-recomputing `gauge-ring`, as a pure SVG ring.
 *
 * It does NOT import the `gauge-ring` WIDGET: widgets are registry entries the
 * host mounts, not components families reach across for — importing kpi's
 * component here would weld the domain chunk to the kpi chunk and defeat the
 * per-family split (04 §2.3). The ring is ~15 lines of geometry; the coupling
 * would cost more than it saves.
 *
 * `aria-hidden` because the same figure is stated in text right beside it.
 */
function ProgressRing({ pct, label }: { pct: number; label: string }) {
  const RADIUS = 20;
  const circumference = 2 * Math.PI * RADIUS;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * circumference;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className="size-12 shrink-0 -rotate-90"
      data-part="checklist-gauge"
      data-pct={Math.round(pct)}
    >
      <circle cx="24" cy="24" r={RADIUS} fill="none" strokeWidth="4" className="stroke-surface-3" />
      <circle
        cx="24"
        cy="24"
        r={RADIUS}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        className="stroke-accent transition-[stroke-dasharray] duration-300"
      >
        <title>{label}</title>
      </circle>
    </svg>
  );
}

export function OnboardingChecklistView({
  tasks,
  locale,
  progressLabel,
  celebrateOnComplete = true,
  celebrateTitle,
  celebrateBody,
  onToggle,
  onAction,
  testId,
}: OnboardingChecklistViewProps) {
  const t = useMaybeT();
  const done = tasks.filter((task) => task.done).length;
  const total = tasks.length;
  const pct = total === 0 ? 0 : (done / total) * 100;
  const complete = total > 0 && done === total;
  const progress =
    progressLabel !== undefined
      ? interpolate(progressLabel, { done: done.toString(), total: total.toString() })
      : t('ui:widgets.domain.onboardingChecklist.progressLabel', '{done} of {total} done', {
          done: done.toString(),
          total: total.toString(),
        });

  return (
    <div
      data-widget="onboarding-checklist"
      data-testid={testId}
      data-complete={complete ? '' : undefined}
      className="flex h-full flex-col gap-3 overflow-auto px-4 pb-4"
    >
      {/*
        The annex's "live-recomputing gauge-ring + progress-bar pair", swapped for
        a success state at 100% when `celebrateOnComplete` is set. Both readouts
        derive from the SAME `done`/`total` on every render, so they can never
        disagree about the same checklist.
      */}
      {complete && celebrateOnComplete ? (
        <div className="flex items-center gap-2.5 rounded-lg bg-pos-soft p-3" data-part="checklist-celebrate">
          <Check aria-hidden="true" className="size-5 shrink-0 text-pos" />
          <div className="min-w-0">
            <p className="text-body-sm font-bold text-pos">{celebrateTitle ?? t('ui:widgets.domain.onboardingChecklist.celebrateTitle', 'All done')}</p>
            {celebrateBody === undefined ? null : <p className="text-caption text-fg-muted">{celebrateBody}</p>}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <ProgressRing pct={pct} label={progress} />
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-semibold text-fg" data-part="checklist-progress">
              {progress}
            </p>
            <ProgressBar
              value={pct}
              tone="accent"
              size="sm"
              animated={false}
              label={progress}
              className="mt-1"
            />
          </div>
          <span className="shrink-0 text-caption font-bold tabular-nums text-accent" data-part="checklist-pct">
            {formatPct(pct, locale)}
          </span>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {tasks.map((task) => (
          <li
            key={task.id}
            data-part="checklist-task"
            data-done={task.done ? '' : undefined}
            className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 p-2.5"
          >
            {/*
              A real checkbox input, not a styled div: it is the control that
              carries the step's state, so it must be focusable, space-toggleable
              and announced as a checkbox. Unbound → `disabled`, because a tick
              the host cannot persist is a lie the next refresh exposes.
            */}
            <input
              type="checkbox"
              data-part="checklist-toggle"
              className="mt-0.5 size-4 shrink-0 accent-accent"
              checked={task.done}
              disabled={onToggle === undefined}
              aria-label={task.title}
              onChange={(event) => onToggle?.(task, event.currentTarget.checked)}
            />
            <div className="min-w-0 flex-1">
              <p
                className={`text-body-sm font-semibold ${task.done ? 'text-fg-muted line-through' : 'text-fg'}`}
                data-part="checklist-title"
              >
                {task.title}
              </p>
              {task.desc === undefined ? null : (
                <p className="mt-0.5 text-caption text-fg-subtle">{task.desc}</p>
              )}
              {task.minutes === undefined ? null : (
                <Badge tone="neutral" className="mt-1" data-part="checklist-time">
                  {formatMinutes(task.minutes, locale)}
                </Badge>
              )}
            </div>
            {task.action === undefined || task.done || onAction === undefined ? null : (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                data-part="checklist-cta"
                onClick={() => onAction(task)}
              >
                {task.action}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OnboardingChecklistWidget({ config, data, onEvent }: WidgetProps<OnboardingChecklistConfig>) {
  const t = useMaybeT();
  const source = useMemo(() => opsBindingSourceOf(config.binding), [config.binding]);

  const tasks = useMemo((): OnboardingTask[] => {
    // Host-supplied `tasks` render INSTEAD of the bound rows (schema contract).
    const fromConfig = config.tasks?.map(
      (task): OnboardingTask => ({
        id: task.id,
        title: task.title,
        desc: task.description,
        minutes: task.minutes,
        action: task.action,
        href: task.href,
        done: task.done ?? false,
      }),
    );
    return (
      fromConfig ??
      opsRowsOf(data).map(
        (row, index): OnboardingTask => ({
          id: labelField(row, config.idField, `step${index}`),
          title: labelField(row, config.titleField, ''),
          desc: row[config.descField] === undefined ? undefined : labelField(row, config.descField, ''),
          minutes: row[config.minutesField] === undefined ? undefined : countField(row, config.minutesField, 0),
          action: row[config.actionField] === undefined ? undefined : labelField(row, config.actionField, ''),
          href: row[config.hrefField] === undefined ? undefined : labelField(row, config.hrefField, ''),
          done: booleanField(row, config.doneField) ?? false,
        }),
      )
    );
  }, [config, data]);

  if (tasks.length === 0) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.onboardingChecklist.emptyTitle', 'Nothing to set up')}
        body={config.emptyBody ?? t('ui:widgets.domain.onboardingChecklist.emptyBody', 'Add onboarding steps in config or bind a steps table.')}
      />
    );
  }

  return (
    <OnboardingChecklistView
      tasks={tasks}
      celebrateOnComplete={config.celebrateOnComplete}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.progressLabel === undefined ? {} : { progressLabel: config.progressLabel })}
      {...(config.celebrateTitle === undefined ? {} : { celebrateTitle: config.celebrateTitle })}
      {...(config.celebrateBody === undefined ? {} : { celebrateBody: config.celebrateBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      /*
        The CTA is a DRILL-THROUGH, and it needs no binding: an href is a route,
        not a table write, so a config-driven (unbound) checklist still navigates.
        Ticking a step is a write and does need one — hence the two are gated
        separately.
      */
      onAction={(task: OnboardingTask) => {
        if (task.href === undefined || task.href === '') return;
        void onEvent({ type: 'drill-through', href: task.href });
      }}
      {...(source === null
        ? {}
        : {
            onToggle: (task: OnboardingTask, done: boolean) =>
              void onEvent({
                type: 'mutate',
                intent: 'update',
                connectionId: source.connectionId,
                table: source.table,
                recordId: task.id,
                values: { [config.doneField]: done },
              }),
          })}
    />
  );
}
