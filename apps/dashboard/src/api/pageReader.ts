// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first paint's handle on the page document's reader (`pageDocument.ts`),
 * which is a chunk of its own because it is zod.
 *
 * `loadPageReader()` fetches it; `pageQuery` starts that beside its request,
 * so a page document is parsed the moment both are in. `usePageReader()` is
 * for the hooks that read a page's layout while it renders: a page's data
 * only exists once the reader has run, so on every real render the reader is
 * already here and the hook returns it at once. It suspends only for a
 * caller that came by a page some other way and before the chunk ran.
 *
 * The chunk hands itself in (`providePageReader`) when it runs, so a module
 * that imports it statically (the project kit, a test) has the reader without
 * ever calling `loadPageReader()`.
 */
import { use } from 'react';

import type * as PageDocument from './pageDocument.js';

export interface PageReader {
  parsePageDocument: typeof PageDocument.parsePageDocument;
  extractBindings: typeof PageDocument.extractBindings;
  layoutHasDay: typeof PageDocument.layoutHasDay;
  layoutRefreshMs: typeof PageDocument.layoutRefreshMs;
}

let reader: PageReader | null = null;
let loading: Promise<PageReader> | null = null;

/** Called once, by `pageDocument.ts` as it runs. */
export function providePageReader(provided: PageReader): void {
  reader = provided;
}

/** The reader, fetching its chunk the first time; a failed fetch is tried again on the next call. */
export function loadPageReader(): Promise<PageReader> {
  if (reader !== null) return Promise.resolve(reader);
  loading ??= import('./pageDocument.js').then(
    () => reader as PageReader,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The reader, for a hook that runs while a page renders (see the note above). */
export function usePageReader(): PageReader {
  return reader ?? use(loadPageReader());
}
