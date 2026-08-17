// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keyboard manager (09-generated-app.md §5.3): platform mapping, typing
 * suppression with the Esc/⌘Enter/⌘S allowlist, chord window + timeout, and
 * the data-driven G-chord letter assignment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHORD_WINDOW_MS,
  createShortcutManager,
  displayKey,
  eventSignature,
  gChordTargets,
  isTypingContext,
  parseKeys,
} from './shortcuts.js';

function keydown(init: KeyboardEventInit & { target?: Element }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.target !== undefined) init.target.dispatchEvent(event);
  else document.body.dispatchEvent(event);
  return event;
}

describe('parseKeys / eventSignature / displayKey', () => {
  it('parses combos and chords', () => {
    expect(parseKeys(['⌘', 'K'])).toMatchObject({ kind: 'combo', signature: 'mod+k' });
    expect(parseKeys(['⌘', '⇧', 'L'])).toMatchObject({ kind: 'combo', signature: 'mod+shift+l' });
    expect(parseKeys(['?'])).toMatchObject({ kind: 'combo', signature: '?' });
    expect(parseKeys(['G', 'then', 'O'])).toMatchObject({ kind: 'chord', signature: 'g o' });
  });

  it('binds ⌘ as Ctrl off-mac and as meta on mac', () => {
    const ctrlK = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    expect(eventSignature(ctrlK, false)).toBe('mod+k');
    expect(eventSignature(ctrlK, true)).toBe('k');
    const metaK = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
    expect(eventSignature(metaK, true)).toBe('mod+k');
  });

  it('localizes keycaps per platform', () => {
    expect(displayKey('⌘', true)).toBe('⌘');
    expect(displayKey('⌘', false)).toBe('Ctrl');
    expect(displayKey('⇧', false)).toBe('Shift');
    expect(displayKey('K', false)).toBe('K');
  });
});

describe('typing-context suppression', () => {
  let input: HTMLInputElement;
  beforeEach(() => {
    input = document.createElement('input');
    document.body.appendChild(input);
  });
  afterEach(() => {
    input.remove();
  });

  it('suppresses single-key shortcuts while typing (acceptance: "c" in a field)', () => {
    const manager = createShortcutManager({ isMac: true });
    const handler = vi.fn();
    manager.register({ id: 'create', group: 'Actions', label: 'Create new', keys: ['C'], handler });
    const event = keydown({ key: 'c', target: input });
    expect(manager.handleKeydown(event)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets the allowlist through (⌘S) but never ⌘C/⌘A inside fields', () => {
    const manager = createShortcutManager({ isMac: true });
    const save = vi.fn();
    const copy = vi.fn();
    manager.register({ id: 'save', group: 'Editing', label: 'Save changes', keys: ['⌘', 'S'], handler: save });
    manager.register({ id: 'copy', group: 'Data', label: 'Copy row', keys: ['⌘', 'C'], handler: copy });
    expect(manager.handleKeydown(keydown({ key: 's', metaKey: true, target: input }))).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(manager.handleKeydown(keydown({ key: 'c', metaKey: true, target: input }))).toBe(false);
    expect(copy).not.toHaveBeenCalled();
  });

  it('detects contenteditable and IME composition', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    expect(isTypingContext(keydown({ key: 'c', target: div }))).toBe(true);
    div.remove();
    expect(isTypingContext(new KeyboardEvent('keydown', { key: 'c', isComposing: true }))).toBe(true);
  });
});

describe('G-chords', () => {
  it('fires the second step inside the window', () => {
    const manager = createShortcutManager({ isMac: true });
    const go = vi.fn();
    manager.register({ id: 'go-orders', group: 'Navigation', label: 'Go to Orders', keys: ['G', 'then', 'O'], handler: go });
    expect(manager.handleKeydown(keydown({ key: 'g' }))).toBe(true);
    expect(manager.handleKeydown(keydown({ key: 'o' }))).toBe(true);
    expect(go).toHaveBeenCalledOnce();
  });

  it('times out after 1200 ms', () => {
    vi.useFakeTimers();
    try {
      const manager = createShortcutManager({ isMac: true });
      const go = vi.fn();
      manager.register({ id: 'go-orders', group: 'Navigation', label: 'Go to Orders', keys: ['G', 'then', 'O'], handler: go });
      manager.handleKeydown(keydown({ key: 'g' }));
      vi.advanceTimersByTime(CHORD_WINDOW_MS + 50);
      manager.handleKeydown(keydown({ key: 'o' }));
      expect(go).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits the pending indicator signal', () => {
    const manager = createShortcutManager({ isMac: true });
    manager.register({ id: 'go-orders', group: 'Navigation', label: 'Go to Orders', keys: ['G', 'then', 'O'], handler: () => undefined });
    const seen: Array<string | null> = [];
    manager.onChordPending((pending) => seen.push(pending));
    manager.handleKeydown(keydown({ key: 'g' }));
    manager.handleKeydown(keydown({ key: 'o' }));
    expect(seen).toEqual(['g', null]);
  });

  it('assigns unique letters, next-distinct on collision, capped at 8', () => {
    const items = [
      { fallback: 'Customers' },
      { fallback: 'Calendar' }, // c taken → a
      { fallback: 'Cases' },    // c,a taken → s
      { fallback: 'Orders' },
    ];
    const targets = gChordTargets(items);
    expect(targets.map((target) => target.letter)).toEqual(['c', 'a', 's', 'o']);

    const many = Array.from({ length: 12 }, (_, i) => ({ fallback: `${String.fromCodePoint(97 + i)}Page` }));
    expect(gChordTargets(many)).toHaveLength(8);
  });

  it('never hands a reserved letter to a nav item', () => {
    // `Cases` claims `s` unreserved (see above) — the Studio chord must win it,
    // pushing Cases to its next distinct letter rather than shadowing `G S`.
    const items = [{ fallback: 'Customers' }, { fallback: 'Calendar' }, { fallback: 'Cases' }];
    expect(gChordTargets(items, ['s']).map((target) => target.letter)).toEqual(['c', 'a', 'e']);
    // Unreserved (viewer, no Studio access) the letter stays available.
    expect(gChordTargets(items).map((target) => target.letter)).toEqual(['c', 'a', 's']);
  });
});

describe('panel listing', () => {
  it('lists the live registration set in canonical group order', () => {
    const manager = createShortcutManager({ isMac: true });
    const off = manager.register({ id: 'v', group: 'View', label: 'Toggle sidebar', keys: ['⌘', 'B'], handler: () => undefined });
    manager.register({ id: 'g', group: 'General', label: 'Open command palette', keys: ['⌘', 'K'] });
    expect(manager.list().map((group) => group.group)).toEqual(['General', 'View']);
    off();
    expect(manager.list().map((group) => group.group)).toEqual(['General']);
  });
});
