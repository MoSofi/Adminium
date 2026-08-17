// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scheduled-reports client (M7 reports track) — thin typed wrappers over
 * `/api/v1/scheduled-reports`. Shapes mirror the server Zod reply schemas
 * (`apps/server/src/routes/scheduled-reports/schema.ts`) — the copied-mirror
 * convention from data-io/api.ts: change both together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

export interface ReportScheduleDto {
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  /** `HH:mm`, 24h. */
  time: string;
  /** IANA zone, e.g. `UTC`, `America/New_York`. */
  timezone: string;
}

/** §3.24 stored INTENT; v1 delivers a CSV data snapshot regardless. */
export type ReportFormat = 'pdf' | 'png';

export interface ScheduledReportDto {
  id: string;
  pageId: string;
  pageTitle: string | null;
  pageSlug: string | null;
  name: string;
  schedule: ReportScheduleDto;
  recipients: string[];
  format: ReportFormat;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledReportWriteBody {
  pageId: string;
  name: string;
  schedule: ReportScheduleDto;
  recipients?: string[];
  format?: ReportFormat;
  enabled?: boolean;
}

const BASE = '/api/v1/scheduled-reports';

export const scheduledReportsApi = {
  list: async () => (await api.get<{ data: ScheduledReportDto[] }>(BASE)).data,

  create: async (body: ScheduledReportWriteBody) =>
    (await api.post<{ data: ScheduledReportDto }>(BASE, body)).data,

  update: async (id: string, patch: Partial<ScheduledReportWriteBody>) =>
    (await api.patch<{ data: ScheduledReportDto }>(`${BASE}/${encodeURIComponent(id)}`, patch)).data,

  remove: async (id: string) =>
    (await api.delete<{ data: { deleted: boolean } }>(`${BASE}/${encodeURIComponent(id)}`)).data,
};

export function scheduledReportsQuery() {
  return queryOptions({
    queryKey: ['scheduled-reports'] as const,
    queryFn: () => scheduledReportsApi.list(),
  });
}
