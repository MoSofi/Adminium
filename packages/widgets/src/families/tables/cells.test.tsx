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
