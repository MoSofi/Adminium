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

/**
 * The tag a person's dates, times and numbers are written in, beside a text
 * written in `locale` (one of Adminium's own languages).
 *
 * A recipient whose language is not one Adminium ships is written to in the
 * nearest one (`en-GB` gets the `en_US` email), but their clock and calendar
 * are still their own: "at 09:30", not "at 9:30 AM". So the first tag they
 * asked for that is in the SAME language as the text, and that this runtime
 * can format, is the one used. A tag in another language never is — its
 * weekday would be a word of a language the email is not written in.
 *
 * `requested` is one tag (`en-GB`, `en_GB`) or an Accept-Language list.
 */
export function formatTag(requested: string | null | undefined, locale: string): string {
  const text = bcp47(locale);
  const language = text.split('-')[0]!.toLowerCase();
  const wanted = (requested ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: bcp47(tag.trim()), q: q === undefined ? 1 : Number(q.slice(2)) };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    if (tag.split('-')[0]!.toLowerCase() !== language) continue;
    // A bare language says nothing the text's own tag does not, and CLDR's defaults for one can
    // differ from the text's (`ar` counts in Latin digits, `ar-EG` in Arabic-Indic): the text's tag.
    if (!tag.includes('-')) return text;
    try {
      const [canonical] = Intl.DateTimeFormat.supportedLocalesOf(tag);
      if (canonical !== undefined) return canonical;
    } catch {
      // Not a well-formed tag: somebody else's typo, not a reason to fail an email.
    }
  }
  return text;
}

/**
 * A number a sentence says ("expires in 20 minutes", "47 days past due"), in
 * the digits of the language the sentence is written in: Arabic-Indic in
 * `ar-EG`, as Adminium's prose uses them (the i18n rules' numeral policy),
 * and Latin in every language whose own digits they are. Never grouped: a
 * count is not an amount.
 *
 * The number keeps exactly the figures it was written with — `1.50` stays
 * two decimals, `20` none — so text in a language with Latin digits reads
 * character for character as `String(value)` did. What is not a number as
 * `String()` writes one (`1e21`, `007`, `+3`, text, nothing) comes back as
 * it was.
 *
 * `locale` is either spelling (`ar_EG`, `ar-EG`); a tag this runtime cannot
 * format leaves the number as it was, rather than failing an email.
 */
export function proseNumber(value: number | string | null | undefined, locale: string): string {
  const written = value === null || value === undefined ? '' : String(value).trim();
  // Only a number as String() writes one: `007`, `+3` or ` 4` is text, and stays exactly as it is.
  const match = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(written);
  if (match === null || written !== String(value)) return value === null || value === undefined ? '' : String(value);
  const places = match[1]?.length ?? 0;
  try {
    return new Intl.NumberFormat(bcp47(locale), { useGrouping: false, minimumFractionDigits: places, maximumFractionDigits: places }).format(written as unknown as number);
  } catch {
    return written;
  }
}
