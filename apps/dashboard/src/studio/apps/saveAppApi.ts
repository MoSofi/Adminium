// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app: the data layer over `/api/v1/apps/save*`
 * (`apps/server/src/routes/apps/save.ts`).
 *
 * Shapes mirror the server's Zod replies — the copied-mirror convention:
 * change both together.
 *
 *  - `GET /apps/save/inventory` lists what a database could put in its app,
 *    and what each thing needs (the wizard's "What to include").
 *  - `POST /apps/save/plan` writes nothing: the Check list, the counts, the
 *    version, and whether the file can be made now.
 *  - `POST /apps/save` makes the file from the same choices and answers.
 *  - `GET /apps/saves` and `GET /apps/save/:id/file`: "Saved from here".
 *
 * An answer is recorded exactly where its Check item says: under the
 * `answers` list its choice names, holding `answer.targets[choice]` when the
 * item gives one, else `answer.target`.
 */
import { queryOptions } from '@tanstack/react-query';

import { ApiError, api, csrfHeaders } from '../../app/api.js';

export type CheckGroup = 'choice' | 'after' | 'info';
export type AnswerChoice = 'carry-as-text' | 'leave-out' | 'make-shared' | 'clear' | 'keep';

export interface CheckItem {
  group: CheckGroup;
  code: string;
  kind: string;
  item: string;
  field?: string;
  message: string;
  answer?: { choices: string[]; target: string; targets?: Record<string, string> };
  afterKind?: string;
}

export interface GateProblem {
  code: string;
  message: string;
  path?: string;
}

export interface SavePlan {
  key: string;
  version: string;
  lineage: 'new' | 'kept';
  label: string;
  minAdminiumVersion: string;
  ready: boolean;
  check: CheckItem[];
  problems: GateProblem[];
  counts: Record<string, number>;
}

export interface RowChoice {
  mode: 'none' | 'starting' | 'sample';
  viewId?: string;
}

export interface SaveAnswers {
  carryAsText?: string[];
  personalColumns?: string[];
  shareViews?: string[];
  clear?: string[];
  leaveOut?: string[];
  keep?: string[];
}

export interface SaveInclude {
  tables?: string[];
  pages?: string[];
  roles?: string[];
  automations?: string[];
  emailTemplates?: string[];
  documents?: string[];
  reports?: string[];
  invoiceLayouts?: string[];
  scheduledReports?: string[];
  publicEndpoints?: string[];
  payments?: boolean;
  instance?: boolean;
}

export interface SaveRequest {
  connectionId: string;
  key: string;
  name: string;
  version?: string;
  description?: string;
  label?: string;
  include?: SaveInclude;
  rows?: Record<string, RowChoice>;
  answers?: SaveAnswers;
}

export interface SavedFile {
  id: string;
  key: string;
  version: string;
  integrity: string;
  bytes: number;
  filename: string;
  savedAt: number;
}

export interface AppSaveRow {
  id: string;
  key: string;
  version: string;
  connectionId: string | null;
  name: string | null;
  description: string | null;
  label: string;
  savedBy: string | null;
  savedByName: string | null;
  savedAt: number;
  integrity: string;
  bytes: number;
  downloadable: boolean;
}

export interface InventoryLink {
  column: string;
  to: string;
  required: boolean;
}

export interface InventoryTable {
  id: string;
  name: string;
  columns: number;
  rows: number | null;
  rowsExact: boolean;
  links: InventoryLink[];
  personal: string[];
  secretLike: string[];
  rowsAllowed: boolean;
  personalAllowed: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  tableIds: string[];
  pageId?: string;
}

export interface SaveInventory {
  connectionId: string;
  tables: InventoryTable[];
  pages: { id: string; title: string; tableId: string | null; generated: boolean }[];
  views: { id: string; name: string; pageId: string; ownerId: string | null; ownerName: string | null }[];
  roles: { id: string; name: string }[];
  automations: InventoryItem[];
  emailTemplates: { key: string; name: string }[];
  documents: InventoryItem[];
  reports: InventoryItem[];
  invoiceLayouts: InventoryItem[];
  scheduledReports: InventoryItem[];
  publicEndpoints: InventoryItem[];
  payments: boolean;
  instance: boolean;
}

export const APP_SAVES_QUERY_KEY = ['studio', 'apps', 'saves'] as const;

export function appSavesQuery() {
  return queryOptions({
    queryKey: APP_SAVES_QUERY_KEY,
    queryFn: async () => (await api.get<{ saves: AppSaveRow[] }>('/api/v1/apps/saves')).saves,
  });
}

export function saveInventoryQuery(connectionId: string) {
  return queryOptions({
    queryKey: ['studio', 'apps', 'save-inventory', connectionId] as const,
    queryFn: async () =>
      (await api.get<{ inventory: SaveInventory }>(`/api/v1/apps/save/inventory?${new URLSearchParams({ connectionId }).toString()}`)).inventory,
  });
}

export async function planSave(request: SaveRequest): Promise<SavePlan> {
  return (await api.post<{ plan: SavePlan }>('/api/v1/apps/save/plan', request)).plan;
}

export async function saveApp(request: SaveRequest): Promise<SavedFile> {
  return (await api.post<{ save: SavedFile }>('/api/v1/apps/save', request)).save;
}

/** The value a choice records: the item's own for that choice when it gives one. */
export function answerTarget(item: CheckItem, choice: AnswerChoice): string | null {
  if (item.answer === undefined || !item.answer.choices.includes(choice)) return null;
  return item.answer.targets?.[choice] ?? item.answer.target;
}

/** The `answers` list a choice is recorded in. */
export const ANSWER_LIST: Record<AnswerChoice, keyof SaveAnswers> = {
  'carry-as-text': 'carryAsText',
  'leave-out': 'leaveOut',
  'make-shared': 'shareViews',
  clear: 'clear',
  keep: 'keep',
};

/** A saved file's bytes, saved by the browser under its own name; answers that name. */
export async function downloadSavedFile(id: string): Promise<string> {
  const response = await fetch(`/api/v1/apps/save/${encodeURIComponent(id)}/file`, {
    credentials: 'same-origin',
    headers: { accept: 'application/gzip', ...csrfHeaders() },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: unknown; code?: unknown } } | null;
    const message = typeof body?.error?.message === 'string' ? body.error.message : `Download failed with status ${String(response.status)}.`;
    throw new ApiError(response.status, typeof body?.error?.code === 'string' ? body.error.code : 'DOWNLOAD_FAILED', message, null, null);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'app.tgz';
  const blob = await response.blob();
  if (typeof URL.createObjectURL !== 'function') return name;
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return name;
}

/** The version after `version`: the patch number + 1, as the server numbers them. */
export function nextVersionAfter(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) return '1.0.0';
  return `${match[1]!}.${match[2]!}.${String(Number(match[3]) + 1)}`;
}

/** -1, 0 or 1 for two `x.y.z` versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
