// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's chat, piece by piece: the person's message, the Designer's
 * answer with its steps, the cards that wait for the person, and the lines
 * that say how a turn ended. Each takes its data as props and says nothing
 * of where it came from.
 *
 * Milo's chat parts are not used: they carry Milo's own turn model (a page's
 * context, option groups, a token hint) and the `assistant` words.
 */
import { useId, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  CircleSlash2,
  CircleAlert,
  CircleStop,
  CircleX,
  Gauge,
  GitCommitHorizontal,
  Hexagon,
  ListChecks,
  LoaderCircle,
  MessageCircleQuestion,
  Package,
  Play,
  RotateCcw,
  RotateCw,
  TriangleAlert,
} from 'lucide-react';

import { getI18nInstance, t } from '../../i18n/t.js';
import type { DesignerCard, LimitKind, SpendMark } from '../api.js';
import { SUBJECT, secondsOf, shortSubject, stepLine } from '../build/stepLine.js';
import type { StepRow } from '../build/turns.js';
import { Markdown } from './markdown.js';

const SECONDARY = 'inline-flex items-center gap-1.5 rounded-[10px] border border-border-strong bg-surface px-3 py-[7px] text-[12.5px] font-bold text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-[10px] bg-accent px-3 py-[7px] text-[12.5px] font-bold text-accent-fg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50';
const DANGER = 'inline-flex items-center gap-1.5 rounded-[10px] border border-danger/40 bg-danger-soft px-3 py-[7px] text-[12.5px] font-bold text-danger hover:brightness-97 disabled:cursor-not-allowed disabled:opacity-50';

function number(value: number): string {
  return new Intl.NumberFormat(getI18nInstance()?.language ?? 'en-US').format(value);
}

/** A sentence with `MARK` where a value goes, the value drawn in mono. */
function withMono(sentence: string, marks: readonly string[], values: readonly ReactNode[]): ReactNode {
  const out: ReactNode[] = [];
  let rest = sentence;
  for (;;) {
    let at = -1;
    let which = -1;
    marks.forEach((mark, index) => {
      const found = rest.indexOf(mark);
      if (found !== -1 && (at === -1 || found < at)) {
        at = found;
        which = index;
      }
    });
    if (at === -1) break;
    out.push(rest.slice(0, at));
    out.push(
      <span key={out.length} className="font-mono font-semibold text-fg">
        {values[which]}
      </span>,
    );
    rest = rest.slice(at + (marks[which]?.length ?? 1));
  }
  out.push(rest);
  return out;
}

const M1 = '\u0001';
const M2 = '\u0002';
const M3 = '\u0003';

export function PersonMessage({ text }: { text: string }): ReactNode {
  return (
    <div className="flex justify-end">
      <p dir="auto" className="m-0 max-w-[86%] whitespace-pre-wrap text-pretty rounded-2xl rounded-ee-md bg-surface-3 px-3.5 py-[11px] text-[13.5px] leading-normal text-fg">{text}</p>
    </div>
  );
}

export function DesignerMessage({ text, streaming, children }: { text: string; streaming: boolean; children?: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-xs font-extrabold text-fg-muted">
        <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-md bg-accent text-accent-fg">
          <Hexagon className="size-3" />
        </span>
        {t('designer:brand', 'Adminium Designer')}
      </div>
      {text === '' && !streaming ? null : (
        <div aria-live={streaming ? 'polite' : undefined}>
          <Markdown text={text} caret={streaming ? <span aria-hidden="true" className="ms-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent" /> : null} />
        </div>
      )}
      {children}
    </div>
  );
}

function StepLine({ row }: { row: StepRow }): ReactNode {
  const line = stepLine(row);
  const subject = row.subject === undefined ? '' : shortSubject(row.subject);
  return <>{withMono(line, [SUBJECT], [subject])}</>;
}

