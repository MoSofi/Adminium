// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * TRACK FORMS — unit tests for the M7 Wave-4 `forms` TAIL (annex §10):
 * rule-builder, flow-builder, connection-string-field, table-inclusion-checklist,
 * column-mapping-table, export-builder, question-builder, inline-editable-field.
 *
 * The QA harness (qa/*) already proves the generic contracts for every delivered
 * widget (four states, config fuzz, determinism, chunk budget), so these cover
 * what is SPECIFIC to this slice — above all the two places it can do damage:
 *
 *   · THE LIFT. `forms-dsn.ts` and `forms-tables.ts` came out of the Studio
 *     connect wizard, and the whole point of lifting was that ONE rule now backs
 *     both. These pin the behaviours the wizard's own suite pins, on the
 *     widgets side, so the shared rule cannot be "fixed" for the widget and
 *     silently changed for the wizard.
 *   · THE WRITE MODEL. Every widget here emits `mutate` intents. What must never
 *     regress: an unbound instance emits nothing, and an intent never carries a
 *     value the user cannot see.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ColumnMappingTableWidget, mappingRowsOf } from './ColumnMappingTable.js';
import { ConnectionStringFieldWidget } from './ConnectionStringField.js';
import { ExportBuilderWidget, exportStateOf } from './ExportBuilder.js';
import { FlowBuilderWidget, flowNodesOf, flowStatsOf } from './FlowBuilder.js';
import { InlineEditableFieldWidget } from './InlineEditableField.js';
import { QuestionBuilderWidget, questionsOf } from './QuestionBuilder.js';
import { RuleBuilderWidget, conditionsOf, matchModeOf } from './RuleBuilder.js';
import { TableInclusionChecklistWidget, inclusionTablesOf, initialInclusion } from './TableInclusionChecklist.js';
import {
  AUTO_MATCH_THRESHOLD,
  SKIP_TARGET,
  autoMatchTarget,
  canAppendNode,
  exportPhaseOf,
  moveItem,
  nameSimilarity,
  operatorTakesValue,
  repairOperator,
} from './forms-builders.js';
import {
  DSN_ENGINES,
  dsnHost,
  dsnValidationCode,
  dsnWithEngine,
  engineForDsn,
  providerChipsFor,
} from './forms-dsn.js';
import { HIGH_VOLUME_ROWS, defaultIncludedIds, inclusionCounts, isHighVolume } from './forms-tables.js';
import {
  columnMappingTableConfigSchema,
  connectionStringFieldConfigSchema,
  exportBuilderConfigSchema,
  flowBuilderConfigSchema,
  inlineEditableFieldConfigSchema,
  questionBuilderConfigSchema,
  ruleBuilderConfigSchema,
  tableInclusionChecklistConfigSchema,
} from './forms-config.js';

afterEach(cleanup);

function cfg<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse(overrides);
}

const noop = () => {};
const BINDING = { connectionId: 'c1', source: { schema: 'public', name: 'segments' }, shape: 'form-state' };

/** The engines Adminium v1 connects to — what the Studio wizard passes. */
const WIZARD_ENGINES = ['postgres', 'mysql', 'sqlite'] as const;

// ── the lifted DSN grammar (forms-dsn.ts) ──────────────────────────────────

describe('DSN grammar — the rule the Studio wizard now shares', () => {
  it('maps every scheme (and alias) onto its engine', () => {
    expect(engineForDsn('postgres://u@h:5432/db')).toBe('postgres');
    expect(engineForDsn('postgresql://u@h/db')).toBe('postgres');
    expect(engineForDsn('mysql://u@h/db')).toBe('mysql');
    expect(engineForDsn('mariadb://u@h/db')).toBe('mysql'); // alias collapses
    expect(engineForDsn('sqlite:/data/app.db')).toBe('sqlite');
    expect(engineForDsn('mongodb+srv://u@cluster/db')).toBe('mongodb');
    expect(engineForDsn('ftp://files')).toBeNull();
  });

  it('`allowed` makes an out-of-scope scheme read as unrecognised', () => {
    // This is the wizard's behaviour, preserved: v1 cannot connect to Mongo, so
    // for the wizard `mongodb://` is not "valid but refused" — it is unknown.
    expect(engineForDsn('mongodb://u@h/db', WIZARD_ENGINES)).toBeNull();
    expect(dsnValidationCode('mongodb://u@h/db', WIZARD_ENGINES)).toBe('invalid-scheme');
    // …and the same string IS a Mongo DSN to a field configured for it.
    expect(engineForDsn('mongodb://u@h/db', DSN_ENGINES)).toBe('mongodb');
    expect(dsnValidationCode('mongodb://u@h/db', DSN_ENGINES)).toBeNull();
  });

  it('an EMPTY DSN is untouched, not invalid', () => {
    expect(dsnValidationCode('')).toBeNull();
    expect(dsnValidationCode('   ')).toBeNull();
  });

  it('flags a bare authority as incomplete but accepts bare `sqlite:` as a path prefix', () => {
    expect(dsnValidationCode('postgres://')).toBe('incomplete');
    expect(dsnValidationCode('mysql://')).toBe('incomplete');
    expect(dsnValidationCode('sqlite:')).toBeNull();
  });

  it('parses the host, splitting credentials at the LAST @ (un-encoded passwords)', () => {
    expect(dsnHost('postgres://u:p@db.acme.internal:5432/prod')).toBe('db.acme.internal');
    expect(dsnHost('postgres://localhost:5432/app')).toBe('localhost');
    expect(dsnHost('postgres://host/db')).toBe('host');
    // A '@' inside the password must not become the hostname.
    expect(dsnHost('postgres://user:p@ss@real.host/db')).toBe('real.host');
    // A file path has no host.
    expect(dsnHost('sqlite:/data/app.db')).toBeNull();
    expect(dsnHost('nonsense')).toBeNull();
  });

  it('rewrites schemes between network engines and RESETS across sqlite', () => {
    expect(dsnWithEngine('postgres://u@h:5432/db', 'mysql')).toBe('mysql://u@h:5432/db');
    expect(dsnWithEngine('mariadb://u@h/db', 'mysql')).toBe('mariadb://u@h/db'); // already mysql-family
    expect(dsnWithEngine('postgres://u@h/db', 'sqlite')).toBe(''); // host/port → path: nothing carries
    expect(dsnWithEngine('sqlite:/data/app.db', 'postgres')).toBe('');
    expect(dsnWithEngine('', 'mysql')).toBe('');
  });

  /**
   * The allow-list has to reach the REWRITE, not just validation. Without it, a
   * pasted Atlas DSN plus a click on "MySQL" yields
   * `mysql://…@cluster0.mongodb.net/db` — which then validates clean, so the
   * user is one click from firing "Test connection" at a MySQL driver pointed at
   * a Mongo host, and the error they get back is a connection failure rather
   * than "that scheme isn't supported". An out-of-scope scheme is UNRECOGNISED
   * (`engineForDsn` → null), so the field resets and forces a clean retype.
   */
  it('resets — never rewrites — a DSN whose scheme is outside the allow-list', () => {
    const atlas = 'mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/mydb';
    expect(dsnWithEngine(atlas, 'mysql', WIZARD_ENGINES)).toBe('');
    expect(dsnWithEngine('sqlserver://u:p@host:1433/db', 'postgres', WIZARD_ENGINES)).toBe('');
    // …and with the full 5-engine vocabulary the same DSN is in scope, so the
    // scheme swaps in place as before.
    expect(dsnWithEngine(atlas, 'mysql')).toBe('mysql://USER:PASSWORD@cluster0.abcde.mongodb.net/mydb');
  });

  it('shows only the chips belonging to the engine, and none the host cannot reach', () => {
    expect(providerChipsFor('postgres').every((chip) => chip.dsn.startsWith('postgres://'))).toBe(true);
    expect(providerChipsFor('mysql').map((chip) => chip.key)).toEqual(['planetscale']);
    expect(providerChipsFor('sqlite')).toEqual([]);
    // Mongo has a chip, but not for a host that only speaks the wizard's three.
    expect(providerChipsFor('mongodb').map((chip) => chip.key)).toEqual(['atlas']);
    expect(providerChipsFor('mongodb', WIZARD_ENGINES)).toEqual([]);
  });
});

// ── the lifted inclusion rules (forms-tables.ts) ───────────────────────────

describe('table-inclusion rules — the rule the Studio wizard now shares', () => {
  const table = (id: string, rowEstimate: number | null, preHidden = false) => ({
    id,
    rowEstimate,
    piiColumns: 0,
    highVolume: isHighVolume(rowEstimate),
    preHidden,
  });

  it('high volume is strictly ABOVE the threshold (the boundary stays included)', () => {
    expect(isHighVolume(HIGH_VOLUME_ROWS)).toBe(false);
    expect(isHighVolume(HIGH_VOLUME_ROWS + 1)).toBe(true);
  });

  it('an UNKNOWN row count is not high-volume (a schema import must not drop everything)', () => {
    expect(isHighVolume(null)).toBe(false);
    expect(defaultIncludedIds([table('a', null)])).toEqual(['a']);
  });

  it('defaults to everything visible except high-volume ops tables', () => {
    const tables = [
      table('public.customers', 900),
      table('public.audit_log', HIGH_VOLUME_ROWS + 1),
      table('public.join_tbl', 10, true),
      table('public.at_threshold', HIGH_VOLUME_ROWS),
    ];
    expect(defaultIncludedIds(tables)).toEqual(['public.customers', 'public.at_threshold']);
  });

  it('counts only VISIBLE tables in the header count', () => {
    const tables = [table('a', 1), table('b', 1), table('hidden', 1, true)];
    expect(inclusionCounts(tables, new Set(['a', 'hidden']))).toEqual({ included: 1, total: 2 });
  });
});

// ── connection-string-field ────────────────────────────────────────────────

describe('connection-string-field (annex §10)', () => {
  it('detects the engine, parses the host and renders the status line', () => {
    render(
      <ConnectionStringFieldWidget
        config={cfg(connectionStringFieldConfigSchema, { statusLine: '14 tables detected', hostLabel: 'Host: {host}' })}
        instanceId="d1"
        onEvent={noop}
        data={{ fields: [], values: { dsn: 'postgres://u:p@db.acme.internal:5432/prod' } }}
      />,
    );
    expect(document.querySelector('[data-widget="connection-string-field"]')?.getAttribute('data-engine')).toBe('postgres');
    expect(screen.getByText('Host: db.acme.internal')).toBeTruthy();
    expect(screen.getByText('14 tables detected')).toBeTruthy();
  });

  /**
   * The status/host row must not render as an empty box. Its wrapper used to be
   * gated on `host !== null` alone while its only host child additionally needs
   * `hostLabel` — and the Studio connect wizard passes neither `hostLabel` nor
   * `statusLine`, so every user of the connect flow got a childless <div> that
   * the parent's `gap-3` still spaced.
   */
  it('renders no status row at all when there is neither a hostLabel nor a statusLine', () => {
    const { container } = render(
      <ConnectionStringFieldWidget
        config={cfg(connectionStringFieldConfigSchema)}
        instanceId="d0"
        onEvent={noop}
        data={{ fields: [], values: { dsn: 'postgres://u:p@db.acme.internal:5432/app' } }}
      />,
    );
    const empty = [...container.querySelectorAll('[data-widget="connection-string-field"] > div')].filter(
      (node) => node.childElementCount === 0 && (node.textContent ?? '') === '',
    );
    expect(empty).toEqual([]);
  });

  it('reports a rejected scheme with the CALLER’s copy, not its own', () => {
    render(
      <ConnectionStringFieldWidget
        config={cfg(connectionStringFieldConfigSchema, {
          protocols: ['postgres', 'mysql', 'sqlite'],
          invalidSchemeText: 'Expected postgres://, mysql:// or sqlite:',
        })}
        instanceId="d2"
        onEvent={noop}
        data={{ fields: [], values: { dsn: 'mongodb://u@h/db' } }}
      />,
    );
    expect(screen.getByText('Expected postgres://, mysql:// or sqlite:')).toBeTruthy();
  });

  it('commits on blur — NOT per keystroke (a DSN carries a password)', () => {
    const onEvent = vi.fn();
    render(
      <ConnectionStringFieldWidget
        config={cfg(connectionStringFieldConfigSchema, { binding: BINDING })}
        instanceId="d3"
        onEvent={onEvent}
        data={{ fields: [], values: { dsn: '' } }}
      />,
    );
    const input = document.querySelector('[data-part="dsn-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'postgres://u@h/db' } });
    expect(onEvent).not.toHaveBeenCalled(); // no intent mid-typing
    fireEvent.blur(input);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      type: 'mutate',
      intent: 'update',
      table: 'public.segments',
      values: { dsn: 'postgres://u@h/db' },
    });
  });

  it('an UNBOUND field emits nothing (there is nowhere to send it)', () => {
    const onEvent = vi.fn();
    render(
      <ConnectionStringFieldWidget
        config={cfg(connectionStringFieldConfigSchema)}
        instanceId="d4"
        onEvent={onEvent}
        data={{ fields: [], values: { dsn: '' } }}
      />,
    );
    const input = document.querySelector('[data-part="dsn-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'postgres://u@h/db' } });
    fireEvent.blur(input);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('quick-fill chips follow the engine the DSN names', () => {
    render(
      <ConnectionStringFieldWidget
        config={cfg(connectionStringFieldConfigSchema, { quickFillLabel: 'Quick fill:' })}
        instanceId="d5"
        onEvent={noop}
        data={{ fields: [], values: { dsn: 'mysql://u@h/db' } }}
      />,
    );
    const keys = [...document.querySelectorAll('[data-part="quick-fill-chip"]')].map((el) => el.getAttribute('data-key'));
    expect(keys).toEqual(['planetscale']);
  });
});

// ── table-inclusion-checklist ──────────────────────────────────────────────

describe('table-inclusion-checklist (annex §10)', () => {
  const ROWS = {
    rows: [
      { name: 'public.customers', rowCount: 900, pii: 3, tag: 'Customers' },
      { name: 'public.audit_log', rowCount: HIGH_VOLUME_ROWS + 1, pii: 0 },
      { name: 'public.join_tbl', rowCount: 10, pii: 0, hidden: true },
    ],
    total: 3,
  };

  it('projects rows and reads `pii` as either a count or a flag', () => {
    const config = cfg(tableInclusionChecklistConfigSchema);
    const tables = inclusionTablesOf({ rows: [{ name: 'a', pii: 4 }, { name: 'b', pii: true }, { name: 'c' }], total: 3 }, config);
    expect(tables.map((t) => t.piiColumns)).toEqual([4, 1, 0]);
  });

  it('applies the >100k default when NO `included` column exists', () => {
    const config = cfg(tableInclusionChecklistConfigSchema);
    const tables = inclusionTablesOf(ROWS, config);
    expect([...initialInclusion(ROWS, config, tables)]).toEqual(['public.customers']);
  });

  it('an all-false `included` column is a real choice — the default must not overwrite it', () => {
    const config = cfg(tableInclusionChecklistConfigSchema);
    const data = { rows: [{ name: 'a', rowCount: 5, included: false }], total: 1 };
    expect([...initialInclusion(data, config, inclusionTablesOf(data, config))]).toEqual([]);
  });

  it('never lists a pre-hidden join/system table', () => {
    render(
      <TableInclusionChecklistWidget config={cfg(tableInclusionChecklistConfigSchema)} instanceId="t1" onEvent={noop} data={ROWS} />,
    );
    const listed = [...document.querySelectorAll('[data-part="table-row"]')].map((el) => el.getAttribute('data-table'));
    expect(listed).toEqual(['public.customers', 'public.audit_log']);
  });

  it('badges PII and high volume', () => {
    render(
      <TableInclusionChecklistWidget config={cfg(tableInclusionChecklistConfigSchema)} instanceId="t2" onEvent={noop} data={ROWS} />,
    );
    expect(screen.getByText('PII · 3')).toBeTruthy();
    expect(screen.getByText('high volume')).toBeTruthy();
  });

  it('`piiDetection: false` hides the badge', () => {
    render(
      <TableInclusionChecklistWidget
        config={cfg(tableInclusionChecklistConfigSchema, { piiDetection: false })}
        instanceId="t3"
        onEvent={noop}
        data={ROWS}
      />,
    );
    expect(document.querySelector('[data-part="pii-badge"]')).toBeNull();
  });

  it('a toggle emits the WHOLE inclusion set, sorted', () => {
    const onEvent = vi.fn();
    render(
      <TableInclusionChecklistWidget
        config={cfg(tableInclusionChecklistConfigSchema, { binding: BINDING })}
        instanceId="t4"
        onEvent={onEvent}
        data={ROWS}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'public.audit_log' }));
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      intent: 'update',
      values: { includedTables: ['public.audit_log', 'public.customers'] },
    });
  });
});

