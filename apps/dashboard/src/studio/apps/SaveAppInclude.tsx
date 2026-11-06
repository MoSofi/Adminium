// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP, step 2: What to include (`Save As App.dc.html` boards 3b).
 *
 * Grouped by kind, each group a card with a tri-state tick, its count and a
 * fold, closed at first; a search opens every group with a match. Everything
 * starts ticked and every table at "Nothing": the quick save's defaults.
 *
 *  - Ticking a thing brings in what it needs (a page its table, a rule the
 *    tables it reads), and says so under it.
 *  - Unticking something other ticked things need opens "Other things use
 *    …": leave them all out, keep the linking columns without their links
 *    (only when other tables link to it), or keep it.
 *  - Each table has its row count and its rows control: nothing, starting
 *    rows (at most 200, chosen by a saved view over that) or sample rows (at
 *    most 5,000, the same). Personal and secret-looking columns travel empty
 *    unless ticked, and only when rows are chosen is that worth saying.
 *  - Saved views here are the people's own: ticking one makes it a shared
 *    view of the app (and only there). It is the same control as Check's
 *    "Make shared".
 *
 * Filled from the comp's own patterns where it draws nothing: documents, the
 * payments setup and the server's look and words are groups like the rest;
 * a table the saver may not read whole keeps its rows control at "Nothing".
 */
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Bookmark,
  CalendarClock,
  ChevronRight,
  CreditCard,
  FileText,
  Globe,
  KeyRound,
  LayoutPanelLeft,
  Mail,
  Palette,
  Receipt,
  Rows3,
  Search,
  ShieldCheck,
  Table2,
  UserRound,
  Workflow,
} from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { getFormatters } from '@adminium/i18n';
import { Button, Checkbox, Modal, ModalBody, ModalHeader, MonoText, SegmentedControl, Select, cn } from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import type { InventoryTable, RowChoice, SaveInventory } from './saveAppApi.js';
import {
  MAX_SAMPLE_ROWS,
  MAX_STARTING_ROWS,
  dependentsOf,
  idsOf,
  nameOf,
  personalViews,
  tick,
  untick,
  type Dependents,
  type IncludeKind,
  type SaveDraft,
  type Thing,
} from './saveAppDraft.js';
import { monoSentence } from './saveAppWords.js';

/** Rows shown in a group before "Show N more". */
const FIRST_ROWS = 12;

function formatters() {
  return getFormatters(getI18nInstance()?.language ?? 'en-US');
}

function groupLabel(kind: IncludeKind): string {
  switch (kind) {
    case 'tables':
      return t('studio:saveApp.group.tables', 'Tables');
    case 'pages':
      return t('studio:saveApp.group.pages', 'Pages');
    case 'roles':
      return t('studio:saveApp.group.roles', 'Roles');
    case 'automations':
      return t('studio:saveApp.group.automations', 'Automations');
    case 'emailTemplates':
      return t('studio:saveApp.group.emailTemplates', 'Email templates');
    case 'documents':
      return t('studio:saveApp.group.documents', 'Documents');
    case 'reports':
      return t('studio:saveApp.group.reports', 'Reports');
    case 'invoiceLayouts':
      return t('studio:saveApp.group.invoiceLayouts', 'Invoice layouts');
    case 'scheduledReports':
      return t('studio:saveApp.group.scheduledReports', 'Scheduled reports');
    case 'publicEndpoints':
      return t('studio:saveApp.group.publicEndpoints', 'Public access');
  }
}

const GROUP_ICON: Record<IncludeKind, ReactNode> = {
  tables: <Table2 aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
  pages: <LayoutPanelLeft aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
  roles: <ShieldCheck aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
  automations: <Workflow aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
  emailTemplates: <Mail aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
  documents: <FileText aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
  reports: <BarChart3 aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
  invoiceLayouts: <Receipt aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
  scheduledReports: <CalendarClock aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
  publicEndpoints: <Globe aria-hidden className="size-4 shrink-0 text-fg-subtle" />,
};

