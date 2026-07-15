// @vitest-environment happy-dom
/**
 * Track F `tables` additions (annex §3): render + interaction tests for
 * master-list, log-table, card-gallery, grouped-summary-table, schema-tree,
 * and toggle-matrix, plus deterministic demoData and the four WidgetFrame
 * states through WidgetHost.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CardGallery, cardGalleryDemoData } from './CardGallery.js';
import { GroupedSummaryTable, groupedSummaryTableDemoData } from './GroupedSummaryTable.js';
import { LogTable, codeTone, isErrorRow, logTableDemoData, smartTimestamp } from './LogTable.js';
import type { LogRow } from './LogTable.js';
import { MasterList, masterListDemoData } from './MasterList.js';
import { SchemaTree, schemaTreeDemoData } from './SchemaTree.js';
import {
  cardGalleryDefinition,
  groupedSummaryTableDefinition,
  logTableDefinition,
  masterListDefinition,
  schemaTreeDefinition,
  toggleMatrixDefinition,
} from './tables-track-f.definitions.js';
import { ToggleMatrixGrid, toggleMatrixDemoData } from './ToggleMatrixWidget.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const NOW = Date.UTC(2026, 6, 14, 15, 0, 0);
const MASTER_CONFIG = {
  titleField: 'name',
  statusField: 'status',
  toggleField: 'enabled',
  filterField: 'category',
  ownerField: 'owner_name',
  selectable: true,
} as const;

describe('master-list', () => {
  it('renders rows with a status pill and an inline toggle that mutates', () => {
    const { data } = masterListDemoData(7);
    const toggles: { id: string; next: boolean }[] = [];
    render(<MasterList rows={data} config={MASTER_CONFIG} now={NOW} onToggle={(id, next) => toggles.push({ id, next })} />);
    expect(screen.getByText(data[0]!.name as string)).toBeDefined();
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]!);
    expect(toggles).toHaveLength(1);
  });

  it('filters rows through the chip bar and selects a row', () => {
    const rows = [
      { id: 1, name: 'Alpha rule', status: 'active', category: 'Support', enabled: true },
      { id: 2, name: 'Beta rule', status: 'paused', category: 'Reports', enabled: false },
    ];
    const selected: string[] = [];
    render(<MasterList rows={rows} config={MASTER_CONFIG} onSelect={(id) => selected.push(id)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(screen.queryByText('Alpha rule')).toBeNull();
    expect(screen.getByText('Beta rule')).toBeDefined();
    fireEvent.click(screen.getByText('Beta rule'));
    expect(selected).toEqual(['2']);
    expect(document.querySelector('[aria-current="true"]')).not.toBeNull();
  });

  it('demoData is deterministic', () => {
    expect(masterListDemoData(4)).toEqual(masterListDemoData(4));
  });
});

describe('log-table', () => {
  it('classifies error rows and code tones', () => {
    expect(codeTone(201)).toBe('pos');
    expect(codeTone(404)).toBe('warn');
    expect(codeTone(500)).toBe('danger');
    expect(isErrorRow({ id: 1, ts: '', code: 500 })).toBe(true);
    expect(isErrorRow({ id: 2, ts: '', code: 200 })).toBe(false);
    expect(isErrorRow({ id: 3, ts: '', status: 'denied' })).toBe(true);
  });

  it('renders smart timestamp prefixes', () => {
    expect(smartTimestamp(new Date(NOW).toISOString(), NOW)).toMatch(/^Today /);
    expect(smartTimestamp(new Date(NOW - 86_400_000).toISOString(), NOW)).toMatch(/^Yesterday /);
    expect(smartTimestamp(new Date(NOW - 6 * 86_400_000).toISOString(), NOW)).toMatch(/^\w{3} /);
  });

  it('filters to errors only and by search substring', () => {
    const rows: LogRow[] = [
      { id: 1, ts: new Date(NOW).toISOString(), category: 'api', action: 'GET', resource: '/ok', code: 200 },
      { id: 2, ts: new Date(NOW).toISOString(), category: 'api', action: 'GET', resource: '/boom', code: 500 },
    ];
    render(<LogTable rows={rows} now={NOW} />);
    expect(document.querySelectorAll('[data-widget="log-table"] li')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /errors/i }));
    expect(document.querySelectorAll('[data-widget="log-table"] li')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^all/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'boom' } });
    expect(document.querySelectorAll('[data-widget="log-table"] li')).toHaveLength(1);
  });

  it('demoData is deterministic', () => {
    expect(logTableDemoData(3)).toEqual(logTableDemoData(3));
  });
});

describe('card-gallery', () => {
  it('renders cards and fires open on click', () => {
    const { data } = cardGalleryDemoData(1);
    const opened: (string | number)[] = [];
    render(<CardGallery cards={data} onOpen={(card) => opened.push(card.id)} />);
    expect(screen.getByText('Stripe')).toBeDefined();
    fireEvent.click(screen.getByText('Stripe'));
    expect(opened).toHaveLength(1);
  });

  it('shows an empty state', () => {
    render(<CardGallery cards={[]} emptyTitle="Nothing to show" />);
    expect(screen.getByText('Nothing to show')).toBeDefined();
  });

  it('demoData is deterministic', () => {
    expect(cardGalleryDemoData(2)).toEqual(cardGalleryDemoData(2));
  });
});

describe('grouped-summary-table', () => {
  it('renders groups, a totals row, and expands details', () => {
    const data = groupedSummaryTableDemoData(5);
    render(<GroupedSummaryTable data={data} />);
    expect(screen.getByText('North America')).toBeDefined();
    expect(document.querySelector('[data-part="totals-row"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-part="detail-row"]')).toHaveLength(0);
    fireEvent.click(screen.getByText('North America'));
    expect(document.querySelectorAll('[data-part="detail-row"]').length).toBeGreaterThan(0);
  });

  it('demoData is deterministic and carries columns + totals', () => {
    const a = groupedSummaryTableDemoData(6);
    expect(a).toEqual(groupedSummaryTableDemoData(6));
    expect(a.columns.length).toBeGreaterThan(0);
    expect(a.totals).toBeDefined();
  });
});

describe('schema-tree', () => {
  it('renders schema/table labels with PK/FK badges and expands columns', () => {
    const { roots } = schemaTreeDemoData(1);
    render(<SchemaTree roots={roots} expandDepth={0} />);
    expect(screen.getByText('public')).toBeDefined();
    expect(screen.getByText('customers')).toBeDefined();
    // only the schema is auto-expanded at depth 0; table columns stay collapsed
    expect(screen.queryByText('email')).toBeNull();
    fireEvent.click(screen.getByText('customers'));
    expect(screen.getByText('email')).toBeDefined();
    expect(screen.getAllByText('PK').length).toBeGreaterThan(0);
    expect(screen.getByText('view')).toBeDefined();
  });

  it('demoData is deterministic', () => {
    // Same seed twice → identical output (determinism). schema-tree is
    // seed-invariant by design, but this must still assert the determinism
    // property, not seed-invariance (which comparing seed 1 vs 2 would).
    expect(schemaTreeDemoData(1)).toEqual(schemaTreeDemoData(1));
  });
});

describe('toggle-matrix', () => {
  it('renders role columns, locks the owner column, and toggles editable cells dirty', () => {
    const data = toggleMatrixDemoData(1);
    const edits: { row: string; col: string; next: boolean }[] = [];
    render(<ToggleMatrixGrid data={data} onToggle={(row, col, next) => edits.push({ row, col, next })} />);
    expect(screen.getByText('Owner')).toBeDefined();
    expect(screen.getByText('Editor')).toBeDefined();
    const cells = [...document.querySelectorAll('[data-part="matrix-cell"]')];
    expect(cells.length).toBeGreaterThan(0);
    const editable = cells.find((cell) => cell.getAttribute('aria-disabled') !== 'true');
    fireEvent.click(editable as HTMLElement);
    expect(edits).toHaveLength(1);
  });

  it('demoData is deterministic and matches the matrix shape', () => {
    const a = toggleMatrixDemoData(3);
    expect(a).toEqual(toggleMatrixDemoData(3));
    expect(a.rowKeys.length).toBeGreaterThan(0);
    expect(a.colKeys.length).toBeGreaterThan(0);
  });
});

describe('Track F table definitions + four WidgetFrame states', () => {
  const defs: WidgetDefinition[] = [
    masterListDefinition,
    logTableDefinition,
    cardGalleryDefinition,
    groupedSummaryTableDefinition,
    schemaTreeDefinition,
    toggleMatrixDefinition,
  ];

  it('exposes the exact annex ids in the tables family with annex sizing', () => {
    expect(defs.map((d) => d.id).sort()).toEqual([
      'card-gallery',
      'grouped-summary-table',
      'log-table',
      'master-list',
      'schema-tree',
      'toggle-matrix',
    ]);
    for (const def of defs) {
      expect(def.family).toBe('tables');
      expect(def.configSchema.safeParse({}).success).toBe(true);
      expect(def.demoData(1)).toEqual(def.demoData(1));
    }
    expect(logTableDefinition.sizing).toEqual({ minW: 8, minH: 6, defaultW: 12, defaultH: 10 });
    expect(schemaTreeDefinition.sizing).toEqual({ minW: 3, minH: 8, defaultW: 3, defaultH: 12 });
  });

  it('renders skeleton + error states and the empty state through WidgetHost', () => {
    const emptyByContract: Record<string, unknown> = {
      'record-list': { data: [], total: 0 },
      'hierarchy/tree': { roots: [] },
      matrix: { rowKeys: [], colKeys: [] },
    };
    for (const def of defs) {
      const registry = buildRegistry([def]);
      const { unmount: u1 } = render(
        <WidgetHost widgetId={def.id} instanceId={`${def.id}-load`} data={{ status: 'loading' }} registry={registry} />,
      );
      expect(document.querySelector(`[data-skeleton-variant="${def.skeleton}"]`)).not.toBeNull();
      u1();

      const { unmount: u2 } = render(
        <WidgetHost widgetId={def.id} instanceId={`${def.id}-err`} data={{ status: 'error', error: new Error('DENIED'), refetch: () => {} }} registry={registry} />,
      );
      expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
      u2();

      const contract = Array.isArray(def.dataContract) ? def.dataContract[0]! : def.dataContract;
      const { unmount: u3 } = render(
        <WidgetHost
          widgetId={def.id}
          instanceId={`${def.id}-empty`}
          config={{ emptyState: { titleKey: `Empty ${def.id}` } }}
          data={{ status: 'success', data: emptyByContract[contract] }}
          registry={registry}
        />,
      );
      expect(screen.getByText(`Empty ${def.id}`)).toBeDefined();
      u3();
    }
  });
});
