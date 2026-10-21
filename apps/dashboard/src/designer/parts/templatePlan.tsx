// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The plan for building an app from a site template, asked once: a short card in the chat, and
 * "Review the plan…" opens the whole plan in a sheet at the side. The person ticks what becomes a
 * table, reads what the forms do, decides how each thing Adminium does not have is handled, fills the
 * links that lead nowhere and ticks what is added to the project. "Build this" sends the answer;
 * words in the last section are sent instead, and then nothing is approved.
 *
 * Every word of the plan is the template's or the model's: drawn as text, never as markup.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Blocks, Check, ChevronDown, CircleAlert, CircleCheck, LayoutTemplate, LoaderCircle, Mail, MessageSquareText, Type, UsersRound, X } from 'lucide-react';
import { Button, Checkbox, Drawer, DrawerClose, DrawerTitle, DrawerTrigger, RadioCard, RadioGroup, Switch } from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import type { DesignerCard, NeedItem, PlanChoice, TemplatePlanAnswer } from '../api.js';
import { CardShell, knownNeed, listOf, NeedIcon, needLine } from './chat.js';

type PlanCard = Extract<DesignerCard, { type: 'template-plan' }>;
type ReportRow = PlanCard['report'][number];

/** The sheet's sections, in order. */
export type PlanSection = 'tables' | 'forms' | 'shows' | 'added' | 'changes';

// Where a node goes in a translated sentence.
const MARK = String.fromCharCode(1);
const MARK2 = String.fromCharCode(2);

