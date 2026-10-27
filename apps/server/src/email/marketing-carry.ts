// SPDX-License-Identifier: AGPL-3.0-only
import type { LockedFooter } from './render.js';

/**
 * What a marketing mail carries: its two list headers and the locked footer.
 * Its own file so the send queue can name it without importing `marketing.ts`
 * (which reaches the send queue through notifications: an import cycle).
 */
export interface MarketingCarry {
  headers: Record<string, string>;
  locked: LockedFooter;
  /**
   * Where replies go: the mail's own reply address when it has one, else the
   * marketing mail settings' "Replies to marketing mail go to"; null when
   * neither is set (replies then go to the From).
   */
  replyTo: string | null;
}
