// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shortcuts panel (09-generated-app.md §5.3). Its one substantive rule is in
 * the module header: it renders the LIVE registration set from the shortcut
 * manager, never a hardcoded list — so a shortcut that is registered appears,
 * one that is not does not, and the panel can never promise a key that nothing
 * handles.
 *
 * The two rendering details that carry meaning are tested with it: keycaps
 * localize per platform (`⌘` is `Ctrl` off-mac, and a panel that says ⌘ on
 * Windows is telling the user to press a key their keyboard does not have), and
 * a chord renders its steps with a "then" between them rather than as a
 * simultaneous combo.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createShortcutManager, type ShortcutManager } from '../app/shortcuts.js';
import { ShortcutsPanel } from './ShortcutsPanel.js';
import { ShortcutsProvider } from './ShortcutsProvider.js';

/** A manager with a known registration set — the panel's only input. */
function managerWith(isMac: boolean): ShortcutManager {
  const manager = createShortcutManager({ isMac });
  manager.register({ id: 'palette', group: 'General', label: 'Command palette', keys: ['⌘', 'K'] });
  manager.register({ id: 'shortcuts', group: 'General', label: 'Shortcuts', keys: ['?'] });
  manager.register({ id: 'go-orders', group: 'Navigation', label: 'Go to orders', keys: ['g', 'then', 'o'] });
  return manager;
}

function renderPanel(manager: ShortcutManager) {
  return render(
    <ShortcutsProvider manager={manager}>
      <ShortcutsPanel open onOpenChange={() => undefined} />
    </ShortcutsProvider>,
  );
}

/** The Modal renders into a portal, so the caps are on `document`, not in the container. */
function keycaps(): (string | null)[] {
  return [...document.querySelectorAll('kbd')].map((cap) => cap.textContent);
}

describe('ShortcutsPanel', () => {
  it('draws a section per registered group, in manager order', () => {
    renderPanel(managerWith(true));
    const dialog = screen.getByRole('dialog');
    const headings = within(dialog)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['General', 'Navigation']);
  });

  it('lists exactly what is registered — nothing more', () => {
    renderPanel(managerWith(true));
    expect(screen.getByText('Command palette')).toBeTruthy();
    expect(screen.getByText('Go to orders')).toBeTruthy();
    // A shortcut nobody registered must not appear; the panel has no list of
    // its own to fall back on.
    expect(screen.queryByText('Save layout')).toBeNull();
  });

  it('renders a group only once something registers into it', () => {
    const empty = createShortcutManager({ isMac: true });
    renderPanel(empty);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    // The footer still explains how to get back here.
    expect(screen.getByText(/anytime to open this panel/)).toBeTruthy();
  });

  it('keeps the ⌘ keycap on a Mac', () => {
    renderPanel(managerWith(true));
    const caps = keycaps();
    expect(caps).toContain('⌘');
    expect(caps).not.toContain('Ctrl');
  });

  it('shows Ctrl instead of ⌘ off-mac — a key the keyboard actually has', () => {
    renderPanel(managerWith(false));
    const caps = keycaps();
    expect(caps).toContain('Ctrl');
    expect(caps).not.toContain('⌘');
    // Non-modifier caps are untouched by the platform mapping.
    expect(caps).toContain('K');
    expect(caps).toContain('?');
  });

  it('separates the steps of a chord with "then" rather than drawing a combo', () => {
    renderPanel(managerWith(true));
    const row = screen.getByText('Go to orders').closest('li');
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText('then')).toBeTruthy();
    expect(within(row as HTMLElement).getAllByText(/^[go]$/).map((cap) => cap.textContent)).toEqual([
      'g',
      'o',
    ]);
  });
});
