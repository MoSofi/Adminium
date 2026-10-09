// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { initDock, resetDock, setDockOpen, setDockSignal, useDockOpen, useDockSignal } from './dockStore.js';

afterEach(() => {
  resetDock();
  window.localStorage.clear();
});

describe('whether the panel is open', () => {
  it('starts closed and follows what is set', () => {
    const open = renderHook(() => useDockOpen());
    expect(open.result.current).toBe(false);
    act(() => setDockOpen(true));
    expect(open.result.current).toBe(true);
    act(() => setDockOpen(false));
    expect(open.result.current).toBe(false);
  });

  it('is remembered per person, in this browser', () => {
    initDock('usr_a');
    setDockOpen(true);
    // Another person on the same browser starts closed; the first finds it as they left it.
    resetDock();
    initDock('usr_b');
    expect(renderHook(() => useDockOpen()).result.current).toBe(false);
    resetDock();
    initDock('usr_a');
    expect(renderHook(() => useDockOpen()).result.current).toBe(true);
  });

  it('does not write for nobody', () => {
    setDockOpen(true);
    expect(window.localStorage.length).toBe(0);
  });
});

describe('what the bubble shows', () => {
  it('follows the signal, and opening the panel reads whatever was unread', () => {
    const signal = renderHook(() => useDockSignal());
    expect(signal.result.current).toBe('idle');
    act(() => setDockSignal('working'));
    expect(signal.result.current).toBe('working');
    act(() => setDockSignal('unread'));
    expect(signal.result.current).toBe('unread');
    act(() => setDockOpen(true));
    expect(signal.result.current).toBe('idle');
  });
});
