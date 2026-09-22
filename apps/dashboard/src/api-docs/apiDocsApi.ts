// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The explorer's one read: `GET /api/v1/api-docs`.
 *
 * Shapes mirror `apps/server/src/routes/api-docs/schema.ts` — the copied-mirror
 * convention: change both together.
 *
 * A 404 is not an error here, it is the answer "this deployment has no API
 * documentation page" (off, or never on), and the page renders the ordinary
 * not-found screen for it. So the query resolves to `null` rather than
 * throwing, and never retries a 404.
 */
import { queryOptions } from '@tanstack/react-query';

import { ApiError, api } from '../app/api.js';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'BATCH';
export type AuthRole = 'anon' | 'authenticated' | 'service_role';

export interface CatalogueColumn {
  name: string;
  /** Logical type: `uuid`, `integer`, `timestamp`, … — never the database's native type name. */
  type: string;
  tags: ('pk' | 'unique' | 'fk')[];
}

export interface CatalogueEndpoint {
  ref: string;
  path: string;
  /** The source's own label, or null. */
  singular: string | null;
  methods: Method[];
  auth: AuthRole;
  limit: number;
  maxLimit: number;
  order: string;
  rate: { requests: number; window: '1s' | '1m' | '1h' };
  response: 'wrapped' | 'array' | 'single';
  columns: CatalogueColumn[];
  writable: string[];
}

export interface CatalogueConnection {
  /** Null unless two or more connections have listed endpoints. */
  label: string | null;
  endpoints: CatalogueEndpoint[];
}

export interface ApiDocs {
  apiEnabled: boolean;
  registered: boolean;
  baseUrl: string;
  connections: CatalogueConnection[];
}

export const API_DOCS_QUERY_KEY = ['api-docs'] as const;

export function apiDocsQuery() {
  return queryOptions({
    queryKey: API_DOCS_QUERY_KEY,
    queryFn: async (): Promise<ApiDocs | null> => {
      try {
        return await api.get<ApiDocs>('/api/v1/api-docs');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });
}
