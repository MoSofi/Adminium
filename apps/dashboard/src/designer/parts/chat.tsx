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
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Blocks,
  FileSpreadsheet,
  ArrowDown,
  Image as ImageIcon,
  Plug,
  Shapes,
  Type,
  Wind,
  Camera,
  Check,
  Copy,
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
  Palette,
  Play,
  RotateCcw,
  RotateCw,
  TriangleAlert,
} from 'lucide-react';

import { getI18nInstance, t } from '../../i18n/t.js';
import { designerApi, LOOK_DIRECTIONS, type DesignerCard, type LimitKind, type NeedItem, type SpendMark, type StyleChoice } from '../api.js';
import { SUBJECT, secondsOf, shortSubject, stepLine } from '../build/stepLine.js';
import type { StepRow } from '../build/turns.js';
import { versionName } from '../build/versionName.js';
import { lookLine, lookName, LookSwatch, StyleSwatch } from './look.js';
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

/** How long "Copied" stays before the button is its icon again. */
const COPIED_MS = 1800;

/**
 * A person's own message. Its text can be selected like any text, and a small
 * button at its lower corner copies the whole of it: shown when the message is
 * pointed at or reached by the keyboard, and always where nothing can hover.
 */
export function PersonMessage({ text }: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  const back = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (back.current !== null) clearTimeout(back.current);
    },
    [],
  );
  const copy = (): void => {
    // A page that may not write to the clipboard (an http address on a network) says nothing more than it can: the text is still there to select.
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    if (back.current !== null) clearTimeout(back.current);
    back.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <div className="group/message flex justify-end">
      <div className="relative min-w-0 max-w-[86%]">
        <p dir="auto" className="m-0 cursor-text select-text whitespace-pre-wrap text-pretty [overflow-wrap:anywhere] rounded-2xl rounded-ee-[6px] bg-surface-3 px-3.5 py-[11px] text-[13.5px] leading-normal text-fg">{text}</p>
        <button
          type="button"
          onClick={copy}
          data-copied={copied}
          aria-label={copied ? t('designer:chat.copied', 'Copied') : t('designer:chat.copy', 'Copy this message')}
          className={`absolute -bottom-3 -start-3 inline-flex h-[26px] min-w-[26px] items-center justify-center gap-[5px] rounded-[8px] border border-border-strong bg-surface text-[11.5px] font-bold leading-[normal] shadow-md transition-opacity focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent group-focus-within/message:opacity-100 group-hover/message:opacity-100 [@media(hover:none)]:opacity-100 ${copied ? 'pe-[9px] ps-2 text-fg opacity-100' : 'text-fg-muted opacity-0 hover:text-fg'}`}
        >
          {copied ? (
            <>
              <Check aria-hidden="true" className="size-[13px] text-pos" />
              <span aria-hidden="true">{t('designer:chat.copied', 'Copied')}</span>
            </>
          ) : (
            <Copy aria-hidden="true" className="size-[13px]" />
          )}
        </button>
      </div>
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
                    ) : row.tool === 'sight' ? (
                      <Camera className="size-[13px]" />
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
      {withMono(t('designer:turn.saved', 'Saved as {version}', { version: M1 }), [M1], [versionName(name)])}
    </span>
  );
}

/** After "Change the look": what it was changed to. */
export function LookChip({ direction }: { direction: string }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-surface-3 px-[9px] py-[3px] text-[11px] font-bold text-fg-muted">
      <Palette aria-hidden="true" className="size-3" />
      {t('designer:look.changed', 'Look changed to {look}', { look: lookName(direction) })}
    </span>
  );
}

