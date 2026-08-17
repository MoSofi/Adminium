// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  ARCHETYPE_TEMPLATE_IDS,
  scoreArchetypes,
  selectArchetype,
  selectModelArchetypes,
} from './archetypes.js';
import type {
  CandidateColumn,
  CandidateContext,
  CandidateTable,
  CandidateTableInput,
  ClassifiedColumnInput,
  ClassifiedTableInput,
} from './candidates.js';
import { PAGE_TEMPLATE_IDS } from '../templates/manifests.js';

/**
 * §14 Auto-trigger tests — the per-table half of the M7 exit criteria.
 *
 * These prove *selection*: given a classified table, which archetype wins. That
 * the winner then composes into a real page (slots filled, envelope persisted)
 * is proven end-to-end in `packages/engine/test/generate-archetypes.test.ts`.
 */

const CONN = 'conn_01HZX0000000000000000000';
const ctx: CandidateContext = { connectionId: CONN };

interface ColumnSpec {
  name: string;
  logicalType: string;
  semantic: string;
  enumValues?: string[];
  references?: { tableId: string; column: string };
  pair?: { role: string; partner: string };
  isPrimaryKey?: boolean;
}

function build(
  id: string,
  specs: ColumnSpec[],
  overrides: {
    shape?: string;
    role?: string;
    displayColumn?: string | null;
    hierarchyColumn?: string | null;
  } = {},
): CandidateTableInput {
  const columns: CandidateColumn[] = specs.map((spec) => ({
    name: spec.name,
    logicalType: spec.logicalType,
    isPrimaryKey: spec.isPrimaryKey ?? false,
    ...(spec.enumValues === undefined ? {} : { enumValues: spec.enumValues }),
    references: spec.references ?? null,
  }));
  const classifiedColumns: ClassifiedColumnInput[] = specs.map((spec) => ({
    column: spec.name,
    semantic: spec.semantic,
    pair: spec.pair ?? null,
  }));
  const table: CandidateTable = {
    id,
    schema: 'public',
    name: id.split('.').pop() as string,
    kind: 'table',
    rowCountEstimate: 5_000,
    columns,
  };
  const classified: ClassifiedTableInput = {
    tableId: id,
    shape: overrides.shape ?? 'generic',
    role: overrides.role ?? 'entity',
    displayColumn: overrides.displayColumn ?? null,
    hierarchyColumn: overrides.hierarchyColumn ?? null,
    columns: classifiedColumns,
  };
  return { table, classified };
}

const pk: ColumnSpec = { name: 'id', logicalType: 'integer', semantic: 'pk-id', isPrimaryKey: true };
const createdAt: ColumnSpec = {
  name: 'created_at',
  logicalType: 'timestamptz',
  semantic: 'created-at',
};

function pick(input: CandidateTableInput): string | null {
  return selectArchetype(input.table, input.classified, ctx)?.template ?? null;
}

/* ------------------------------------------------------------- §14 triggers */

