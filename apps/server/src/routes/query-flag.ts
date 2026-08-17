/**
 * Boolean query-string flags.
 *
 * NOT `z.coerce.boolean()`. That runs `Boolean(value)` on the query STRING, and
 * every non-empty string is truthy — so `?dryRun=false` and `?confirm=false`
 * both arrive as `true`, and only omitting the parameter gives the "off"
 * behaviour. On a flag that gates a destructive write that is the worst
 * possible failure direction.
 *
 * `routes/i18n/schema.ts` reached the same conclusion for `includeSensitive`
 * and spelled the fix inline; this is that fix, shared.
 *
 * An absent flag and an explicit `=false` both resolve to `false`, so callers
 * compare against `true` rather than checking for `undefined`.
 */

import { z } from 'zod';

/**
 * A query flag that is only true for the literal string `true`.
 * Anything other than `true`/`false` is a 422 rather than a silent coercion.
 */
export function boolFlag() {
  return z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true');
}
