// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where the person's words for a refusal the server says in English are
 * kept once they are in: 403 `OFF_BY_OPERATOR` (a switch the operator of a
 * trial or hosted installation turned off) and the installation's
 * connection-test budget (429 `RATE_LIMITED`, `details.scope: 'instance'`).
 * `ApiError` (`api.ts`) takes its message from here.
 *
 * Imports nothing: the words themselves (`refusalWords.ts`) are a chunk of
 * their own that `main.tsx` names as the loader, fetched on the first such
 * refusal or as soon as `/system/info` shows switches turned off.
 */
type RefusalWords = (code: string, details: unknown) => string | null;

let words: RefusalWords | null = null;
let loader: (() => Promise<{ install: () => Promise<void> }>) | null = null;

/** A refusal said in the person's words. */
export const isRefusal = (code: string, details: unknown): boolean =>
  code === 'OFF_BY_OPERATOR' || (code === 'RATE_LIMITED' && (details as { scope?: unknown } | null | undefined)?.scope === 'instance');

export function setRefusalWords(next: RefusalWords | null): void {
  words = next;
}

/** The words for a refusal, once they are in; null before, and for anything else. */
export function refusalText(code: string, details: unknown): string | null {
  return words !== null && isRefusal(code, details) ? words(code, details) : null;
}

export const hasRefusalWords = (): boolean => words !== null;

/** Names the chunk that holds the words (`main.tsx`). */
export function setRefusalLoader(load: typeof loader): void {
  loader = load;
}

/** Fetches the words and makes them every refusal's message (once is enough; again does nothing new). */
export function loadRefusalWords(): Promise<void> {
  return loader === null ? Promise.resolve() : loader().then((module) => module.install());
}
