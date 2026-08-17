/**
 * Workspace branding client — the white-label chrome (name, logo, version
 * chip) that every shell surface paints itself with.
 *
 * SYNC NOTE: mirrors `apps/server/src/routes/branding/schema.ts` (type-only
 * copy, same convention as app/bootstrap.ts) — change both together.
 *
 * WHY ITS OWN QUERY AND NOT PART OF BOOTSTRAP: the sign-in screen, the 404 and
 * the error/offline heroes all render with no session, and `/bootstrap` 401s
 * for exactly those visitors. `GET /branding` is public, so one query serves
 * every surface — signed in or out — and there is no second copy of the same
 * fact to drift. It is small, cached indefinitely, and invalidated by the
 * `config-changed` realtime event a branding write publishes.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from './api.js';

export interface BrandingData {
  appName: string;
  /** `/api/v1/branding/logo?v=<fileId>`, or null for the built-in mark. */
  logoUrl: string | null;
  /** Whether the sidebar shows the `v<version>` chip. */
  showVersion: boolean;
}

export const BRANDING_QUERY_KEY = ['branding'] as const;

/** What every surface falls back to before the query resolves, or if it fails. */
export const DEFAULT_BRANDING: BrandingData = {
  appName: 'Adminium',
  logoUrl: null,
  showVersion: true,
};

export function brandingQuery() {
  return queryOptions({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: BrandingData }>('/api/v1/branding')).data,
    // Chrome, not data: it changes when an admin changes it, and that write
    // publishes `config-changed`. Refetching it on every window focus would
    // be pure noise on the one query that is on screen 100% of the time.
    staleTime: Infinity,
  });
}

/**
 * Raw-bytes upload (the route takes the image as the body, not multipart, so
 * the content type IS the declaration — the server re-sniffs it anyway).
 * Not routed through `api` because that client is JSON-only.
 */
export async function uploadBrandingLogo(file: File): Promise<BrandingData> {
  const name = file.name === '' ? 'logo' : file.name;
  const response = await fetch(`/api/v1/branding/logo?filename=${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': file.type === '' ? 'application/octet-stream' : file.type,
    },
    body: file,
  });
  const body = (await response.json().catch(() => null)) as
    | { data?: BrandingData; error?: { message?: unknown } }
    | null;
  if (!response.ok) {
    const message =
      typeof body?.error?.message === 'string'
        ? body.error.message
        : `Upload failed with status ${String(response.status)}.`;
    throw new Error(message);
  }
  if (body?.data === undefined) throw new Error('The server returned no branding.');
  return body.data;
}

export async function deleteBrandingLogo(): Promise<BrandingData> {
  return (await api.delete<{ data: BrandingData }>('/api/v1/branding/logo')).data;
}
