// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Host-drawn cells (`custom-cells.tsx`): a renderer is asked before the cell
 * chain, after the masking; nested renderers are asked inner first.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CellValue, MASKED_PLACEHOLDER } from './cells.js';
import { gridColumnSpecSchema } from './column-spec.js';
import type { GridColumnSpecInput } from './column-spec.js';
import { CustomCellProvider, type CustomCellRenderer } from './custom-cells.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const byWidget: CustomCellRenderer = (column, row) =>
  column.widget === 'project.flag' ? <strong>outer {String(row[column.name])}</strong> : undefined;

describe('host-drawn cells', () => {
  it('draw a column the host claims, including an empty value, and leave the rest alone', () => {
    render(
      <CustomCellProvider render={byWidget}>
        <CellValue column={spec({ name: 'flag', label: 'Flag', widget: 'project.flag' })} row={{ flag: null }} />
        <CellValue column={spec({ name: 'name', label: 'Name' })} row={{ name: 'Ada' }} />
      </CustomCellProvider>,
    );
    expect(screen.getByText('outer null')).toBeDefined();
    expect(screen.getByText('Ada')).toBeDefined();
  });

  it('ask the inner renderer first, then the outer one', () => {
    const inner: CustomCellRenderer = (column) => (column.name === 'name' ? <em>inner</em> : undefined);
    render(
      <CustomCellProvider render={byWidget}>
        <CustomCellProvider render={inner}>
          <CellValue column={spec({ name: 'name', label: 'Name', widget: 'project.flag' })} row={{ name: 'x' }} />
          <CellValue column={spec({ name: 'flag', label: 'Flag', widget: 'project.flag' })} row={{ flag: true }} />
        </CustomCellProvider>
      </CustomCellProvider>,
    );
    expect(screen.getByText('inner')).toBeDefined();
    expect(screen.getByText('outer true')).toBeDefined();
  });

  it('cannot unmask a value the server or the column keeps masked', () => {
    const everything: CustomCellRenderer = () => <strong>drawn</strong>;
    render(
      <CustomCellProvider render={everything}>
        <CellValue column={spec({ name: 'phone', label: 'Phone' })} row={{ phone: null, _masked: ['phone'] }} />
        <CellValue column={spec({ name: 'ssn', label: 'SSN', pii: true })} row={{ ssn: '123' }} />
      </CustomCellProvider>,
    );
    expect(screen.queryByText('drawn')).toBeNull();
    expect(screen.getAllByText(MASKED_PLACEHOLDER)).toHaveLength(2);
  });

  it('keep the widget id a page file gives, even one no host knows', () => {
    expect(spec({ name: 'a', label: 'A', widget: 'flag-cell' }).widget).toBe('flag-cell');
    expect(gridColumnSpecSchema.safeParse({ name: 'a', label: 'A', widget: '' }).success).toBe(false);
  });
});
