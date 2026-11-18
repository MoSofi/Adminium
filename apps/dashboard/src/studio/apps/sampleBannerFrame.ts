// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The box of the "Sample data is loaded" banner, shared by the banner
 * (`SampleData.tsx`) and the slot an app's page keeps for it while the banner's
 * own code and words are still on their way (`pages/appPageNotice.tsx`). One
 * box for both, so the slot is exactly the banner's height and the cards under
 * it do not move when the banner takes its place.
 */
export const SAMPLE_BANNER_FRAME = 'mb-3.5 flex flex-wrap items-center gap-[11px] rounded-[11px] border border-accent/25 bg-accent-soft px-3.5 py-2.5';
