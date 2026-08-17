// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Client for `/api/v1/i18n` (23-runtime-translations.md §6.1).
 *
 * SYNC NOTE: these types mirror `apps/server/src/routes/i18n/schema.ts`
 * (type-only copy — the dashboard may not import server runtime code, per the
 * 01-architecture.md §2.3 matrix). Change both together.
 */
import type { Namespace } from '@adminium/i18n';

import { api } from '../app/api.js';

// Boot-path calls and their types live in ./i18nBoot.ts so the entry chunk
// does not pay for the editor (see that module's header).
export {
  EAGER_NAMESPACES,
  fetchBundle,
  fetchManifest,
  fetchOverrides,
} from './i18nBoot.js';
export type { I18nBundle, I18nManifest, LocaleManifestEntry } from './i18nBoot.js';
import type { LocaleManifestEntry } from './i18nBoot.js';

export interface KeyRow {
  namespace: Namespace;
  key: string;
  source: string;
  builtin: string | null;
  override: string | null;
  stale: boolean;
  a11yCritical: boolean;
  updatedAt: number | null;
}

export interface KeysPage {
  items: KeyRow[];
  total: number;
  groups: { group: string; count: number }[];
  version: number;
}

export type KeyStateFilter = 'all' | 'overridden' | 'untranslated' | 'stale';

export interface KeysQuery {
  locale: string;
  namespace?: Namespace | undefined;
  group?: string | undefined;
  q?: string | undefined;
  state?: KeyStateFilter | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

export async function fetchKeys(query: KeysQuery): Promise<KeysPage> {
  const params = new URLSearchParams({ locale: query.locale });
  if (query.namespace !== undefined) params.set('namespace', query.namespace);
  if (query.group !== undefined) params.set('group', query.group);
  if (query.q !== undefined && query.q !== '') params.set('q', query.q);
  if (query.state !== undefined) params.set('state', query.state);
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return api.get<KeysPage>(`/api/v1/i18n/keys?${params.toString()}`);
}

export interface WriteKeyResult {
  ok: true;
  version: number;
  row: KeyRow | null;
}

export async function putKey(input: {
  locale: string;
  namespace: Namespace;
  key: string;
  value: string;
}): Promise<WriteKeyResult> {
  return api.put<WriteKeyResult>('/api/v1/i18n/keys', input);
}

/** Reset to the built-in — a hard delete, NOT a write of `''`. */
export async function resetKey(input: {
  locale: string;
  namespace: Namespace;
  key: string;
}): Promise<WriteKeyResult> {
  const params = new URLSearchParams(input);
  return api.delete<WriteKeyResult>(`/api/v1/i18n/keys?${params.toString()}`);
}

export interface BulkResult {
  ok: true;
  version: number;
  written: number;
  rejected: { namespace: string; key: string; reason: string }[];
}

export async function putKeysBulk(
  items: { locale: string; namespace: Namespace; key: string; value: string }[],
): Promise<BulkResult> {
  return api.post<BulkResult>('/api/v1/i18n/keys/bulk', { items });
}

export interface LocaleMutationResult {
  ok: true;
  version: number;
  locale: LocaleManifestEntry | null;
}

export async function createLocale(input: {
  locale: string;
  english: string;
  native: string;
  dir: 'ltr' | 'rtl';
  fontHint: 'latin' | 'arabic' | 'cjk';
  intlTag: string;
  enabled?: boolean;
  sortOrder?: number;
  copyFrom?: string;
}): Promise<LocaleMutationResult> {
  return api.post<LocaleMutationResult>('/api/v1/i18n/locales', input);
}

export async function patchLocale(
  locale: string,
  input: Partial<{
    enabled: boolean;
    sortOrder: number;
    english: string;
    native: string;
    dir: 'ltr' | 'rtl';
    fontHint: 'latin' | 'arabic' | 'cjk';
    intlTag: string;
  }>,
): Promise<LocaleMutationResult> {
  return api.patch<LocaleMutationResult>(`/api/v1/i18n/locales/${encodeURIComponent(locale)}`, input);
}

export interface DeleteLocaleResult {
  ok: true;
  version: number;
  reassignedUsers: number;
  deletedOverrides: number;
  deletedEmailTemplates: number;
  workspaceDefaultReset: boolean;
}

export async function deleteLocale(
  locale: string,
  reassignTo: string = 'inherit',
): Promise<DeleteLocaleResult> {
  return api.delete<DeleteLocaleResult>(
    `/api/v1/i18n/locales/${encodeURIComponent(locale)}?reassignTo=${encodeURIComponent(reassignTo)}`,
  );
}

export interface FormatFailure {
  key: string;
  lng: string;
  message: string;
  at: number;
  count: number;
}

export async function fetchFormatErrors(): Promise<{ items: FormatFailure[] }> {
  return api.get<{ items: FormatFailure[] }>('/api/v1/i18n/format-errors');
}
