import type { LockedFooter } from './render.js';

/**
 * What a marketing mail carries: its two list headers and the locked footer.
 * Its own file so the send queue can name it without importing `marketing.ts`
 * (which reaches the send queue through notifications: an import cycle).
 */
export interface MarketingCarry {
  headers: Record<string, string>;
  locked: LockedFooter;
}
