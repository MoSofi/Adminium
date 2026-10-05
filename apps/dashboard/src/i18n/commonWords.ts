// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of four screens — the dashboard builder, the knowledge base, the
 * About page and the Team page — are not in the entry chunk: en-US keeps
 * those groups of `common` in a chunk of their own (`COMMON_DEFERRED_GROUPS`,
 * @adminium/i18n). A screen that reads one waits here before it renders, so
 * it never paints its inline English and then changes to the catalogue's
 * words (or to an owner's rewording).
 *
 * With no instance at all (unit tests that never boot i18n) there is nothing
 * to wait for: those render from the inline fallbacks by design.
 */
import { hasWords, wordsReady } from '@adminium/i18n';
import { use } from 'react';

import { getI18nInstance } from './t.js';

const ALREADY: Promise<void> = Promise.resolve();

/** Resolves once the deferred groups of `common` are in. Memoised per instance, so it is usable with `use()`. */
export function commonWordsReady(): Promise<void> {
  const i18n = getI18nInstance();
  return i18n === null ? ALREADY : wordsReady(i18n, 'common');
}

/** Suspends the screen until its words are in; returns at once when they are. */
export function useCommonWords(): void {
  const i18n = getI18nInstance();
  if (i18n === null || hasWords(i18n, 'common')) return;
  use(wordsReady(i18n, 'common'));
}