/** The order the comp lists the groups in; the comp draws no documents group, it sits with the other made things. */
const ORDER: readonly IncludeKind[] = ['tables', 'pages', 'roles', 'automations', 'emailTemplates', 'documents', 'reports', 'invoiceLayouts', 'scheduledReports', 'publicEndpoints'];

export interface SaveAppIncludeProps {
  inventory: SaveInventory;
  draft: SaveDraft;
  setDraft: (draft: SaveDraft) => void;
}

const thingKey = (thing: Thing) => `${thing.kind}:${thing.id}`;

/** Everything that would be left pointing at nothing, through tables that link too. */
function closure(inventory: SaveInventory, draft: SaveDraft, thing: Thing): Thing[] {
  const out = new Map<string, Thing>([[thingKey(thing), thing]]);
  const queue: Thing[] = [thing];
  while (queue.length > 0) {
    const next = queue.shift()!;
    const deps = dependentsOf(inventory, draft, next);
    for (const one of [...deps.things, ...deps.links.map((link): Thing => ({ kind: 'tables', id: link.tableId }))]) {
      if (out.has(thingKey(one))) continue;
      out.set(thingKey(one), one);
      queue.push(one);
    }
  }
  return [...out.values()];
}

export function SaveAppInclude({ inventory, draft, setDraft }: SaveAppIncludeProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [brought, setBrought] = useState<Record<string, Thing[]>>({});
  const [asking, setAsking] = useState<{ thing: Thing; deps: Dependents } | null>(null);
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const me = bootstrap?.user.id ?? null;
  const needle = query.trim().toLowerCase();

  const label = (kind: IncludeKind, id: string): string => nameOf(inventory, { kind, id });
  const matches = (text: string) => needle === '' || text.toLowerCase().includes(needle);

  const setTicked = (thing: Thing, on: boolean) => {
    if (on) {
      const result = tick(inventory, draft, thing);
      setDraft(result.draft);
      setBrought({ ...brought, [thingKey(thing)]: result.brought });
      return;
    }
    const deps = dependentsOf(inventory, draft, thing);
    if (deps.things.length > 0 || deps.links.length > 0) {
      setAsking({ thing, deps });
      return;
    }
    setDraft(untick(draft, [thing]));
  };

  const groups = ORDER.map((kind) => {
    const ids = idsOf(inventory, kind);
    const rows = ids.filter((id) => matches(label(kind, id)) || matches(groupLabel(kind)));
    return { kind, ids, rows };
  }).filter((group) => needle === '' || group.rows.length > 0);

  // The people's own views of the pages going in; a shared view goes with its page.
  const views = personalViews(inventory, draft);
  const sharedCount = views.filter((view) => draft.sharedViews.includes(view.id)).length;
  const viewRows = views.filter((view) => matches(view.name) || matches(t('studio:saveApp.group.views', 'Saved views')));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[16.5px] font-extrabold tracking-[-0.02em]">{t('studio:saveApp.include.title', 'What to include')}</h2>
        <p className="mt-1 text-[13px] leading-[1.5] text-fg-muted">
          {t('studio:saveApp.include.body', 'Untick anything to leave it out. Rows go in only where you choose them.')}
        </p>
      </div>
      <div className="flex h-[38px] items-center gap-[9px] rounded-[10px] border border-border-strong bg-surface px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <Search aria-hidden className="size-[15px] shrink-0 text-fg-subtle" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('studio:saveApp.include.searchLabel', 'Search what to include')}
          placeholder={t('studio:saveApp.include.search', 'Search tables, pages, roles…')}
          className="w-full border-none bg-transparent px-0.5 py-px text-[13px] text-fg outline-none"
        />
      </div>

      <div className="flex flex-col gap-2">
        {groups.map(({ kind, ids, rows }) => {
          const ticked = ids.filter((id) => draft.include[kind].includes(id)).length;
          const isOpen = needle !== '' || open[kind] === true;
          const shown = needle !== '' || expanded[kind] === true ? rows : rows.slice(0, FIRST_ROWS);
          return (
            <GroupCard
              key={kind}
              id={kind}
              icon={GROUP_ICON[kind]}
              label={groupLabel(kind)}
              count={ids.length}
              state={ids.length === 0 ? false : ticked === ids.length ? true : ticked === 0 ? false : 'indeterminate'}
              disabled={ids.length === 0}
              open={isOpen}
              onToggleOpen={() => setOpen({ ...open, [kind]: !isOpen })}
              onTick={(on) => setDraft({ ...draft, include: { ...draft.include, [kind]: on ? ids : [] } })}
            >
              {ids.length === 0 ? (
                <p className="border-t border-border px-5 py-3 text-[12.5px] text-fg-subtle">{t('studio:saveApp.include.nothing', 'Nothing to include')}</p>
              ) : (
                <>
                  {kind === 'pages' ? <PagesNote inventory={inventory} /> : null}
                  {shown.map((id) =>
                    kind === 'tables' ? (
                      <TableRow
                        key={id}
                        table={inventory.tables.find((one) => one.id === id)!}
                        inventory={inventory}
                        draft={draft}
                        me={me}
                        setDraft={setDraft}
                        onTick={(on) => setTicked({ kind, id }, on)}
                        brought={brought[thingKey({ kind, id })] ?? []}
                      />
                    ) : (
                      <PlainRow
                        key={id}
                        id={`${kind}-${id}`}
                        label={label(kind, id)}
                        checked={draft.include[kind].includes(id)}
                        onTick={(on) => setTicked({ kind, id }, on)}
                        detail={kind === 'pages' ? pageDetail(inventory, id) : null}
                        brought={(brought[thingKey({ kind, id })] ?? []).map((one) => nameOf(inventory, one))}
                      />
                    ),
                  )}
                  {shown.length < rows.length ? (
                    <div className="border-t border-border px-5 py-2.5">
                      <Button variant="ghost" size="sm" onClick={() => setExpanded({ ...expanded, [kind]: true })}>
                        {t('studio:saveApp.include.showMore', 'Show {count} more', { count: rows.length - shown.length })}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </GroupCard>
          );
        })}

        {needle === '' || viewRows.length > 0 ? (
          <GroupCard
            id="views"
            icon={<Bookmark aria-hidden className="size-4 shrink-0 text-fg-subtle" />}
            label={t('studio:saveApp.group.views', 'Saved views')}
            count={views.length}
            meta={views.length === 0 ? null : t('studio:saveApp.views.sharedOf', '{shared} of {total} shared', { shared: sharedCount, total: views.length })}
            state={sharedCount === 0 ? false : sharedCount === views.length ? true : 'indeterminate'}
            disabled={views.length === 0}
            open={needle !== '' || open['views'] === true}
            onToggleOpen={() => setOpen({ ...open, views: !(open['views'] === true) })}
            onTick={(on) => setDraft({ ...draft, sharedViews: on ? views.map((view) => view.id) : [] })}
          >
            {views.length === 0 ? (
              <p className="border-t border-border px-5 py-3 text-[12.5px] text-fg-subtle">{t('studio:saveApp.include.nothing', 'Nothing to include')}</p>
            ) : (
              viewRows.map((view) => {
                const shared = draft.sharedViews.includes(view.id);
                return (
                  <PlainRow
                    key={view.id}
                    id={`view-${view.id}`}
                    label={view.name}
                    checked={shared}
                    onTick={(on) => setDraft({ ...draft, sharedViews: on ? [...draft.sharedViews, view.id] : draft.sharedViews.filter((id) => id !== view.id) })}
                    detail={
                      shared
                        ? t('studio:saveApp.views.isShared', 'Shared in the app')
                        : t('studio:saveApp.views.notShared', 'Not shared · see Check')
                    }
                    brought={[]}
                  />
                );
              })
            )}
          </GroupCard>
        ) : null}

        {inventory.payments && (needle === '' || matches(t('studio:saveApp.group.payments', 'Payments setup'))) ? (
          <SwitchGroup
            id="payments"
            icon={<CreditCard aria-hidden className="size-4 shrink-0 text-fg-subtle" />}
            label={t('studio:saveApp.group.payments', 'Payments setup')}
            body={t('studio:saveApp.include.paymentsBody', 'Which tables take payments, and how. Payment keys never go in the file.')}
            checked={draft.payments}
            onTick={(on) => setDraft({ ...draft, payments: on })}
          />
        ) : null}
        {inventory.instance && (needle === '' || matches(t('studio:saveApp.group.instance', 'This server’s look and words'))) ? (
          <SwitchGroup
            id="instance"
            icon={<Palette aria-hidden className="size-4 shrink-0 text-fg-subtle" />}
            label={t('studio:saveApp.group.instance', 'This server’s look and words')}
            body={t(
              'studio:saveApp.include.instanceBody',
              'The look, the logo, the languages, changed wording and edited system emails. The new server applies them only if the person installing ticks them.',
            )}
            checked={draft.instance}
            onTick={(on) => setDraft({ ...draft, instance: on })}
          />
        ) : null}
      </div>

      {asking === null ? null : (
        <DependentsDialog
          inventory={inventory}
          asking={asking}
          onCancel={() => setAsking(null)}
          onLeaveAll={() => {
            setDraft(untick(draft, closure(inventory, draft, asking.thing)));
            setAsking(null);
          }}
          onKeepColumns={() => {
            setDraft(untick(draft, [asking.thing, ...asking.deps.things]));
            setAsking(null);
          }}
        />
      )}
    </div>
  );
}

function pageDetail(inventory: SaveInventory, id: string): string | null {
  const page = inventory.pages.find((one) => one.id === id);
  if (page === undefined) return null;
  return page.generated ? t('studio:saveApp.include.pageMade', 'As Adminium made it') : t('studio:saveApp.include.pageChanged', 'Changed by hand');
}

function PagesNote({ inventory }: { inventory: SaveInventory }) {
  const made = inventory.pages.filter((page) => page.generated).length;
  return (
    <p className="border-t border-border px-5 py-2.5 text-[12.5px] text-fg-muted">
      {t('studio:saveApp.include.pagesNote', '{total, plural, one {# page} other {# pages}}: {made} as Adminium made them, {changed} changed by hand.', {
        total: inventory.pages.length,
        made,
        changed: inventory.pages.length - made,
      })}
    </p>
  );
}

/* ---------------------------------------------------------- the pieces */

function GroupCard({
  id,
  icon,
  label,
  count,
  meta = null,
  state,
  disabled,
  open,
  onToggleOpen,
  onTick,
  children,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  count: number;
  meta?: string | null;
  state: boolean | 'indeterminate';
  disabled: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onTick: (on: boolean) => void;
  children: ReactNode;
}) {
  const bodyId = `save-include-${id}`;
  return (
    <section className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-card">
      <div className="flex items-center gap-3 px-4 py-[13px]">
        <Checkbox aria-label={label} checked={state} disabled={disabled} onCheckedChange={(next) => onTick(next === true)} />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggleOpen}
          className="flex min-h-6 min-w-0 flex-1 items-center gap-3 text-start text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {icon}
          <span className="text-[13px] font-bold">{label}</span>
          <span className="inline-flex h-[22px] items-center rounded-[6px] bg-surface-3 px-2 font-mono text-[11.5px] font-bold text-fg-muted">{count}</span>
          {meta === null ? null : <span className="text-[12.5px] text-fg-subtle">{meta}</span>}
          <span className="flex-1" />
          <ChevronRight aria-hidden className={cn('size-4 shrink-0 text-fg-subtle transition-transform duration-150 rtl:-scale-x-100', open ? 'rotate-90 rtl:-rotate-90' : '')} />
        </button>
      </div>
      <div id={bodyId} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}

function SwitchGroup({ id, icon, label, body, checked, onTick }: { id: string; icon: ReactNode; label: string; body: string; checked: boolean; onTick: (on: boolean) => void }) {
  const control = `save-include-${id}`;
  return (
    <section className="flex items-start gap-3 rounded-[14px] border border-border bg-surface px-4 py-[13px] shadow-card">
      <Checkbox id={control} className="mt-0.5" checked={checked} onCheckedChange={(next) => onTick(next === true)} />
      <label htmlFor={control} className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-3">
          {icon}
          <span className="text-[13px] font-bold">{label}</span>
        </span>
        <span className="text-[12.5px] text-fg-muted">{body}</span>
      </label>
    </section>
  );
}

function PlainRow({ id, label, checked, onTick, detail, brought }: { id: string; label: string; checked: boolean; onTick: (on: boolean) => void; detail: string | null; brought: string[] }) {
  const control = `save-row-${id}`;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border px-5 py-[11px]">
      <div className="flex items-center gap-3">
        <Checkbox id={control} checked={checked} onCheckedChange={(next) => onTick(next === true)} />
        <label htmlFor={control} className="min-w-0 flex-1 text-[13px]">
          {label}
        </label>
        {detail === null ? null : <span className="text-[12.5px] text-fg-subtle">{detail}</span>}
      </div>
      <BroughtLine names={brought} />
    </div>
  );
}

function BroughtLine({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="ps-[30px] text-[12px] text-fg-muted" role="status">
      {t('studio:saveApp.include.brought', 'Brought in with it: {names}', { names: formatters().list(names) })}
    </p>
  );
}

function TableRow({
  table,
  inventory,
  draft,
  me,
  setDraft,
  onTick,
  brought,
}: {
  table: InventoryTable;
  inventory: SaveInventory;
  draft: SaveDraft;
  me: string | null;
  setDraft: (draft: SaveDraft) => void;
  onTick: (on: boolean) => void;
  brought: Thing[];
}) {
  const control = `save-table-${useId()}`;
  const numbers = formatters();
  const included = draft.include.tables.includes(table.id);
  const choice: RowChoice = draft.rows[table.id] ?? { mode: 'none' };
  const mode = table.rowsAllowed ? choice.mode : 'none';
  const cap = mode === 'starting' ? MAX_STARTING_ROWS : MAX_SAMPLE_ROWS;
  const over = mode !== 'none' && table.rows !== null && table.rows > cap;
  const setRows = (next: RowChoice) => setDraft({ ...draft, rows: { ...draft.rows, [table.id]: next } });
  const pickViews = useMemo(() => {
    const pages = new Set(inventory.pages.filter((page) => page.tableId === table.id).map((page) => page.id));
    return inventory.views.filter((view) => pages.has(view.pageId) && (view.ownerId === null || view.ownerId === me));
  }, [inventory, table.id, me]);
  const targets = (columns: string[]) => columns.map((column) => `${table.id}.${column}`);
  const personalOn = table.personal.length > 0 && targets(table.personal).every((target) => draft.personalColumns.includes(target));
  const secretOn = table.secretLike.length > 0 && targets(table.secretLike).every((target) => draft.personalColumns.includes(target));
  const toggleColumns = (columns: string[], on: boolean) => {
    const set = new Set(draft.personalColumns);
    for (const target of targets(columns)) {
      if (on) set.add(target);
      else set.delete(target);
    }
    setDraft({ ...draft, personalColumns: [...set] });
  };
  const columnList = (columns: string[]) =>
    columns.map((column, index) => (
      <span key={column}>
        {index > 0 ? ', ' : null}
        <MonoText>{column}</MonoText>
      </span>
    ));

  return (
    <div data-part="include-table" className="flex flex-col gap-[9px] border-t border-border px-5 py-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox id={control} checked={included} onCheckedChange={(next) => onTick(next === true)} />
        <label htmlFor={control} className="min-w-[140px] flex-1 font-mono text-[13px] font-semibold">
          {table.name}
        </label>
        <span className="text-[12.5px] text-fg-subtle">
          {t('studio:saveApp.include.columns', '{count, plural, one {# column} other {# columns}}', { count: table.columns })}
        </span>
        {table.rows === null ? null : (
          <span className="text-[12.5px] text-fg-subtle">
            {table.rowsExact
              ? t('studio:saveApp.include.rows', '{count, plural, one {# row} other {# rows}}', { count: table.rows })
              : t('studio:saveApp.include.rowsAbout', '{count, plural, one {about # row} other {about # rows}}', { count: table.rows })}
          </span>
        )}
        {included ? (
          <SegmentedControl
            aria-label={t('studio:saveApp.include.rowsFor', 'Rows for {table}', { table: table.name })}
            className="shrink-0 bg-surface-3"
            itemClassName="h-7 rounded-[7px] px-2.5 text-[12px] font-bold"
            disabled={!table.rowsAllowed}
            value={mode}
            onValueChange={(value) => setRows({ mode: value as RowChoice['mode'] })}
            options={[
              { value: 'none', label: t('studio:saveApp.include.rowsNone', 'Nothing') },
              { value: 'starting', label: t('studio:saveApp.include.rowsStarting', 'Starting rows') },
              { value: 'sample', label: t('studio:saveApp.include.rowsSample', 'Sample rows') },
            ]}
          />
        ) : (
          <span className="text-[12.5px] text-fg-subtle">{t('studio:saveApp.include.leftOut', 'Left out')}</span>
        )}
      </div>
      {included ? (
        <div className="flex flex-col gap-2 ps-[30px]">
          {!table.rowsAllowed ? (
            <p className="text-[12.5px] text-fg-muted" data-part="rows-not-yours">
              {t('studio:saveApp.include.rowsNotYours', 'You can’t read {table}, so its rows can’t go in. Its structure still can.', { table: table.name })}
            </p>
          ) : null}
          {over ? (
            <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-fg-muted">
              <Rows3 aria-hidden className="size-3.5 shrink-0" />
              <span>
                {monoSentence(
                  (m) => t('studio:saveApp.include.chooseWhich', '{rows} rows — choose which {cap}', { rows: m['rows']!, cap: m['cap']! }),
                  { rows: numbers.number(table.rows ?? 0), cap: numbers.number(cap) },
                )}
              </span>
              <Select
                className="h-8 w-auto text-[12.5px]"
                aria-label={t('studio:saveApp.include.whichRows', 'Which {cap} rows of {table}', { cap: numbers.number(cap), table: table.name })}
                value={choice.viewId ?? ''}
                onChange={(event) => setRows(event.target.value === '' ? { mode } : { mode, viewId: event.target.value })}
              >
                <option value="">{t('studio:saveApp.include.pageOrder', 'The page’s order')}</option>
                {pickViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {t('studio:saveApp.include.byView', 'Saved view: {view}', { view: view.name })}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {mode !== 'none' && table.personal.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-warn-soft px-[9px] py-1 text-[12px] font-bold text-warn">
                <UserRound aria-hidden className="size-[13px] shrink-0" />
                <span>
                  {t('studio:saveApp.include.personal', 'Personal:')} {columnList(table.personal)}{' '}
                  {personalOn ? t('studio:saveApp.include.included', '— included') : t('studio:saveApp.include.leftOutDash', '— left out')}
                </span>
              </span>
              {table.personalAllowed ? (
                <button
                  type="button"
                  aria-pressed={personalOn}
                  onClick={() => toggleColumns(table.personal, !personalOn)}
                  className="px-0.5 py-1 text-[12px] font-bold text-warn underline underline-offset-[3px]"
                >
                  {personalOn ? t('studio:saveApp.include.leaveThemOut', 'Leave them out') : t('studio:saveApp.include.includeThem', 'Include them')}
                </button>
              ) : null}
            </div>
          ) : null}
          {mode !== 'none' && table.secretLike.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-surface-3 px-[9px] py-1 text-[12px] font-bold text-fg-muted">
                <KeyRound aria-hidden className="size-[13px] shrink-0" />
                <span>
                  {columnList(table.secretLike)}{' '}
                  {t('studio:saveApp.include.secretLike', '{count, plural, one {looks like a key} other {look like keys}}', { count: table.secretLike.length })}{' '}
                  {secretOn ? t('studio:saveApp.include.included', '— included') : t('studio:saveApp.include.leftOutDash', '— left out')}
                </span>
              </span>
              {table.personalAllowed ? (
                <button
                  type="button"
                  aria-pressed={secretOn}
                  onClick={() => toggleColumns(table.secretLike, !secretOn)}
                  className="px-0.5 py-1 text-[12px] font-bold text-fg-muted underline underline-offset-[3px]"
                >
                  {secretOn
                    ? t('studio:saveApp.include.leaveItOut', '{count, plural, one {Leave it out} other {Leave them out}}', { count: table.secretLike.length })
                    : t('studio:saveApp.include.includeIt', '{count, plural, one {Include it} other {Include them}}', { count: table.secretLike.length })}
                </button>
              ) : null}
            </div>
          ) : null}
          <BroughtLine names={brought.map((one) => nameOf(inventory, one))} />
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- the dependents */

function DependentsDialog({
  inventory,
  asking,
  onCancel,
  onLeaveAll,
  onKeepColumns,
}: {
  inventory: SaveInventory;
  asking: { thing: Thing; deps: Dependents };
  onCancel: () => void;
  onLeaveAll: () => void;
  onKeepColumns: () => void;
}) {
  const name = nameOf(inventory, asking.thing);
  const byKind = new Map<IncludeKind, string[]>();
  for (const thing of asking.deps.things) byKind.set(thing.kind, [...(byKind.get(thing.kind) ?? []), nameOf(inventory, thing)]);
  const tableName = (id: string) => inventory.tables.find((table) => table.id === id)?.name ?? id;
  return (
    <Modal
      open
      size="md"
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <ModalHeader title={t('studio:saveApp.deps.title', 'Other things use {name}', { name })} closeLabel={t('studio:saveApp.cancel', 'Cancel')} />
      <ModalBody className="flex flex-col gap-4 leading-[normal]">
        <p className="text-[13px] text-fg-muted">
          {monoSentence((m) => t('studio:saveApp.deps.body', 'If {name} stays out, these lose what they point to.', { name: m['name']! }), { name })}
        </p>
        {[...byKind].map(([kind, names]) => (
          <section key={kind} className="flex flex-col gap-1.5">
            <h3 className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">
              {t('studio:saveApp.deps.group', '{group} ({count})', { group: groupLabel(kind), count: names.length })}
            </h3>
            <ul className="flex flex-col gap-1 text-[13px]">
              {names.map((one, index) => (
                <li key={index}>{one}</li>
              ))}
            </ul>
          </section>
        ))}
        {asking.deps.links.length === 0 ? null : (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">
              {t('studio:saveApp.deps.links', 'Tables that link to it ({count})', { count: asking.deps.links.length })}
            </h3>
            <ul className="flex flex-col gap-1 text-[13px]">
              {asking.deps.links.map((link) => (
                <li key={`${link.tableId}.${link.column}`}>
                  <MonoText>{`${tableName(link.tableId)}.${link.column}`}</MonoText>
                </li>
              ))}
            </ul>
          </section>
        )}
        <footer className="-mx-5 flex flex-col-reverse gap-2 border-t border-border px-5 pt-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button variant="secondary" onClick={onLeaveAll}>
            {t('studio:saveApp.deps.leaveAll', 'Leave them all out')}
          </Button>
          {asking.deps.links.length === 0 ? null : (
            <Button variant="secondary" onClick={onKeepColumns}>
              {t('studio:saveApp.deps.keepColumns', 'Keep the columns, drop the links')}
            </Button>
          )}
          <Button autoFocus onClick={onCancel}>
            {t('studio:saveApp.deps.keep', 'Keep {name}', { name })}
          </Button>
        </footer>
      </ModalBody>
    </Modal>
  );
}
