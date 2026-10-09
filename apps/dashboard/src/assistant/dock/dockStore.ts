// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether the assistant's panel is open, and what its bubble should show.
 *
 * IN THE ENTRY, SO IT IS SMALL. The header's Ask button and the floating
 * bubble must open the same panel, and both are on screen before the panel's
 * own code is loaded; this is the one thing they share. Everything the panel
 * draws is in its own chunk, loaded on the first open.
 *
 * OPEN IS REMEMBERED PER PERSON, in this browser: after a reload the panel is
 * as they left it. That is a convenience of this browser and nothing more;
 * the conversation itself is the server's.
 */
import { useSyncExternalStore } from 'react';

/** What the bubble shows while the panel is closed. */
export type DockSignal = 'idle' | 'working' | 'unread';

let open = false;
let signal: DockSignal = 'idle';
let person: string | null = null;
const listeners = new Set<() => void>();

const KEY = 'adminium.assistant.open:';

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Take up what this person left: called once the shell knows who is signed in. */
export function initDock(userId: string): void {
  if (person === userId) return;
  person = userId;
  try {
    open = window.localStorage.getItem(KEY + userId) === '1';
  } catch {
    // A private window, blocked storage: the panel starts closed.
    open = false;
  }
  emit();
}

export function setDockOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  // Opened: whatever was unread is being read.
  if (next) signal = 'idle';
  try {
    if (person !== null) window.localStorage.setItem(KEY + person, next ? '1' : '0');
  } catch {
    // Not remembered, then.
  }
  emit();
}

export function setDockSignal(next: DockSignal): void {
  if (signal === next) return;
  signal = next;
  emit();
}

export function useDockOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

export function useDockSignal(): DockSignal {
  return useSyncExternalStore(subscribe, () => signal, () => 'idle');
}

/** For tests: back to a closed panel that belongs to nobody. */
export function resetDock(): void {
  open = false;
  signal = 'idle';
  person = null;
  emit();
}
