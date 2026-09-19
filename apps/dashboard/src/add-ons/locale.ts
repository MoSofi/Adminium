// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The BCP-47 tag an add-on page formats dates and numbers with.
 *
 * The published surface used to be `bootstrapQuery` — the whole boot payload,
 * as react-query options — and the first page to use it wanted one string out
 * of it. Handing over a query object also meant handing over a type this
 * repository could not name in a package that has no react-query dependency,
 * so it was `unknown`, so it did not compile. A hook that answers the question
 * is smaller for the host, smaller for the add-on, and typechecks.
 */
import { useQuery } from '@tanstack/react-query';
import { tagForLocale, type LocaleId } from '@adminium/i18n';

import { bootstrapQuery } from '../app/bootstrap.js';

export function useLocaleTag(): string {
  const { data } = useQuery(bootstrapQuery());
  return tagForLocale((data?.prefs.locale ?? 'en_US') as LocaleId);
}
