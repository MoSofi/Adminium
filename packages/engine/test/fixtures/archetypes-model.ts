// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A synthetic schema built to exercise every §14 auto-trigger the runtime can
 * compose (research/widget-registry.md §14, M7 exit criteria). One table per
 * trigger, each shaped exactly as the annex describes it — nothing here is
 * tuned to the *rules*, only to the annex's own words, so the test that reads it
 * proves the pipeline rather than restating it.
 *
 * Northwind (`northwind.model.json`) stays the realism fixture; it happens to
 * trigger only `page-directory` (employees.reports_to) and `page-calendar`
 * (orders.order_date), which is why the exit criteria need this one.
 */
import { parseDatabaseModel, type DatabaseModel } from '../../src/schema-model.js';

interface Col {
  name: string;
  logicalType: string;
  dbType?: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  enumRef?: string;
  references?: { tableId: string; column: string };
  maxLength?: number;
}

function table(name: string, columns: Col[], rowCountEstimate = 5_000): Record<string, unknown> {
  return {
    id: `public.${name}`,
    schema: 'public',
    name,
    kind: 'table',
    rowCountEstimate,
    primaryKey: columns.filter((c) => c.isPrimaryKey === true).map((c) => c.name),
    columns: columns.map((column, index) => ({
      name: column.name,
      ordinal: index + 1,
      dbType: column.dbType ?? column.logicalType,
      logicalType: column.logicalType,
      nullable: column.nullable ?? true,
      isPrimaryKey: column.isPrimaryKey ?? false,
      isUnique: column.isUnique ?? column.isPrimaryKey ?? false,
      enumRef: column.enumRef ?? null,
      references: column.references ?? null,
      ...(column.maxLength === undefined ? {} : { maxLength: column.maxLength }),
    })),
  };
}

const pk: Col = { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true };
const createdAt: Col = { name: 'created_at', logicalType: 'timestamptz', nullable: false };

export const ARCHETYPE_CONNECTION = 'conn_01HZXARCHETYPE00000000000';

/** The raw IR — `parseDatabaseModel` fills every remaining default. */
const raw = {
  irVersion: 1,
  dialect: 'postgres',
  source: { kind: 'live', connectionId: ARCHETYPE_CONNECTION },
  name: 'archetypes',
  defaultSchema: 'public',
  schemas: ['public'],
  enums: [
    { id: 'public.task_status', name: 'task_status', values: ['todo', 'in_progress', 'review', 'done'] },
    { id: 'public.team', name: 'team', values: ['platform', 'growth'] },
    { id: 'public.shift_type', name: 'shift_type', values: ['morning', 'evening', 'night'] },
    { id: 'public.approval_state', name: 'approval_state', values: ['pending', 'approved', 'rejected'] },
    { id: 'public.priority', name: 'priority', values: ['low', 'high'] },
    { id: 'public.channel', name: 'channel', values: ['email', 'chat'] },
  ],
  tables: [
    // §14 page-board — "Status enum classified as workflow; optional lane dimension"
    table('tasks', [
      pk,
      { name: 'title', logicalType: 'varchar', maxLength: 200, nullable: false },
      { name: 'status', logicalType: 'enum', enumRef: 'public.task_status', nullable: false },
      { name: 'team', logicalType: 'enum', enumRef: 'public.team' },
      createdAt,
    ]),

    // §14 page-calendar — "Date column + title column"
    table('releases', [
      pk,
      { name: 'title', logicalType: 'varchar', maxLength: 200, nullable: false },
      { name: 'released_at', logicalType: 'timestamptz', nullable: false },
    ]),

    // §14 page-directory — "People-shaped table (name/email/role/avatar)" + org-chart tree
    table('employees', [
      pk,
      { name: 'full_name', logicalType: 'varchar', maxLength: 120, nullable: false },
      { name: 'email', logicalType: 'varchar', maxLength: 200, nullable: false, isUnique: true },
      { name: 'avatar_url', logicalType: 'text' },
      { name: 'manager_id', logicalType: 'integer', references: { tableId: 'public.employees', column: 'id' } },
    ]),

    // §14 page-scheduler — "Person FK × date × shift-type"
    table('shifts', [
      pk,
      { name: 'employee_id', logicalType: 'integer', nullable: false, references: { tableId: 'public.employees', column: 'id' } },
      { name: 'shift_date', logicalType: 'date', nullable: false },
      { name: 'shift_type', logicalType: 'enum', enumRef: 'public.shift_type', nullable: false },
    ]),

    // §13/§14 gantt — "start+end dates + phase FK → gantt-chart" (page-master-detail's domain card)
    table('phases', [pk, { name: 'name', logicalType: 'varchar', maxLength: 80, nullable: false }], 12),
    table('project_tasks', [
      pk,
      { name: 'name', logicalType: 'varchar', maxLength: 200, nullable: false },
      { name: 'start_date', logicalType: 'date', nullable: false },
      { name: 'end_date', logicalType: 'date', nullable: false },
      { name: 'progress', logicalType: 'integer', nullable: false },
      { name: 'phase_id', logicalType: 'integer', references: { tableId: 'public.phases', column: 'id' } },
    ]),

    // §14 page-log-viewer — "Audit/event/webhook/log tables"
    table('order_audit', [
      pk,
      { name: 'action', logicalType: 'varchar', maxLength: 40, nullable: false },
      { name: 'actor_id', logicalType: 'integer', references: { tableId: 'public.employees', column: 'id' } },
      createdAt,
    ]),

    // §14 page-files — "File/attachment-shaped tables"
    table('attachments', [
      pk,
      { name: 'file_name', logicalType: 'varchar', maxLength: 255, nullable: false },
      { name: 'file_size', logicalType: 'bigint', nullable: false },
      { name: 'mime_type', logicalType: 'varchar', maxLength: 80 },
      { name: 'parent_id', logicalType: 'integer', references: { tableId: 'public.attachments', column: 'id' } },
    ]),

    // §14 page-chat — "Conversation+message table pair"
    table('conversations', [
      pk,
      { name: 'subject', logicalType: 'varchar', maxLength: 200, nullable: false },
      createdAt,
    ]),
    table('conv_messages', [
      pk,
      { name: 'conversation_id', logicalType: 'integer', nullable: false, references: { tableId: 'public.conversations', column: 'id' } },
      { name: 'sender_id', logicalType: 'integer', nullable: false, references: { tableId: 'public.employees', column: 'id' } },
      { name: 'body', logicalType: 'text', nullable: false },
      createdAt,
    ]),

    // §14 page-queue-inbox — "pending/approved-style workflow enums"
    table('approvals', [
      pk,
      { name: 'subject', logicalType: 'varchar', maxLength: 200, nullable: false },
      { name: 'state', logicalType: 'enum', enumRef: 'public.approval_state', nullable: false },
      createdAt,
    ]),

    // §14 page-master-detail — "Enum-heavy tables with rich per-record detail"
    table('tickets', [
      pk,
      { name: 'subject', logicalType: 'varchar', maxLength: 200, nullable: false },
      { name: 'description', logicalType: 'text' },
      { name: 'priority', logicalType: 'enum', enumRef: 'public.priority', nullable: false },
      { name: 'channel', logicalType: 'enum', enumRef: 'public.channel', nullable: false },
      createdAt,
    ]),

    // No §14 trigger — a plain lookup table keeps just its page-crud.
    table('regions', [pk, { name: 'region_name', logicalType: 'varchar', maxLength: 60, nullable: false }], 8),
  ],
};

export const archetypeModel: DatabaseModel = parseDatabaseModel(raw);
