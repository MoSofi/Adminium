// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Option lists, resolved for the FORMS that render them.
 *
 * A `column.options` rule either carries its values or names a list. The
 * server checks MEMBERSHIP against the list; what a value is CALLED is this
 * side's business, and that is why the built-ins are resolved here rather than
 * fetched:
 *
 * - `builtin:countries` is 249 ISO codes in the store and 249 NAMES on screen,
 *   and which names depends on who is looking. `Intl.DisplayNames` answers that
 *   in the reader's own language, from the browser's own data, with no request
 *   and nothing to keep in step.
 * - `builtin:us-states` carries its names (proper nouns), and `builtin:gender`
 *   takes its three from `ui:lists.gender.*`, in all eight locales.
 *
 * A CUSTOM list is a workspace's own row, so it does take a request — and only
 * when a page actually names one, which is what `useListOptions` is given the
 * keys for. A page whose rules name no custom list makes no request at all.
 *
 * Shapes mirror the route's Zod replies (`apps/server/src/routes/option-lists/`)
 * — the copied-mirror convention this app uses everywhere: change both
 * together.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { builtinOptionItems, isBuiltinOptionList, type OptionListItem } from '@adminium/widgets/page-config';
import type { ColumnFacts, ListOptionsResolver } from '@adminium/widgets';

import { api } from '../app/api.js';
import { getI18nInstance, t } from '../i18n/t.js';

/** Mirrors `itemSchema`. */
export interface OptionListItemView {
  value: string;
  label?: string;
  tone?: string;
  description?: string;
}

/** Mirrors `listReply`. */
export interface OptionListView {
  key: string;
  name: string;
  items: OptionListItemView[];
  /** `builtin`, `custom`, or `copy:<builtin key>`. */
  origin: string;
  /** False for a built-in: the editor offers a copy instead of a save. */
  editable: boolean;
}

export const OPTION_LISTS_QUERY_KEY = ['option-lists'] as const;

export function optionListsQuery() {
  return queryOptions({
    queryKey: OPTION_LISTS_QUERY_KEY,
    queryFn: async () => (await api.get<{ lists: OptionListView[] }>('/api/v1/option-lists')).lists,
    /*
     * Read by the lists page, by the Rules section of the column inspector and
     * by every form whose column names a custom list. React Query keys the
     * cache on `queryKey` alone, so the options belong here rather than at a
     * call site — otherwise whichever mounts first decides them for the others.
     *
     * `retry: false`: the interesting failure is a 403, and retrying a
     * permission refusal three times only delays the fallback.
     */
    retry: false,
    staleTime: 60_000,
  });
}

/** The three the comp names, in the reader's language (Appendix D). */
export function builtinListOptions(key: string, locale: string): readonly OptionListItem[] {
  return builtinOptionItems(key, locale, {
    female: t('ui:lists.gender.female', 'Female'),
    male: t('ui:lists.gender.male', 'Male'),
    other: t('ui:lists.gender.other', 'Other'),
  });
}

/**
 * A resolver for the form: list key → the answers it holds.
 *
 * `customKeys` are the non-built-in lists this page's rules name. Empty ⇒ no
 * request: a page that uses only the built-ins, or no lists at all, must not
 * pay for the store.
 */
export function useListOptions(customKeys: readonly string[]): ListOptionsResolver {
  const wanted = customKeys.filter((key) => !isBuiltinOptionList(key));
  const lists = useQuery({ ...optionListsQuery(), enabled: wanted.length > 0 });
  const data = lists.data;
  const locale = getI18nInstance()?.language ?? 'en-US';
  return useCallback(
    (key: string) => {
      if (isBuiltinOptionList(key)) return builtinListOptions(key, locale);
      return data?.find((list) => list.key === key)?.items;
    },
    [data, locale],
  );
}

/** Every list key a page's column facts name, deduplicated. */
export function listKeysOf(facts: ColumnFacts | undefined): string[] {
  const keys = new Set<string>();
  for (const fact of Object.values(facts ?? {})) {
    const options = fact.options;
    if (options !== undefined && 'list' in options) keys.add(options.list);
  }
  return [...keys];
}
