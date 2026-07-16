import { isRegisteredWidgetId } from '@adminium/widgets/generate';
import { describe, expect, it } from 'vitest';

import { applyClassification } from '../src/classify/index.js';
import { pageEnvelopeSchema, widgetConfigSchema } from '../src/config-schema/index.js';
import { generatePages } from '../src/generate/index.js';
import type { PageEnvelope } from '../src/index.js';
import { ARCHETYPE_CONNECTION, archetypeModel } from './fixtures/archetypes-model.js';

/**
 * **The M7 exit criteria.** research/widget-registry.md §15 step 3 —
 * "Per table emit: `page-crud` always; **plus the highest-scoring archetype from
 * §14 triggers**" — proven end to end: a classified schema in, stored page
 * envelopes out, one assertion per §14 Auto-trigger row.
 *
 * This is the far side of the package boundary described in
 * `src/generate/archetype.ts`: the rules are unit-tested against their own
 * structural contract in `@adminium/widgets`; these tests prove that the real
 * classifier's output, adapted through `toCandidateModel`, actually lands on
 * those triggers — i.e. that the two vocabularies agree.
 */

const model = applyClassification(archetypeModel);
const result = generatePages(model, { connectionId: ARCHETYPE_CONNECTION });

/** The archetype page generated for a table, if any. */
function archetypeFor(tableId: string): PageEnvelope | undefined {
  return result.pages.find(
    (page) =>
      page.source.table === tableId &&
      page.template !== 'page-crud' &&
      page.template !== 'page-dashboard',
  );
}

function widgetsOn(page: PageEnvelope): string[] {
  const layout = page.config['layout'] as { items: { widget: string }[] };
  return layout.items.map((item) => item.widget);
}

function itemConfig(page: PageEnvelope, widget: string): Record<string, unknown> {
  const layout = page.config['layout'] as { items: { widget: string; config: Record<string, unknown> }[] };
  const item = layout.items.find((i) => i.widget === widget);
  if (item === undefined) throw new Error(`no ${widget} on ${page.id}`);
  return item.config;
}

