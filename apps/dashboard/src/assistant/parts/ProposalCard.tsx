// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card a proposal is drawn as, in every state it has: being checked,
 * waiting for a yes, changed since it was shown, done, done in part, stopped
 * part way, let go.
 *
 * A VIEW AND NOTHING ELSE. It is handed what to draw; which state a proposal
 * is in, and what its buttons do, is `LiveProposal`'s. So every state can be
 * drawn in a story or a test with no conversation behind it.
 *
 * NOTHING HERE CAN CONFIRM BY ACCIDENT. When a card that asks appears, focus
 * goes to its title, never to a button; Cancel comes before the confirm in
 * the tab order; and the confirm is disabled while nothing is ticked.
 */
import { cn } from '@adminium/ui';
import {
  ArrowDown,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  Maximize2,
  Pause,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldOff,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';

export type ProposalIcon =
  | 'change'
  | 'add'
  | 'delete'
  | 'send'
  | 'save'
  | 'done'
  | 'mixed'
  | 'paused'
  | 'off'
  | 'undone'
  | 'clock'
  | 'down'
  | 'changed'
  | 'info'
  | 'warn'
  | 'notTried'
  | 'open'
  | 'ask';

const ICONS: Record<ProposalIcon, LucideIcon> = {
  change: PencilLine,
  add: Plus,
  delete: Trash2,
  send: Send,
  save: Save,
  done: Check,
  mixed: CircleAlert,
  paused: Pause,
  off: ShieldOff,
  undone: Undo2,
  clock: Clock,
  down: ArrowDown,
  changed: RefreshCw,
  info: Info,
  warn: TriangleAlert,
  notTried: CircleDashed,
  open: ExternalLink,
  ask: Sparkles,
};

export type ProposalTone = 'accent' | 'pos' | 'warn' | 'danger' | 'muted';
type LineTone = 'muted' | 'subtle' | 'warn' | 'danger' | 'pos';

export interface ProposalLine {
  icon?: ProposalIcon;
  text: string;
  tone?: LineTone;
}

/** One row of the list: a record, what changes on it, and why not when it cannot be done. */
export interface ProposalRow {
  id: string;
  /** The record's key, in mono; `plain` draws a name instead. */
  label: string;
  plain?: boolean;
  sub?: string;
  /** One changed column, drawn at the row's end. */
  inline?: { before: string; after: string };
  /** Changed columns, one line each. `before` is null for a row that is new. */
  changes?: { field: string; before: string | null; after: string }[];
  reason?: string;
  dim?: boolean;
  /** Present when the row can be ticked. */
  checked?: boolean;
  onToggle?: () => void;
}

export interface ProposalButton {
  id: string;
  label: string;
  kind?: 'ghost' | 'primary' | 'danger';
  icon?: ProposalIcon;
  disabled?: boolean;
  onClick: () => void;
  /** An undo's minute, as a share left (0..1) and the seconds as text. */
  ring?: { left: number; seconds: string };
}

export interface ProposalGroup {
  tone: 'pos' | 'warn' | 'muted';
  icon: ProposalIcon;
  label: string;
  count: number;
  rows: { label: string; text: string }[];
}

export interface ProposalCardProps {
  tone?: 'default' | 'muted' | 'pos' | 'danger';
  icon: ProposalIcon;
  iconTone?: ProposalTone;
  title: string;
  sub?: string | undefined;
  badge?: string;
  /** A line with a turning mark: the proposal is being checked, or written. */
  spinner?: string;
  facts?: { label: string; value: string }[];
  lines?: ProposalLine[];
  group?: { label: string; open: boolean; onToggle: () => void };
  rows?: ProposalRow[];
  people?: string[];
  link?: { label: string; onClick: () => void };
  danger?: string;
  groups?: ProposalGroup[];
  notes?: ProposalLine[];
  count?: string;
  openLarge?: { label: string; onClick: () => void };
  buttons?: ProposalButton[];
  after?: ProposalLine[];
  /** In the thread after the assistant's own words: under its avatar's column. */
  indent?: boolean;
  /** A card that asks for a decision takes focus on its title when it appears. */
  asks?: boolean;
  onEscape?: () => void;
  /** Left-to-right arrow, or right-to-left in an RTL language. */
  rtl?: boolean;
  testId?: string;
}

const LINE_TONE: Record<LineTone, string> = {
  muted: 'text-fg-muted font-medium',
  subtle: 'text-fg-subtle font-medium',
  warn: 'text-warn font-semibold',
  danger: 'text-danger font-semibold',
  pos: 'text-pos font-medium',
};

const ICON_TONE: Record<ProposalTone, string> = {
  accent: 'bg-accent-soft-solid text-accent',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-surface-3 text-fg-subtle',
};

const GROUP_TONE = { pos: 'text-pos', warn: 'text-warn', muted: 'text-fg-subtle' } as const;

function Line({ line }: { line: ProposalLine }) {
  const Icon = line.icon === undefined ? null : ICONS[line.icon];
  return (
    <div className={cn('flex items-start gap-[7px] text-[12px] leading-[1.5]', LINE_TONE[line.tone ?? 'muted'])}>
      {Icon === null ? null : <Icon className="mt-0.5 size-[13px] shrink-0" aria-hidden="true" />}
      <span>{line.text}</span>
    </div>
  );
}

const STRUCK = 'text-fg-subtle line-through decoration-fg-subtle/70';

/**
 * A row that will not be done: refused, or unticked. Drawn quieter by colour
 * and ground, never by opacity: a faded row's text would fall under the
 * contrast a person needs to read why it was refused.
 */
const quiet = (row: ProposalRow): boolean => row.dim === true || row.checked === false;

/** What a tick stands for, said whole: the row and what would change on it. */
function tickLabel(row: ProposalRow, arrow: string): string {
  if (row.inline !== undefined) return `${row.label}: ${row.inline.before} ${arrow} ${row.inline.after}`;
  const first = row.changes?.[0];
  if (first === undefined) return row.sub === undefined || row.sub === '' ? row.label : `${row.label}: ${row.sub}`;
  return `${row.label}: ${first.field} ${first.before === null ? '' : `${first.before} ${arrow} `}${first.after}`;
}

export function ProposalCard(props: ProposalCardProps) {
  const { tone = 'default', iconTone = 'accent', rtl = false } = props;
  const HeadIcon = ICONS[props.icon];
  const arrow = rtl ? '←' : '→';
  const title = useRef<HTMLDivElement | null>(null);
  const asks = props.asks === true;
  useEffect(() => {
    if (!asks) return;
    // Not from under someone who is typing: their words, and their next Escape, stay theirs.
    const active = document.activeElement;
    if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.value !== '') return;
    // The title, never a button: Enter must not be able to confirm what was only just shown.
    title.current?.focus({ preventScroll: true });
  }, [asks]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || props.onEscape === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    props.onEscape();
  };

  return (
    <div className="flex min-w-0 flex-1 items-start gap-[11px]" data-testid={props.testId ?? 'assistant-proposal'} onKeyDown={onKeyDown}>
      {props.indent === true ? <div className="w-7 shrink-0" /> : null}
      <div
        className={cn(
          'min-w-0 flex-1 overflow-hidden rounded-[16px] border',
          tone === 'muted' ? 'border-border bg-surface-2 text-fg-muted' : 'bg-surface text-fg shadow-menu',
          tone === 'default' && 'border-border',
          tone === 'pos' && 'border-pos/35',
          tone === 'danger' && 'border-danger/35',
        )}
      >
        <div className="flex items-start gap-2.5 px-3.5 pt-[13px]">
          <span className={cn('flex size-[30px] shrink-0 items-center justify-center rounded-[9px]', ICON_TONE[iconTone])}>
            <HeadIcon className="size-[15px]" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 pt-[5px]">
            <div ref={title} tabIndex={-1} data-testid="assistant-proposal-title" className="rounded-sm text-pretty text-[13.5px] font-extrabold leading-[1.4] tracking-[-0.01em] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {props.title}
            </div>
            {props.sub === undefined || props.sub === '' ? null : <div className="mt-[3px] text-[11.5px] leading-[1.5] text-fg-muted">{props.sub}</div>}
          </div>
          {props.badge === undefined ? null : (
            <span className="mt-1 shrink-0 rounded-[20px] bg-surface-3 px-2 py-[3px] text-[10.5px] font-bold text-fg-muted">{props.badge}</span>
          )}
        </div>

        <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3">
          {props.spinner === undefined ? null : (
            <span role="status" className="flex items-center gap-2 text-[12px] text-fg-muted">
              <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden="true" />
              {props.spinner}
            </span>
          )}

          {props.facts === undefined || props.facts.length === 0 ? null : (
            <dl className="flex flex-col gap-[7px]">
              {props.facts.map((fact) => (
                <div key={fact.label} className="flex items-baseline gap-2.5">
                  <dt className="w-[58px] shrink-0 text-[11px] font-bold text-fg-subtle">{fact.label}</dt>
                  <dd className="min-w-0 flex-1 text-[12.5px] font-semibold leading-[1.45]">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {(props.lines ?? []).map((line) => (
            <Line key={line.text} line={line} />
          ))}

          {props.group === undefined ? null : (
            <button
              type="button"
              onClick={props.group.onToggle}
              aria-expanded={props.group.open}
              data-testid="assistant-proposal-group"
              className="flex w-full items-center gap-2 rounded-[11px] border border-border bg-surface-2 px-[11px] py-[9px] text-start text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {props.group.open ? (
                <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 text-fg-subtle rtl:rotate-180" aria-hidden="true" />
              )}
              <span className="flex-1 font-mono text-[11.5px] font-semibold">{props.group.label}</span>
            </button>
          )}

          {props.rows === undefined || props.rows.length === 0 ? null : (
            <div className="flex flex-col gap-px overflow-hidden rounded-[11px] border border-border bg-border">
              {props.rows.map((row) => (
                <div key={row.id} data-testid="assistant-proposal-row" data-dim={quiet(row) ? '' : undefined} className={cn('flex flex-col gap-1.5 px-[11px] py-[9px]', quiet(row) ? 'bg-surface-2' : 'bg-surface')}>
                  <div className="flex min-w-0 items-center gap-[9px]">
                    {row.checked === undefined || row.onToggle === undefined ? null : (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={row.checked}
                        aria-label={tickLabel(row, arrow)}
                        onClick={row.onToggle}
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-[5px] border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                          row.checked ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong bg-transparent text-transparent',
                        )}
                      >
                        <Check className="size-[11px]" aria-hidden="true" />
                      </button>
                    )}
                    <span className={cn('shrink-0 font-bold', quiet(row) ? 'text-fg-muted' : 'text-fg', row.plain === true ? 'text-[13px]' : 'font-mono text-[12px]')}>{row.label}</span>
                    {row.sub === undefined || row.sub === '' ? null : <span className="min-w-0 truncate text-[11.5px] text-fg-muted">{row.sub}</span>}
                    {row.inline === undefined ? null : (
                      <span className="ms-auto flex shrink-0 items-center gap-1.5 font-mono text-[11.5px]">
                        <span className={STRUCK}>{row.inline.before}</span>
                        <span className="text-fg-subtle" aria-hidden="true">
                          {arrow}
                        </span>
                        <span className={cn('font-semibold', quiet(row) && 'text-fg-muted')}>{row.inline.after}</span>
                      </span>
                    )}
                  </div>
                  {(row.changes ?? []).map((change) => (
                    <div key={change.field} className="grid grid-cols-[68px_minmax(0,1fr)] items-baseline gap-2 font-mono text-[11.5px]">
                      <span className="truncate text-fg-subtle">{change.field}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {change.before === null ? null : (
                          <>
                            <span className={STRUCK}>{change.before}</span>
                            <span className="text-fg-subtle" aria-hidden="true">
                              {arrow}
                            </span>
                          </>
                        )}
                        <span className="break-all font-semibold text-fg">{change.after}</span>
                      </span>
                    </div>
                  ))}
                  {row.reason === undefined || row.reason === '' ? null : (
                    <div className="flex gap-1.5 text-[11.5px] font-semibold leading-[1.45] text-warn">
                      <Ban className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                      <span>{row.reason}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {props.people === undefined || props.people.length === 0 ? null : (
            <div className="flex flex-wrap gap-[5px]">
              {props.people.map((name) => (
                <span key={name} className="rounded-[20px] bg-surface-3 px-[9px] py-[3px] text-[11.5px] font-semibold text-fg-muted">
                  {name}
                </span>
              ))}
            </div>
          )}

          {props.link === undefined ? null : (
            <button
              type="button"
              onClick={props.link.onClick}
              className="inline-flex w-fit items-center gap-1.5 text-[12px] font-bold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <ExternalLink className="size-[13px]" aria-hidden="true" />
              {props.link.label}
            </button>
          )}

          {props.danger === undefined ? null : (
            <div data-testid="assistant-proposal-danger" className="flex gap-[9px] rounded-[11px] border border-danger/35 bg-danger-soft px-3 py-2.5 text-[12px] font-bold leading-[1.5] text-danger">
              <Trash2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{props.danger}</span>
            </div>
          )}

          {props.groups === undefined ? null : (
            <div className="flex flex-col gap-2.5">
              {props.groups.map((group) => {
                const Icon = ICONS[group.icon];
                return (
                  <div key={group.label} className="flex flex-col gap-[5px]">
                    <div className={cn('flex items-center gap-2 text-[12px] font-bold', GROUP_TONE[group.tone])}>
                      <Icon className="size-[13px] shrink-0" aria-hidden="true" />
                      <span className="flex-1">{group.label}</span>
                      <span className="font-mono">{group.count}</span>
                    </div>
                    {group.rows.map((row, index) => (
                      // By place as well as label: two new rows share a label, and the list never reorders.
                      <div key={`${String(index)}:${row.label}`} className="flex gap-2 ps-[21px] text-[11.5px] leading-[1.45] text-fg-muted">
                        <span className="shrink-0 font-mono font-semibold text-fg">{row.label}</span>
                        <span>{row.text}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {(props.notes ?? []).map((line) => (
            <Line key={line.text} line={line} />
          ))}

          {props.count === undefined && props.openLarge === undefined ? null : (
            <div className="flex items-center gap-2">
              {props.count === undefined ? null : (
                <span data-testid="assistant-proposal-count" className="font-mono text-[11.5px] font-semibold text-fg-muted">
                  {props.count}
                </span>
              )}
              {props.openLarge === undefined ? null : (
                <button
                  type="button"
                  onClick={props.openLarge.onClick}
                  data-testid="assistant-proposal-large"
                  className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-[9px] py-[5px] text-[11.5px] font-bold text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Maximize2 className="size-3" aria-hidden="true" />
                  {props.openLarge.label}
                </button>
              )}
            </div>
          )}

          {props.buttons === undefined || props.buttons.length === 0 ? null : (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
              {props.buttons.map((button) => {
                const Icon = button.icon === undefined ? null : ICONS[button.icon];
                return (
                  <button
                    key={button.id}
                    type="button"
                    data-testid={`assistant-proposal-${button.id}`}
                    disabled={button.disabled === true}
                    onClick={button.onClick}
                    className={cn(
                      'nb-press inline-flex items-center gap-[7px] whitespace-nowrap rounded-[10px] border px-[13px] py-2 text-[12.5px] font-bold leading-[1.2]',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45',
                      button.kind === 'primary' && 'border-accent bg-accent text-accent-fg',
                      button.kind === 'danger' && 'border-danger bg-danger text-accent-fg',
                      (button.kind === undefined || button.kind === 'ghost') && 'border-border-strong bg-surface text-fg',
                    )}
                  >
                    {button.ring === undefined ? null : (
                      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border-strong)" strokeWidth="2.5" />
                        <circle
                          cx="10"
                          cy="10"
                          r="8"
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeDasharray={`${(button.ring.left * 50.3).toFixed(1)} 51`}
                          transform="rotate(-90 10 10)"
                        />
                      </svg>
                    )}
                    {Icon === null ? null : <Icon className="size-3.5" aria-hidden="true" />}
                    {button.label}
                    {button.ring === undefined ? null : (
                      <span aria-hidden="true" className="font-mono text-[11px] font-semibold text-fg-muted">
                        {button.ring.seconds}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {(props.after ?? []).map((line) => (
            <Line key={line.text} line={line} />
          ))}
        </div>
      </div>
    </div>
  );
}
