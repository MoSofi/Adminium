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
export type DockSignal = 'idle' | 'working' | 'unread' | 'proposal';

let open = false;
let signal: DockSignal = 'idle';
let person: string | null = null;
/** Whether the signed-in person may use the assistant here: the shell says so once it knows. */
let available = false;
/** Words an add-on page asked to put in the panel's box, waiting for the panel to take them. */
let prompt: string | null = null;

/** The longest prompt the box is given, as long as a message the assistant takes. */
export const DOCK_PROMPT_MAX = 4000;
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

/** Whether the person may use the assistant here (the shell's word); nothing opens the panel for someone who may not. */
export function setDockAvailable(next: boolean): void {
  available = next;
  if (!next) prompt = null;
}

/**
 * The panel opened from a page (an add-on's "Ask Milo"), with words in its
 * box the person reads, changes and sends themselves: nothing is sent here.
 * False, and nothing happens, for someone who may not use the assistant.
 */
export function openDockWith(words?: string): boolean {
  if (!available) return false;
  const trimmed = typeof words === 'string' ? words.trim().slice(0, DOCK_PROMPT_MAX) : '';
  if (trimmed !== '') prompt = trimmed;
  if (open) emit();
  else setDockOpen(true);
  return true;
}

/** The words waiting for the box, taken once: the next open finds none. */
export function takeDockPrompt(): string | null {
  const words = prompt;
  prompt = null;
  return words;
}

/** Whether words are waiting for the box (read on each change, so an open panel takes them too). */
export function useDockPromptWaiting(): boolean {
  return useSyncExternalStore(subscribe, () => prompt !== null, () => false);
}

export function setDockSignal(next: DockSignal): void {
  if (signal === next) return;
  signal = next;
  emit();
}

/** Back to nothing to say, when what it said is over (a proposal that was let go, or decided). */
export function clearDockSignal(kind: DockSignal): void {
  if (signal === kind) setDockSignal('idle');
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
  available = false;
  prompt = null;
  emit();
}