/** After "Change the style": what it was changed to, and that its fonts come with the next message when the project lacks them. */
export function StyleChip({ title, fontsLater }: { title: string; fontsLater: boolean }): ReactNode {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 self-start rounded-full bg-accent-soft px-[9px] py-[3px] text-[11px] font-bold text-accent">
      <Palette aria-hidden="true" className="size-3" />
      {t('designer:style.changed', 'Style changed to {style}', { style: title })}
      {fontsLater ? <span className="font-normal">{t('designer:style.fontsLater', 'Its fonts are added when you next send a message.')}</span> : null}
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
  if (card.style !== undefined) return <StyleQuestion card={card} styles={card.style} answered={answered} answer={answer} busy={busy} onChoose={onChoose} onOwnWords={onOwnWords} />;
  if (card.look === true) {
    // The look of the app's screens: the server asks by direction, and the page says it in its own words.
    return (
      <CardShell cardId={card.id} icon={<Palette className="size-4" />} title={t('designer:look.question', 'How should it look?')}>
        {answered ? (
          <p className="m-0 text-[12.5px] text-fg-muted">
            {answer === undefined || answer === '' ? t('designer:card.noAnswer', 'No answer was given.') : t('designer:card.youAnswered', 'You answered: {answer}', { answer: lookName(answer) })}
          </p>
        ) : (
          <>
            <p className="m-0 text-[12.5px] leading-normal text-fg-muted">{t('designer:look.lead', 'Pick a direction for the screens people will see. You can change it afterwards.')}</p>
            <div className="flex flex-col gap-1.5">
              {LOOK_DIRECTIONS.filter((direction) => card.choices.includes(direction)).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  disabled={busy}
                  onClick={() => onChoose(direction)}
                  className="flex items-center gap-2.5 rounded-[10px] border border-border-strong bg-surface px-2.5 py-2 text-start hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <LookSwatch direction={direction} />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[12.5px] font-bold text-fg">{lookName(direction)}</span>
                    <span className="text-[11.5px] leading-snug text-fg-muted">{lookLine(direction)}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button type="button" disabled={busy} onClick={() => onChoose('surprise')} className={PRIMARY}>
                {t('designer:look.surprise', 'Surprise me')}
              </button>
              <button type="button" onClick={onOwnWords} className="text-[12.5px] font-bold text-accent hover:underline">
                {t('designer:look.ownWords', 'Describe it in my own words')}
              </button>
            </div>
          </>
        )}
      </CardShell>
    );
  }
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
          {card.choices.length === 0 ? (
            // No choices: the answer box under the chat is simply there, and takes the answer.
            <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-fg-muted">
              <ArrowDown aria-hidden="true" className="size-3.5" />
              {t('designer:card.typeBelow', 'Type your answer below.')}
            </p>
          ) : (
            <button type="button" onClick={onOwnWords} className="self-start text-[12.5px] font-bold text-accent hover:underline">
              {t('designer:card.ownWords', 'Answer in my own words')}
            </button>
          )}
        </>
      )}
    </CardShell>
  );
}

