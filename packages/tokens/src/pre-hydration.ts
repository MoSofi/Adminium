// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pre-hydration script — flash prevention. See 02-design-system.md §4.3.
 *
 * Inlined (as a string) as the FIRST <script> in <head> of apps/dashboard/index.html,
 * the Electron renderer HTML and Storybook's preview-head.html, before any stylesheet
 * paints content. It reads the localStorage pre-paint cache and stamps data-theme /
 * data-accent / data-density / dir / lang on <html>, resolving theme "system" via
 * prefers-color-scheme. On any storage failure (private mode) it leaves the baseline paint.
 *
 * The storage keys and fallbacks are intentionally written out as literals so the string
 * is self-contained and inline-able; test/pre-hydration.test.ts asserts they stay in
 * sync with STORAGE_KEYS / DEFAULT_PREFS from ./index.js.
 */
export const preHydrationScript =
  '(function(){try{var d=document.documentElement,s=localStorage;' +
  'var t=s.getItem("adminium-theme")||"system";' +
  'if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";' +
  'd.setAttribute("data-theme",t);' +
  'd.setAttribute("data-accent",s.getItem("adminium-accent")||"indigo");' +
  'd.setAttribute("data-density",s.getItem("adminium-density")||"comfortable");' +
  'var r=s.getItem("adminium-dir");' +
  'if(r==="rtl")d.setAttribute("dir","rtl");' +
  'var l=s.getItem("adminium-locale");' +
  // split/join, not replace: `replace("_","-")` swaps only the FIRST
  // underscore, so a three-subtag id like `zh_Hant_TW` would stamp the invalid
  // tag `zh-Hant_TW` (23 §5.5).
  'if(l)d.setAttribute("lang",l.split("_").join("-"))}catch(e){}})();';
