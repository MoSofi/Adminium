// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-board` template renderer (manifest `page-board.json`, annex).
 *
 * Renders the stored archetype config body on the 12-col grid: the required
 * `board` slot composes the boards family's REAL components
 * (`kanban-board` / `kanban-swimlane-grid` — dnd-kit optimistic move machinery
 * from M7 W2), translated from the candidate vocabulary the engine persists
 * (`statusColumn`/`laneColumn`/`titleColumn`/`progressColumn`/`columns[]` —
 * registry/candidates.ts `boards.workflow-enum`) to the components' props.
 *
 * Behaviors:
 * - drop issues ONE update intent through `onEvent` — status only on the
 *   kanban, lane+status atomically on swimlanes; the mutate promise is
 *   returned so a rejected write rolls the optimistic move back;
 * - a drop into a "Completed"-classified column forces `pct = 100` when the
 *   stored config names a progress column;
 * - the roadmap variant (`bucketBy: 'quarter'` + a date column in the stored
 *   config) buckets cards into quarter columns; a cross-quarter drop
 *   reschedules the record to the target quarter's first day;
 * - `inline-compose-card` quick-add inserts with the column defaults;
 * - card click emits `record-open` — the host routes it to the record drawer;
 * - every non-board item (KPI cards, insights) renders through WidgetHost.
 */
import { useMaybeT } from '@adminium/i18n/react';
import { useMemo } from 'react';

import { KanbanBoard } from '../../families/boards/KanbanBoard.js';
import { KanbanSwimlaneGrid } from '../../families/boards/KanbanSwimlaneGrid.js';
import { InlineComposeCard } from '../../families/boards/InlineComposeCard.js';
import {
  boardRowsOf,
  resolveColumns,
  resolveLanes,
  toBoardCard,
  type BoardCardData,
  type ColumnDef,
  type ColumnDefInput,
  type LaneDefInput,
} from '../../families/boards/board-lib.js';
import { WidgetFrame } from '../../frame/WidgetFrame.js';
import { UnplacedRowsNotice, nothingPlaced } from '../planning/UnplacedRowsNotice.js';
import { WidgetHost, type WidgetDataState } from '../../frame/WidgetHost.js';
import { DashboardGrid } from '../../grid/DashboardGrid.js';
import type { LayoutItem } from '../../grid/layout-schema.js';
import type { WidgetEvent } from '../../registry/types.js';
import {
  configString,
  dayStartValue,
  isCompletedColumn,
  itemConfigOf,
  parseTemplateConfig,
  planningDateKindOf,
  planningSourceOf,
  quarterKeyOf,
  quarterLabelOf,
  quarterStartIso,
  splitInstant,
  type PlanningDateOptions,
  useTemplateStates,
  type TemplateDataStates,
} from '../planning/planning-lib.js';

export const PAGE_BOARD_TEMPLATE_ID = 'page-board';

const BOARD_WIDGET_IDS = new Set(['kanban-board', 'kanban-swimlane-grid']);
const COMPOSE_WIDGET_ID = 'inline-compose-card';

export interface PageBoardLabels {
  addLabel?: string | undefined;
  composePlaceholder?: string | undefined;
  composeAdd?: string | undefined;
  composeCancel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  /** The empty state when the query succeeded and the table has no rows yet. */
  noRowsTitle?: string | undefined;
  noRowsBody?: string | undefined;
}

