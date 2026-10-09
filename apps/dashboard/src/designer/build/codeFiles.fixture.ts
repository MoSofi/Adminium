// SPDX-License-Identifier: AGPL-3.0-only
/** The Code tab's model at rest, for tests that draw the work area and are not about the Code tab. */
import type { CodeFiles } from './useCodeFiles.js';

export function idleCode(over: Partial<CodeFiles> = {}): CodeFiles {
  return {
    active: false,
    activate: () => undefined,
    list: undefined,
    listState: 'loading',
    retryList: () => undefined,
    open: null,
    setOpen: () => undefined,
    content: { state: 'none', text: '' },
    retryContent: () => undefined,
    textFor: () => null,
    marks: new Set(),
    edited: new Set(),
    changed: new Set(),
    gone: new Set(),
    count: 0,
    lock: null,
    saving: false,
    problem: null,
    canSave: false,
    canDiscard: false,
    save: () => Promise.resolve(true),
    discard: () => undefined,
    keepMine: () => undefined,
    useChanged: () => undefined,
    putBack: () => undefined,
    dismissProblem: () => undefined,
    attach: () => undefined,
    onText: () => undefined,
    ...over,
  };
}