export function StepsBlock({
  rows,
  stepCount,
  live,
  ms,
  open,
  onToggle,
}: {
  rows: readonly StepRow[];
  stepCount: number;
  live: boolean;
  ms: number | null;
  open: boolean;
  onToggle: () => void;
}): ReactNode {
  const listId = useId();
  if (rows.length === 0 && !live) return null;
  const summary =
    ms === null
      ? t('designer:steps.count', '{count, plural, one {# step} other {# steps}}', { count: stepCount })
      : t('designer:steps.summary', '{count, plural, one {# step} other {# steps}} · {seconds} s', { count: stepCount, seconds: secondsOf(ms) });
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full items-center gap-2 px-[11px] py-2 text-start text-xs font-bold text-fg-muted hover:text-fg"
      >
        {live ? (
          <>
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-accent" />
            <span className="flex-1">{t('designer:steps.working', 'Working')}</span>
          </>
        ) : (
          <>
            <ListChecks aria-hidden="true" className="size-3.5 text-fg-subtle" />
            <span className="flex-1 font-mono text-[11.5px] font-semibold">{summary}</span>
          </>
        )}
        <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <ul id={listId} className="m-0 flex list-none flex-col gap-1.5 border-t border-border px-[11px] py-2.5">
          {rows.map((row) => {
            const tone = row.state === 'failed' ? 'text-danger' : row.state === 'running' ? 'text-accent' : 'text-fg-subtle';
            return (
              <li key={row.id} className="flex flex-col gap-1">
                <div className="flex items-start gap-2">
                  <span aria-hidden="true" className={`mt-0.5 flex shrink-0 ${tone}`}>
                    {row.state === 'running' ? (
                      <LoaderCircle className="size-[13px] animate-spin" />
                    ) : row.state === 'failed' ? (
                      <CircleX className="size-[13px]" />
                    ) : row.state === 'missed' ? (
                      <CircleSlash2 className="size-[13px]" />
                    ) : (
                      <Check className="size-[13px]" />
                    )}
                  </span>
                  <span className={`min-w-0 flex-1 break-words text-[12.5px] leading-snug ${row.state === 'failed' ? 'font-bold text-danger' : row.state === 'running' ? 'font-bold text-fg' : 'text-fg-muted'}`}>
                    <StepLine row={row} />
                    {row.state === 'running' ? <span className="sr-only"> {t('designer:steps.running', '(running)')}</span> : null}
                    {row.state === 'failed' ? <span className="sr-only"> {t('designer:steps.failedMark', '(failed)')}</span> : null}
                  </span>
                  {row.ms === null || row.state === 'running' ? null : (
                    <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{t('designer:steps.seconds', '{seconds} s', { seconds: secondsOf(row.ms) })}</span>
                  )}
                </div>
                {row.detail !== null && row.state === 'failed' ? (
                  <pre dir="ltr" className="m-0 ms-[21px] whitespace-pre-wrap text-start break-words rounded-md bg-surface-3 px-2 py-1.5 font-mono text-[11px] leading-snug text-fg-muted">{row.detail}</pre>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function UsageLine({ step, tokens }: { step: number; tokens: number }): ReactNode {
  return (
    <p className="m-0 text-[11.5px] text-fg-subtle">
      {withMono(t('designer:steps.usage', 'Step {step} · {tokens} tokens so far', { step: M1, tokens: M2 }), [M1, M2], [String(step), number(tokens)])}
    </p>
  );
}

export function SavedChip({ name }: { name: string }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-surface-3 px-[9px] py-[3px] text-[11px] font-bold text-fg-muted">
      <GitCommitHorizontal aria-hidden="true" className="size-3" />
      {withMono(t('designer:turn.saved', 'Saved as {version}', { version: M1 }), [M1], [name])}
    </span>
  );
}

function CardShell({
  tone = 'plain',
  icon,
  title,
  children,
  role = 'group',
  cardId,
}: {
  tone?: 'plain' | 'danger';
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  role?: 'group' | 'alert';
  /** The page finds a waiting card by this, to scroll to it and focus it. */
  cardId: string;
}): ReactNode {
  const titleId = useId();
  return (
    <div
      role={role}
      aria-labelledby={titleId}
      data-card-id={cardId}
      tabIndex={-1}
      className={`flex flex-col gap-3 rounded-xl border bg-surface p-3.5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${tone === 'danger' ? 'border-danger/35' : 'border-border-strong'}`}
    >
      <div className="flex items-start gap-[9px]">
        <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-fg-muted'}`}>
          {icon}
        </span>
        <span id={titleId} dir="auto" className="mt-[3px] text-[13.5px] font-extrabold leading-snug text-fg">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

export function QuestionCard({
  card,
  answered,
  answer,
  busy,
  onChoose,
  onOwnWords,
}: {
  card: Extract<DesignerCard, { type: 'question' }>;
  answered: boolean;
  answer?: string | undefined;
  busy: boolean;
  onChoose: (choice: string) => void;
  onOwnWords: () => void;
}): ReactNode {
  return (
    <CardShell cardId={card.id} icon={<MessageCircleQuestion className="size-4" />} title={card.question}>
      {answered ? (
        <p className="m-0 text-[12.5px] text-fg-muted">
          {answer === undefined || answer === '' ? t('designer:card.noAnswer', 'No answer was given.') : t('designer:card.youAnswered', 'You answered: {answer}', { answer })}
        </p>
      ) : (
        <>
          {card.choices.length === 0 ? null : (
            <div className="flex flex-wrap gap-2">
              {card.choices.map((choice) => (
                <button key={choice} type="button" disabled={busy} onClick={() => onChoose(choice)} className={SECONDARY}>
                  {choice}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={onOwnWords} className="self-start text-[12.5px] font-bold text-accent hover:underline">
            {t('designer:card.ownWords', 'Answer in my own words')}
          </button>
        </>
      )}
    </CardShell>
  );
}

type Removal = Extract<DesignerCard, { type: 'removal' }>;

function removalSentence(change: Removal['changes'][number]): ReactNode {
  const rows = number(change.rows);
  if (change.kind === 'table') {
    return withMono(t('designer:card.removeTable', 'Removing the table {table} deletes its {rows, plural, one {# row} other {# rows}}.', { table: M1, rows: change.rows }), [M1], [change.tableName]);
  }
  if (change.kind === 'narrow') {
    return withMono(
      t('designer:card.narrow', 'Narrowing {column} on {table}: {rows, plural, one {# row no longer fits} other {# rows no longer fit}}. They stay either way.', { column: M1, table: M2, rows: change.rows }),
      [M1, M2],
      [change.column ?? '', change.tableName],
    );
  }
  return withMono(
    t('designer:card.removeColumn', 'Removing the column {column} from {table} deletes what is stored in it: {rows} rows have a value.', { column: M1, table: M2, rows: M3 }),
    [M1, M2, M3],
    [change.column ?? '', change.tableName, rows],
  );
}

export function RemovalCard({
  card,
  answered,
  closed = false,
  kept,
  busy,
  onKeep,
  onRemove,
}: {
  card: Removal;
  answered: boolean;
  /** The turn ended without an answer. */
  closed?: boolean;
  kept?: boolean | undefined;
  busy: boolean;
  onKeep: () => void;
  onRemove: () => void;
}): ReactNode {
  const only = card.changes.length === 1 ? card.changes[0] : undefined;
  const narrowing = card.changes.every((change) => change.kind === 'narrow');
  const keepLabel = narrowing
    ? t('designer:card.keepAsWas', 'Keep it as it was')
    : only?.kind === 'column'
      ? t('designer:card.keepColumn', 'Keep the column')
      : only?.kind === 'table'
        ? t('designer:card.keepTable', 'Keep the table')
        : t('designer:card.keepAll', 'Keep them');
  const goLabel = narrowing ? t('designer:card.narrowIt', 'Narrow it') : only !== undefined ? t('designer:card.removeIt', 'Remove it and its data') : t('designer:card.removeAll', 'Remove them and their data');
  return (
    <CardShell cardId={card.id} role="alert" tone="danger" icon={<TriangleAlert className="size-[15px]" />} title={narrowing ? t('designer:card.narrowTitle', 'This change narrows a column') : t('designer:card.removalTitle', 'This change removes data')}>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {card.changes.map((change) => (
          <li key={`${change.table}.${change.column ?? ''}.${change.kind}`} className="text-[13px] leading-normal text-fg-muted">
            {removalSentence(change)}
          </li>
        ))}
      </ul>
      {closed && !answered ? (
        <p className="m-0 text-[12.5px] font-semibold text-fg-muted">{t('designer:card.noAnswer', 'No answer was given.')}</p>
      ) : answered ? (
        <p className="m-0 text-[12.5px] font-semibold text-fg-muted">
          {kept === true ? t('designer:card.kept', 'Kept.') : narrowing ? t('designer:card.narrowed', 'Narrowed.') : t('designer:card.removed', 'Removed.')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onKeep} className={PRIMARY}>
            {keepLabel}
          </button>
          <button type="button" disabled={busy} onClick={onRemove} className={DANGER}>
            {goLabel}
          </button>
        </div>
      )}
    </CardShell>
  );
}

export function PackageCard({
  card,
  answered,
  closed = false,
  accepted,
  busy,
  onAdd,
  onSkip,
}: {
  card: Extract<DesignerCard, { type: 'package' }>;
  answered: boolean;
  /** The turn ended without an answer. */
  closed?: boolean;
  accepted?: boolean | undefined;
  busy: boolean;
  onAdd: () => void;
  onSkip: () => void;
}): ReactNode {
  return (
    <CardShell cardId={card.id} icon={<Package className="size-[15px]" />} title={withMono(t('designer:card.package', 'A package is needed: {name} ({version}). Add it?', { name: M1, version: M2 }), [M1, M2], [card.name, card.version])}>
      {card.why === '' ? null : (
        <p dir="auto" className="m-0 text-[12.5px] leading-normal text-fg-muted">
          {card.why}
        </p>
      )}
      {closed && !answered ? (
        <p className="m-0 text-[12.5px] font-semibold text-fg-muted">{t('designer:card.noAnswer', 'No answer was given.')}</p>
      ) : answered ? (
        <p className="m-0 text-[12.5px] font-semibold text-fg-muted">{accepted === true ? t('designer:card.packageYes', 'You said yes.') : t('designer:card.packageNo', 'You said to do without it.')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onAdd} className={PRIMARY}>
            {t('designer:card.addIt', 'Add it')}
          </button>
          <button type="button" disabled={busy} onClick={onSkip} className={SECONDARY}>
            {t('designer:card.doWithout', 'Do without')}
          </button>
        </div>
      )}
    </CardShell>
  );
}

export function StoppedNote({ onContinue, onPutBack, busy }: { onContinue?: (() => void) | undefined; onPutBack?: (() => void) | undefined; busy: boolean }): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="flex items-center gap-[7px] text-[12.5px] text-fg-muted">
        <CircleStop aria-hidden="true" className="size-3.5" />
        {t('designer:turn.stopped', 'Stopped. Nothing from this turn was saved as a version.')}
      </span>
      {onContinue === undefined ? null : (
        <button type="button" disabled={busy} onClick={onContinue} className={SECONDARY}>
          <Play aria-hidden="true" className="size-[13px] rtl:-scale-x-100" />
          {t('designer:turn.continue', 'Continue')}
        </button>
      )}
      {onPutBack === undefined ? null : (
        <button type="button" disabled={busy} onClick={onPutBack} className={SECONDARY}>
          <RotateCcw aria-hidden="true" className="size-[13px]" />
          {t('designer:turn.putBack', 'Put the files back')}
        </button>
      )}
    </div>
  );
}

export function LimitNote({ which, value, version, onKeepGoing, busy }: { which: LimitKind; value: number; version: string | null; onKeepGoing?: (() => void) | undefined; busy: boolean }): ReactNode {
  const head =
    which === 'steps'
      ? withMono(t('designer:turn.limitSteps', 'This turn reached its limit of {value} steps.', { value: M1 }), [M1], [number(value)])
      : which === 'turn-tokens'
        ? withMono(t('designer:turn.limitTurnTokens', 'This turn reached its limit of {value} tokens.', { value: M1 }), [M1], [number(value)])
        : withMono(t('designer:turn.limitSessionTokens', 'This session reached its spending limit of {value} tokens.', { value: M1 }), [M1], [number(value)]);
  return (
    <div className="flex flex-col gap-[11px] rounded-xl bg-surface-3 px-3.5 py-[13px]">
      <p className="m-0 flex items-start gap-[9px] text-[13px] leading-normal text-fg-muted">
        <Gauge aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
        <span>
          {head}
          {version === null ? null : <> {withMono(t('designer:turn.limitSaved', 'The work so far is saved as {version}.', { version: M1 }), [M1], [version])}</>}
        </span>
      </p>
      {onKeepGoing === undefined ? null : (
        <button type="button" disabled={busy} onClick={onKeepGoing} className={`${SECONDARY} self-start`}>
          {t('designer:turn.keepGoing', 'Keep going')}
        </button>
      )}
    </div>
  );
}

/**
 * Above the message box, for as long as a spending mark is passed. It stops
 * nothing (D92): the person reads it, hears it once, and decides.
 */
export function SpendNotice({ warnings, onNewSession }: { warnings: readonly { which: SpendMark; mark: number }[]; onNewSession?: (() => void) | undefined }): ReactNode {
  if (warnings.length === 0) return null;
  return (
    <div role="alert" className="mx-3.5 mt-2.5 flex shrink-0 flex-col gap-1 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5">
      {warnings.map(({ which, mark }) => (
        <p key={which} className="m-0 flex items-start gap-[9px] text-[12.5px] font-semibold leading-normal text-danger">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
          <span>
            {which === 'turn-tokens'
              ? withMono(t('designer:spend.turn', 'This turn has used more than {value} tokens and is still working. Stop it if that is more than you meant to spend.', { value: M1 }), [M1], [number(mark)])
              : withMono(t('designer:spend.session', 'This session has used more than {value} tokens. Nothing is stopped. A new session starts the count again.', { value: M1 }), [M1], [number(mark)])}
            {which === 'session-tokens' && onNewSession !== undefined ? (
              <>
                {' '}
                <button type="button" onClick={onNewSession} className="font-extrabold underline underline-offset-2 hover:no-underline">
                  {t('designer:spend.newSession', 'Start a new session')}
                </button>
              </>
            ) : null}
          </span>
        </p>
      ))}
    </div>
  );
}

export function FailedNote({ error, onRetry, busy }: { error: { code: string; message: string; provider?: string | undefined; status?: number | undefined }; onRetry?: (() => void) | undefined; busy: boolean }): ReactNode {
  const said =
    error.provider !== undefined && error.status !== undefined
      ? withMono(t('designer:turn.modelFailed', 'The model stopped answering ({provider}, {status}). Nothing was lost.', { provider: error.provider, status: M1 }), [M1], [String(error.status)])
      : t('designer:turn.failed', 'The turn failed: {message} Nothing was lost.', { message: error.message });
  return (
    <div role="alert" className="flex flex-col gap-[11px] rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-[13px]">
      <p className="m-0 flex items-start gap-[9px] text-[13px] font-semibold leading-normal text-danger">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
        <span>{said}</span>
      </p>
      {onRetry === undefined ? null : (
        <button type="button" disabled={busy} onClick={onRetry} className={`${SECONDARY} self-start`}>
          <RotateCw aria-hidden="true" className="size-[13px]" />
          {t('designer:turn.retry', 'Try again')}
        </button>
      )}
    </div>
  );
}

export function NotAppliedNote({ message }: { message: string }): ReactNode {
  return (
    <p role="alert" className="m-0 flex items-start gap-2 text-[12.5px] font-semibold leading-normal text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{t('designer:turn.notApplied', 'This turn’s changes were not applied: {message}', { message })}</span>
    </p>
  );
}
