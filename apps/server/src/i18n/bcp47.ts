// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Locale spellings, and picking a label in the reader's language.
 *
 * A user's preference is stored in the underscore form (`de_DE`, the meta
 * payload's own spelling), while every label a manifest or a `surface.json`
 * carries is keyed by BCP 47 (`de-DE`). Looking one up with the other misses
 * every time and falls back to English — which is what the hosted-app labels
 * did for every non-English reader.
 */

/** `de_DE` → `de-DE`; a tag already in BCP 47 is returned as it is. */
export function bcp47(locale: string): string {
  return locale.replace(/_/g, '-');
}

/**
 * The label for a reader: their exact tag, then another region of their
 * language (`de-AT` for `de-DE`), then US English, then whatever there is.
 * Accepts either spelling of `locale`.
 */
export function pickLabel(labels: Readonly<Record<string, string>>, locale: string): string | undefined {
  const tag = bcp47(locale);
  const exact = labels[tag];
  if (exact !== undefined) return exact;
  const language = tag.split('-')[0]!.toLowerCase();
  for (const [key, value] of Object.entries(labels)) {
    if (key.split('-')[0]!.toLowerCase() === language) return value;
  }
  return labels['en-US'] ?? Object.values(labels)[0];
}
