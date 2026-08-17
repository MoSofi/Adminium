// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './Select.js';

function renderSelect(props: Parameters<typeof Select>[0] = {}) {
  return render(
    <Select aria-label="Role" {...props}>
      <option value="admin">Admin</option>
      <option value="viewer">Viewer</option>
    </Select>,
  );
}

describe('Select', () => {
  it('renders a native select with input chrome and a chevron', () => {
    const { container } = renderSelect();
    const select = screen.getByRole('combobox', { name: 'Role' });
    expect(select.tagName).toBe('SELECT');
    expect(select.className).toContain('bg-surface-2');
    expect(select.className).toContain('appearance-none');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('changes value via user selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect({ defaultValue: 'admin', onChange });
    await user.selectOptions(screen.getByRole('combobox'), 'viewer');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('viewer');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('sets aria-invalid when error', () => {
    renderSelect({ error: true });
    expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBe('true');
  });

  it('is disabled when disabled', () => {
    renderSelect({ disabled: true });
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  });

  it('applies the mono variant', () => {
    renderSelect({ mono: true });
    expect(screen.getByRole('combobox').className).toContain('font-mono');
  });
});
