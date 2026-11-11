// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Export everything": the client of `POST /api/v1/export/zip`,
 * `GET /api/v1/export/zip` and `GET /api/v1/export/zip/:id`.
 *
 * SYNC NOTE: {@link ExportView} mirrors `exportEverythingReply` in
 * `apps/server/src/routes/export/everything.ts`. Change both together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';

export type ExportView =
  | { id: string; state: 'preparing'; percent: number }
  | { id: string; state: 'ready'; percent: 100; fileName: string; bytes: number; expiresAt: number }
  | { id: string; state: 'failed'; message: string }
  | { id: string; state: 'expired' };

export interface ExportReply {
  export: ExportView | null;
}

/** How often a file being made is asked about. */
export const EXPORT_POLL_MS = 700;

export const EXPORT_STATE_KEY = ['export', 'everything'] as const;

export function exportStateQuery() {
  return queryOptions({
    queryKey: EXPORT_STATE_KEY,
    queryFn: () => api.get<ExportReply>('/api/v1/export/zip'),
    // Asked again only while the file is being made.
    refetchInterval: (query) => (query.state.data?.export?.state === 'preparing' ? EXPORT_POLL_MS : false),
    staleTime: 0,
  });
}

export function startExport(): Promise<ExportReply> {
  return api.post<ExportReply>('/api/v1/export/zip');
}

/** The one-time download. A plain link: the browser saves it with the session cookie. */
export function exportDownloadHref(id: string): string {
  return `/api/v1/export/zip/${encodeURIComponent(id)}`;
}

/** The command the "On your own server" row copies. */
export const IMPORT_COMMAND = 'adminium import-zip <file>';
