// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "What strangers are served may have changed": said by whatever rewrites
 * served files in place (a build of the project's apps, which the Designer
 * runs too), heard by the signed instance events (`operator/events.ts`), which
 * then look again and tell the operator what really changed.
 *
 * Its own module, with nothing imported, so a build that runs outside a server
 * (the `dev` command's) can say it for nothing: with no server listening it
 * reaches nobody.
 */

const listeners = new Set<() => void>();

/** Served files may have changed: everyone listening looks again (each debounces its own look). */
export function publicFilesMayHaveChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A listener's failure is its own.
    }
  }
}

/** Listen for {@link publicFilesMayHaveChanged}; the returned function stops listening. */
export function onPublicFilesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
