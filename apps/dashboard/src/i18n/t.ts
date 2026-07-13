/**
 * Tiny i18n stub — the real i18next layer (8 locales, ICU plurals, RTL) lands
 * in M8 per 10-i18n-theming.md. Until then every user-visible string flows
 * through `t(key, fallback)` so the M8 migration is a mechanical key sweep,
 * not a string hunt.
 */
export function t(_key: string, fallback: string): string {
  return fallback;
}
