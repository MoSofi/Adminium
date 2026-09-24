// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The connection's currency, for a template's widgets that name none.
 *
 * A money card stored without `format.currency` reads in US dollars, so a
 * KPI strip over a clinic's fees in pounds said `$0.00`. Every template that
 * draws stored widgets merges the page's currency into their config as it
 * draws them, never into the stored layout: a page saved today still follows
 * the connection when its currency changes, and a widget that names its own
 * currency keeps it.
 */

/** A widget's config with the page's currency, unless it names its own. */
export function withCurrency(config: unknown, currency: string | undefined): unknown {
  if (currency === undefined || typeof config !== 'object' || config === null) return config;
  const format = (config as { format?: Record<string, unknown> }).format;
  if (typeof format?.['currency'] === 'string') return config;
  return { ...config, format: { ...format, currency } };
}
