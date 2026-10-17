// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Why a message was not sent, in words, for an outbox that keeps no reason
 * column of its own. A file of its own, with nothing to import, so that the
 * write path (`outbox/release.ts`) can name a removal's skip without reaching
 * the outbox's timing and, through it, back to the write path.
 */

/** Why a message was let go of. */
export type SkipReason = 'overtaken' | 'paid' | 'void' | 'no-longer-needed' | 'by-hand';

/** What the error column says of a skip when the outbox keeps no reason column. */
export function skipSentence(reason: SkipReason): string {
  switch (reason) {
    case 'overtaken':
      return 'Overtaken by a later message';
    case 'paid':
      return 'No longer needed: paid';
    case 'void':
      return 'No longer needed: void';
    case 'by-hand':
      return 'Skipped by hand';
    default:
      return 'No longer needed';
  }
}