describe('§14 auto-triggers — one archetype page per table, alongside page-crud', () => {
  it('a status-enum workflow table emits a page-board', () => {
    const page = archetypeFor('public.tasks') as PageEnvelope;
    expect(page.template).toBe('page-board');
    // `team` is an orthogonal enum → the swimlane variant (annex §6/§14).
    expect(widgetsOn(page)).toContain('kanban-swimlane-grid');
    const board = itemConfig(page, 'kanban-swimlane-grid');
    expect(board['statusColumn']).toBe('status');
    expect(board['laneColumn']).toBe('team');
    expect(board['columns']).toEqual(['todo', 'in_progress', 'review', 'done']);
  });

  it('a date + title table emits a page-calendar', () => {
    const page = archetypeFor('public.releases') as PageEnvelope;
    expect(page.template).toBe('page-calendar');
    expect(widgetsOn(page)).toContain('calendar-month');
    expect(widgetsOn(page)).toContain('day-agenda');
    const calendar = itemConfig(page, 'calendar-month');
    expect(calendar['startColumn']).toBe('released_at');
    expect(calendar['titleColumn']).toBe('title');
  });

  it('a self-FK people table emits a page-directory with the org-chart', () => {
    const page = archetypeFor('public.employees') as PageEnvelope;
    expect(page.template).toBe('page-directory');
    expect(widgetsOn(page)).toContain('org-chart');
    expect(itemConfig(page, 'org-chart')['parentColumn']).toBe('manager_id');
    expect(page.nav.group).toBe('people');
  });

  it('person FK × date × shift-type emits a page-scheduler', () => {
    const page = archetypeFor('public.shifts') as PageEnvelope;
    expect(page.template).toBe('page-scheduler');
    expect(widgetsOn(page)).toContain('schedule-matrix');
    const matrix = itemConfig(page, 'schedule-matrix');
    expect(matrix['personColumn']).toBe('employee_id');
    expect(matrix['dateColumn']).toBe('shift_date');
    expect(matrix['typeColumn']).toBe('shift_type');
  });

  it('start/end + progress + phase FK emits a page hosting the gantt-chart', () => {
    const page = archetypeFor('public.project_tasks') as PageEnvelope;
    // §14 ships no page-gantt: the gantt is a *domain card* in the
    // page-master-detail detail pane (annex §14 "detail pane … / domain card").
    expect(page.template).toBe('page-master-detail');
    expect(widgetsOn(page)).toContain('gantt-chart');
    const gantt = itemConfig(page, 'gantt-chart');
    expect(gantt['startColumn']).toBe('start_date');
    expect(gantt['endColumn']).toBe('end_date');
    expect(gantt['progressColumn']).toBe('progress');
    expect(gantt['groupColumn']).toBe('phase_id');
  });

  it('an *_audit table emits a page-log-viewer', () => {
    const page = archetypeFor('public.order_audit') as PageEnvelope;
    expect(page.template).toBe('page-log-viewer');
    expect(widgetsOn(page)).toContain('log-table');
    // Newest first — a log is read from the top.
    expect(
      (itemConfig(page, 'log-table')['binding'] as { orderBy: unknown }).orderBy,
    ).toEqual([{ column: 'created_at', dir: 'desc' }]);
  });

  it('an attachment table emits a page-files', () => {
    const page = archetypeFor('public.attachments') as PageEnvelope;
    expect(page.template).toBe('page-files');
    expect(widgetsOn(page)).toContain('file-browser');
    const browser = itemConfig(page, 'file-browser');
    expect(browser['nameColumn']).toBe('file_name');
    expect(browser['parentColumn']).toBe('parent_id');
    // The quota meter over SUM(file_size) fills the manifest's `usage` slot.
    expect(widgetsOn(page)).toContain('usage-meter');
  });

  it('a conversation+message PAIR emits one page-chat, on the conversation', () => {
    const page = archetypeFor('public.conversations') as PageEnvelope;
    expect(page.template).toBe('page-chat');
    expect(widgetsOn(page)).toContain('conversation-inbox');
    expect(widgetsOn(page)).toContain('chat-thread');
    // The thread binds to the messages child, not to the conversation.
    const thread = itemConfig(page, 'chat-thread')['binding'] as { source: { name: string } };
    expect(thread.source.name).toBe('conv_messages');
    // …and the child table does not get a second chat page.
    expect(archetypeFor('public.conv_messages')?.template).not.toBe('page-chat');
    expect(result.pages.filter((p) => p.template === 'page-chat')).toHaveLength(1);
  });

  it('a pending/approved workflow enum emits a page-queue-inbox', () => {
    const page = archetypeFor('public.approvals') as PageEnvelope;
    expect(page.template).toBe('page-queue-inbox');
    // The manifest's kpi-row is `required` — the §1 count/new/status cards fill it.
    expect(widgetsOn(page).filter((w) => w === 'kpi-stat-card').length).toBeGreaterThan(0);
    expect(widgetsOn(page)).toContain('master-list');
  });

  it('an enum-heavy table with rich detail emits a page-master-detail', () => {
    const page = archetypeFor('public.tickets') as PageEnvelope;
    expect(page.template).toBe('page-master-detail');
    expect(widgetsOn(page)).toContain('master-list');
    expect(widgetsOn(page)).toContain('detail-key-value');
  });

  it('a table with no §14 trigger gets nothing extra', () => {
    expect(archetypeFor('public.regions')).toBeUndefined();
    expect(result.pages.some((p) => p.source.table === 'public.regions')).toBe(true); // page-crud
  });
});

