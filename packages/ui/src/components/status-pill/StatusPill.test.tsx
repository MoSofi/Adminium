import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusPill, registerStatusTones, statusTone } from './StatusPill.js';

describe('statusTone', () => {
  it('maps canonical statuses to their semantic tones', () => {
    expect(statusTone('paid')).toBe('pos');
    expect(statusTone('pending')).toBe('warn');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('refunded')).toBe('info');
    expect(statusTone('draft')).toBe('neutral');
  });

  it('is case-insensitive', () => {
    expect(statusTone('Connected')).toBe('pos');
    expect(statusTone('ERROR')).toBe('danger');
  });

  it('falls back for unknown statuses', () => {
    expect(statusTone('somesuch')).toBe('neutral');
    expect(statusTone('somesuch', 'info')).toBe('info');
  });

  it('accepts registered domain statuses (idempotent merge)', () => {
    registerStatusTones({ shipped: 'pos' });
    registerStatusTones({ shipped: 'pos' });
    expect(statusTone('shipped')).toBe('pos');
    // defaults are untouched
    expect(statusTone('paid')).toBe('pos');
  });
});

describe('StatusPill', () => {
  it('renders a dotted badge with the registry tone', () => {
    const { container } = render(<StatusPill status="paid">Paid</StatusPill>);
    const pill = screen.getByText('Paid');
    expect(pill.className).toContain('bg-pos-soft');
    expect(pill.getAttribute('data-tone')).toBe('pos');
    expect(pill.getAttribute('data-status')).toBe('paid');
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  });

  it('falls back to the raw status key when no label is given', () => {
    render(<StatusPill status="pending" />);
    expect(screen.getByText('pending').className).toContain('bg-warn-soft');
  });

  it('honors an explicit tone override', () => {
    render(
      <StatusPill status="paid" tone="danger">
        Paid
      </StatusPill>,
    );
    expect(screen.getByText('Paid').className).toContain('bg-danger-soft');
  });

  it('uses fallbackTone for unregistered statuses', () => {
    render(
      <StatusPill status="mystery" fallbackTone="info">
        Mystery
      </StatusPill>,
    );
    expect(screen.getByText('Mystery').className).toContain('bg-info-soft');
  });
});
