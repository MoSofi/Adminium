// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Option lists over `/api/v1/option-lists` (plan 50 D20).
 *
 * Shapes mirror the route's Zod replies, the copied-mirror convention this app
 * uses everywhere: change both together.
 *
 * ─── The two copies, and why they are the same move ────────────────────────
 *
 * A built-in cannot be edited. Wanting to edit one is not a mistake, though —
 * "countries, without the ones we do not ship to" is an ordinary request — so
 * the editor answers it by making an editable COPY, seeded from the built-in as
 * the reader currently sees it. {@link copyOfList} does that.
 *
 * "Store the label" is the same move with one difference: the copy's VALUES are
 * the labels. A workspace whose spreadsheets say "Germany" rather than "DE"
 * wants the column to hold "Germany", and that decision is made once, here,
 * rather than by every form. It fixes the workspace's language into the data
 * from that moment on (Appendix D), which is exactly why it is a copy and not a
 * switch on the built-in.
 */
import { api, ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';

/*
 * The query, the shapes and the built-ins live in `api/optionLists.ts`: every
 * FORM reads them too, and a Studio module is the wrong home for something a
 * page renders. What is here is what only the editor needs.
 */
export {
  OPTION_LISTS_QUERY_KEY,
  optionListsQuery,
  type OptionListItemView,
  type OptionListView,
} from '../../api/optionLists.js';

import type { OptionListItemView, OptionListView } from '../../api/optionLists.js';

export interface OptionListBody {
  key: string;
  name: string;
  items: OptionListItemView[];
  origin?: string;
}

export async function createOptionList(body: OptionListBody): Promise<OptionListView> {
  return api.post<OptionListView>('/api/v1/option-lists', body);
}

export async function updateOptionList(
  key: string,
  patch: { name?: string; items?: OptionListItemView[] },
): Promise<OptionListView> {
  return api.patch<OptionListView>(`/api/v1/option-lists/${encodeURIComponent(key)}`, patch);
}

export async function deleteOptionList(key: string): Promise<void> {
  await api.delete(`/api/v1/option-lists/${encodeURIComponent(key)}`);
}

/**
 * The columns a refused delete named, or null for any other failure.
 *
 * A 409 is not a failure to report as one: it is the server saying the list is
 * in use, and the columns it names are the whole instruction.
 */
export function usedByFromError(raised: unknown): string[] | null {
  if (!(raised instanceof ApiError) || raised.status !== 409) return null;
  const used = (raised.details as { usedBy?: unknown } | undefined)?.usedBy;
  return Array.isArray(used) ? used.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function messageFromError(raised: unknown): string {
  if (raised instanceof ApiError) return raised.message;
  return raised instanceof Error
    ? raised.message
    : t('studio:lists.errorUnknown', 'That did not work. Try again.');
}

/** A slug that is free: the wanted one, else the wanted one with a number. */
export function freeKey(wanted: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(wanted)) return wanted;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${wanted}-${String(n)}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${wanted}-${String(Date.now())}`;
}

/**
 * An editable copy of a list.
 *
 * `storeLabels` makes the LABEL the value, which is the whole of the
 * store-the-label feature: the copy's items carry no labels afterwards,
 * because a label equal to its value is one thing said twice. An item with no
 * label keeps its value either way — there is nothing else to use.
 */
export function copyOfList(
  list: OptionListView,
  opts: { storeLabels?: boolean; taken?: readonly string[] } = {},
): OptionListBody {
  const storeLabels = opts.storeLabels === true;
  const base = list.key.startsWith('builtin:') ? list.key.slice('builtin:'.length) : list.key;
  const wanted = storeLabels ? `${base}-labels` : base;
  return {
    key: freeKey(wanted, opts.taken ?? []),
    name: list.name,
    items: list.items.map((item) =>
      storeLabels
        ? {
            value: item.label ?? item.value,
            ...(item.tone === undefined ? {} : { tone: item.tone }),
            ...(item.description === undefined ? {} : { description: item.description }),
          }
        : { ...item },
    ),
    // Where it came from, so the editor can say so and the next install still
    // knows this list is a fork rather than something typed by hand.
    origin: list.key.startsWith('builtin:') ? `copy:${list.key}` : 'custom',
  };
}

/** What is wrong with a draft, in the operator's words, or null. */
export function draftIssue(draft: { name: string; items: OptionListItemView[] }): string | null {
  if (draft.name.trim() === '') return t('studio:lists.issueName', 'Give the list a name.');
  const values = draft.items.map((item) => item.value.trim());
  if (values.length === 0 || values.every((value) => value === '')) {
    return t('studio:lists.issueEmpty', 'A list needs at least one value.');
  }
  if (values.some((value) => value === '')) {
    return t('studio:lists.issueBlank', 'One of the values is empty. Fill it in or remove the row.');
  }
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return t('studio:lists.issueDuplicate', '"{value}" is in the list twice.', { value });
    }
    seen.add(value);
  }
  return null;
}