describe('archetype pages are well-formed stored documents', () => {
  const archetypes = result.pages.filter(
    (p) => p.template !== 'page-crud' && p.template !== 'page-dashboard',
  );

  it('covers nine of the §14 archetypes on this schema', () => {
    expect([...new Set(archetypes.map((p) => p.template))].sort()).toEqual([
      'page-board',
      'page-calendar',
      'page-chat',
      'page-directory',
      'page-files',
      'page-log-viewer',
      'page-master-detail',
      'page-queue-inbox',
      'page-scheduler',
    ]);
  });

  it('validates against the frozen envelope contract (01 §6.1)', () => {
    for (const page of archetypes) {
      expect(() => pageEnvelopeSchema.parse(page)).not.toThrow();
      expect(page.v).toBe(1);
      expect(page.kind).toBe('page');
      expect(page.config['templateVersion']).toBe(1);
      expect(page.config['layout']).toBeDefined();
      expect(Array.isArray(page.config['toolbar'])).toBe(true);
      expect(Array.isArray(page.config['overlays'])).toBe(true);
      expect(typeof page.config['generatedHash']).toBe('string');
    }
  });

  it('every widget instance carries a compilable query descriptor (04 §5.1)', () => {
    for (const page of archetypes) {
      const layout = page.config['layout'] as { items: unknown[] };
      expect(layout.items.length).toBeGreaterThan(0);
      for (const item of layout.items) {
        expect(() => widgetConfigSchema.parse(item)).not.toThrow();
        const binding = (item as { config: { binding?: { connectionId: string } } }).config.binding;
        expect(binding?.connectionId).toBe(ARCHETYPE_CONNECTION);
      }
    }
  });

  it('records why the table earned the template (Studio review + H3 prompt)', () => {
    for (const page of archetypes) {
      const archetype = page.config['archetype'] as { score: number; reasons: string[] };
      expect(archetype.score).toBeGreaterThan(0);
      expect(archetype.score).toBeLessThanOrEqual(1);
      expect(archetype.reasons.length).toBeGreaterThan(0);
    }
  });

  it('uses connection-scoped ids and slugs that never collide with page-crud', () => {
    const ids = result.pages.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const slugs = result.pages.map((p) => p.nav.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const page of archetypes) {
      expect(page.id).toMatch(/^page_[0-9a-f]{8}_[a-z0-9-]+$/);
      expect(page.id.length).toBeLessThanOrEqual(36);
      expect(page.nav.slug?.length).toBeLessThanOrEqual(22);
    }
  });

  it('sits beside its table page-crud in the nav, never displacing it', () => {
    for (const page of archetypes) {
      const crud = result.pages.find(
        (p) => p.template === 'page-crud' && p.source.table === page.source.table,
      ) as PageEnvelope;
      expect(page.nav.order).toBe(crud.nav.order + 5);
    }
  });

  it('is deterministic — a re-run is byte-identical (04 §8 H5)', () => {
    const again = generatePages(model, { connectionId: ARCHETYPE_CONNECTION });
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
  });
});

