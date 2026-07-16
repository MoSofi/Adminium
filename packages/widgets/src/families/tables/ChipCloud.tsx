import { EmptyState, MonoText, Tag } from '@adminium/ui';
import type { Tone } from '@adminium/ui';

import { chipIcon } from './tables-tail-icons.js';
import { chipCloudConfigSchema, chipCloudDemoData } from './tables-tail-config.js';
import type { ChipCloudConfig } from './tables-tail-config.js';
import { resolveLocale, tailToneOf } from './tables-tail-lib.js';
import type { CloudChip } from './tables-tail-types.js';
import type { WidgetProps } from '../../registry/types.js';

export { chipCloudConfigSchema, chipCloudDemoData };
export type { ChipCloudConfig, CloudChip };

/**
 * `chip-cloud` (annex §3) — wrapped mono chips: discovered table names, merge
 * variables, suggested dashboards (Adminium Console, Connect Database, Email
 * Templates, Workspace Settings). Optional staggered pop-in, optional
 * click-to-insert.
 *
 * The chips are inert `<span>`s unless a click action is configured, and
 * interactive `<button>`s when one is — a cloud whose chips do nothing must not
 * ship focusable, clickable-looking dead controls.
 *
 * The stagger is a CSS custom property per chip (`--chip-i`), the sanctioned
 * escape hatch for a per-item dynamic value (02 §8). It is opt-in and the
 * animation utility itself is `motion-safe:`, so `prefers-reduced-motion`
 * viewers get the cloud with no pop-in at all.
 */

export interface ChipCloudProps {
  chips: readonly CloudChip[];
  clickAction?: 'none' | 'insert' | 'navigate' | undefined;
  stagger?: boolean | undefined;
  limit?: number | undefined;
  tone?: Tone | undefined;
  locale?: string | undefined;
  /** "+{n} more" overflow chip label; `{n}` is substituted. */
  moreLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onSelect?: ((chip: CloudChip) => void) | undefined;
  testId?: string | undefined;
}

/** The staggered pop-in, opt-in and `motion-safe`-gated (02 §8, 10 §6). */
const STAGGER_CLASS =
  'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:[animation-delay:calc(var(--chip-i)*40ms)] motion-safe:[animation-fill-mode:backwards]';

export function ChipCloud({
  chips,
  clickAction = 'none',
  stagger = false,
  limit = 40,
  tone = 'neutral',
  locale,
  moreLabel,
  emptyTitle,
  emptyBody,
  onSelect,
  testId,
}: ChipCloudProps) {
  void resolveLocale(locale); // normalize at the boundary (see tables-tail-lib)
  const slice = chips.slice(0, limit);
  const overflow = chips.length - slice.length;
  const interactive = clickAction !== 'none' && onSelect !== undefined;

  if (slice.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? 'Nothing discovered yet'}
        body={emptyBody ?? 'Tables and variables will appear here as chips once they are found.'}
      />
    );
  }

  return (
    <div
      data-widget="chip-cloud"
      data-testid={testId}
      data-action={clickAction}
      className="flex h-full flex-wrap content-start items-start gap-1.5 overflow-auto p-3"
    >
      {slice.map((chip, index) => {
        const body = (
          <Tag mono tone={tailToneOf(chip.tone, tone)} data-part="cloud-chip">
            <span aria-hidden="true" className="me-1 inline-flex size-3 items-center [&>svg]:size-3">
              {chipIcon(chip.icon)}
            </span>
            {chip.label}
          </Tag>
        );
        /*
         * The stagger index rides the WRAPPER, not the Tag: `Tag` omits `style`
         * from its props by design, and the rule that permits a `style` object
         * requires a literal object expression — so `--chip-i` is always set and
         * only the class that consumes it is conditional.
         */
        const staggerClass = stagger ? STAGGER_CLASS : '';
        return interactive ? (
          <button
            key={`${chip.label}-${index}`}
            type="button"
            onClick={() => onSelect(chip)}
            style={{ '--chip-i': String(index) }}
            className={`rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${staggerClass}`}
          >
            {body}
          </button>
        ) : (
          <span key={`${chip.label}-${index}`} style={{ '--chip-i': String(index) }} className={staggerClass}>
            {body}
          </span>
        );
      })}
      {overflow > 0 && (
        <MonoText data-part="cloud-overflow" className="self-center px-1.5 text-caption text-fg-subtle">
          {(moreLabel ?? '+{n} more').replace('{n}', String(overflow))}
        </MonoText>
      )}
    </div>
  );
}

/**
 * Project an untrusted `categorical` payload onto `CloudChip`s. The annex's
 * contract is "string array (+ optional icon per chip)", so a bare
 * `['a','b']` array — the shape a hand-written binding most often produces —
 * projects just as well as the canonical `{ items: [{ label }] }` envelope.
 */
export function cloudChipsOf(data: unknown): CloudChip[] {
  const raw = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { items?: unknown }).items)
      ? ((data as { items: unknown[] }).items)
      : [];
  return raw.flatMap((entry): CloudChip[] => {
    if (typeof entry === 'string') return entry === '' ? [] : [{ label: entry, value: entry }];
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const label = record.label ?? record.name ?? record.value;
    if (typeof label !== 'string' || label === '') return [];
    return [
      {
        label,
        ...(typeof record.icon === 'string' ? { icon: record.icon } : {}),
        ...(typeof record.tone === 'string' ? { tone: record.tone } : {}),
        value: typeof record.value === 'string' ? record.value : label,
      },
    ];
  });
}

export function ChipCloudWidget({ config, data, onEvent }: WidgetProps<ChipCloudConfig>) {
  /*
   * `insert` is a HOST concern (paste the chip into the focused editor/composer),
   * so the widget emits nothing for it — the host owns the composer and passes
   * its own `onSelect` when it mounts the component directly. `navigate` is a
   * plain drill-through on the configured href + the chip's value.
   */
  const onSelect =
    config.clickAction === 'navigate' && config.href !== undefined
      ? (chip: CloudChip) =>
          onEvent({ type: 'drill-through', href: `${config.href as string}${encodeURIComponent(chip.value ?? chip.label)}` })
      : undefined;
  return (
    <ChipCloud
      chips={cloudChipsOf(data)}
      clickAction={config.clickAction}
      stagger={config.stagger}
      limit={config.limit}
      tone={tailToneOf(config.chipTone, 'neutral')}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(onSelect === undefined ? {} : { onSelect })}
    />
  );
}