describe('§14 auto-triggers — one archetype per table', () => {
  it('status enum classified as workflow → page-board', () => {
    const tasks = build(
      'public.tasks',
      [
        pk,
        { name: 'title', logicalType: 'varchar', semantic: 'plain' },
        {
          name: 'status',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['todo', 'in_progress', 'review', 'done'],
        },
        createdAt,
      ],
      { displayColumn: 'title', shape: 'workflow' },
    );
    expect(pick(tasks)).toBe('page-board');
  });

  it('…and an orthogonal lane dimension raises the score (swimlane variant)', () => {
    const laned = build(
      'public.tasks',
      [
        pk,
        { name: 'title', logicalType: 'varchar', semantic: 'plain' },
        {
          name: 'status',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['todo', 'done'],
        },
        {
          name: 'team',
          logicalType: 'enum',
          semantic: 'category-enum',
          enumValues: ['platform', 'growth'],
        },
      ],
      { displayColumn: 'title', shape: 'workflow' },
    );
    const plain = build(
      'public.tasks',
      [
        pk,
        { name: 'title', logicalType: 'varchar', semantic: 'plain' },
        {
          name: 'status',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['todo', 'done'],
        },
      ],
      { displayColumn: 'title', shape: 'workflow' },
    );
    const lanedBoard = scoreArchetypes(laned.table, laned.classified, ctx).find(
      (a) => a.template === 'page-board',
    );
    const plainBoard = scoreArchetypes(plain.table, plain.classified, ctx).find(
      (a) => a.template === 'page-board',
    );
    expect(lanedBoard?.score).toBeGreaterThan(plainBoard?.score as number);
    expect(lanedBoard?.reasons.join(' ')).toContain('lane dimension');
  });

  it('date column + title column → page-calendar', () => {
    const releases = build(
      'public.releases',
      [
        pk,
        { name: 'title', logicalType: 'varchar', semantic: 'plain' },
        { name: 'released_at', logicalType: 'timestamptz', semantic: 'event-timestamp' },
      ],
      { displayColumn: 'title', shape: 'events' },
    );
    expect(pick(releases)).toBe('page-calendar');
  });

  it('people-shaped table (name/email/avatar) → page-directory', () => {
    const employees = build(
      'public.employees',
      [
        pk,
        { name: 'full_name', logicalType: 'varchar', semantic: 'person-name' },
        { name: 'email', logicalType: 'varchar', semantic: 'email' },
        { name: 'avatar_url', logicalType: 'varchar', semantic: 'image-url' },
        {
          name: 'manager_id',
          logicalType: 'integer',
          semantic: 'fk',
          references: { tableId: 'public.employees', column: 'id' },
        },
      ],
      {
        displayColumn: 'full_name',
        shape: 'people',
        role: 'people',
        hierarchyColumn: 'manager_id',
      },
    );
    const selection = selectArchetype(employees.table, employees.classified, ctx);
    expect(selection?.template).toBe('page-directory');
    // The self-FK is what makes it the org-chart tree variant (§14).
    expect(selection?.reasons.join(' ')).toContain('org-chart tree variant');
  });

  it('person FK × date × shift-type → page-scheduler', () => {
    const shifts = build(
      'public.shifts',
      [
        pk,
        {
          name: 'employee_id',
          logicalType: 'integer',
          semantic: 'fk',
          references: { tableId: 'public.employees', column: 'id' },
        },
        { name: 'shift_date', logicalType: 'date', semantic: 'event-timestamp' },
        {
          name: 'shift_type',
          logicalType: 'enum',
          semantic: 'category-enum',
          enumValues: ['morning', 'evening', 'night'],
        },
      ],
      { shape: 'events' },
    );
    expect(pick(shifts)).toBe('page-scheduler');
  });

  it('hours × person × project → page-scheduler (team workload variant)', () => {
    const assignments = build('public.assignments', [
      pk,
      {
        name: 'user_id',
        logicalType: 'integer',
        semantic: 'fk',
        references: { tableId: 'public.users', column: 'id' },
      },
      {
        name: 'project_id',
        logicalType: 'integer',
        semantic: 'fk',
        references: { tableId: 'public.projects', column: 'id' },
      },
      { name: 'hours', logicalType: 'decimal', semantic: 'plain' },
    ]);
    const selection = selectArchetype(assignments.table, assignments.classified, ctx);
    expect(selection?.template).toBe('page-scheduler');
    expect(selection?.reasons.join(' ')).toContain('team workload');
  });

  it('audit/log table → page-log-viewer', () => {
    const audit = build(
      'public.order_audit',
      [
        pk,
        { name: 'action', logicalType: 'varchar', semantic: 'plain' },
        {
          name: 'actor_id',
          logicalType: 'integer',
          semantic: 'fk',
          references: { tableId: 'public.users', column: 'id' },
        },
        createdAt,
      ],
      { shape: 'log', role: 'log' },
    );
    expect(pick(audit)).toBe('page-log-viewer');
  });

  it('file/attachment-shaped table → page-files', () => {
    const files = build(
      'public.attachments',
      [
        pk,
        { name: 'file_name', logicalType: 'varchar', semantic: 'file-ref' },
        { name: 'file_size', logicalType: 'bigint', semantic: 'plain' },
        {
          name: 'folder_id',
          logicalType: 'integer',
          semantic: 'fk',
          references: { tableId: 'public.attachments', column: 'id' },
        },
      ],
      { displayColumn: 'file_name', hierarchyColumn: 'folder_id' },
    );
    expect(pick(files)).toBe('page-files');
  });

  it('attachments table with a file ref but NO size column → page-files', () => {
    // §14 triggers on "File/attachment-shaped tables **or storage integration**".
    // A storage-integration attachments table has a URL, not a byte count — the
    // documented "name + explicit file reference" branch used to be unreachable
    // (it redundantly required a size column), so this table earned no page.
    const attachments = build(
      'public.attachments',
      [
        pk,
        { name: 'file_name', logicalType: 'varchar', semantic: 'plain' },
        { name: 'storage_url', logicalType: 'varchar', semantic: 'file-ref' },
        createdAt,
      ],
      { displayColumn: 'file_name' },
    );
    expect(pick(attachments)).toBe('page-files');
  });

  it('a people table with neither avatar nor self-FK earns no page-directory', () => {
    // page-directory's required `directory` slot only accepts card-gallery
    // (needs image-url) or org-chart (needs a self-FK). Firing without either
    // selected the archetype and then composed to null — and archetypePages
    // drops rather than falling back, so the table lost its §14 page silently.
    // A people table with no avatar column is the COMMON case.
    const employees = build(
      'public.employees',
      [
        pk,
        { name: 'full_name', logicalType: 'varchar', semantic: 'person-name' },
        { name: 'email', logicalType: 'varchar', semantic: 'email' },
        {
          name: 'department',
          logicalType: 'enum',
          semantic: 'category-enum',
          enumValues: ['eng', 'sales'],
        },
        createdAt,
      ],
      { displayColumn: 'full_name', shape: 'people', role: 'people' },
    );
    const ranked = scoreArchetypes(employees.table, employees.classified, ctx);
    expect(ranked.map((a) => a.template)).not.toContain('page-directory');
  });

  it('pending/approved workflow enum → page-queue-inbox, not page-board', () => {
    const approvals = build(
      'public.approvals',
      [
        pk,
        { name: 'subject', logicalType: 'varchar', semantic: 'plain' },
        {
          name: 'state',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['pending', 'approved', 'rejected'],
        },
        createdAt,
      ],
      { displayColumn: 'subject', shape: 'workflow' },
    );
    expect(pick(approvals)).toBe('page-queue-inbox');
    expect(scoreArchetypes(approvals.table, approvals.classified, ctx).map((a) => a.template)).not
      .toContain('page-board');
  });

  it('read/unread boolean → page-queue-inbox', () => {
    const notifications = build(
      'public.notifications',
      [
        pk,
        { name: 'title', logicalType: 'varchar', semantic: 'plain' },
        { name: 'is_read', logicalType: 'boolean', semantic: 'boolean-flag' },
        createdAt,
      ],
      { displayColumn: 'title' },
    );
    expect(pick(notifications)).toBe('page-queue-inbox');
  });

  it('conversation + message pair → page-chat on the conversation table', () => {
    const conversations = build(
      'public.conversations',
      [pk, { name: 'subject', logicalType: 'varchar', semantic: 'plain' }, createdAt],
      { displayColumn: 'subject' },
    );
    const messages = build(
      'public.messages',
      [
        pk,
        {
          name: 'conversation_id',
          logicalType: 'integer',
          semantic: 'fk',
          references: { tableId: 'public.conversations', column: 'id' },
        },
        {
          name: 'sender_id',
          logicalType: 'integer',
          semantic: 'fk',
          references: { tableId: 'public.users', column: 'id' },
        },
        { name: 'body', logicalType: 'text', semantic: 'free-text' },
        createdAt,
      ],
      { role: 'messages' },
    );
    const selected = selectModelArchetypes([conversations, messages], ctx);
    expect(selected.get('public.conversations')?.template).toBe('page-chat');
    expect(selected.get('public.messages')?.template).not.toBe('page-chat');
  });

  it('start/end + progress + phase FK → page-master-detail (gantt detail pane)', () => {
    const projectTasks = build(
      'public.project_tasks',
      [
        pk,
        { name: 'name', logicalType: 'varchar', semantic: 'plain' },
        {
          name: 'start_date',
          logicalType: 'date',
          semantic: 'date-range',
          pair: { role: 'start', partner: 'end_date' },
        },
        {
          name: 'end_date',
          logicalType: 'date',
          semantic: 'date-range',
          pair: { role: 'end', partner: 'start_date' },
        },
        { name: 'progress', logicalType: 'integer', semantic: 'percent' },
        {
          name: 'phase_id',
          logicalType: 'integer',
          semantic: 'fk',
          references: { tableId: 'public.phases', column: 'id' },
        },
      ],
      { displayColumn: 'name' },
    );
    const selection = selectArchetype(projectTasks.table, projectTasks.classified, ctx);
    expect(selection?.template).toBe('page-master-detail');
    expect(selection?.reasons.join(' ')).toContain('gantt-chart detail pane');
    // A start/end range is scheduling data, so the calendar trigger is damped
    // (annex §5) and must not beat it.
    const ranked = scoreArchetypes(projectTasks.table, projectTasks.classified, ctx);
    const calendar = ranked.find((a) => a.template === 'page-calendar');
    expect(calendar?.score).toBeLessThan(selection?.score as number);
  });

  it('enum-heavy table with rich detail → page-master-detail', () => {
    const tickets = build(
      'public.tickets',
      [
        pk,
        { name: 'subject', logicalType: 'varchar', semantic: 'plain' },
        { name: 'description', logicalType: 'text', semantic: 'free-text' },
        {
          name: 'priority',
          logicalType: 'enum',
          semantic: 'category-enum',
          enumValues: ['low', 'high'],
        },
        {
          name: 'channel',
          logicalType: 'enum',
          semantic: 'category-enum',
          enumValues: ['email', 'chat'],
        },
        createdAt,
      ],
      { displayColumn: 'subject' },
    );
    expect(pick(tickets)).toBe('page-master-detail');
  });
});

