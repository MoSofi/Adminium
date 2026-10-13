// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A save the app does for a part (a card moved, a pin dragged), followed to
 * its answer. The app may answer nothing, a promise, `{ refused }`, or throw;
 * a part knows one form, a promise that rejects when the save was refused.
 */
import type { KitRefused } from './contract.js';

/** Why a save did not hold, as its rejection says it; undefined when it says nothing a person could read. */
export function reasonOf(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return message === undefined || message.trim() === '' ? undefined : message;
}

/**
 * Follows a save to its answer, in the one form a part knows: a promise that
 * rejects when the save was refused. Nothing answered is taken at its word.
 */
export function followed(save: () => void | KitRefused | Promise<void | KitRefused>): Promise<void> | undefined {
  let answer: void | KitRefused | Promise<void | KitRefused>;
  try {
    answer = save();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  if (answer === undefined) return undefined;
  return Promise.resolve(answer).then((said) => {
    const refused = (said as Partial<KitRefused> | undefined)?.refused;
    if (typeof refused === 'string') throw new Error(refused);
  });
}