/** "How should it look?": a few styles that suit, the rest behind "Show all", and the person's own words. */
function StyleQuestion({
  card,
  styles,
  answered,
  answer,
  busy,
  onChoose,
  onOwnWords,
}: {
  card: Extract<DesignerCard, { type: 'question' }>;
  styles: readonly StyleChoice[];
  answered: boolean;
  answer?: string | undefined;
  busy: boolean;
  onChoose: (choice: string) => void;
  onOwnWords: () => void;
}): ReactNode {
  const [all, setAll] = useState(false);
  const byKey = new Map(styles.map((style) => [style.key, style]));
  const first = card.choices.flatMap((key) => byKey.get(key) ?? []);
  const rest = (card.more ?? []).flatMap((key) => byKey.get(key) ?? []);
  const said = answer === undefined || answer === '' ? null : answer === 'surprise' ? t('designer:look.surprise', 'Surprise me') : (byKey.get(answer)?.title ?? answer);
  return (
    <CardShell cardId={card.id} icon={<Palette className="size-4" />} title={t('designer:look.question', 'How should it look?')}>
      {answered ? (
        <p className="m-0 text-[12.5px] text-fg-muted">{said === null ? t('designer:card.noAnswer', 'No answer was given.') : t('designer:card.youAnswered', 'You answered: {answer}', { answer: said })}</p>
      ) : (
        <>
          <p className="m-0 text-[12.5px] leading-normal text-fg-muted">{t('designer:style.lead', 'Pick a style for the screens people will see. You can change it afterwards.')}</p>
          <div className="flex flex-col gap-1.5">
            {[...first, ...(all ? rest : [])].map((style) => (
              <button
                key={style.key}
                type="button"
                disabled={busy}
                onClick={() => onChoose(style.key)}
                className="flex items-center gap-2.5 rounded-[10px] border border-border-strong bg-surface px-2.5 py-2 text-start hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <StyleSwatch swatch={style.swatch} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[12.5px] font-bold text-fg">{style.title}</span>
                  <span dir="auto" className="text-[11.5px] leading-snug text-fg-muted">
                    {style.description}
                  </span>
                </span>
              </button>
            ))}
            {rest.length === 0 || all ? null : (
              <button type="button" onClick={() => setAll(true)} className="self-start text-[12.5px] font-bold text-accent hover:underline">
                {t('designer:style.showAll', 'Show all {count}', { count: first.length + rest.length })}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" disabled={busy} onClick={() => onChoose('surprise')} className={PRIMARY}>
              {t('designer:look.surprise', 'Surprise me')}
            </button>
            <button type="button" onClick={onOwnWords} className="text-[12.5px] font-bold text-accent hover:underline">
              {t('designer:look.ownWords', 'Describe it in my own words')}
            </button>
          </div>
        </>
      )}
    </CardShell>
  );
}

/** What a thing on the needs card is, in the page's words: the server sends what it is, never a sentence. */
function needLine(item: NeedItem): string {
  if (item.kind === 'picture-site') return t('designer:needs.site', 'Pictures from {host} — shown straight from that site', { host: item.host });
  if (item.kind === 'font') {
    if (item.use === 'heading') return t('designer:needs.fontHeading', '{family} — a typeface, for headings', { family: item.family });
    if (item.use === 'body') return t('designer:needs.fontBody', '{family} — a typeface, for the body text', { family: item.family });
    return t('designer:needs.font', '{family} — a typeface', { family: item.family });
  }
  switch (item.role) {
    case 'screens':
      return t('designer:needs.screens', '{name} — what the app’s own screens are built with', { name: item.name });
    case 'public-client':
      return t('designer:needs.publicClient', '{name} — lets the public page talk to your Adminium', { name: item.name });
    case 'tailwind':
      return t('designer:needs.tailwind', 'Tailwind CSS — a styling toolkit, for a finer design');
    case 'icons':
      return t('designer:needs.icons', '{name} — a set of icons', { name: item.name });
    case 'ui':
      return t('designer:needs.ui', '{name} — a small helper for the page’s parts', { name: item.name });
    default:
      return t('designer:needs.other', '{name}', { name: item.name });
  }
}

/** A thing's short name, for "Added: …" and "Left out: …". */
function needShort(item: NeedItem): string {
  if (item.kind === 'picture-site') return t('designer:needs.sitePictures', 'pictures from {host}', { host: item.host });
  if (item.kind === 'font') return item.family;
  return item.role === 'tailwind' ? 'Tailwind CSS' : item.name;
}

function NeedIcon({ item }: { item: NeedItem }): ReactNode {
  const cls = 'mt-[2px] size-3.5 shrink-0 text-fg-subtle';
  if (item.kind === 'picture-site') return <ImageIcon aria-hidden="true" className={cls} />;
  if (item.kind === 'font') return <Type aria-hidden="true" className={cls} />;
  if (item.role === 'public-client') return <Plug aria-hidden="true" className={cls} />;
  if (item.role === 'tailwind') return <Wind aria-hidden="true" className={cls} />;
  if (item.role === 'icons') return <Shapes aria-hidden="true" className={cls} />;
  return <Package aria-hidden="true" className={cls} />;
}

/** Whether Adminium itself knows the thing: those are offered ticked. A name only the Designer vouches for is not. */
const knownNeed = (item: NeedItem): boolean => item.kind !== 'package' || item.role !== 'other';

/**
 * Everything a step needs from outside the project, on one card: a checkbox
 * each, "Select all" and "Deselect all" at the start of the footer, "Send"
 * at its end.
 */
export function NeedsCard({
  card,
  answered,
  closed = false,
  accepted,
  busy,
  onSend,
}: {
  card: Extract<DesignerCard, { type: 'needs' }>;
  answered: boolean;
  /** The turn ended without an answer. */
  closed?: boolean;
  /** The ids ticked, once answered. */
  accepted?: readonly string[] | undefined;
  busy: boolean;
  onSend: (ids: string[]) => void;
}): ReactNode {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(card.items.filter(knownNeed).map((item) => item.id)));
  const group = useId();
  const known = card.items.filter(knownNeed);
  const unknown = card.items.filter((item) => !knownNeed(item));
  const toggle = (id: string): void => {
    setTicked((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const row = (item: NeedItem): ReactNode => {
    const on = ticked.has(item.id);
    const id = `${group}-${item.id}`;
    return (
      <li key={item.id} className="flex items-start gap-2.5">
        <input id={id} type="checkbox" checked={on} disabled={busy} onChange={() => toggle(item.id)} className="mt-[3px] size-3.5 shrink-0 accent-[var(--color-accent)]" />
        <NeedIcon item={item} />
        <label htmlFor={id} className={`flex min-w-0 flex-col gap-0.5 text-[12.5px] leading-snug ${on ? 'text-fg' : 'text-fg-muted'}`}>
          <span>
            <span className="font-semibold">{needLine(item)}</span>
            {item.kind === 'picture-site' ? null : (
              <span dir="ltr" className="ms-1.5 font-mono text-[11px] text-fg-subtle">
                {item.kind === 'package' && item.role === 'other' ? `${item.name} ` : ''}
                {item.version}
              </span>
            )}
          </span>
          {item.kind === 'picture-site' ? <span className="text-[11.5px] text-fg-subtle">{t('designer:needs.siteNote', 'That site then sees each visit to a page that shows its pictures.')}</span> : null}
          {item.why === undefined ? null : (
            <span dir="auto" className="text-[11.5px] text-fg-subtle">
              {t('designer:needs.note', 'The Designer’s note: {why}', { why: item.why })}
            </span>
          )}
        </label>
      </li>
    );
  };
  const title = t('designer:needs.title', 'The design needs a few things. Add them?');
  if (answered || closed) {
    const yes = new Set(accepted ?? []);
    const added = card.items.filter((item) => yes.has(item.id));
    const left = card.items.filter((item) => !yes.has(item.id));
    return (
      <CardShell cardId={card.id} icon={<Package className="size-[15px]" />} title={title}>
        {!answered ? (
          <p className="m-0 text-[12.5px] font-semibold text-fg-muted">{t('designer:card.noAnswer', 'No answer was given.')}</p>
        ) : added.length === 0 ? (
          <p className="m-0 text-[12.5px] font-semibold text-fg-muted">{t('designer:needs.none', 'You chose to add nothing.')}</p>
        ) : (
          <div className="flex flex-col gap-1 text-[12.5px] text-fg-muted">
            <p dir="auto" className="m-0 font-semibold">
              {t('designer:needs.added', 'Added: {list}.', { list: added.map(needShort).join(', ') })}
            </p>
            {left.length === 0 ? null : (
              <p dir="auto" className="m-0">
                {t('designer:needs.left', 'Left out: {list}.', { list: left.map(needShort).join(', ') })}
              </p>
            )}
          </div>
        )}
      </CardShell>
    );
  }
  return (
    <CardShell cardId={card.id} icon={<Package className="size-[15px]" />} title={title}>
      {known.length === 0 ? null : (
        <>
          <p className="m-0 text-[12.5px] leading-normal text-fg-muted">
            {t('designer:needs.lead', 'These are common, free and widely used. Adminium asks because it adds nothing to your project without your yes.')}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{known.map(row)}</ul>
        </>
      )}
      {unknown.length === 0 ? null : (
        <div className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface-2 p-2.5">
          <p className="m-0 text-[12px] font-bold text-fg">{t('designer:needs.unknownHead', 'Asked for by the Designer')}</p>
          <p className="m-0 text-[12px] leading-normal text-fg-muted">{t('designer:needs.unknownLead', 'Adminium does not know these. Add one only if you recognise it.')}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{unknown.map(row)}</ul>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" disabled={busy} onClick={() => setTicked(new Set(card.items.map((item) => item.id)))} className="text-[12.5px] font-bold text-accent hover:underline disabled:opacity-50">
            {t('designer:needs.selectAll', 'Select all')}
          </button>
          <button type="button" disabled={busy} onClick={() => setTicked(new Set())} className="text-[12.5px] font-bold text-accent hover:underline disabled:opacity-50">
            {t('designer:needs.deselectAll', 'Deselect all')}
          </button>
        </div>
        <button type="button" disabled={busy} onClick={() => onSend(card.items.filter((item) => ticked.has(item.id)).map((item) => item.id))} className={PRIMARY}>
          {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          {busy ? t('designer:needs.adding', 'Adding…') : ticked.size === 0 ? t('designer:needs.sendNone', 'Send — add nothing') : t('designer:needs.send', 'Send')}
        </button>
      </div>
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
  const all = [{ name: card.name, version: card.version }, ...(card.also ?? [])];
  const many = all.length > 1;
  const title = many
    ? withMono(
        t('designer:card.packages', 'Packages are needed: {list}. Add them?', { list: M1 }),
        [M1],
        [all.map((entry) => `${entry.name} (${entry.version})`).join(', ')],
      )
    : withMono(t('designer:card.package', 'A package is needed: {name} ({version}). Add it?', { name: M1, version: M2 }), [M1, M2], [card.name, card.version]);
  return (
    <CardShell cardId={card.id} icon={<Package className="size-[15px]" />} title={title}>
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
            {many ? t('designer:card.addThem', 'Add them') : t('designer:card.addIt', 'Add it')}
          </button>
          <button type="button" disabled={busy} onClick={onSkip} className={SECONDARY}>
            {t('designer:card.doWithout', 'Do without')}
          </button>
        </div>
      )}
    </CardShell>
  );
}

/** An add-on the app needs and this server does not have. Every word of it is the server's own: the model gave a key. */
export function AddOnCard({
  card,
  answered,
  closed = false,
  accepted,
  busy,
  onGet,
  onSkip,
}: {
  card: Extract<DesignerCard, { type: 'add-on' }>;
  answered: boolean;
  /** The turn ended without an answer. */
  closed?: boolean;
  accepted?: boolean | undefined;
  busy: boolean;
  onGet: () => void;
  onSkip: () => void;
}): ReactNode {
  const off = card.listOff === true;
  const here = card.here === true;
  const title = off
    ? withMono(t('designer:card.addOnOff', 'This app needs the add-on {key}, which is not on this server. Switch the list of adminium.dev on to look for it?', { key: M1 }), [M1], [card.key])
    : here
      ? t('designer:card.addOnHere', 'This app needs the add-on {name} ({version}). It is on this server and not installed. Install it?', { name: card.name, version: card.version ?? '' })
      : t('designer:card.addOn', 'This app needs the add-on {name} ({version}), which is not on this server. Get it?', { name: card.name, version: card.version ?? '' });
  return (
    <CardShell cardId={card.id} icon={<Blocks className="size-[15px]" />} title={title}>
      {card.line === '' ? null : (
        <p dir="auto" className="m-0 text-[12.5px] leading-normal text-fg-muted">
          {card.line}
        </p>
      )}
      {card.tables === undefined || off ? null : (
        <p className="m-0 text-[12.5px] leading-normal text-fg-muted">
          {t('designer:card.addOnTables', '{count, plural, one {It adds # table to your database.} other {It adds # tables to your database.}}', { count: card.tables })}
        </p>
      )}
      <p className="m-0 text-[12.5px] leading-normal text-fg-muted">
        {off
          ? t(
              'designer:card.addOnOffSends',
              'The list of adminium.dev is off on this server. Switching it on asks adminium.dev for the list, now and once a day, which tells it this server’s address, the time and its Adminium version. Nothing is downloaded yet: if the add-on is in the list, you are asked again, by its name and version. Studio → Add-ons switches the list off again.',
            )
          : here
            ? t('designer:card.addOnHereSends', 'Nothing is downloaded. It is installed on this server, as Studio → Add-ons would install it.')
            : t('designer:card.addOnSends', 'It is downloaded from adminium.dev, which names this add-on and its version to adminium.dev, and installed on this server, as Studio → Add-ons would install it.')}
      </p>
      {closed && !answered ? (
        <p className="m-0 text-[12.5px] font-semibold text-fg-muted">{t('designer:card.noAnswer', 'No answer was given.')}</p>
      ) : answered ? (
        <p className="m-0 text-[12.5px] font-semibold text-fg-muted">{accepted === true ? t('designer:card.packageYes', 'You said yes.') : t('designer:card.packageNo', 'You said to do without it.')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onGet} className={PRIMARY}>
            {off ? t('designer:card.addOnSwitchOn', 'Switch the list on') : here ? t('designer:card.addOnInstall', 'Install it') : t('designer:card.addOnGet', 'Get it')}
          </button>
          <button type="button" disabled={busy} onClick={onSkip} className={SECONDARY}>
            {t('designer:card.doWithout', 'Do without')}
          </button>
        </div>
      )}
    </CardShell>
  );
}

/** Rows of a CSV the person attached, into one of the app's tables. Every word is the server's own; nothing is loaded before the yes. */
export function RowsCard({
  card,
  answered,
  closed = false,
  accepted,
  busy,
  onLoad,
  onSkip,
}: {
  card: Extract<DesignerCard, { type: 'rows' }>;
  answered: boolean;
  /** The turn ended without an answer. */
  closed?: boolean;
  accepted?: boolean | undefined;
  busy: boolean;
  onLoad: () => void;
  onSkip: () => void;
}): ReactNode {
  const title = withMono(
    t('designer:card.rows', '{count, plural, one {Load # row from {file} into {table}?} other {Load # rows from {file} into {table}?}}', { count: card.rows, file: M1, table: M2 }),
    [M1, M2],
    [card.file, card.table],
  );
  return (
    <CardShell cardId={card.id} icon={<FileSpreadsheet className="size-[15px]" />} title={title}>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12.5px] leading-normal text-fg-muted">
        {card.mapping.map((pair) => (
          <li key={`${pair.from}\u0000${pair.to}`} dir="auto">
            <span className="font-semibold text-fg">{pair.from}</span> → <span className="font-mono text-[12px]">{pair.to}</span>
          </li>
        ))}
      </ul>
      {card.left === 0 ? null : (
        <p dir="auto" className="m-0 text-[12.5px] leading-normal text-fg-muted">
          {t('designer:card.rowsLeft', '{count, plural, one {# row does not pass the table’s checks and is left out.} other {# rows do not pass the table’s checks and are left out.}}', { count: card.left })}
          {card.reasons.length === 0 ? null : ` ${card.reasons.slice(0, 3).join('; ')}`}
        </p>
      )}
      <p className="m-0 text-[12.5px] leading-normal text-fg-muted">
        {t('designer:card.rowsHow', 'They are added as new rows, through the same checks as any import. Imports in the dashboard keeps the report.')}
      </p>
      {closed && !answered ? (
        <p className="m-0 text-[12.5px] font-semibold text-fg-muted">{t('designer:card.noAnswer', 'No answer was given.')}</p>
      ) : answered ? (
        <p className="m-0 text-[12.5px] font-semibold text-fg-muted">{accepted === true ? t('designer:card.packageYes', 'You said yes.') : t('designer:card.rowsNo', 'You said not to load them.')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onLoad} className={PRIMARY}>
            {t('designer:card.rowsLoad', 'Load them')}
          </button>
          <button type="button" disabled={busy} onClick={onSkip} className={SECONDARY}>
            {t('designer:card.rowsSkip', 'Do not load')}
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

/** What a provider said, out of "provider: HTTP 402 — {"error":"…"}": the sentence alone, cut short. */
export function providerWords(message: string): string {
  const after = message.replace(/^[a-z0-9-]+: HTTP \d+\s*[—-]\s*/i, '').trim();
  let words = after;
  try {
    const parsed = JSON.parse(after) as { error?: unknown; message?: unknown };
    const inner = typeof parsed.error === 'string' ? parsed.error : typeof (parsed.error as { message?: unknown } | undefined)?.message === 'string' ? (parsed.error as { message: string }).message : parsed.message;
    if (typeof inner === 'string') words = inner;
  } catch {
    // Not JSON: the words as they are.
  }
  return words.length > 300 ? `${words.slice(0, 299)}…` : words;
}

export function FailedNote({ error, onRetry, busy }: { error: { code: string; message: string; provider?: string | undefined; status?: number | undefined }; onRetry?: (() => void) | undefined; busy: boolean }): ReactNode {
  const said =
    error.provider !== undefined && error.status !== undefined
      ? withMono(t('designer:turn.modelFailed', 'The model stopped answering ({provider}, {status}). Nothing was lost.', { provider: error.provider, status: M1 }), [M1], [String(error.status)])
      : t('designer:turn.failed', 'The turn failed: {message} Nothing was lost.', { message: error.message });
  // The provider's own words, when it gave a reason a person can act on ("add usage credits"): shown as text, never as a link.
  const theirs = error.provider !== undefined && error.status !== undefined && error.status >= 400 && error.status < 500 ? providerWords(error.message) : '';
  return (
    <div role="alert" className="flex flex-col gap-[11px] rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-[13px]">
      <p className="m-0 flex items-start gap-[9px] text-[13px] font-semibold leading-normal text-danger">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-[15px] shrink-0" />
        <span>{said}</span>
      </p>
      {theirs === '' ? null : (
        <p dir="auto" className="m-0 ms-6 break-words text-[12px] leading-normal text-fg-muted">
          {theirs}
        </p>
      )}
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

const PICTURE_SHAPE: Record<'wide' | 'tall' | 'square', string> = { wide: 'aspect-[16/10]', tall: 'aspect-[4/5]', square: 'aspect-square' };

/**
 * Free pictures the Designer found, in groups by what each is for: a
 * checkbox on each, all ticked at first, "None of these" per group, and the
 * same footer as the needs card. A picture is shown from this server.
 */
export function PicturesCard({
  card,
  sessionId,
  answered,
  closed = false,
  accepted,
  busy,
  onSend,
}: {
  card: Extract<DesignerCard, { type: 'pictures' }>;
  sessionId: string;
  answered: boolean;
  /** The turn ended without an answer. */
  closed?: boolean;
  accepted?: readonly string[] | undefined;
  busy: boolean;
  onSend: (ids: string[]) => void;
}): ReactNode {
  const all = card.groups.flatMap((group) => group.pictures.map((picture) => picture.id));
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(all));
  const title = t('designer:pictures.title', 'Pictures for the page. Use them?');
  const icon = <ImageIcon className="size-[15px]" />;
  if (answered || closed) {
    const count = (accepted ?? []).length;
    return (
      <CardShell cardId={card.id} icon={icon} title={title}>
        <p className="m-0 text-[12.5px] font-semibold text-fg-muted">
          {!answered
            ? t('designer:card.noAnswer', 'No answer was given.')
            : count === 0
              ? t('designer:pictures.noneChosen', 'You chose none. The Designer will draw tiles instead.')
              : t('designer:pictures.added', 'Pictures added: {count}. Their credits are kept with them.', { count })}
        </p>
      </CardShell>
    );
  }
  const set = (ids: readonly string[], on: boolean): void => {
    setTicked((before) => {
      const next = new Set(before);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  return (
    <CardShell cardId={card.id} icon={icon} title={title}>
      <p className="m-0 text-[12.5px] leading-normal text-fg-muted">
        {t('designer:pictures.lead', 'Free pictures the Designer found. Tick the ones to use: they are copied into your app, with their credits.')}
      </p>
      {card.site === undefined ? null : (
        <p className="m-0 text-[12.5px] leading-normal text-fg-muted">
          {t('designer:pictures.shownFrom', 'Some of these are shown straight from {site}, not copied. That site then sees each visit to a page that shows them.', { site: card.site })}
        </p>
      )}
      {card.groups.map((group) => (
        <div key={group.id} role="group" aria-label={group.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span dir="auto" className="text-[12px] font-bold text-fg">
              {group.label}
            </span>
            <button type="button" disabled={busy} onClick={() => set(group.pictures.map((picture) => picture.id), false)} className="shrink-0 text-[11.5px] font-bold text-accent hover:underline disabled:opacity-50">
              {t('designer:pictures.noneOfThese', 'None of these')}
            </button>
          </div>
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
            {group.pictures.map((picture) => {
              const on = ticked.has(picture.id);
              return (
                <li key={picture.id}>
                  <label className={`relative flex cursor-pointer flex-col gap-1 rounded-lg border p-1 ${on ? 'border-accent ring-1 ring-accent' : 'border-border-strong opacity-60'}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy}
                      onChange={() => set([picture.id], !on)}
                      aria-label={t('designer:pictures.use', 'Use the picture “{title}” by {creator}', { title: picture.title, creator: picture.creator })}
                      className="absolute start-2 top-2 size-4 accent-[var(--color-accent)]"
                    />
                    <img src={designerApi.pictureThumbUrl(sessionId, card.shelf, picture.id)} alt="" loading="lazy" className={`w-full rounded-md bg-surface-3 object-cover ${PICTURE_SHAPE[group.shape]}`} />
                    <span dir="auto" className="truncate px-0.5 text-[11px] text-fg-subtle">
                      {t('designer:pictures.by', '{creator} · {licence}', { creator: picture.creator, licence: picture.licence })}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" disabled={busy} onClick={() => set(all, true)} className="text-[12.5px] font-bold text-accent hover:underline disabled:opacity-50">
            {t('designer:needs.selectAll', 'Select all')}
          </button>
          <button type="button" disabled={busy} onClick={() => set(all, false)} className="text-[12.5px] font-bold text-accent hover:underline disabled:opacity-50">
            {t('designer:needs.deselectAll', 'Deselect all')}
          </button>
        </div>
        <button type="button" disabled={busy} onClick={() => onSend(all.filter((id) => ticked.has(id)))} className={PRIMARY}>
          {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          {busy ? t('designer:pictures.copying', 'Copying…') : ticked.size === 0 ? t('designer:pictures.sendNone', 'Send — use none') : t('designer:needs.send', 'Send')}
        </button>
      </div>
    </CardShell>
  );
}
