// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToggleRow } from './ToggleRow.js';

afterEach(cleanup);

describe('ToggleRow', () => {
  it('names the switch with the label and describes it with the explanation', () => {
    render(
      <ToggleRow
        label="Publish immediately"
        description="Off keeps it as a draft."
        checked={false}
        onCheckedChange={() => {}}
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'Publish immediately' });
    // The explanation EXPLAINS; it is not part of the name. A screen reader
    // announces "Publish immediately, switch, off" and then the sentence.
    const describedBy = toggle.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Off keeps it as a draft.');
  });

  it('toggles from the label, so the sentence is part of the target', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<ToggleRow label="Publish immediately" checked={false} onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByText('Publish immediately'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('toggles with the keyboard', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<ToggleRow label="Publish immediately" checked={false} onCheckedChange={onCheckedChange} />);
    await user.tab();
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('works uncontrolled, which is what a story and a preview need', async () => {
    const user = userEvent.setup();
    render(<ToggleRow label="Publish immediately" defaultChecked />);
    const toggle = screen.getByRole('switch', { name: 'Publish immediately' });
    expect(toggle.getAttribute('data-state')).toBe('checked');
    await user.click(toggle);
    expect(toggle.getAttribute('data-state')).toBe('unchecked');
  });
});