/** An address a link box may hold, as the server checks it: https, mailto, tel, or a path of the app (never `//`, which leaves it). */
const LINK = /^(?:https:\/\/[^\s<>"'`]{1,290}|mailto:[^\s<>"'`]{1,200}|tel:\+?[0-9 ()-]{3,30}|\/(?!\/)[A-Za-z0-9/_.-]{0,100})$/;

/** Whether a link box's address can be sent: empty, or one the server takes. */
export function linkFits(address: string): boolean {
  const value = address.trim();
  return value === '' || LINK.test(value);
}

/** The choice a row starts on: Replace where there is one, else Leave out. Never Build. */
export function presetChoice(row: Pick<ReportRow, 'replace'>): PlanChoice {
  return row.replace === undefined ? 'leave' : 'replace';
}

function language(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

function number(value: number): string {
  return new Intl.NumberFormat(language()).format(value);
}

/** "name, price, picture" in the page's language, with no "and". */
function commaList(names: readonly string[]): string {
  try {
    return new Intl.ListFormat(language(), { style: 'short', type: 'unit' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/** A sentence with marks where nodes go. */
function fill(sentence: string, nodes: readonly (readonly [string, ReactNode])[]): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = sentence;
  for (;;) {
    let at = -1;
    let which: (typeof nodes)[number] | undefined;
    for (const entry of nodes) {
      const found = rest.indexOf(entry[0]);
      if (found !== -1 && (at === -1 || found < at)) {
        at = found;
        which = entry;
      }
    }
    if (which === undefined) break;
    out.push(rest.slice(0, at));
    out.push(<span key={out.length}>{which[1]}</span>);
    rest = rest.slice(at + which[0].length);
  }
  out.push(rest);
  return out;
}

/** A count's figure in mono, inside the words that say it. */
function monoCount(text: string, count: number): ReactNode {
  const figure = number(count);
  const at = text.indexOf(figure);
  if (at === -1) return text;
  return [
    text.slice(0, at),
    <span key="n" className="font-mono">
      {figure}
    </span>,
    text.slice(at + figure.length),
  ];
}

/** An answer as the session's history keeps it, read without trusting its shape. */
export function readPlanAnswer(value: unknown): TemplatePlanAnswer | null {
  if (typeof value !== 'object' || value === null) return null;
  const given = value as Record<string, unknown>;
  const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []);
  const decisions: Record<string, PlanChoice> = {};
  const rawDecisions = given['decisions'];
  if (typeof rawDecisions === 'object' && rawDecisions !== null) {
    for (const [id, choice] of Object.entries(rawDecisions)) if (choice === 'build' || choice === 'replace' || choice === 'leave') decisions[id] = choice;
  }
  const links: Record<string, string> = {};
  const rawLinks = given['links'];
  if (typeof rawLinks === 'object' && rawLinks !== null) {
    for (const [id, address] of Object.entries(rawLinks)) if (typeof address === 'string') links[id] = address;
  }
  const changes = typeof given['changes'] === 'string' && given['changes'].trim() !== '' ? given['changes'] : undefined;
  return { tables: strings(given['tables']), decisions, links, takeOutEmpty: given['takeOutEmpty'] !== false, added: strings(given['added']), ...(changes === undefined ? {} : { changes }) };
}

/** What the person has chosen so far: kept by the card, so closing the sheet loses nothing. */
interface Draft {
  tables: ReadonlySet<string>;
  decisions: Readonly<Record<string, PlanChoice>>;
  links: Readonly<Record<string, string>>;
  takeOutEmpty: boolean;
  added: ReadonlySet<string>;
  changes: string;
}

const deciding = (card: PlanCard): ReportRow[] => card.report.filter((row) => row.status === 'not-available');

function startDraft(card: PlanCard): Draft {
  return {
    tables: new Set(card.tables.map((table) => table.table)),
    decisions: Object.fromEntries(deciding(card).map((row) => [row.id, presetChoice(row)])),
    links: {},
    takeOutEmpty: true,
    // As the needs card does: what Adminium knows starts ticked.
    added: new Set(card.added.filter(knownNeed).map((item) => item.id)),
    changes: '',
  };
}

function answerFrom(card: PlanCard, draft: Draft): TemplatePlanAnswer {
  return {
    tables: card.tables.filter((table) => draft.tables.has(table.table)).map((table) => table.table),
    decisions: Object.fromEntries(deciding(card).map((row) => [row.id, draft.decisions[row.id] ?? presetChoice(row)])),
    links: Object.fromEntries(card.links.map((link) => [link.id, (draft.links[link.id] ?? '').trim()])),
    takeOutEmpty: draft.takeOutEmpty,
    added: card.added.filter((item) => draft.added.has(item.id)).map((item) => item.id),
  };
}

function toggled(set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

type PlanTable = PlanCard['tables'][number];

/** A column as the person reads it: its label where the plan has one, else its ref. */
function columnName(table: PlanTable | undefined, ref: string): string {
  return table?.columns.find((column) => column.column === ref)?.label ?? ref;
}

/** What visitors read of a table by the plan, by name; the id is not said. */
function visibleColumns(table: PlanTable): string[] {
  return table.publicRead.filter((ref) => ref !== 'id').map((ref) => columnName(table, ref));
}

/** A table as the person reads it: the plan's label, a form's, else its ref. */
function tableName(card: PlanCard, ref: string): string {
  return card.tables.find((table) => table.table === ref)?.label ?? card.forms.find((form) => form.table === ref)?.tableLabel ?? ref;
}

/** The dashboard rights approved with the plan, as the server keeps them: only on the tables it builds (ticked, or a form's). */
function grantedRoles(card: PlanCard, ticked: ReadonlySet<string>): { role: string; tables: string[] }[] {
  const own = new Set([...ticked, ...card.forms.flatMap((form) => [form.table, ...(form.lines === undefined ? [] : [form.lines])])]);
  return card.roles.map((role) => ({ role: role.role, tables: role.tables.filter((table) => own.has(table)) })).filter((role) => role.tables.length > 0);
}

/** The line an answered card keeps: what was built, replaced and left out. */
function answeredLine(card: PlanCard, said: TemplatePlanAnswer): string {
  const offered = new Set(card.tables.map((table) => table.table));
  const tables = said.tables.filter((id) => offered.has(id)).length;
  const rows = deciding(card);
  const chosen = (choice: PlanChoice): string[] => rows.filter((row) => (said.decisions[row.id] ?? presetChoice(row)) === choice).map((row) => row.label);
  const built = chosen('build');
  const replaced = chosen('replace');
  const left = chosen('leave');
  return [
    t('designer:plan.answeredBuilt', 'Built: {tables, plural, one {# table} other {# tables}}, {forms, plural, one {# form} other {# forms}}.', { tables, forms: card.forms.length }),
    ...(built.length === 0 ? [] : [t('designer:plan.answeredAlso', 'Also built: {labels}.', { labels: listOf(built) })]),
    ...(replaced.length === 0 ? [] : [t('designer:plan.answeredReplaced', 'Replaced: {labels}.', { labels: listOf(replaced) })]),
    left.length === 0 ? t('designer:plan.answeredLeftNothing', 'Left out: nothing.') : t('designer:plan.answeredLeft', 'Left out: {labels}.', { labels: listOf(left) }),
  ].join(' ');
}

/** The card collapsed once it is answered, or once its turn ended without an answer. */
function AnsweredPlan({ card, children }: { card: PlanCard; children: ReactNode }): ReactNode {
  return (
    <div role="group" aria-label={t('designer:plan.answeredLabel', 'Your template, as an app, answered')} data-card-id={card.id} tabIndex={-1} className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3.5 py-3 text-[12.5px] leading-normal outline-none">
      <div className="flex items-center gap-2">
        <LayoutTemplate aria-hidden="true" className="size-[15px] shrink-0 text-accent" />
        <span className="flex-1 text-[13px] font-bold text-fg">{t('designer:plan.title', 'Your template, as an app')}</span>
        <span className="text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">{t('designer:plan.answeredMark', 'Answered')}</span>
      </div>
      {children}
    </div>
  );
}

export function TemplatePlanCard({
  card,
  answered,
  closed = false,
  answer,
  busy,
  onSend,
  start,
}: {
  card: PlanCard;
  answered: boolean;
  /** The turn ended. */
  closed?: boolean;
  /** The answer as the session keeps it, once answered. */
  answer?: unknown;
  busy: boolean;
  onSend: (value: TemplatePlanAnswer) => void;
  /** Where the sheet starts: open, and which sections are open in it. */
  start?: { sheet?: boolean; sections?: readonly PlanSection[] } | undefined;
}): ReactNode {
  const [draft, setDraft] = useState<Draft>(() => startDraft(card));
  const [sheet, setSheet] = useState(start?.sheet === true);
  // Sent and not yet answered: the card says it is building while the answer is on its way.
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!busy && !answered) setSent(false);
  }, [busy, answered]);
  const said = answered ? readPlanAnswer(answer) : null;
  const building = answered ? !closed && said?.changes === undefined : sent && busy;

  // The sheet's button is gone once it builds: focus goes to the card rather than nowhere.
  useEffect(() => {
    if (!building || (document.activeElement !== null && document.activeElement !== document.body)) return;
    const own = [...document.querySelectorAll<HTMLElement>('[data-card-id]')].find((element) => element.dataset['cardId'] === card.id);
    own?.focus();
  }, [building, card.id]);

  if (!answered && closed) {
    return (
      <AnsweredPlan card={card}>
        <span className="font-semibold text-fg-muted">{t('designer:card.noAnswer', 'No answer was given.')}</span>
      </AnsweredPlan>
    );
  }
  if (answered && said?.changes !== undefined) {
    return (
      <AnsweredPlan card={card}>
        <span className="flex items-start gap-2 text-fg-muted">
          <MessageSquareText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
          <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {t('designer:plan.changesSent', 'You asked for changes to the plan: {changes}', { changes: said.changes })}
          </span>
        </span>
      </AnsweredPlan>
    );
  }
  if (answered && closed) {
    return (
      <AnsweredPlan card={card}>
        {said === null ? null : (
          <span className="flex items-start gap-2">
            <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-pos" />
            <span className="text-pretty">
              {answeredLine(card, said)}
            </span>
          </span>
        )}
      </AnsweredPlan>
    );
  }

  const decide = deciding(card).length;
  const summary = t('designer:plan.summary', 'From {name}: {tables, plural, one {# table} other {# tables}}, {forms, plural, one {# form} other {# forms}}, {decide, plural, one {# thing to decide} other {# things to decide}}, {links, plural, one {# link to fill} other {# links to fill}}.', {
    name: MARK,
    tables: card.tables.length,
    forms: card.forms.length,
    decide,
    links: card.links.length,
  });
  const submit = (value: TemplatePlanAnswer): void => {
    setSheet(false);
    if (value.changes === undefined) setSent(true);
    onSend(value);
  };
  return (
    <CardShell cardId={card.id} icon={<LayoutTemplate className="size-[15px]" />} title={t('designer:plan.title', 'Your template, as an app')}>
      <p className="m-0 text-pretty text-[12.5px] leading-normal text-fg-muted">
        {fill(summary, [
          [
            MARK,
            <span dir="auto" className="font-mono font-semibold text-fg">
              {card.site.name}
            </span>,
          ],
        ])}
      </p>
      {building ? (
        <div role="status" className="flex items-center gap-2 border-t border-border pt-3 text-[12.5px] font-bold text-fg-muted">
          <LoaderCircle aria-hidden="true" className="size-[15px] shrink-0 animate-spin text-accent motion-reduce:animate-none" />
          {t('designer:plan.building', 'Building from the plan…')}
        </div>
      ) : (
        <PlanDrawer card={card} open={sheet} onOpenChange={setSheet} draft={draft} setDraft={setDraft} busy={busy} onSubmit={submit} sections={start?.sections} />
      )}
    </CardShell>
  );
}

/** One section of the sheet: a header that opens and closes it, with its count and how it stands. */
function Section({
  n,
  title,
  state,
  count,
  warn = false,
  open,
  onToggle,
  titleId,
  children,
}: {
  n: number;
  title: string;
  state: string;
  count: ReactNode;
  warn?: boolean;
  open: boolean;
  onToggle: () => void;
  titleId: string;
  children: ReactNode;
}): ReactNode {
  const bodyId = `${titleId}-body`;
  return (
    <div className="border-b border-border">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex w-full items-start gap-3 px-[22px] py-4 text-start text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true" className="mt-px flex size-[22px] shrink-0 items-center justify-center rounded-md bg-surface-3 font-mono text-[11.5px] font-bold text-fg-muted">
            {number(n)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span id={titleId} className="text-[14.5px] font-bold leading-[1.4] tracking-[-.01em]">
              {title}
            </span>
            <span className="text-[11.5px] font-normal text-fg-muted">{state}</span>
          </span>
          {count === null ? null : (
            // Not a flex box: the space between the figure and its word would be dropped.
            <span className={`inline-block shrink-0 whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-bold ${warn ? 'bg-warn-soft text-warn' : 'bg-surface-3 text-fg-muted'}`}>{count}</span>
          )}
          <ChevronDown aria-hidden="true" className={`mt-[3px] size-4 shrink-0 text-fg-subtle transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </button>
      </h3>
      <div id={bodyId} role="region" aria-labelledby={titleId} hidden={!open} className="px-[22px] pb-5">
        {children}
      </div>
    </div>
  );
}

/** A thing the template shows that Adminium does not have: Build, Replace (where there is one) or Leave out. */
function Decision({ row, value, busy, onChange }: { row: ReportRow; value: PlanChoice; busy: boolean; onChange: (choice: PlanChoice) => void }): ReactNode {
  const id = useId();
  const options: { value: PlanChoice; verb: string; words: string | undefined; note?: string }[] = [
    {
      value: 'build',
      verb: t('designer:plan.build', 'Build'),
      words: row.build,
      ...(row.buildServerCode ? { note: t('designer:plan.serverCode', 'You approve each piece of server code as it is written.') } : {}),
    },
    ...(row.replace === undefined ? [] : [{ value: 'replace' as const, verb: t('designer:plan.replace', 'Replace'), words: row.replace }]),
    { value: 'leave', verb: t('designer:plan.leave', 'Leave out'), words: row.leave },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span id={id} dir="auto" className="text-[14px] font-bold text-fg">
          {row.label}
        </span>
        <span className="whitespace-nowrap rounded-md bg-warn-soft px-[7px] py-0.5 text-[10.5px] font-bold uppercase tracking-[.05em] text-warn">{t('designer:plan.notAvailable', 'Not available')}</span>
        <span dir="auto" className="text-[11.5px] text-fg-subtle">
          {row.where}
        </span>
      </div>
      <RadioGroup aria-labelledby={id} value={value} disabled={busy} onValueChange={(next) => onChange(next as PlanChoice)} className="gap-2">
        {options.map((option) => (
          <RadioCard
            key={option.value}
            value={option.value}
            className="py-3 pe-9 ps-3.5"
            title={
              <span className="text-pretty font-normal leading-normal">
                {option.words === undefined
                  ? <span className="font-bold">{option.verb}</span>
                  : fill(t('designer:plan.option', '{verb}: {words}', { verb: MARK, words: MARK2 }), [
                      [MARK, <span className="font-bold">{option.verb}</span>],
                      [MARK2, <span dir="auto">{option.words}</span>],
                    ])}
              </span>
            }
            description={option.note}
          />
        ))}
      </RadioGroup>
    </div>
  );
}

function PlanDrawer({
  card,
  open,
  onOpenChange,
  draft,
  setDraft,
  busy,
  onSubmit,
  sections,
}: {
  card: PlanCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: Draft;
  setDraft: (change: (before: Draft) => Draft) => void;
  busy: boolean;
  onSubmit: (value: TemplatePlanAnswer) => void;
  sections?: readonly PlanSection[] | undefined;
}): ReactNode {
  const subId = useId();
  return (
    <Drawer open={open} onOpenChange={onOpenChange} aria-describedby={subId} className="w-[560px] max-w-full max-md:w-full max-md:border-s-0">
      <DrawerTrigger asChild>
        <Button size="lg" disabled={busy} className="w-full rounded-[10px] font-bold">
          {t('designer:plan.review', 'Review the plan…')}
        </Button>
      </DrawerTrigger>
      <PlanSheet card={card} draft={draft} setDraft={setDraft} busy={busy} onSubmit={onSubmit} sections={sections} subId={subId} />
    </Drawer>
  );
}

/** The whole plan, in the sheet: five sections and the footer's button. */
function PlanSheet({
  card,
  draft,
  setDraft,
  busy,
  onSubmit,
  sections,
  subId,
}: {
  card: PlanCard;
  draft: Draft;
  setDraft: (change: (before: Draft) => Draft) => void;
  busy: boolean;
  onSubmit: (value: TemplatePlanAnswer) => void;
  sections?: readonly PlanSection[] | undefined;
  subId: string;
}): ReactNode {
  const base = useId();
  const [open, setOpen] = useState<ReadonlySet<PlanSection>>(() => new Set(sections ?? ['tables']));
  const [worksOpen, setWorksOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState<ReadonlySet<string>>(new Set());
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  // A Build with an address that does not fit: every bad box says so, and the first one takes focus.
  const [tried, setTried] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tried === 0) return;
    body.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
  }, [tried]);

  const toggleSection = (key: PlanSection): void => setOpen((before) => toggled(before, key, !before.has(key)) as ReadonlySet<PlanSection>);
  const changes = draft.changes.trim();
  const rows = deciding(card);
  const works = card.report.filter((row) => row.status === 'works');
  const addOns = card.report.filter((row) => row.status === 'add-on');
  const emptyLinks = card.links.filter((link) => (draft.links[link.id] ?? '').trim() === '').length;
  const tickedTables = card.tables.filter((table) => draft.tables.has(table.table)).length;
  const tickedAdded = card.added.filter((item) => draft.added.has(item.id)).length;
  const known = card.added.filter(knownNeed);
  const unknown = card.added.filter((item) => !knownNeed(item));

  const submit = (): void => {
    if (card.links.some((link) => !linkFits(draft.links[link.id] ?? ''))) {
      setOpen((before) => new Set([...before, 'shows']));
      setTried((count) => count + 1);
      return;
    }
    const value = answerFrom(card, draft);
    onSubmit(changes === '' ? value : { ...value, changes });
  };

  const roles = grantedRoles(card, draft.tables);
  const rolesBlock =
    roles.length === 0 ? null : (
      <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3">
        {roles.map((role) => (
          <p key={role.role} className="m-0 flex items-start gap-2 text-[12.5px] leading-normal text-fg">
            <UsersRound aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
            <span>
              {fill(t('designer:plan.rolesEdit', 'Who edits them in the dashboard: {role} ({tables})', { role: MARK, tables: MARK2 }), [
                [
                  MARK,
                  <span dir="auto" className="font-bold">
                    {role.role}
                  </span>,
                ],
                [MARK2, <span dir="auto">{commaList(role.tables.map((table) => tableName(card, table)))}</span>],
              ])}
            </span>
          </p>
        ))}
      </div>
    );
  const shownSections: { key: PlanSection; title: string; state: string; count: ReactNode; warn?: boolean; body: ReactNode }[] = [];
  if (card.tables.length > 0) {
    shownSections.push({
      key: 'tables',
      title: t('designer:plan.tablesTitle', 'What becomes a table'),
      state:
        tickedTables === card.tables.length
          ? t('designer:plan.allTicked', 'All ticked')
          : t('designer:plan.tablesSome', '{ticked} ticked, {fixed, plural, one {# stays fixed text} other {# stay fixed text}}', { ticked: tickedTables, fixed: card.tables.length - tickedTables }),
      count: monoCount(t('designer:plan.tablesCount', '{count, plural, one {# table} other {# tables}}', { count: card.tables.length }), card.tables.length),
      body: (
        <>
          <p className="m-0 mb-1 text-[12.5px] leading-normal text-fg-muted">{t('designer:plan.tablesHint', 'An unticked table stays fixed text on the page.')}</p>
          <ul className="m-0 list-none p-0">
            {card.tables.map((table, index) => {
              const on = draft.tables.has(table.table);
              const names = table.columns.map((column) => column.label);
              const more = names.length > 3;
              const expanded = more && columnsOpen.has(table.table);
              // Approved as a public read only when the table is ticked.
              const seen = visibleColumns(table);
              const columnsLine = more ? t('designer:plan.columnsMore', '{list} and {count} more', { list: commaList(names.slice(0, 3)), count: names.length - 3 }) : commaList(names);
              const line = fill(t('designer:plan.tableLine', '{table}: {columns}', { table: MARK, columns: MARK2 }), [
                [MARK, <span dir="auto" className="font-bold">{table.label}</span>],
                [MARK2, <span className="text-fg-muted">{columnsLine}</span>],
              ]);
              return (
                <li key={table.table} className={`flex items-start gap-3 py-[13px] ${index > 0 ? 'border-t border-border' : ''}`}>
                  <Checkbox
                    checked={on}
                    disabled={busy}
                    onCheckedChange={(next) => setDraft((before) => ({ ...before, tables: toggled(before.tables, table.table, next === true) }))}
                    aria-label={t('designer:plan.makeTable', 'Make {table} a table', { table: table.label })}
                    className="mt-0.5"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {more ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setColumnsOpen((before) => toggled(before, table.table, !before.has(table.table)))}
                        className="flex items-start gap-1.5 text-start text-[13px] leading-normal text-fg focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <span>{line}</span>
                        <ChevronDown aria-hidden="true" className={`mt-[3px] size-3.5 shrink-0 text-fg-subtle transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                    ) : (
                      <span className="text-[13px] leading-normal text-fg">
                        {line}
                      </span>
                    )}
                    {expanded ? (
                      <ul className="m-0 my-1 flex list-none flex-wrap gap-[5px] p-0">
                        {table.columns.map((column) => (
                          <li key={column.column} dir="auto" className="rounded-md bg-surface-3 px-[7px] py-0.5 font-mono text-[11.5px] font-medium text-fg">
                            {column.label}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {table.shownOn.length === 0 ? null : (
                      <span className="text-[11.5px] text-fg-muted">
                        {t('designer:plan.shownOn', 'Shown on {pages}', { pages: commaList(table.shownOn) })}
                      </span>
                    )}
                    {on && seen.length > 0 ? (
                      <span className="text-[11.5px] text-fg-muted">
                        {fill(t('designer:plan.visitorsSee', 'Visitors see: {columns}', { columns: MARK }), [
                          [
                            MARK,
                            <span dir="auto" className="text-fg">
                              {/* Folded, a long list is cut as the columns are. */}
                              {more && !expanded && seen.length > 3 ? t('designer:plan.columnsMore', '{list} and {count} more', { list: commaList(seen.slice(0, 3)), count: seen.length - 3 }) : commaList(seen)}
                            </span>,
                          ],
                        ])}
                      </span>
                    ) : null}
                    <span className="text-[11.5px] text-fg-muted">{samplesLine(table)}</span>
                    {table.addOnInfo === undefined ? null : (
                      <span className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
                        <Blocks aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" />
                        {table.addOnInfo.installed ? t('designer:plan.addOnTable', 'Built on the {name} add-on', { name: table.addOnInfo.name }) : t('designer:plan.addOnTableMissing', 'Built on the {name} add-on, which is not installed yet', { name: table.addOnInfo.name })}
                      </span>
                    )}
                    {on ? null : (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-bold text-fg">
                        <Type aria-hidden="true" className="size-[13px] shrink-0 text-fg-subtle" />
                        {t('designer:plan.fixed', 'Stays fixed text on the page.')}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {rolesBlock}
        </>
      ),
    });
  }
  if (card.forms.length > 0) {
    shownSections.push({
      key: 'forms',
      title: t('designer:plan.formsTitle', 'What the forms do'),
      state: t('designer:plan.formsState', 'Each writes to a table'),
      count: monoCount(t('designer:plan.formsCount', '{count, plural, one {# form} other {# forms}}', { count: card.forms.length }), card.forms.length),
      body: (
        <>
        <ul className="m-0 list-none p-0">
          {card.forms.map((form) => {
            const sentence =
              form.perHour === null
                ? t('designer:plan.formAnyone', '{form}: writes to {table}. Anyone can send it.', { form: MARK, table: form.tableLabel })
                : t('designer:plan.formLimit', '{form}: writes to {table}. Anyone can send it, up to {count, plural, one {# time} other {# times}} an hour.', { form: MARK, table: form.tableLabel, count: form.perHour });
            const lines = form.lines === undefined ? null : (card.tables.find((table) => table.table === form.lines)?.label ?? form.lines);
            return (
              <li key={form.form} className="flex items-start gap-3 py-[13px]">
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-fg-muted">
                  <Mail className="size-[15px]" />
                </span>
                <span className="min-w-0 flex-1 text-pretty text-[13px] leading-normal text-fg">
                  {fill(sentence, [[MARK, <span dir="auto" className="font-bold">{form.label}</span>]])}
                  {lines === null ? null : <> {t('designer:plan.formLines', 'Its lines are written to {table}.', { table: lines })}</>}
                  <span className="mt-0.5 block text-[11.5px] text-fg-muted">
                    {fill(t('designer:plan.visitorsFill', 'Visitors fill in: {columns}', { columns: MARK }), [
                      [
                        MARK,
                        <span dir="auto" className="text-fg">
                          {commaList([
                            ...form.writable.map((ref) => columnName(card.tables.find((table) => table.table === form.table), ref)),
                            // Each line of an order sends its own columns too.
                            ...(form.linesWritable ?? []).map((ref) => columnName(card.tables.find((table) => table.table === form.lines), ref)),
                          ])}
                        </span>,
                      ],
                    ])}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        {/* With no tables of its own, the plan's rights are said with its forms. */}
        {card.tables.length === 0 ? rolesBlock : null}
        </>
      ),
    });
  }
  if (card.report.length > 0 || card.links.length > 0) {
    const worksState = t('designer:plan.showsWorks', '{count, plural, one {# works as it is} other {# work as they are}}', { count: works.length });
    const linksState = card.links.length === 0 ? null : emptyLinks === 0 ? t('designer:plan.linksFilled', 'all links filled') : t('designer:plan.linksEmpty', '{empty} of {total, plural, one {# link} other {# links}} empty', { empty: emptyLinks, total: card.links.length });
    shownSections.push({
      key: 'shows',
      title: t('designer:plan.showsTitle', 'What the template shows'),
      state: linksState === null ? worksState : `${worksState} · ${linksState}`,
      count: rows.length === 0 ? null : monoCount(t('designer:plan.showsCount', '{count} to decide', { count: rows.length }), rows.length),
      warn: true,
      body: (
        <div className="flex flex-col gap-5">
          {works.length === 0 ? null : (
            <div className="overflow-hidden rounded-[10px] border border-border">
              <button type="button" aria-expanded={worksOpen} onClick={() => setWorksOpen((before) => !before)} className="flex w-full items-center gap-2.5 bg-surface-2 px-3.5 py-[13px] text-start text-fg hover:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
                <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-pos" />
                <span className="flex-1 text-[13px] font-bold">{monoCount(t('designer:plan.worksRow', '{count, plural, one {# thing works as it is} other {# things work as they are}}', { count: works.length }), works.length)}</span>
                <ChevronDown aria-hidden="true" className={`size-[15px] shrink-0 text-fg-subtle transition-transform duration-150 motion-reduce:transition-none ${worksOpen ? 'rotate-180' : ''}`} />
              </button>
              {worksOpen ? (
                <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3.5 gap-y-1.5 border-t border-border px-3.5 pb-3 pt-2.5">
                  {works.map((row) => (
                    <li key={row.id} className="flex items-start gap-1.5 text-[12.5px] leading-normal text-fg">
                      <Check aria-hidden="true" className="mt-0.5 size-[13px] shrink-0 text-pos" />
                      <span dir="auto">{row.label}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          {addOns.length === 0 ? null : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {addOns.map((row) => (
                <li key={row.id} className="flex items-start gap-2.5 text-[13px] leading-normal text-fg">
                  <Blocks aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span dir="auto" className="font-bold">
                      {row.label}
                    </span>
                    <span className="text-[11.5px] text-fg-muted">
                      {fill(t('designer:plan.addOnRow', 'Works with the {addOn} add-on', { addOn: MARK }), [
                        [
                          MARK,
                          <span dir="ltr" className="font-mono">
                            {row.addOn ?? ''}
                          </span>,
                        ],
                      ])}
                    </span>
                    <span dir="auto" className="text-[11.5px] text-fg-subtle">
                      {row.where}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {rows.map((row) => (
            <Decision key={row.id} row={row} value={draft.decisions[row.id] ?? presetChoice(row)} busy={busy} onChange={(choice) => setDraft((before) => ({ ...before, decisions: { ...before.decisions, [row.id]: choice } }))} />
          ))}
          {card.links.length === 0 ? null : (
            <div className={`flex flex-col gap-3 ${works.length + addOns.length + rows.length > 0 ? 'border-t border-border pt-[18px]' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-fg">{t('designer:plan.linksTitle', 'Links to fill')}</span>
                <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[11.5px] font-bold text-fg-muted">{number(card.links.length)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
                <label htmlFor={`${base}-take-out`} className="text-[13px] font-semibold text-fg">
                  {t('designer:plan.takeOut', 'Take out the links I leave empty')}
                </label>
                <Switch id={`${base}-take-out`} checked={draft.takeOutEmpty} disabled={busy} onCheckedChange={(next) => setDraft((before) => ({ ...before, takeOutEmpty: next }))} />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-3.5 gap-y-3">
                {card.links.map((link, index) => {
                  const value = draft.links[link.id] ?? '';
                  const bad = (tried > 0 || touched.has(link.id)) && !linkFits(value);
                  const inputId = `${base}-link-${String(index)}`;
                  return (
                    <div key={link.id} className="flex min-w-0 flex-col gap-[5px]">
                      <label htmlFor={inputId} className="text-[12.5px] font-bold text-fg">
                        <span dir="auto">{link.label}</span>
                      </label>
                      <input
                        id={inputId}
                        type="url"
                        dir="ltr"
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="https://"
                        value={value}
                        disabled={busy}
                        onChange={(event) => {
                          const next = event.target.value;
                          setDraft((before) => ({ ...before, links: { ...before.links, [link.id]: next } }));
                        }}
                        onBlur={() => setTouched((before) => toggled(before, link.id, true))}
                        aria-invalid={bad ? true : undefined}
                        aria-describedby={bad ? `${inputId}-error` : undefined}
                        className={`w-full rounded-[10px] border bg-surface px-[11px] py-2 font-mono text-[12.5px] font-medium text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${bad ? 'border-danger' : 'border-border-strong'}`}
                      />
                      {bad ? (
                        <span id={`${inputId}-error`} className="flex items-start gap-1.5 text-[11.5px] font-semibold leading-snug text-danger">
                          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                          {t('designer:plan.linkBad', 'Use an address that starts with https://, mailto: or tel:, or a page of the app like /about.')}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ),
    });
  }
  if (card.added.length > 0) {
    const item = (entry: NeedItem, index: number): ReactNode => {
      const id = `${base}-added-${String(index)}`;
      const on = draft.added.has(entry.id);
      return (
        <li key={entry.id} className={`flex items-start gap-3 py-[13px] ${index > 0 ? 'border-t border-border' : ''}`}>
          <Checkbox id={id} checked={on} disabled={busy} onCheckedChange={(next) => setDraft((before) => ({ ...before, added: toggled(before.added, entry.id, next === true) }))} className="mt-0.5" />
          <NeedIcon item={entry} />
          <label htmlFor={id} className={`flex min-w-0 flex-1 flex-col gap-0.5 text-[13px] leading-normal ${on ? 'text-fg' : 'text-fg-muted'}`}>
            <span>
              <span className="font-semibold">{needLine(entry)}</span>
              {entry.kind === 'picture-site' ? null : (
                <span dir="ltr" className="ms-1.5 font-mono text-[11px] text-fg-subtle">
                  {entry.kind === 'package' && entry.role === 'other' ? `${entry.name} ` : ''}
                  {entry.version}
                </span>
              )}
            </span>
            {entry.why === undefined ? null : (
              <span dir="auto" className="text-[11.5px] text-fg-subtle">
                {t('designer:needs.note', 'The Designer’s note: {why}', { why: entry.why })}
              </span>
            )}
          </label>
        </li>
      );
    };
    shownSections.push({
      key: 'added',
      title: t('designer:plan.addedTitle', 'Added to the project'),
      state: tickedAdded === card.added.length ? t('designer:plan.allTicked', 'All ticked') : t('designer:plan.addedSome', '{ticked} of {total} ticked', { ticked: tickedAdded, total: card.added.length }),
      count: <span className="font-mono">{number(card.added.length)}</span>,
      body: (
        <>
          {known.length === 0 ? null : <ul className="m-0 list-none p-0">{known.map(item)}</ul>}
          {unknown.length === 0 ? null : (
            <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border-strong bg-surface-2 px-3 pt-2.5">
              <p className="m-0 text-[12px] font-bold text-fg">{t('designer:needs.unknownHead', 'Asked for by the Designer')}</p>
              <p className="m-0 text-[12px] leading-normal text-fg-muted">{t('designer:needs.unknownLead', 'Adminium does not know these. Add one only if you recognise it.')}</p>
              <ul className="m-0 list-none p-0">{unknown.map((entry, index) => item(entry, known.length + index))}</ul>
            </div>
          )}
        </>
      ),
    });
  }
  const changesTitle = `${base}-changes`;
  shownSections.push({
    key: 'changes',
    title: t('designer:plan.changesTitle', 'Anything to change?'),
    state: changes === '' ? t('designer:plan.changesOptional', 'Optional') : t('designer:plan.changesWritten', 'Your changes are written'),
    count: null,
    body: (
      <textarea
        rows={4}
        // The server takes no more than this.
        maxLength={4000}
        dir="auto"
        aria-labelledby={changesTitle}
        placeholder={t('designer:plan.changesPlaceholder', 'Write what you want different.')}
        value={draft.changes}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value;
          setDraft((before) => ({ ...before, changes: next }));
        }}
        className="block w-full resize-y rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 text-[13px] leading-normal text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-accent"
      />
    ),
  });

  return (
    <>
      <div className="flex shrink-0 items-start gap-2.5 border-b border-border py-4 pe-4 ps-[22px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <DrawerTitle className="m-0 text-[16.5px] font-extrabold leading-[1.35] tracking-[-.02em] text-fg">
            {fill(t('designer:plan.sheetTitle', 'The plan for {name}', { name: MARK }), [[MARK, <span dir="auto">{card.site.name}</span>]])}
          </DrawerTitle>
          <span id={subId} className="text-[11.5px] text-fg-muted">
            <span dir="auto" className="font-mono">
              {card.site.name}
            </span>
            {' · '}
            {monoCount(t('designer:template.pages', '{count, plural, one {# page} other {# pages}}', { count: card.site.pages }), card.site.pages)}
            {' · '}
            {monoCount(t('designer:template.files', '{count, plural, one {# file} other {# files}}', { count: card.site.files }), card.site.files)}
          </span>
        </div>
        <DrawerClose
          aria-label={t('designer:plan.close', 'Close')}
          className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <X aria-hidden="true" className="size-[17px]" />
        </DrawerClose>
      </div>
      <div ref={body} className="nb-scroll min-h-0 flex-1 overflow-y-auto">
        {shownSections.map((section, index) => (
          <Section
            key={section.key}
            n={index + 1}
            title={section.title}
            state={section.state}
            count={section.count}
            warn={section.warn === true}
            open={open.has(section.key)}
            onToggle={() => toggleSection(section.key)}
            titleId={section.key === 'changes' ? changesTitle : `${base}-${section.key}`}
          >
            {section.body}
          </Section>
        ))}
      </div>
      <div className="shrink-0 border-t border-border bg-surface-2 px-[22px] py-3.5">
        <Button size="lg" disabled={busy} onClick={submit} className="w-full rounded-[10px] font-bold">
          {changes === '' ? t('designer:plan.buildThis', 'Build this') : t('designer:plan.sendChanges', 'Send my changes')}
        </Button>
      </div>
    </>
  );
}

/** Where a table's sample rows come from: the template's own, made up, or none. */
function samplesLine(table: PlanCard['tables'][number]): string {
  if (table.fromTemplate > 0 && table.madeUp > 0) {
    return t('designer:plan.samplesBoth', '{template, plural, one {# sample row from the template} other {# sample rows from the template}}, {madeUp} made up', { template: table.fromTemplate, madeUp: table.madeUp });
  }
  if (table.fromTemplate > 0) return t('designer:plan.samplesTemplate', '{count, plural, one {# sample row from the template} other {# sample rows from the template}}', { count: table.fromTemplate });
  if (table.madeUp > 0) return t('designer:plan.samplesMadeUp', '{count, plural, one {# sample row, made up} other {# sample rows, made up}}', { count: table.madeUp });
  return t('designer:plan.samplesNone', 'No sample rows');
}