describe('archetype pages respect generation options', () => {
  it("intent 'crud' emits page-crud only", () => {
    const crudOnly = generatePages(model, { connectionId: ARCHETYPE_CONNECTION, intent: 'crud' });
    expect([...new Set(crudOnly.pages.map((p) => p.template))]).toEqual(['page-crud']);
  });

  /**
   * `isRegistered` defaults to the registry's checked-in id mirror rather than
   * "everything is registered". The sole production caller (apps/server
   * `run.ts`) omits the option, so a permissive default made EVERY registry
   * filter in this pipeline dead code — `date-range-picker` and `toast-stack`,
   * both declared in PENDING_TEMPLATE_WIDGET_IDS, were persisted into stored
   * page envelopes and would render `widget-missing` the moment chrome renders.
   */
  it('persists no unregistered chrome id when isRegistered is not supplied', () => {
    const archetypes = result.pages.filter((page) => page.template !== 'page-crud');
    expect(archetypes.length).toBeGreaterThan(0);
    for (const page of archetypes) {
      const config = page.config as { toolbar?: string[]; overlays?: string[] };
      for (const id of [...(config.toolbar ?? []), ...(config.overlays ?? [])]) {
        expect(isRegisteredWidgetId(id), `${page.id} persists unregistered chrome '${id}'`).toBe(true);
      }
    }
  });

  it('persists no unregistered widget id in any archetype layout', () => {
    for (const page of result.pages.filter((p) => p.template !== 'page-crud')) {
      for (const widget of widgetsOn(page)) {
        expect(isRegisteredWidgetId(widget), `${page.id} binds unregistered '${widget}'`).toBe(true);
      }
    }
  });

  it('an explicit isRegistered still overrides the default catalog', () => {
    const narrowed = generatePages(model, {
      connectionId: ARCHETYPE_CONNECTION,
      isRegistered: () => true,
    });
    const calendar = narrowed.pages.find((p) => p.template === 'page-calendar');
    // With everything "registered", the pending chrome ids survive — proving the
    // default is what filters them, not some other layer.
    expect((calendar?.config as { toolbar?: string[] }).toolbar).toContain('date-range-picker');
  });

  /**
   * 09 §8.4: read-only-analytics is "dashboards, analytics, data grids
   * (read-only), search, exports; **no forms/boards/imports**". The archetype
   * pass used to gate only on `intent !== 'crud'`, so this intent emitted a
   * drag-to-change-status kanban with a create wizard — byte-identical to the
   * full-admin output — on a connection explicitly scoped to read-only.
   */
  it("intent 'read-only-analytics' omits boards, files, queues and chat (09 §8.4)", () => {
    const readOnly = generatePages(model, {
      connectionId: ARCHETYPE_CONNECTION,
      intent: 'read-only-analytics',
    });
    const templates = new Set(readOnly.pages.map((p) => p.template));
    for (const omitted of ['page-board', 'page-files', 'page-queue-inbox', 'page-chat']) {
      expect(templates.has(omitted), `read-only-analytics emitted ${omitted}`).toBe(false);
    }
    // The read-oriented archetypes still generate.
    expect(templates.has('page-calendar')).toBe(true);
    // …and the tables that lost an archetype keep their read-only page-crud.
    const tasksCrud = readOnly.pages.find(
      (p) => p.template === 'page-crud' && p.source.table === 'public.tasks',
    );
    expect((tasksCrud?.config as { readOnly?: boolean }).readOnly).toBe(true);
    expect(readOnly.warnings.some((w) => w.includes('the generation intent omits this archetype'))).toBe(true);
  });

  /**
   * 09 §8.4: support-console is "queue/master-detail templates prioritized …;
   * boards/analytics omitted". It used to fall through to the full-admin set
   * while emitting a warning that the queue templates "land M7" — the milestone
   * that shipped them.
   */
  it("intent 'support-console' omits boards and dashboards, keeps queues (09 §8.4)", () => {
    const support = generatePages(model, {
      connectionId: ARCHETYPE_CONNECTION,
      intent: 'support-console',
    });
    const templates = new Set(support.pages.map((p) => p.template));
    expect(templates.has('page-board')).toBe(false);
    expect(templates.has('page-dashboard')).toBe(false);
    expect(templates.has('page-queue-inbox')).toBe(true);
    // The stale milestone warning is gone.
    expect(support.warnings.some((w) => w.includes('land M7'))).toBe(false);
  });

  it('drops widgets the live registry does not know (04 §10)', () => {
    const noOrgChart = generatePages(model, {
      connectionId: ARCHETYPE_CONNECTION,
      isRegistered: (id) => id !== 'org-chart',
    });
    const directory = noOrgChart.pages.find((p) => p.template === 'page-directory') as PageEnvelope;
    // The directory slot falls back to the card-gallery — still a page.
    expect(widgetsOn(directory)).not.toContain('org-chart');
    expect(widgetsOn(directory)).toContain('card-gallery');
  });

  it('skips archetypes with a warning when no required slot can be filled', () => {
    const noBoards = generatePages(model, {
      connectionId: ARCHETYPE_CONNECTION,
      isRegistered: (id) => id !== 'kanban-board' && id !== 'kanban-swimlane-grid',
    });
    expect(noBoards.pages.some((p) => p.template === 'page-board')).toBe(false);
    expect(noBoards.warnings.some((w) => w.includes('page-board for public.tasks skipped'))).toBe(
      true,
    );
    // The table keeps its page-crud regardless.
    expect(
      noBoards.pages.some((p) => p.template === 'page-crud' && p.source.table === 'public.tasks'),
    ).toBe(true);
  });

  it('skips archetypes with a warning when the model has no connection', () => {
    const detached = { ...model, source: { kind: 'import', format: 'json-ir' } as const };
    const offline = generatePages(detached);
    expect(offline.pages.every((p) => p.template === 'page-crud')).toBe(true);
    expect(offline.warnings.some((w) => w.includes('§14 archetype pages skipped'))).toBe(true);
  });

  it('honours settings.includedTables (the server filters the model upstream)', () => {
    // `filterModelToIncludedTables` (apps/server) drops excluded tables from the
    // model; the archetype pass only ever sees what survives.
    const onlyTasks = {
      ...model,
      tables: model.tables.filter((t) => t.id === 'public.tasks'),
      relations: [],
    };
    const scoped = generatePages(onlyTasks, { connectionId: ARCHETYPE_CONNECTION });
    expect(scoped.pages.filter((p) => p.template === 'page-board')).toHaveLength(1);
    // No excluded table earns a page — the dashboard is the only table-less one.
    for (const page of scoped.pages) {
      expect(page.source.table === null || page.source.table === 'public.tasks').toBe(true);
    }
  });
});
