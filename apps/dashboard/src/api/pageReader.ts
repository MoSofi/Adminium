// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first paint's handle on the page document's reader (`pageDocument.ts`),
 * which is a chunk of its own because it is zod.
 *
 * `loadPageReader()` fetches it; `pageQuery` starts that beside its request,
 * so a page document is parsed the moment both are in. `usePageReader()` is
 * for the hooks that read a page's layout while it renders: a page's data
 * only exists once the reader is in, so on every real render the hook
 * returns it at once. It suspends only for a caller that came by a page some
 * other way before the chunk was asked for.
 *
 * A module that imports the reader statically to parse a document of its
 * own (the project kit) hands it in with `providePageReader`, so the page it
 * then renders reads its layout without waiting. The reader never calls in
 * here itself: this module loads it, and a call back would be an import cycle.
 */
import { use } from 'react';

import type { pageReader as PageReaderValue } from './pageDocument.js';

export type PageReader = typeof PageReaderValue;

let reader: PageReader | null = null;
let loading: Promise<PageReader> | null = null;

/** For a module that already holds the reader (it imported `pageDocument.ts`). */
export function providePageReader(provided: PageReader): void {
  reader = provided;
}

/** The reader, fetching its chunk the first time; a failed fetch is tried again on the next call. */
export function loadPageReader(): Promise<PageReader> {
  if (reader !== null) return Promise.resolve(reader);
  loading ??= import('./pageDocument.js').then(
    (module) => {
      reader = module.pageReader;
      return reader;
    },
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
