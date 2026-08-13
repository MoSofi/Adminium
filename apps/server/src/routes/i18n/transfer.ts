/**
 * Translation import/export (23-runtime-translations.md §3.6, T21).
 *
 * JSON, not CSV, and that is a deliberate refusal rather than an omission:
 * the stated workflow is "export → send to a translator → import", i.e. the
 * file gets opened in a spreadsheet by someone else, and this repo's CSV
 * writer (`data-io/csv.ts`) quotes only on `[",\r\n]` and never neutralises a
 * leading `=`/`+`/`-`/`@`. Shipping a formula-injection vector to third
 * parties to save them a JSON editor is not a trade worth making.
 *
 * Import is deliberately awkward in one specific way: it requires an explicit
 * opt-in for the `errors` and auth namespaces. Carrying translations in a
 * config bundle turns import into a UI-COPY INJECTION channel — today an
 * imported bundle cannot alter a single word of security-relevant chrome, and
 * afterwards it could silently rewrite the sign-in screen, all 33 `errors`
 * strings, and every destructive-confirm label. The export path's doctrine
 * (`export/redaction.ts`) is about secrets LEAVING and has no counterpart for
 * untrusted content ARRIVING; this is that counterpart.
 */
import type { Namespace } from '@adminium/i18n';
import { sourceMessage } from '@adminium/i18n/editing';

/** One exported locale file. */
export interface TranslationExport {
  formatVersion: 1;
  locale: string;
  exportedKeys: number;
  /** `namespace` → dotted key → message. */
  entries: Record<string, Record<string, string>>;
}

/** Namespaces whose contents are what users read when things go wrong. */
export const SENSITIVE_NAMESPACES: readonly Namespace[] = ['errors'];

/** Key prefixes that render on the signed-out surfaces. */
export const SENSITIVE_KEY_PREFIXES = ['auth.', 'login.', 'reset.', 'forgot.', 'otp.'];

export function isSensitive(namespace: string, key: string): boolean {
  if ((SENSITIVE_NAMESPACES as readonly string[]).includes(namespace)) return true;
  return SENSITIVE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function buildExport(
  locale: string,
  rows: readonly { namespace: string; key: string; value: string }[],
): TranslationExport {
  const entries: Record<string, Record<string, string>> = {};
  for (const row of rows) (entries[row.namespace] ??= {})[row.key] = row.value;
  return { formatVersion: 1, locale, exportedKeys: rows.length, entries };
}

export interface ParsedImport {
  items: { namespace: Namespace; key: string; value: string }[];
  /** Entries refused before any write — reported, never silently dropped. */
  rejected: { namespace: string; key: string; reason: string }[];
  /** How many sensitive entries the file carries, for the confirm prompt. */
  sensitiveCount: number;
}

export interface ParseImportOptions {
  namespaces: readonly Namespace[];
  /** Without this, sensitive entries are refused rather than written. */
  includeSensitive?: boolean | undefined;
}

/**
 * Validate the envelope and split the payload into writable items and
 * rejections. Message-level validation (ICU, placeholder parity, the a11y
 * blank rule) is the route's job — it needs the locale's plural categories.
 *
 * Absence-tolerant by design: a bundle produced before this format existed
 * simply has no translation file, and must stay importable.
 */
export function parseImport(payload: unknown, opts: ParseImportOptions): ParsedImport {
  const items: ParsedImport['items'] = [];
  const rejected: ParsedImport['rejected'] = [];
  let sensitiveCount = 0;

  if (typeof payload !== 'object' || payload === null) {
    return { items, rejected: [{ namespace: '-', key: '-', reason: 'Not a translation file.' }], sensitiveCount };
  }
  const doc = payload as Partial<TranslationExport>;
  if (doc.formatVersion !== 1 || typeof doc.entries !== 'object' || doc.entries === null) {
    return {
      items,
      rejected: [{ namespace: '-', key: '-', reason: 'Unsupported translation file version.' }],
      sensitiveCount,
    };
  }

  for (const [namespace, byKey] of Object.entries(doc.entries)) {
    if (!(opts.namespaces as readonly string[]).includes(namespace)) {
      rejected.push({ namespace, key: '*', reason: `Unknown namespace ${namespace}.` });
      continue;
    }
    for (const [key, value] of Object.entries(byKey ?? {})) {
      if (typeof value !== 'string') {
        rejected.push({ namespace, key, reason: 'Value must be a string.' });
        continue;
      }
      // An import must never GROW the key space — that is how a bad file
      // silently fills the table with junk nobody can find or delete.
      if (sourceMessage(namespace, key) === null) {
        rejected.push({ namespace, key, reason: 'No such key in this version of Adminium.' });
        continue;
      }
      if (isSensitive(namespace, key)) {
        sensitiveCount += 1;
        if (opts.includeSensitive !== true) {
          rejected.push({
            namespace,
            key,
            reason: 'Error and sign-in copy needs an explicit opt-in to import.',
          });
          continue;
        }
      }
      items.push({ namespace: namespace as Namespace, key, value });
    }
  }

  return { items, rejected, sensitiveCount };
}
