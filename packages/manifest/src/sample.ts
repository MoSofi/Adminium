// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium.sample/1` — an app's sample data, shipped in its package and named
 * by the manifest's `sampleData.file`.
 *
 * Rows are written in the order the tables are listed, parents first, and
 * removed in reverse. A value is a plain JSON value or one of five directives:
 *
 *   `{"@ref": "<label>"}`      the key of an earlier row with that `@label`
 *   `{"@ago": "PT19M"}`        an ISO-8601 duration before now
 *   `{"@day": -1, "@time": "09:30"}`   a wall time in the venue's own zone,
 *                               days from today
 *   `{"@t": {"en-US": "…"}}`   the adding person's language
 *   `{"@asset": "<label>"}`    a file from `assets`, added to the Files library
 *
 * Pure: a format and its checks, no I/O. The server resolves the directives.
 */
import { z } from 'zod';

import type { Manifest } from './schema.js';

export const SAMPLE_FORMAT = 'adminium.sample/1';

const label = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/, 'a label of letters, digits and : . _ -');

/** `P[nW][nD][T[nH][nM][nS]]`, with at least one part. */
const ISO_DURATION = /^P(?!$)(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

const directive = z.union([
  z.object({ '@ref': label }).strict(),
  z.object({ '@ago': z.string().regex(ISO_DURATION, 'an ISO-8601 duration such as PT19M') }).strict(),
  z
    .object({
      '@day': z.number().int().min(-366).max(366),
      '@time': z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time such as 09:30'),
    })
    .strict(),
  z.object({ '@t': z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.string()).refine((m) => Object.keys(m).length > 0) }).strict(),
  z.object({ '@asset': label }).strict(),
]);

const plain = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** A column's value: a plain value, a directive, or (for a json column) any object or array. */
export const sampleValueSchema = z.union([plain, directive, z.array(z.unknown()), z.record(z.string(), z.unknown())]);

export const sampleRowSchema = z.record(z.string(), sampleValueSchema);

export const sampleBundleSchema = z
  .object({
    format: z.literal(SAMPLE_FORMAT),
    app: z.string().min(1),
    assets: z
      .record(label, z.object({ file: z.string().regex(/^seeds\/[a-z0-9][a-z0-9._/-]*$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
      .default({}),
    tables: z
      .array(z.object({ ref: z.string().min(1), rows: z.array(sampleRowSchema).min(1).max(5000) }).strict())
      .min(1),
  })
  .strict();

export type SampleBundle = z.infer<typeof sampleBundleSchema>;
export type SampleValue = z.infer<typeof sampleValueSchema>;

/** A value's directive, when it is one. */
export function sampleDirective(value: unknown):
  | { kind: 'ref'; label: string }
  | { kind: 'ago'; duration: string }
  | { kind: 'wall'; day: number; time: string }
  | { kind: 't'; texts: Record<string, string> }
  | { kind: 'asset'; label: string }
  | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record['@ref'] === 'string') return { kind: 'ref', label: record['@ref'] };
  if (typeof record['@ago'] === 'string') return { kind: 'ago', duration: record['@ago'] };
  if (typeof record['@day'] === 'number' && typeof record['@time'] === 'string') {
    return { kind: 'wall', day: record['@day'], time: record['@time'] };
  }
  if (typeof record['@t'] === 'object' && record['@t'] !== null) {
    return { kind: 't', texts: record['@t'] as Record<string, string> };
  }
  if (typeof record['@asset'] === 'string') return { kind: 'asset', label: record['@asset'] };
  return null;
}

/** An ISO-8601 duration in milliseconds. */
export function isoDurationMs(duration: string): number {
  const match = ISO_DURATION.exec(duration);
  if (match === null) throw new Error(`"${duration}" is not an ISO-8601 duration`);
  const n = (part: string | undefined) => (part === undefined ? 0 : Number.parseFloat(part));
  const weeks = n(match[1]);
  const days = n(match[2]);
  const hours = n(match[4]);
  const minutes = n(match[5]);
  const seconds = n(match[6]);
  return ((((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

export interface SampleIssue {
  path: string;
  message: string;
}

/**
 * Everything wrong with a bundle for this manifest: a table it does not
 * declare, a column the table does not have, a label used twice, a `@ref` to
 * a row that comes later or not at all, an `@asset` it does not list.
 */
export function sampleBundleIssues(bundle: SampleBundle, manifest: Manifest): SampleIssue[] {
  const issues: SampleIssue[] = [];
  if (bundle.app !== manifest.key) {
    issues.push({ path: 'app', message: `The bundle is for "${bundle.app}", not "${manifest.key}".` });
  }
  const declared = new Map((manifest.requiredSchema?.tables ?? []).map((table) => [table.ref, table]));
  const seen = new Set<string>();
  for (const [t, table] of bundle.tables.entries()) {
    const shape = declared.get(table.ref);
    if (shape === undefined) {
      issues.push({ path: `tables.${String(t)}.ref`, message: `"${table.ref}" is not a table this app declares.` });
      continue;
    }
    const columns = new Set(shape.columns.map((column) => column.ref));
    for (const [r, row] of table.rows.entries()) {
      const at = `tables.${String(t)}.rows.${String(r)}`;
      for (const [column, value] of Object.entries(row)) {
        if (column === '@label') {
          if (typeof value !== 'string' || !label.safeParse(value).success) {
            issues.push({ path: `${at}.@label`, message: 'A label is letters, digits and : . _ -.' });
          } else if (seen.has(value)) {
            issues.push({ path: `${at}.@label`, message: `The label "${value}" is used twice.` });
          }
          continue;
        }
        if (!columns.has(column)) {
          issues.push({ path: `${at}.${column}`, message: `"${table.ref}" has no column "${column}".` });
          continue;
        }
        // An object that looks like a directive must BE one: a malformed
        // `@ago` would otherwise be written into the column as JSON.
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          Object.keys(value).some((key) => key.startsWith('@')) &&
          !directive.safeParse(value).success
        ) {
          issues.push({ path: `${at}.${column}`, message: `"${column}" holds a directive that is not well formed.` });
          continue;
        }
        const found = sampleDirective(value);
        if (found?.kind === 'ref' && !seen.has(found.label)) {
          issues.push({
            path: `${at}.${column}`,
            message: `"${found.label}" is not an earlier row: a referenced row must come first.`,
          });
        }
        if (found?.kind === 'asset' && bundle.assets[found.label] === undefined) {
          issues.push({ path: `${at}.${column}`, message: `"${found.label}" is not one of the bundle’s assets.` });
        }
      }
      // Labelled AFTER its own values are checked: a row cannot refer to itself.
      const own = row['@label'];
      if (typeof own === 'string') seen.add(own);
    }
  }
  return issues;
}
