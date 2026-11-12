// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-run consent step under an operator's lock (plan 75 §5.2 A2): in
 * trial mode both outbound calls are set off by the operator, so the two
 * switches are drawn off and read-only with the chip, never hidden, and a
 * click changes nothing.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import { TelemetryConsent } from './TelemetryConsent.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

const OFF = { telemetry: false, updateCheck: false };

describe('TelemetryConsent', () => {
  it('open: two switches that answer, no chip', async () => {
    const onChange = vi.fn();
    render(<TelemetryConsent value={OFF} onChange={onChange} />);
    expect(screen.queryByText('Set by the operator')).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Share anonymous usage data' }));
    expect(onChange).toHaveBeenCalledWith({ telemetry: true, updateCheck: false });
  });

  it('set by the operator: off, read-only but reachable, the chip and the reason, and a click does nothing', async () => {
    const onChange = vi.fn();
    render(<TelemetryConsent value={{ telemetry: true, updateCheck: true }} onChange={onChange} locked={{ telemetry: true, updateCheck: true }} />);
    for (const name of ['Share anonymous usage data', 'Check for new releases']) {
      const toggle = screen.getByRole('switch', { name });
      // Drawn off whatever the value says: the operator's word is what is in force.
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      expect(toggle.getAttribute('aria-disabled')).toBe('true');
      expect((toggle as HTMLButtonElement).disabled).toBe(false);
      const described = (toggle.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '');
      expect(described).toContain('The operator has switched this off for this installation.');
      await userEvent.click(toggle);
    }
    expect(screen.getAllByText('Set by the operator')).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
    // "You can change either one later" is not said of a switch nobody here can change.
    expect(screen.queryByText('Both are off by default and you can change either one later in Settings.')).toBeNull();
  });
});