// ── rule-builder ───────────────────────────────────────────────────────────

describe('rule-builder (annex §10)', () => {
  const CATALOG = [
    { name: 'plan', label: 'Plan', type: 'enum' as const, options: [{ value: 'pro' }, { value: 'free' }] },
    { name: 'mrr', label: 'MRR', type: 'number' as const },
  ];

  it('repairs an operator the field type does not support (keeps field + value)', () => {
    expect(repairOperator('contains', 'number', undefined)).toBe('eq'); // number's first
    expect(repairOperator('gte', 'number', undefined)).toBe('gte'); // already valid
  });

  it('KEEPS a condition on a column the catalog dropped (never silently widen the rule)', () => {
    const config = cfg(ruleBuilderConfigSchema, { fieldCatalog: CATALOG });
    const conditions = conditionsOf(
      { fields: [], values: { conditions: [{ field: 'region', op: 'eq', value: 'EU' }] } },
      config,
    );
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toMatchObject({ field: 'region', value: 'EU' });
  });

  it('the payload’s match mode overrides config’s generated default', () => {
    const config = cfg(ruleBuilderConfigSchema, { matchMode: 'all' });
    expect(matchModeOf({ fields: [], values: { match: 'any' } }, config)).toBe('any');
    expect(matchModeOf({ fields: [], values: {} }, config)).toBe('all');
    expect(matchModeOf({ fields: [], values: { match: 'nonsense' } }, config)).toBe('all');
  });

  it('a value-less operator drops the stale value from the emitted rule', () => {
    expect(operatorTakesValue('is-null')).toBe(false);
    expect(operatorTakesValue('eq')).toBe(true);
    const onEvent = vi.fn();
    render(
      <RuleBuilderWidget
        config={cfg(ruleBuilderConfigSchema, { fieldCatalog: CATALOG, binding: BINDING })}
        instanceId="r1"
        onEvent={onEvent}
        data={{ fields: [], values: { conditions: [{ field: 'mrr', op: 'gte', value: '500' }], match: 'all' } }}
      />,
    );
    fireEvent.change(document.querySelector('[data-part="condition-operator"]') as HTMLSelectElement, {
      target: { value: 'is-null' },
    });
    const emitted = onEvent.mock.calls[0]?.[0] as { values: { conditions: unknown[] } };
    expect(emitted.values.conditions[0]).toEqual({ field: 'mrr', op: 'is-null' }); // no `value`
  });

  it('switching field resets the value (`mrr >= 500` must not become `plan >= 500`)', () => {
    const onEvent = vi.fn();
    render(
      <RuleBuilderWidget
        config={cfg(ruleBuilderConfigSchema, { fieldCatalog: CATALOG, binding: BINDING })}
        instanceId="r2"
        onEvent={onEvent}
        data={{ fields: [], values: { conditions: [{ field: 'mrr', op: 'gte', value: '500' }], match: 'all' } }}
      />,
    );
    fireEvent.change(document.querySelector('[data-part="condition-field"]') as HTMLSelectElement, {
      target: { value: 'plan' },
    });
    const emitted = onEvent.mock.calls[0]?.[0] as { values: { conditions: { field: string; value: string }[] } };
    expect(emitted.values.conditions[0]).toMatchObject({ field: 'plan', value: '' });
  });

  it('the ALL/ANY divider toggles the match mode and re-emits', () => {
    const onEvent = vi.fn();
    render(
      <RuleBuilderWidget
        config={cfg(ruleBuilderConfigSchema, { fieldCatalog: CATALOG, binding: BINDING })}
        instanceId="r3"
        onEvent={onEvent}
        data={{
          fields: [],
          values: {
            conditions: [
              { field: 'plan', op: 'eq', value: 'pro' },
              { field: 'mrr', op: 'gte', value: '500' },
            ],
            match: 'all',
          },
        }}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="match-divider"]') as HTMLElement);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ values: { match: 'any' } });
  });

  it('honours maxConditions', () => {
    render(
      <RuleBuilderWidget
        config={cfg(ruleBuilderConfigSchema, { fieldCatalog: CATALOG, maxConditions: 1 })}
        instanceId="r4"
        onEvent={noop}
        data={{ fields: [], values: { conditions: [{ field: 'plan', op: 'eq', value: 'pro' }] } }}
      />,
    );
    expect((document.querySelector('[data-part="add-condition"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('an UNBOUND builder emits nothing', () => {
    const onEvent = vi.fn();
    render(
      <RuleBuilderWidget
        config={cfg(ruleBuilderConfigSchema, { fieldCatalog: CATALOG })}
        instanceId="r5"
        onEvent={onEvent}
        data={{ fields: [], values: { conditions: [] } }}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="add-condition"]') as HTMLElement);
    expect(onEvent).not.toHaveBeenCalled();
  });
});

// ── flow-builder ───────────────────────────────────────────────────────────

describe('flow-builder (annex §10)', () => {
  const DATA = {
    fields: [],
    values: {
      nodes: [
        { id: 'n1', kind: 'trigger', title: 'Order created' },
        { id: 'n2', kind: 'action', title: 'Send email' },
      ],
      runs: 120,
      successRate: 98,
    },
  };

  it('a flow may hold only ONE trigger', () => {
    expect(canAppendNode('trigger', [{ kind: 'trigger' }])).toBe(false);
    expect(canAppendNode('trigger', [{ kind: 'action' }])).toBe(true);
    expect(canAppendNode('action', [{ kind: 'trigger' }])).toBe(true);
  });

  it('drops nodes of a kind the flow disables', () => {
    const config = cfg(flowBuilderConfigSchema, { nodeKinds: ['trigger', 'action'] });
    expect(flowNodesOf({ fields: [], values: { nodes: [{ id: 'x', kind: 'condition', title: 'If' }] } }, config)).toEqual([]);
  });

  it('reads header run stats, and reports none when the payload has none', () => {
    expect(flowStatsOf(DATA)).toEqual({ runs: 120, successRate: 98 });
    expect(flowStatsOf({ fields: [], values: { nodes: [] } })).toBeNull();
  });

  it('renders the stats line and one connector per gap', () => {
    render(
      <FlowBuilderWidget config={cfg(flowBuilderConfigSchema)} instanceId="f1" onEvent={noop} data={DATA} />,
    );
    expect(screen.getByText('120 runs · 98% success')).toBeTruthy();
    // 2 nodes ⇒ 1 connector between them (the trailing rail is aria-hidden chrome).
    expect(document.querySelectorAll('[data-part="flow-connector"]')).toHaveLength(1);
  });

  it('removing a node emits the remaining ordered list', () => {
    const onEvent = vi.fn();
    render(
      <FlowBuilderWidget
        config={cfg(flowBuilderConfigSchema, { binding: BINDING })}
        instanceId="f2"
        onEvent={onEvent}
        data={DATA}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Remove step — Send email/ }));
    const emitted = onEvent.mock.calls[0]?.[0] as { values: { nodes: { id: string }[] } };
    expect(emitted.values.nodes.map((n) => n.id)).toEqual(['n1']);
  });
});

// ── column-mapping-table ───────────────────────────────────────────────────

describe('column-mapping-table (annex §10)', () => {
  const TARGETS = [
    { key: 'full_name', label: 'Full name' },
    { key: 'email', label: 'Email' },
  ];

  it('name similarity is case/separator insensitive and symmetric', () => {
    expect(nameSimilarity('created_at', 'createdAt')).toBe(1);
    expect(nameSimilarity('Full Name', 'full_name')).toBe(1);
    expect(nameSimilarity('a', 'b')).toBe(0);
    expect(nameSimilarity('email_address', 'email')).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it('auto-matches by name, and suggests NOTHING below the threshold', () => {
    expect(autoMatchTarget('Full Name', TARGETS)).toBe('full_name');
    expect(autoMatchTarget('email_address', TARGETS)).toBe('email');
    // A column resembling nothing must stay unset rather than get a wrong guess.
    expect(autoMatchTarget('xyzzy_ref_9', TARGETS)).toBeNull();
  });

  it('never auto-matches onto the skip sentinel', () => {
    expect(autoMatchTarget('skip', [{ key: SKIP_TARGET, label: "Don't import" }])).toBeNull();
  });

  it('an EXPLICIT skip survives auto-match (skip ≠ undecided)', () => {
    const config = cfg(columnMappingTableConfigSchema, { targets: TARGETS, autoMatch: true });
    // Without the explicit target this column would auto-match `email`.
    const rows = mappingRowsOf({ rows: [{ column: 'email_address', target: SKIP_TARGET }], total: 1 }, config);
    expect(rows[0]?.target).toBe(SKIP_TARGET);
  });

  it('`autoMatch: false` leaves every unmapped column undecided', () => {
    const config = cfg(columnMappingTableConfigSchema, { targets: TARGETS, autoMatch: false });
    expect(mappingRowsOf({ rows: [{ column: 'Full Name' }], total: 1 }, config)[0]?.target).toBe('');
  });

  it('emits a mapping that omits undecided columns', () => {
    const onEvent = vi.fn();
    render(
      <ColumnMappingTableWidget
        config={cfg(columnMappingTableConfigSchema, { targets: TARGETS, autoMatch: false, binding: BINDING })}
        instanceId="m1"
        onEvent={onEvent}
        data={{ rows: [{ column: 'Full Name' }, { column: 'nope' }], total: 2 }}
      />,
    );
    fireEvent.change(document.querySelectorAll('[data-part="mapping-target"]')[0] as HTMLSelectElement, {
      target: { value: 'full_name' },
    });
    const emitted = onEvent.mock.calls[0]?.[0] as { values: { mapping: Record<string, string> } };
    expect(emitted.values.mapping).toEqual({ 'Full Name': 'full_name' }); // `nope` omitted
  });
});

// ── export-builder ─────────────────────────────────────────────────────────

describe('export-builder (annex §10)', () => {
  it('the payload phase wins over an optimistic local one', () => {
    expect(exportPhaseOf('idle', false)).toBe('idle');
    expect(exportPhaseOf('idle', true)).toBe('running'); // submitted, host silent
    expect(exportPhaseOf('failed', true)).toBe('failed'); // host says failed ⇒ failed
    expect(exportPhaseOf('done', false)).toBe('done');
  });

  it('falls back when the payload names a format this instance disabled', () => {
    const config = cfg(exportBuilderConfigSchema, { formats: ['csv'] });
    // Otherwise the segmented control would render with no segment selected.
    expect(exportStateOf({ fields: [], values: { format: 'pdf' } }, config).format).toBe('csv');
    // An ENABLED format is honoured.
    expect(exportStateOf({ fields: [], values: { format: 'csv' } }, config).format).toBe('csv');
    // …and a payload naming nonsense falls back too.
    expect(exportStateOf({ fields: [], values: { format: 'docx' } }, config).format).toBe('csv');
  });

  it('submitting emits an INSERT intent describing the job', () => {
    const onEvent = vi.fn();
    render(
      <ExportBuilderWidget
        config={cfg(exportBuilderConfigSchema, { binding: BINDING })}
        instanceId="e1"
        onEvent={onEvent}
        data={{ fields: [], values: { format: 'csv', from: '2026-06-01', to: '2026-06-30', includeCharts: true } }}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="export-submit"]') as HTMLElement);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      type: 'mutate',
      intent: 'insert',
      values: { format: 'csv', from: '2026-06-01', to: '2026-06-30', includeCharts: true },
    });
  });

  it('renders progress while running and a Download drill-through when done', () => {
    const onEvent = vi.fn();
    const { rerender } = render(
      <ExportBuilderWidget
        config={cfg(exportBuilderConfigSchema)}
        instanceId="e2"
        onEvent={onEvent}
        data={{ fields: [], values: { status: 'running', progress: 62 } }}
      />,
    );
    expect(document.querySelector('[data-part="export-progress"]')).not.toBeNull();
    expect(screen.getByText('62%')).toBeTruthy();

    rerender(
      <ExportBuilderWidget
        config={cfg(exportBuilderConfigSchema)}
        instanceId="e2"
        onEvent={onEvent}
        data={{ fields: [], values: { status: 'done', progress: 100, downloadHref: '/exports/1' } }}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="export-download"]') as HTMLElement);
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/exports/1' });
  });

  it('done WITHOUT an href renders no Download button (a control that did nothing)', () => {
    render(
      <ExportBuilderWidget
        config={cfg(exportBuilderConfigSchema)}
        instanceId="e3"
        onEvent={noop}
        data={{ fields: [], values: { status: 'done', progress: 100 } }}
      />,
    );
    expect(document.querySelector('[data-part="export-download"]')).toBeNull();
    expect(screen.getByText('Export ready')).toBeTruthy();
  });
});

// ── question-builder ───────────────────────────────────────────────────────

describe('question-builder (annex §10)', () => {
  const DATA = {
    fields: [],
    values: {
      questions: [
        { id: 'q1', kind: 'nps', q: 'How likely?', required: true },
        { id: 'q2', kind: 'single-choice', q: 'Plan?', required: false, opts: ['Free', 'Pro'] },
      ],
    },
  };

  it('moveItem is a pure reorder; out-of-range moves are no-ops', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 0, 0)).toEqual(['a', 'b']);
  });

  it('drops questions of a kind the survey disables (never coerce what it asks)', () => {
    const config = cfg(questionBuilderConfigSchema, { kinds: ['short-text'] });
    expect(questionsOf(DATA, config)).toEqual([]);
  });

  it('reorders with the move buttons and emits the new order', () => {
    const onEvent = vi.fn();
    render(
      <QuestionBuilderWidget
        config={cfg(questionBuilderConfigSchema, { binding: BINDING })}
        instanceId="q1"
        onEvent={onEvent}
        data={DATA}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Move up — 2/ }));
    const emitted = onEvent.mock.calls[0]?.[0] as { values: { questions: { id: string }[] } };
    expect(emitted.values.questions.map((q) => q.id)).toEqual(['q2', 'q1']);
  });

  it('only option-bearing kinds carry `opts` in the emitted survey', () => {
    const onEvent = vi.fn();
    render(
      <QuestionBuilderWidget
        config={cfg(questionBuilderConfigSchema, { binding: BINDING })}
        instanceId="q2"
        onEvent={onEvent}
        data={DATA}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Move up — 2/ }));
    const emitted = onEvent.mock.calls[0]?.[0] as { values: { questions: Record<string, unknown>[] } };
    const [single, nps] = emitted.values.questions;
    expect(single).toHaveProperty('opts');
    expect(nps).not.toHaveProperty('opts'); // an NPS scale has no choices
  });

  it('honours maxQuestions', () => {
    render(
      <QuestionBuilderWidget
        config={cfg(questionBuilderConfigSchema, { maxQuestions: 2 })}
        instanceId="q3"
        onEvent={noop}
        data={DATA}
      />,
    );
    for (const button of document.querySelectorAll('[data-part="palette-kind"]')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

// ── inline-editable-field ──────────────────────────────────────────────────

describe('inline-editable-field (annex §10)', () => {
  const DATA = { row: { id: 'doc-1', name: 'Invoice INV-2026-0142' } };

  it('click-to-edit, Enter commits and emits an update for the bound record', () => {
    const onEvent = vi.fn();
    render(
      <InlineEditableFieldWidget
        config={cfg(inlineEditableFieldConfigSchema, { field: 'name', binding: BINDING })}
        instanceId="i1"
        onEvent={onEvent}
        data={DATA}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="inline-display"]') as HTMLElement);
    const input = document.querySelector('[data-part="inline-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed' } });
    expect(onEvent).not.toHaveBeenCalled(); // no debounce write mid-typing
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      type: 'mutate',
      intent: 'update',
      recordId: 'doc-1',
      values: { name: 'Renamed' },
    });
  });

  it('Escape restores the committed value and writes NOTHING', () => {
    const onEvent = vi.fn();
    render(
      <InlineEditableFieldWidget
        config={cfg(inlineEditableFieldConfigSchema, { field: 'name', binding: BINDING })}
        instanceId="i2"
        onEvent={onEvent}
        data={DATA}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="inline-display"]') as HTMLElement);
    const input = document.querySelector('[data-part="inline-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Oops' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEvent).not.toHaveBeenCalled();
    expect(screen.getByText('Invoice INV-2026-0142')).toBeTruthy();
  });

  it('an UNCHANGED commit emits nothing (no audit entry for a no-op write)', () => {
    const onEvent = vi.fn();
    render(
      <InlineEditableFieldWidget
        config={cfg(inlineEditableFieldConfigSchema, { field: 'name', binding: BINDING })}
        instanceId="i3"
        onEvent={onEvent}
        data={DATA}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="inline-display"]') as HTMLElement);
    fireEvent.blur(document.querySelector('[data-part="inline-input"]') as HTMLElement);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('an EMPTY value still renders a clickable target', () => {
    render(
      <InlineEditableFieldWidget
        config={cfg(inlineEditableFieldConfigSchema, { field: 'name', emptyValueLabel: 'Untitled' })}
        instanceId="i4"
        onEvent={noop}
        data={{ row: { id: 'd', name: '' } }}
      />,
    );
    const display = document.querySelector('[data-part="inline-display"]') as HTMLElement;
    expect(display.getAttribute('data-empty')).toBe('true');
    expect(display.textContent).toBe('Untitled');
  });

  /**
   * `useState(bound)` seeds the FIRST render and is ignored forever after, so
   * the display would keep showing the value the row had when the instance
   * mounted. A master-detail page reuses ONE instance across row selections:
   * without a resync the field shows the previous record's text while
   * `boundRecordIdOf` already resolves the new id — and an edit then writes the
   * NEW record with the OLD record's value.
   */
  it('resyncs the display when the bound record swaps underneath it', () => {
    const config = cfg(inlineEditableFieldConfigSchema, { field: 'name', binding: BINDING });
    const { rerender } = render(
      <InlineEditableFieldWidget config={config} instanceId="i6" onEvent={noop} data={{ row: { id: '1', name: 'Ada' } }} />,
    );
    expect(screen.getByText('Ada')).toBeTruthy();
    rerender(
      <InlineEditableFieldWidget config={config} instanceId="i6" onEvent={noop} data={{ row: { id: '2', name: 'Grace' } }} />,
    );
    expect(screen.getByText('Grace')).toBeTruthy();
    expect(screen.queryByText('Ada')).toBeNull();
  });

  /** A refetch (refreshInterval, or another user's edit) must surface too. */
  it('surfaces a refetched value for the same record', () => {
    const config = cfg(inlineEditableFieldConfigSchema, { field: 'name' });
    const { rerender } = render(
      <InlineEditableFieldWidget config={config} instanceId="i7" onEvent={noop} data={{ row: { id: '1', name: 'Ada' } }} />,
    );
    rerender(
      <InlineEditableFieldWidget config={config} instanceId="i7" onEvent={noop} data={{ row: { id: '1', name: 'Ada L.' } }} />,
    );
    expect(screen.getByText('Ada L.')).toBeTruthy();
  });

  /**
   * The resync must not fire on an unrelated re-render, or every keystroke in
   * an open editor would be thrown away.
   */
  it('keeps an open draft across a re-render that does not change the bound value', () => {
    const config = cfg(inlineEditableFieldConfigSchema, { field: 'name', binding: BINDING });
    const { rerender } = render(
      <InlineEditableFieldWidget config={config} instanceId="i8" onEvent={noop} data={DATA} />,
    );
    fireEvent.click(document.querySelector('[data-part="inline-display"]') as HTMLElement);
    fireEvent.change(document.querySelector('[data-part="inline-input"]') as HTMLInputElement, {
      target: { value: 'Half-typed' },
    });
    rerender(<InlineEditableFieldWidget config={config} instanceId="i8" onEvent={noop} data={{ row: { ...DATA.row } }} />);
    expect((document.querySelector('[data-part="inline-input"]') as HTMLInputElement).value).toBe('Half-typed');
  });

  it('a multiline field takes Enter as a newline, not a commit', () => {
    const onEvent = vi.fn();
    render(
      <InlineEditableFieldWidget
        config={cfg(inlineEditableFieldConfigSchema, { field: 'name', multiline: true, binding: BINDING })}
        instanceId="i5"
        onEvent={onEvent}
        data={DATA}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="inline-display"]') as HTMLElement);
    const box = document.querySelector('[data-part="inline-input"]') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Line 1' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onEvent).not.toHaveBeenCalled();
  });
});

// ── junk-payload tolerance (04 §3: unknown in, no crash out) ────────────────

describe('the tail tolerates junk payloads', () => {
  const JUNK: [string, unknown][] = [
    ['null', null],
    ['a string', 'nope'],
    ['a bare array', [1, 2]],
    ['an envelope of the wrong shape', { rows: 'no', values: 7 }],
    ['rows of non-objects', { rows: [1, 'x', null], total: 3 }],
    ['a values list of non-objects', { fields: [], values: { conditions: [1, null], nodes: ['x'], questions: [7] } }],
  ];

  for (const [label, data] of JUNK) {
    it(`rule-builder tolerates ${label}`, () => {
      expect(() =>
        render(<RuleBuilderWidget config={cfg(ruleBuilderConfigSchema)} instanceId="j1" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`flow-builder tolerates ${label}`, () => {
      expect(() =>
        render(<FlowBuilderWidget config={cfg(flowBuilderConfigSchema)} instanceId="j2" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`connection-string-field tolerates ${label}`, () => {
      expect(() =>
        render(
          <ConnectionStringFieldWidget
            config={cfg(connectionStringFieldConfigSchema)}
            instanceId="j3"
            onEvent={noop}
            data={data}
          />,
        ),
      ).not.toThrow();
    });

    it(`table-inclusion-checklist tolerates ${label}`, () => {
      expect(() =>
        render(
          <TableInclusionChecklistWidget
            config={cfg(tableInclusionChecklistConfigSchema)}
            instanceId="j4"
            onEvent={noop}
            data={data}
          />,
        ),
      ).not.toThrow();
    });

    it(`column-mapping-table tolerates ${label}`, () => {
      expect(() =>
        render(
          <ColumnMappingTableWidget config={cfg(columnMappingTableConfigSchema)} instanceId="j5" onEvent={noop} data={data} />,
        ),
      ).not.toThrow();
    });

    it(`export-builder tolerates ${label}`, () => {
      expect(() =>
        render(<ExportBuilderWidget config={cfg(exportBuilderConfigSchema)} instanceId="j6" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`question-builder tolerates ${label}`, () => {
      expect(() =>
        render(<QuestionBuilderWidget config={cfg(questionBuilderConfigSchema)} instanceId="j7" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`inline-editable-field tolerates ${label}`, () => {
      expect(() =>
        render(
          <InlineEditableFieldWidget
            config={cfg(inlineEditableFieldConfigSchema)}
            instanceId="j8"
            onEvent={noop}
            data={data}
          />,
        ),
      ).not.toThrow();
    });
  }
});
