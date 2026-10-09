// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The bubble and the place the panel mounts.
 *
 * The panel's code is its own chunk: what matters here is WHEN it is mounted
 * (never before the first open, unless a reload finds it open), that it stays
 * mounted once loaded so a question asked and left is still followed, and
 * that the bubble and the toasts do not stand on each other.
 */
import { act, cleanup, render as renderBare, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetDock, setDockOpen, setDockSignal } from '../assistant/dock/dockStore.js';
import { makeBootstrap } from '../test/fixtures.js';
import { AssistantBubble } from './AssistantBubble.js';
import { PageActions, PageActionsProvider } from './PageActionsProvider.js';
import { PageAssistantButton } from './PageAssistantButton.js';
import { ShortcutsProvider } from './ShortcutsProvider.js';

vi.mock('../assistant/dock/AssistantDock.js', () => ({
  AssistantDock: ({ visible }: { visible: boolean }) => <div data-testid="dock" data-visible={String(visible)} />,
}));

/** As in the shell: the bubble registers its shortcut with the manager. */
const render = (ui: ReactElement) => renderBare(<ShortcutsProvider>{ui}</ShortcutsProvider>);

afterEach(() => {
  cleanup();
  resetDock();
  window.localStorage.clear();
  document.documentElement.style.removeProperty('--toast-lift');
});

const allowed = () => makeBootstrap({ assistant: { allowed: true, name: 'Milo' } } as never);
const lift = () => document.documentElement.style.getPropertyValue('--toast-lift');

describe('the bubble', () => {
  it('is not drawn for a person who may not use the assistant, and nothing of the panel is mounted', () => {
    render(<AssistantBubble bootstrap={makeBootstrap()} />);
    expect(screen.queryByTestId('assistant-bubble')).toBeNull();
    expect(screen.queryByTestId('dock')).toBeNull();
    expect(lift()).toBe('');
  });

  it('is drawn in the corner with the toasts lifted over it, and the panel is not mounted before a press', () => {
    render(<AssistantBubble bootstrap={allowed()} />);
    expect(screen.getByRole('button', { name: 'Ask Milo' })).toBeTruthy();
    expect(screen.queryByTestId('dock')).toBeNull();
    expect(lift()).toBe('60px');
  });

  it('opens the panel, goes away while it is open, and comes back when it closes with the panel still mounted', async () => {
    render(<AssistantBubble bootstrap={allowed()} />);
    await act(async () => screen.getByTestId('assistant-bubble').click());
    expect((await screen.findByTestId('dock')).getAttribute('data-visible')).toBe('true');
    expect(screen.queryByTestId('assistant-bubble')).toBeNull();
    // Nothing in the corner now: the toasts are back where they were.
    expect(lift()).toBe('');

    act(() => setDockOpen(false));
    expect(screen.getByTestId('assistant-bubble')).toBeTruthy();
    expect(screen.getByTestId('dock').getAttribute('data-visible')).toBe('false');
  });

  it('is found open after a reload by the person who left it open, and by nobody else', async () => {
    const first = render(<AssistantBubble bootstrap={allowed()} />);
    await act(async () => screen.getByTestId('assistant-bubble').click());
    first.unmount();
    resetDock();

    const again = render(<AssistantBubble bootstrap={allowed()} />);
    expect((await screen.findByTestId('dock')).getAttribute('data-visible')).toBe('true');
    again.unmount();
    resetDock();

    const other = makeBootstrap({ assistant: { allowed: true, name: 'Milo' }, user: { ...makeBootstrap().user, id: 'usr_other' } } as never);
    render(<AssistantBubble bootstrap={other} />);
    expect(screen.getByTestId('assistant-bubble')).toBeTruthy();
    expect(screen.queryByTestId('dock')).toBeNull();
  });

  it('opens and closes from the keyboard, with a shortcut the registry lists', async () => {
    render(<AssistantBubble bootstrap={allowed()} />);
    const press = () => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, metaKey: true, bubbles: true })));
    await press();
    expect((await screen.findByTestId('dock')).getAttribute('data-visible')).toBe('true');
    await press();
    expect(screen.getByTestId('dock').getAttribute('data-visible')).toBe('false');
  });

  it('says in words what its ring and its dot show', () => {
    render(<AssistantBubble bootstrap={allowed()} />);
    act(() => setDockSignal('working'));
    expect(screen.getByTestId('assistant-bubble').textContent).toContain('Milo is working');
    act(() => setDockSignal('unread'));
    expect(screen.getByTestId('assistant-bubble').textContent).toContain('1 unread answer');
    expect(screen.getByTestId('assistant-bubble').getAttribute('data-signal')).toBe('unread');
  });
});

describe('the header`s Ask button', () => {
  it('opens the same panel the bubble opens', async () => {
    render(
      <PageActionsProvider>
        <PageAssistantButton bootstrap={allowed()} />
        <PageActions assistant={{ context: 'data', host: { connectionIds: [], pageId: 'page_1' } }} />
        <AssistantBubble bootstrap={allowed()} />
      </PageActionsProvider>,
    );
    const button = await screen.findByTestId('ask-assistant');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await act(async () => button.click());
    expect((await screen.findByTestId('dock')).getAttribute('data-visible')).toBe('true');
    expect(screen.getByTestId('ask-assistant').getAttribute('aria-expanded')).toBe('true');
  });
});