export interface PageBoardProps {
  /** The stored page config body: `{ templateVersion, toolbar, overlays, layout }`. */
  config: unknown;
  /** Per-instance data states from the host binding; absent → demo data. */
  states?: TemplateDataStates | undefined;
  /** Widget event sink. `mutate` handlers may return the CRUD promise so the
   *  boards' optimistic machinery can roll a rejected move back. */
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  /**
   * IANA zone a roadmap buckets dates in (a timestamp is converted into it
   * before its quarter is taken; a cross-quarter drop writes the quarter's
   * first midnight in it). Absent ⇒ the viewer's zone.
   */
  timeZone?: string | undefined;
  locale?: string | undefined;
  dir?: 'ltr' | 'rtl' | undefined;
  labels?: PageBoardLabels | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

/** The stored board item config, normalized from the candidate vocabulary. */
interface BoardItemConfig {
  statusColumn: string;
  laneColumn: string | undefined;
  titleColumn: string;
  progressColumn: string | undefined;
  columnDefs: ColumnDefInput[] | undefined;
  laneDefs: LaneDefInput[] | undefined;
  roadmap: boolean;
  dateColumn: string | undefined;
  allowAdd: boolean;
}

/** Accepts both `columns: ['todo', …]` (engine) and `columnDefs: [{id…}]`. */
function columnDefsOf(config: Record<string, unknown>): ColumnDefInput[] | undefined {
  const raw = config['columns'] ?? config['columnDefs'];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const defs: ColumnDefInput[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') defs.push({ id: entry });
    else if (typeof entry === 'object' && entry !== null) defs.push(entry as ColumnDefInput);
  }
  return defs.length > 0 ? defs : undefined;
}

function laneDefsOf(config: Record<string, unknown>): LaneDefInput[] | undefined {
  const raw = config['lanes'] ?? config['laneDefs'];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const defs: LaneDefInput[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') defs.push({ id: entry });
    else if (typeof entry === 'object' && entry !== null) defs.push(entry as LaneDefInput);
  }
  return defs.length > 0 ? defs : undefined;
}

export function boardItemConfigOf(config: Record<string, unknown>): BoardItemConfig {
  return {
    statusColumn: configString(config, 'statusColumn', 'columnField') ?? 'status',
    laneColumn: configString(config, 'laneColumn', 'laneField'),
    titleColumn: configString(config, 'titleColumn', 'titleField') ?? 'title',
    progressColumn: configString(config, 'progressColumn'),
    columnDefs: columnDefsOf(config),
    laneDefs: laneDefsOf(config),
    roadmap: config['bucketBy'] === 'quarter' || config['roadmap'] === true,
    dateColumn: configString(config, 'dateColumn', 'startColumn', 'due'),
    allowAdd: config['allowAdd'] === true,
  };
}

/**
 * Rows → cards with the stored column mapping (+ progress patch + roadmap
 * bucketing). A roadmap buckets by the date's day in `dates.timeZone`, read
 * per the column's kind — the same rule as the calendar.
 */
export function boardCardsOf(
  rows: Record<string, unknown>[],
  cfg: BoardItemConfig,
  dates: PlanningDateOptions = {},
): BoardCardData[] {
  return rows.map((row, index) => {
    const card = toBoardCard(row, index, {
      columnField: cfg.statusColumn,
      titleField: cfg.titleColumn,
      ...(cfg.laneColumn === undefined ? {} : { laneField: cfg.laneColumn }),
    });
    if (cfg.progressColumn !== undefined) {
      const pct = row[cfg.progressColumn];
      if (typeof pct === 'number' && Number.isFinite(pct)) card.pct = pct;
    }
    if (cfg.roadmap && cfg.dateColumn !== undefined) {
      card.column = quarterKeyOf(splitInstant(row[cfg.dateColumn], dates)?.day ?? '');
    }
    return card;
  });
}

/** Roadmap columns: the distinct quarters present, chronologically. */
export function quarterColumnsOf(cards: readonly BoardCardData[]): ColumnDef[] {
  const keys = [...new Set(cards.map((card) => card.column).filter((key) => key !== ''))].sort();
  const tones: ColumnDef['tone'][] = ['accent', 'info', 'warn', 'pos'];
  return keys.map((key, index) => ({
    id: key,
    label: quarterLabelOf(key),
    tone: tones[index % tones.length] as ColumnDef['tone'],
  }));
}

function BoardSlot({
  item,
  state,
  onEvent,
  timeZone,
  locale,
  dir,
  labels,
}: {
  item: LayoutItem;
  state: WidgetDataState;
  onEvent: PageBoardProps['onEvent'];
  timeZone: string | undefined;
  locale: string | undefined;
  dir: 'ltr' | 'rtl';
  labels: PageBoardLabels | undefined;
}) {
  const t = useMaybeT();
  const raw = itemConfigOf(item);
  const cfg = useMemo(() => boardItemConfigOf(raw), [raw]);
  const source = planningSourceOf(raw);
  const rows = useMemo(() => boardRowsOf(state.data), [state.data]);
  const dateKind = planningDateKindOf(state.data, cfg.dateColumn);
  const cards = useMemo(
    () => boardCardsOf(rows, cfg, { timeZone, kind: dateKind }),
    [rows, cfg, timeZone, dateKind],
  );
  const roadmap = cfg.roadmap && cfg.dateColumn !== undefined;
  const columns = useMemo(
    () => (roadmap ? quarterColumnsOf(cards) : resolveColumns(cards, cfg.columnDefs)),
    [roadmap, cards, cfg.columnDefs],
  );
  // Cards with no status — or one outside the declared columns — are not on
  // any column. All of them unplaced reads as an empty board (a status column
  // just added to a table that has rows), so it gets a sentence. A roadmap
  // places by date and is not a repair target; it is left out.
  const placed = useMemo(
    () => cards.filter((card) => card.column !== '' && columns.some((column) => column.id === card.column)).length,
    [cards, columns],
  );
  const swimlane = item.widget === 'kanban-swimlane-grid';
  const lanes = useMemo(() => (swimlane ? resolveLanes(cards, cfg.laneDefs) : []), [swimlane, cards, cfg.laneDefs]);

  const mutate = (recordId: string, values: Record<string, unknown>) => {
    if (source === null || onEvent === undefined) return undefined;
    return onEvent(item.i, {
      type: 'mutate',
      intent: 'update',
      connectionId: source.connectionId,
      table: source.table,
      recordId,
      values,
    });
  };

  const moveValues = (toColumn: string, toLane?: string): Record<string, unknown> => {
    if (roadmap) {
      const start = quarterStartIso(toColumn);
      return cfg.dateColumn !== undefined && start !== null
        ? { [cfg.dateColumn]: dayStartValue(start, { timeZone, kind: dateKind }) }
        : {};
    }
    const values: Record<string, unknown> = { [cfg.statusColumn]: toColumn };
    if (toLane !== undefined && cfg.laneColumn !== undefined) values[cfg.laneColumn] = toLane;
    if (cfg.progressColumn !== undefined && isCompletedColumn(toColumn)) values[cfg.progressColumn] = 100;
    return values;
  };

  const openCard = (cardId: string) => {
    if (source === null || onEvent === undefined) return;
    onEvent(item.i, {
      type: 'record-open',
      connectionId: source.connectionId,
      table: source.table,
      recordId: cardId,
    });
  };

  const frameState = state.status === 'loading' ? 'skeleton' : state.status === 'error' ? 'error' : 'loaded';
  /*
   * WHICH empty state. The widgets show theirs whenever they have nothing to
   * lay out — a plain board with no columns, a swimlane grid with no lanes —
   * and the host's text for it says "add a status field". That is right when
   * the table has rows the board cannot place, and wrong when the table simply
   * has no rows yet: lanes and data-derived columns come FROM the rows, so a
   * freshly installed app's board told its operator to add a status field it
   * already had. A board with its columns declared still shows them, empty and
   * addable; this only changes what the empty state SAYS.
   */
  const noRows = state.status === 'success' && rows.length === 0;
  const emptyTitle = noRows
    ? (labels?.noRowsTitle ?? t('ui:templates.board.noRowsTitle', 'No cards yet'))
    : labels?.emptyTitle;
  const emptyBody = noRows
    ? (labels?.noRowsBody ??
      t('ui:templates.board.noRowsBody', 'Cards appear here as soon as the table has rows.'))
    : labels?.emptyBody;
  const boardLabels = {
    ...(labels?.addLabel === undefined ? {} : { addLabel: labels.addLabel }),
    ...(emptyTitle === undefined ? {} : { emptyTitle, emptyBody }),
  };

  return (
    <WidgetFrame
      state={frameState}
      frameless
      skeleton="block"
      errorMessage={state.status === 'error' ? messageOf(state.error) : undefined}
      onRetry={state.refetch}
      refetching={state.isRefetching === true}
      testId={`board-slot-${item.i}`}
    >
      {/* A column, so the notice takes its height FROM the board: the board is
          `h-full`, and as a plain sibling below the notice it overflowed the
          slot by the notice's height, into the composer placed under it. */}
      <div className="flex h-full min-h-0 flex-col">
        {state.status === 'success' && !roadmap && nothingPlaced(rows.length, placed) ? (
          <UnplacedRowsNotice
            testId="board-unplaced-rows"
            message={t(
              'ui:templates.planning.unplaced.board',
              'None of this table’s rows has a status yet, so the board is empty. A row appears here as soon as it has one.',
            )}
          />
        ) : null}
        <div className="min-h-0 flex-1">
          {swimlane ? (
            <KanbanSwimlaneGrid
              cards={cards}
              columns={columns}
              lanes={lanes}
              dir={dir}
              {...(locale === undefined ? {} : { locale })}
              labels={boardLabels}
              onCardMove={(cardId, _from, to) => mutate(cardId, moveValues(to.column, to.lane))}
              onCardOpen={openCard}
            />
          ) : (
            <KanbanBoard
              cards={cards}
              columns={columns}
              dir={dir}
              {...(locale === undefined ? {} : { locale })}
              allowAdd={!roadmap && cfg.allowAdd}
              labels={boardLabels}
              onCardMove={(cardId, _from, toColumn) => mutate(cardId, moveValues(toColumn))}
              onCardOpen={openCard}
              onAdd={(columnId) => {
                if (source === null || onEvent === undefined) return;
                void onEvent(item.i, {
                  type: 'mutate',
                  intent: 'insert',
                  connectionId: source.connectionId,
                  table: source.table,
                  values: { [cfg.statusColumn]: columnId },
                });
              }}
            />
          )}
        </div>
      </div>
    </WidgetFrame>
  );
}

function ComposeSlot({
  item,
  board,
  onEvent,
  labels,
}: {
  item: LayoutItem;
  /** The board item the composer inserts into (defaults ride its config). */
  board: LayoutItem | undefined;
  onEvent: PageBoardProps['onEvent'];
  labels: PageBoardLabels | undefined;
}) {
  const raw = itemConfigOf(item);
  const boardRaw = board === undefined ? {} : itemConfigOf(board);
  const boardCfg = boardItemConfigOf(boardRaw);
  // Insert target: the composer's own binding, else the board's.
  const source = planningSourceOf(raw) ?? planningSourceOf(boardRaw);
  const titleField = configString(raw, 'titleField', 'titleColumn') ?? boardCfg.titleColumn;
  const defaults = (typeof raw['defaults'] === 'object' && raw['defaults'] !== null ? raw['defaults'] : {}) as Record<
    string,
    unknown
  >;
  const firstColumn = boardCfg.columnDefs?.[0]?.id;

  return (
    <InlineComposeCard
      defaultOpen={raw['defaultOpen'] === true}
      keepOpen={raw['keepOpen'] !== false}
      {...(labels?.composePlaceholder === undefined ? {} : { placeholder: labels.composePlaceholder })}
      {...(labels?.composeAdd === undefined ? {} : { addLabel: labels.composeAdd })}
      {...(labels?.composeCancel === undefined ? {} : { cancelLabel: labels.composeCancel })}
      testId={`compose-slot-${item.i}`}
      onAdd={(title) => {
        if (source === null || onEvent === undefined) return;
        void onEvent(item.i, {
          type: 'mutate',
          intent: 'insert',
          connectionId: source.connectionId,
          table: source.table,
          // Column defaults first (annex) — the typed title and the board's
          // first-column status can never be clobbered by stale defaults.
          values: {
            ...(firstColumn === undefined ? {} : { [boardCfg.statusColumn]: String(firstColumn) }),
            ...defaults,
            [titleField]: title,
          },
        });
      }}
    />
  );
}

function messageOf(error: unknown): string | undefined {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return undefined;
}

export function PageBoard({
  config,
  states,
  onEvent,
  timeZone,
  locale,
  dir = 'ltr',
  labels,
  className,
  testId,
}: PageBoardProps) {
  const t = useMaybeT();
  const parsed = useMemo(() => parseTemplateConfig(config), [config]);
  const resolvedStates = useTemplateStates(parsed.layout, states);
  const boardItem = parsed.layout.items.find((item) => BOARD_WIDGET_IDS.has(item.widget));

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-board-invalid">
        {t(
          'ui:templates.board.invalidLayout',
          'This board’s stored layout is invalid. Regenerate the page or reset its layout.',
        )}
      </p>
    );
  }

  return (
    <DashboardGrid
      layout={parsed.layout}
      className={className}
      testId={testId ?? 'page-board'}
      renderItem={(item) => {
        const state = resolvedStates[item.i] ?? { status: 'loading' as const };
        if (BOARD_WIDGET_IDS.has(item.widget)) {
          return (
            <BoardSlot
              item={item}
              state={state}
              onEvent={onEvent}
              timeZone={timeZone}
              locale={locale}
              dir={dir}
              labels={labels}
            />
          );
        }
        if (item.widget === COMPOSE_WIDGET_ID) {
          return <ComposeSlot item={item} board={boardItem} onEvent={onEvent} labels={labels} />;
        }
        return (
          <WidgetHost
            widgetId={item.widget}
            instanceId={item.i}
            config={item.config}
            data={state}
            onEvent={onEvent === undefined ? undefined : (event) => void onEvent(item.i, event)}
          />
        );
      }}
    />
  );
}