/* -------------------------------------------------------- non-selection */

describe('§14 selection — ties and no-match emit nothing', () => {
  it('a plain lookup table earns no archetype', () => {
    const regions = build(
      'public.regions',
      [pk, { name: 'region_name', logicalType: 'varchar', semantic: 'plain' }],
      { displayColumn: 'region_name' },
    );
    expect(scoreArchetypes(regions.table, regions.classified, ctx)).toEqual([]);
    expect(pick(regions)).toBeNull();
  });

  it('a log table with a kanban-shaped status enum stays page-log-viewer', () => {
    // §14 routes "Audit/event/webhook/log tables" to page-log-viewer, and the
    // classifier's log shape/role is definitive — page-board's enum-vocabulary
    // match is only a heuristic, so it must not compete here. Previously both
    // scored 0.88, the tie made selectArchetype return null, and the table
    // silently lost its §14 page entirely.
    const syncLog = build(
      'public.sync_log',
      [
        pk,
        {
          name: 'status',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['open', 'closed'],
        },
        createdAt,
      ],
      { shape: 'log', role: 'log' },
    );
    const ranked = scoreArchetypes(syncLog.table, syncLog.classified, ctx);
    expect(ranked.map((a) => a.template)).toEqual(['page-log-viewer']);
    expect(pick(syncLog)).toBe('page-log-viewer');
  });

  it('a log table with a lane dimension is not rendered as a kanban board', () => {
    // The dangerous half: a second category enum used to give page-board a
    // ×1.05 lane bonus (0.924), outscoring page-log-viewer's 0.88 outright — so
    // an append-only audit log generated a drag-to-change-status board.
    const orderAudit = build(
      'public.order_audit',
      [
        pk,
        {
          name: 'state',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['open', 'in_progress', 'done'],
        },
        {
          name: 'channel',
          logicalType: 'enum',
          semantic: 'category-enum',
          enumValues: ['api', 'ui'],
        },
        createdAt,
      ],
      { shape: 'log', role: 'log' },
    );
    const ranked = scoreArchetypes(orderAudit.table, orderAudit.classified, ctx);
    expect(ranked.map((a) => a.template)).not.toContain('page-board');
    expect(pick(orderAudit)).toBe('page-log-viewer');
  });

  it('a tie between the top two archetypes still selects the deterministic winner', () => {
    // scoreArchetypes orders by score desc THEN template id — a total order that
    // does not depend on rule declaration order — so ranked[0] is stable across
    // runs and satisfies 04 §8 H5. Dropping the page on a tie would violate H2's
    // "highest-scoring §14 trigger" and be invisible to the Engine, which cannot
    // tell "nothing triggered" from "two triggers tied".
    const ranked = [
      { template: 'page-board', score: 0.88, reasons: [] },
      { template: 'page-log-viewer', score: 0.88, reasons: [] },
    ];
    const sorted = [...ranked].sort((a, b) => b.score - a.score || a.template.localeCompare(b.template));
    expect(sorted[0]?.template).toBe('page-board');
    // …and the real selector agrees: an exact tie yields a page, never null.
    const tied = build(
      'public.approvals_tied',
      [
        pk,
        { name: 'subject', logicalType: 'varchar', semantic: 'plain' },
        {
          name: 'status',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['pending', 'approved'],
        },
        createdAt,
      ],
      { displayColumn: 'subject' },
    );
    const scored = scoreArchetypes(tied.table, tied.classified, ctx);
    if (scored.length > 1 && scored[0]?.score === scored[1]?.score) {
      expect(pick(tied)).toBe(scored[0]?.template);
    }
    expect(pick(tied)).not.toBeNull();
  });

  it('system and join tables earn nothing (05 §8.2)', () => {
    const join = build('public.order_tags', [
      { name: 'order_id', logicalType: 'integer', semantic: 'fk' },
      { name: 'tag_id', logicalType: 'integer', semantic: 'fk' },
    ]);
    join.classified = { ...join.classified, role: 'join-table', shape: 'join' };
    expect(pick(join)).toBeNull();
  });
});

/* --------------------------------------------------------------- contract */

describe('§14 archetype contract', () => {
  it('every trigger names a shipped manifest', () => {
    for (const id of ARCHETYPE_TEMPLATE_IDS) {
      expect(PAGE_TEMPLATE_IDS).toContain(id);
    }
  });

  it('never selects page-crud — the Engine emits it for every table regardless', () => {
    expect(ARCHETYPE_TEMPLATE_IDS).not.toContain('page-crud');
  });

  it('template ids are unique across rules (H2: one archetype per table)', () => {
    expect(new Set(ARCHETYPE_TEMPLATE_IDS).size).toBe(ARCHETYPE_TEMPLATE_IDS.length);
  });

  it('is deterministic', () => {
    const orders = build(
      'public.orders',
      [
        pk,
        { name: 'ref', logicalType: 'varchar', semantic: 'plain' },
        {
          name: 'status',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['open', 'done'],
        },
        createdAt,
      ],
      { displayColumn: 'ref' },
    );
    const a = scoreArchetypes(orders.table, orders.classified, ctx);
    const b = scoreArchetypes(orders.table, orders.classified, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const entry of a) {
      expect(entry.score).toBe(Math.round(entry.score * 1000) / 1000);
    }
  });
});
