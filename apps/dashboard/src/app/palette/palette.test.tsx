/**
 * ⌘K palette (09-generated-app.md §5.2): fixed group order Actions →
 * Navigate, client-side nav filtering (search endpoint lands Wave B,
 * M4-T06), query echoed in the empty state, Ask AI hidden while
 * `llm.enabled` is false, and selection dispatch.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@adminium/ui';

import { makeBootstrap } from '../../test/fixtures.js';
import { CommandPaletteHost } from './CommandPaletteHost.js';

function renderPalette(overrides: Partial<Parameters<typeof CommandPaletteHost>[0]> = {}) {
  const onNavigate = vi.fn();
  const onSignOut = vi.fn();
  const onShowShortcuts = vi.fn();
  render(
    <ThemeProvider>
      <CommandPaletteHost
        open
        onOpenChange={() => undefined}
        bootstrap={makeBootstrap()}
        onNavigate={onNavigate}
        onSignOut={onSignOut}
        onShowShortcuts={onShowShortcuts}
        {...overrides}
      />
    </ThemeProvider>,
  );
  return { onNavigate, onSignOut, onShowShortcuts };
}

describe('CommandPaletteHost', () => {
  it('renders Actions then Navigate with nav-tree entries and chord hints', () => {
    renderPalette();
    const groups = screen.getAllByRole('group').map((el) => el.getAttribute('aria-label'));
    expect(groups).toEqual(['Actions', 'Navigate']);
    expect(screen.getByRole('option', { name: /Customers/ })).toBeDefined();
    // First nav item gets the `G C` chord hint.
    expect(screen.getByText('G C')).toBeDefined();
  });

  it('filters client-side and echoes the query in the empty state', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'orders');
    expect(screen.getByRole('option', { name: /Orders/ })).toBeDefined();
    expect(screen.queryByRole('option', { name: /Sign out/ })).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, 'zzz-nothing');
    expect(screen.getByText(/No results for "zzz-nothing"/)).toBeDefined();
  });

  it('dispatches navigation and actions on selection', async () => {
    const { onNavigate, onSignOut } = renderPalette();
    await userEvent.click(screen.getByRole('option', { name: /Customers/ }));
    expect(onNavigate).toHaveBeenCalledWith('customers');
    await userEvent.click(screen.getByRole('option', { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('hides the Ask AI footer while llm.enabled is false', () => {
    renderPalette();
    expect(screen.queryByText('Ask AI')).toBeNull();
  });

  it('shows the Ask AI footer when llm.enabled', () => {
    renderPalette({ bootstrap: makeBootstrap({ llm: { enabled: true } }) });
    expect(screen.getByText('Ask AI')).toBeDefined();
  });
});
