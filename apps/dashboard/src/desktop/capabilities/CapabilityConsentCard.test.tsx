// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The capability consent surface (11-electron.md §12) — the OAuth-scope card.
 *
 * What matters: it presents §12's "THIS WILL ALLOW <app> TO…" with the app name
 * and every scope, and it reports the user's choice without deciding anything —
 * Allow calls back, and every other way of closing (Not now, Escape, the X)
 * is a decline, because access is never granted by dismissal.
 */
import { Printer } from 'lucide-react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { CapabilityConsentCard } from './CapabilityConsentCard.js';

let restoreI18n: (() => void) | null = null;
afterEach(() => {
  restoreI18n?.();
  restoreI18n = null;
  vi.restoreAllMocks();
});

function renderCard(overrides: {
  open?: boolean;
  busy?: boolean;
  onApprove?: () => void;
  onCancel?: () => void;
}): { onApprove: () => void; onCancel: () => void } {
  restoreI18n = installTestI18n();
  const onApprove = overrides.onApprove ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  render(
    <CapabilityConsentCard
      open={overrides.open ?? true}
      appName="Adminium POS"
      busy={overrides.busy ?? false}
      scopes={[
        { id: 'printer.escpos', icon: <Printer aria-hidden />, text: 'Print to receipt printers' },
      ]}
      onApprove={onApprove}
      onCancel={onCancel}
    />,
  );
  return { onApprove, onCancel };
}

describe('CapabilityConsentCard', () => {
  it('names the app and lists each requested scope (§12 copy)', () => {
    renderCard({});
    // "THIS WILL ALLOW <app> TO:" with the app interpolated.
    expect(screen.getByText(/this will allow adminium pos to/i)).toBeDefined();
    expect(screen.getByText('Print to receipt printers')).toBeDefined();
  });

  it('calls onApprove when Allow is pressed', async () => {
    const user = userEvent.setup();
    const { onApprove } = renderCard({});
    await user.click(screen.getByRole('button', { name: /^allow$/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('treats "Not now" as a decline', async () => {
    const user = userEvent.setup();
    const { onApprove, onCancel } = renderCard({});
    await user.click(screen.getByRole('button', { name: /not now/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderCard({ open: false });
    expect(screen.queryByText(/this will allow/i)).toBeNull();
  });
});
