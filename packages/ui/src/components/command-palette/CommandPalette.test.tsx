import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette, type CommandGroup, type CommandItem } from './CommandPalette.js';
import { useCommandK } from './useCommandK.js';

afterEach(cleanup);

const GROUPS: CommandGroup[] = [
  {
    id: 'nav',
    label: 'Navigation',
    items: [
      { id: 'dashboard', label: 'Go to Dashboard', hint: 'G D' },
      { id: 'invoices', label: 'Go to Invoices', keywords: ['billing'] },
    ],
  },
  {
    id: 'actions',
    label: 'Actions',
    items: [
      { id: 'new-user', label: 'Create user' },
      { id: 'export', label: 'Export CSV' },
    ],
  },
];

const LABELS = {
  dialog: 'Command palette',
  placeholder: 'Search commands…',
  navigate: 'navigate',
  open: 'open',
  close: 'close',
  empty: (q: string) => `No results for "${q}"`,
};

function Harness({ onSelect }: { onSelect: (item: CommandItem) => void }) {
  const [open, setOpen] = useState(false);
  useCommandK(() => setOpen((o) => !o));
  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      groups={GROUPS}
      onSelect={onSelect}
      labels={LABELS}
    />
  );
}

describe('CommandPalette', () => {
  it('opens with the ⌘K/Ctrl+K global hotkey and focuses the search input', async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('navigates with arrows (wrapping) and selects with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.keyboard('{Control>}k{/Control}');

    const input = screen.getByRole('combobox');
    // First item is active by default.
    expect(input.getAttribute('aria-activedescendant')).toContain('dashboard');

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toContain('new-user');

    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    // Wrapped from the first item to the last.
    expect(input.getAttribute('aria-activedescendant')).toContain('export');

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'export' }));
    expect(screen.queryByRole('dialog')).toBeNull(); // closeOnSelect
  });

  it('filters by label and keywords, hiding empty groups', async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={() => {}} />);
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('billing');

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Go to Invoices/ })).toBeDefined();
    expect(screen.queryByText('Actions')).toBeNull();
  });

  it('shows the empty state echoing the query', async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={() => {}} />);
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('zzz');
    expect(screen.getByText('No results for "zzz"')).toBeDefined();
  });

  it('clicking a row selects it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.keyboard('{Control>}k{/Control}');
    await user.click(screen.getByRole('option', { name: /Create user/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-user' }));
  });

  it('Esc closes the palette', async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={() => {}} />);
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders footer hints and kbd shortcuts', async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={() => {}} />);
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByText('navigate')).toBeDefined();
    expect(screen.getByText('open')).toBeDefined();
    expect(screen.getByText('close')).toBeDefined();
    expect(screen.getByText('G D')).toBeDefined();
  });
});
