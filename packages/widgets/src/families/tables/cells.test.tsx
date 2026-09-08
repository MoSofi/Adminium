// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CellValue, MASKED_PLACEHOLDER } from './cells.js';
import { gridColumnSpecSchema } from './column-spec.js';
import type { GridColumnSpecInput } from './column-spec.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

describe('CellValue — type-aware cell renderers (09 §7.1)', () => {
  it('money → mono Intl currency', () => {
    render(
      <CellValue
        column={spec({ name: 'mrr', label: 'MRR', logicalType: 'decimal', semantic: 'money', currency: 'USD' })}
        row={{ mrr: '4820' }}
      />,
    );
    expect(screen.getByText('$4,820')).toBeDefined();
  });

  it('an explicit display block wins over the semantic chain', () => {
    // A derived value has no useful semantic or logicalType, so without this
    // branch a computed total renders as a bare mono string.
    render(
      <CellValue
        column={spec({
          name: 'total',
          label: 'Total',
          derived: { ref: 'total' },
          display: { kind: 'currency', decimals: 2 },
          sortable: false,
        })}
        row={{ total: '1367.28' }}
      />,
    );
    expect(screen.getByText('$1,367.28')).toBeDefined();
  });

  it('repairs a mis-classified numeric column without touching the classifier', () => {
    // `invoice_items.rate` is a numeric(12,2) unit price whose NAME matches
    // the classifier's percent vocabulary, so it renders `1533%` today. The
    // repair changes the unit, not the magnitude (criterion 13).
    const rate: GridColumnSpecInput = {
      name: 'rate',
      label: 'Rate',
      logicalType: 'decimal',
      semantic: 'percent',
    };
    const { unmount } = render(<CellValue column={spec(rate)} row={{ rate: '1533.00' }} />);
    expect(screen.getByText('1533%')).toBeDefined();
    unmount();
    render(
      <CellValue
        column={spec({ ...rate, display: { kind: 'currency', decimals: 2 } })}
        row={{ rate: '1533.00' }}
      />,
    );
    expect(screen.getByText('$1,533.00')).toBeDefined();
  });

  it('renders a refused derived value as masked, and an absent one as an em-dash', () => {
    // The two nulls the wire distinguishes with `_masked` (D11).
    const column = spec({
      name: 'total',
      label: 'Total',
      derived: { ref: 'total' },
      display: { kind: 'currency', decimals: 2 },
    });
    const { unmount } = render(
      <CellValue column={column} row={{ total: null, _masked: ['total'] }} />,
    );
    expect(screen.getByText(MASKED_PLACEHOLDER)).toBeDefined();
    unmount();
    render(<CellValue column={column} row={{ total: null }} />);
    expect(screen.getByText('—')).toBeDefined();
  });

  it('status-workflow enum → StatusPill with the configured tone', () => {
    const { container } = render(
      <CellValue
        column={spec({
          name: 'status',
          label: 'Status',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['active', 'past_due'],
          enumTones: { past_due: 'warn' },
        })}
        row={{ status: 'past_due' }}
      />,
    );
    const pill = container.querySelector('[data-status="past_due"]');
    expect(pill).not.toBeNull();
    expect(screen.getByText('past_due')).toBeDefined();
  });

  it('category enum → Badge', () => {
    render(
      <CellValue
        column={spec({ name: 'plan', label: 'Plan', logicalType: 'enum', semantic: 'category-enum', enumValues: ['team'] })}
        row={{ plan: 'team' }}
      />,
    );
    expect(screen.getByText('team')).toBeDefined();
  });

  it('FK → avatar chip firing a record-open WidgetEvent', async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    render(
      <CellValue
        column={spec({
          name: 'owner_id',
          label: 'Owner',
          logicalType: 'integer',
          semantic: 'fk',
          fk: { table: 'public.team_members', column: 'id', displayKey: 'owner_name' },
        })}
        row={{ owner_id: 3, owner_name: 'Ada Lovelace' }}
        context={{ onEvent, connectionId: 'conn_1' }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Ada Lovelace/ }));
    expect(onEvent).toHaveBeenCalledWith({
      type: 'record-open',
      connectionId: 'conn_1',
      table: 'public.team_members',
      recordId: 3,
    });
  });

  it('FK chip falls back to the raw id when the display lookup is refused (masked), never blank', () => {
    // A PII display column the caller may not read: the server nulls the
    // alias and lists it in `_masked` (crud/lookups.ts applyLookupMask). The
    // chip must show the raw FK value — a blank chip would lie about the row.
    render(
      <CellValue
        column={spec({
          name: 'owner_id',
          label: 'Owner',
          logicalType: 'integer',
          semantic: 'fk',
          fk: { table: 'public.team_members', column: 'id', display: 'full_name', displayKey: 'owner_id__display' },
        })}
        row={{ owner_id: 3, owner_id__display: null, _masked: ['owner_id__display'] }}
      />,
    );
    expect(screen.getByRole('button', { name: /3/ })).toBeDefined();
  });

  it('FK chip drops the monogram on an explicit avatar: false', () => {
    // The chip is the page's choice, not the template's. Default stays ON —
    // an untouched page must look exactly as it did — so only a stored
    // `false` removes it, and the label survives either way.
    const column = {
      name: 'client_id',
      label: 'Client',
      logicalType: 'integer' as const,
      fk: { table: 'public.clients', column: 'id' },
    };

    // `Avatar` renders `role="img"` — the monogram is the only one in a chip.
    const on = render(<CellValue column={spec(column)} row={{ client_id: 42 }} />);
    expect(on.container.querySelector('[role="img"]')).not.toBeNull();
    on.unmount();

    const off = render(
      <CellValue column={spec({ ...column, avatar: false })} row={{ client_id: 42 }} />,
    );
    expect(off.container.querySelector('[role="img"]')).toBeNull();
    // Still a chip, still the value, still clickable through to the record.
    expect(screen.getByRole('button', { name: /42/ })).toBeDefined();
  });

  it('puts a monogram on any column that opts in, keeping its own treatment', () => {
    // The point of the flag: the monogram belongs on the NAME, which is a
    // plain (often looked-up) text column, not on the id beside it.
    const column = { name: 'client_name', label: 'Client Name', logicalType: 'text' as const };

    const off = render(<CellValue column={spec(column)} row={{ client_name: 'Acme Corp' }} />);
    expect(off.container.querySelector('[role="img"]')).toBeNull();
    off.unmount();

    const on = render(
      <CellValue column={spec({ ...column, avatar: true })} row={{ client_name: 'Acme Corp' }} />,
    );
    expect(on.container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Acme Corp');
    expect(screen.getByText('Acme Corp')).toBeDefined();
  });

  it('wraps a badge treatment rather than replacing it', () => {
    // The avatar composes with whatever the column already renders as — it is
    // a wrapper, not another branch of the type dispatch.
    const { container } = render(
      <CellValue
        column={spec({
          name: 'plan',
          label: 'Plan',
          logicalType: 'enum',
          semantic: 'category-enum',
          enumValues: ['team'],
          avatar: true,
        })}
        row={{ plan: 'team' }}
      />,
    );
    expect(container.querySelector('[role="img"]')).not.toBeNull();
    expect(container.querySelector('[data-part="badge"], .inline-flex')).not.toBeNull();
    expect(screen.getByText('team')).toBeDefined();
  });

  it('draws no monogram where there is nothing to draw one from', () => {
    const column = { name: 'client_name', label: 'Client Name', logicalType: 'text' as const, avatar: true };

    // Empty and null values: initials of nothing are nothing.
    for (const row of [{ client_name: '' }, { client_name: '   ' }, { client_name: null }]) {
      const view = render(<CellValue column={spec(column)} row={row} />);
      expect(view.container.querySelector('[role="img"]')).toBeNull();
      view.unmount();
    }

    // A masked value: the initials would leak the shape of what is hidden.
    const masked = render(
      <CellValue column={spec({ ...column, pii: true })} row={{ client_name: 'Acme Corp' }} />,
    );
    expect(masked.container.querySelector('[role="img"]')).toBeNull();
    masked.unmount();

    const serverMasked = render(
      <CellValue column={spec(column)} row={{ client_name: null, _masked: ['client_name'] }} />,
    );
    expect(serverMasked.container.querySelector('[role="img"]')).toBeNull();
  });

  it('boolean → check / x glyphs', () => {
    const column = spec({ name: 'ok', label: 'OK', logicalType: 'boolean' });
    const { container, rerender } = render(<CellValue column={column} row={{ ok: true }} />);
    expect(container.querySelector('[data-part="cell-bool-true"]')).not.toBeNull();
    rerender(<CellValue column={column} row={{ ok: false }} />);
    expect(container.querySelector('[data-part="cell-bool-false"]')).not.toBeNull();
  });

  it('timestamp → relative text with absolute title', () => {
    const { container } = render(
      <CellValue
        column={spec({ name: 'created_at', label: 'Created', logicalType: 'timestamptz', semantic: 'created-at' })}
        row={{ created_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }}
      />,
    );
    const cell = container.querySelector('[data-part="cell-timestamp"]');
    expect(cell?.textContent).toMatch(/ago/);
    expect(cell?.getAttribute('title')).toMatch(/\d{4}|20\d\d|,/);
  });

  it('date → the writer calendar day, never the raw wire instant (UTC+2 audit repro)', () => {
    const column = spec({ name: 'issued_on', label: 'Issued on', logicalType: 'date' });
    // pg wire shape for `date '2026-05-29'` read on a UTC+2 host.
    const { container } = render(<CellValue column={column} row={{ issued_on: '2026-05-28T22:00:00.000Z' }} />);
    const cell = container.querySelector('[data-part="cell-date"]');
    expect(cell?.textContent).toBe('May 29, 2026');
    expect(cell?.getAttribute('title')).toBe('2026-05-29');

    // Plain-string rows (sqlite) render identically — the two wire shapes converge.
    const { container: plain } = render(<CellValue column={column} row={{ issued_on: '2026-05-29' }} />);
    expect(plain.querySelector('[data-part="cell-date"]')?.textContent).toBe('May 29, 2026');
  });

  it('email → mono; url → external link', () => {
    render(
      <CellValue
        column={spec({ name: 'email', label: 'Email', semantic: 'email' })}
        row={{ email: 'ops@acme.dev' }}
      />,
    );
    expect(screen.getByText('ops@acme.dev')).toBeDefined();

    render(
      <CellValue column={spec({ name: 'site', label: 'Site', semantic: 'url' })} row={{ site: 'https://acme.dev' }} />,
    );
    const link = screen.getByRole('link', { name: 'https://acme.dev' });
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it("server-masked PII renders '•••' without an unmask affordance", () => {
    render(
      <CellValue
        column={spec({ name: 'phone', label: 'Phone', semantic: 'phone', pii: true })}
        row={{ phone: null, _masked: ['phone'] }}
        context={{ canUnmask: true }}
      />,
    );
    expect(screen.getByText(MASKED_PLACEHOLDER)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('unmasked PII shows the toggle affordance when permitted', async () => {
    const user = userEvent.setup();
    render(
      <CellValue
        column={spec({ name: 'phone', label: 'Phone', semantic: 'phone', pii: true })}
        row={{ phone: '+1 415 555 0100' }}
        context={{ canUnmask: true }}
      />,
    );
    expect(screen.getByText(MASKED_PLACEHOLDER)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Reveal value' }));
    expect(screen.getByText('+1 415 555 0100')).toBeDefined();
  });

  it('PII without the unmask grant stays masked, no toggle', () => {
    render(
      <CellValue
        column={spec({ name: 'phone', label: 'Phone', semantic: 'phone', pii: true })}
        row={{ phone: '+1 415 555 0100' }}
        context={{ canUnmask: false }}
      />,
    );
    expect(screen.getByText(MASKED_PLACEHOLDER)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('null → em-dash placeholder', () => {
    render(<CellValue column={spec({ name: 'note', label: 'Note' })} row={{ note: null }} />);
    expect(screen.getByText('—')).toBeDefined();
  });
});
