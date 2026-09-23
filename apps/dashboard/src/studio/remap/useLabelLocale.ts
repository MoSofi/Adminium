// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The locale a stored per-locale label is shown in while it is edited: the
 * person's own (`de_DE`), the same one the server resolves their labels to.
 */
import { useQuery } from '@tanstack/react-query';

import { bootstrapQuery } from '../../app/bootstrap.js';

export function useLabelLocale(): string {
  const { data } = useQuery(bootstrapQuery());
  return data?.prefs.locale ?? 'en_US';
}
