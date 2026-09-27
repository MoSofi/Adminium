// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A function whose name and shape are settled, and whose body is not written
 * yet. It is only ever reached for a table or an entry that `unbuilt-rules.ts`
 * already refuses, so reaching it anyway is a bug in that switch: it fails
 * loudly, as a 500, rather than answer as if the rule did not exist.
 */
export class NotBuiltYetError extends Error {
  override readonly name = 'NotBuiltYetError';

  constructor(readonly what: string) {
    super(`${what} is not built yet.`);
  }
}

export function notBuiltYet(what: string): never {
  throw new NotBuiltYetError(what);
}
