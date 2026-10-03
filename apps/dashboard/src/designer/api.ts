// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium Designer's API, as the pages use it.
 *
 * SYNC NOTE: a type-only copy of `apps/server/src/routes/designer/schema.ts`
 * (the dashboard may not import server code). Change both together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

const BASE = '/api/v1/designer';

export type DesignerTarget = 'auto' | 'dashboard' | 'web';

export interface DesignerSession {
  id: string;
  appKey: string;
  title: string;
  target: DesignerTarget;
  connectionId: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  turns: number;
  version: number | null;
  createdApp: boolean;
  tokens: { in: number; out: number };
}

export interface DesignerState {
  mode: 'local' | 'live';
  project: string;
  limits: { maxSteps: number; turnTokens: number; sessionTokens: number };
  active: { sessionId: string; turn: number } | null;
}

export interface YourApp {
  key: string;
  name: string;
  version: number | null;
  editedAt: number | null;
  sessionId: string | null;
}

export interface CatalogApp {
  key: string;
  version: string;
  name: string;
  tagline: string;
  category: string | null;
  sides: ('staff' | 'customer')[];
  iconTint: string | null;
  iconPaths: string[];
  monogram: string | null;
}

export interface ModelConnection {
  id: string;
  provider: string;
  source: 'database' | 'environment';
  state: 'ok' | 'unreachable';
  models: { id: string; label: string }[];
}

export interface DesignerModels {
  connections: ModelConnection[];
  selected: { connectionId: string; model: string } | null;
  verdicts: { connectionId: string; model: string; canBuild: boolean; message: string | null }[];
  canAdd: boolean;
}

export interface ConnectionDraft {
  provider: 'anthropic' | 'openai' | 'openai-compatible' | 'ollama';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ConnectionTest {
  ok: boolean;
  models: { id: string; label: string }[];
  canBuild: { canBuild: true; reportsUsage: boolean } | { canBuild: false; reason: 'no-tool-call' | 'refused-result'; message: string } | null;
  error: { code: string; message: string } | null;
}

export type TurnOutcome = 'done' | 'stopped' | 'limit' | 'failed' | 'not-applied';
export type LimitKind = 'steps' | 'turn-tokens' | 'session-tokens';

export type DesignerCard =
  | { id: string; type: 'question'; question: string; choices: string[] }
  | { id: string; type: 'package'; name: string; version: string; why: string }
  | {
      id: string;
      type: 'removal';
      appKey: string;
      changes: { kind: 'table' | 'column' | 'narrow'; table: string; tableName: string; column?: string; rows: number; detail?: string }[];
    };

export type StepFacts = {
  subject?: string;
  count?: number;
  outcome?: 'added' | 'declined' | 'refused' | 'failed';
  ended?: 'stopped' | 'error';
};

export type DesignerEventBody =
  | { kind: 'turn-started'; text: string }
  | { kind: 'text'; delta: string }
  | ({ kind: 'step'; id: string; tool: string; label: string; state: 'running' | 'done' | 'failed'; ms?: number; detail?: string } & StepFacts)
  | { kind: 'usage'; step: number; tokensIn: number; tokensOut: number; estimated: boolean; turnTokens: number }
  | { kind: 'card'; card: DesignerCard }
  | { kind: 'card-answered'; id: string; value: unknown }
  | { kind: 'check'; ok: boolean; findings: { file: string; path: string; message: string; level: string }[] }
  | { kind: 'build'; ok: boolean; problems: string[] }
  | { kind: 'apply'; ok: boolean; state: string; stage?: string; message?: string }
  | { kind: 'version'; n: number; name: string }
  | { kind: 'limit'; which: LimitKind; value: number }
  | { kind: 'stopped' }
  | { kind: 'error'; code: string; message: string; provider?: string; status?: number }
  | { kind: 'turn-finished'; outcome: TurnOutcome };

export type DesignerEvent = DesignerEventBody & { seq: number; turn: number; at: number };

export interface DesignerVersion {
  n: number;
  name: string;
  at: number;
  current: boolean;
}

export const designerKeys = {
  state: ['designer', 'state'] as const,
  apps: ['designer', 'your-apps'] as const,
  catalog: ['designer', 'catalog'] as const,
  models: ['designer', 'models'] as const,
  session: (id: string) => ['designer', 'session', id] as const,
  versions: (id: string) => ['designer', 'versions', id] as const,
};

export const designerApi = {
  state: () => api.get<DesignerState>(`${BASE}/state`),
  yourApps: () => api.get<{ apps: YourApp[] }>(`${BASE}/sessions`),
  catalog: () => api.get<{ state: 'ok' | 'off' | 'unreachable'; apps: CatalogApp[] }>(`${BASE}/apps`),
  models: () => api.get<DesignerModels>(`${BASE}/models`),
  checkModel: (connectionId: string, model: string) => api.post<{ canBuild: boolean | null; message: string | null }>(`${BASE}/models/check`, { connectionId, model }),
  testConnection: (draft: ConnectionDraft) => api.post<ConnectionTest>(`${BASE}/connections/test`, draft),
  saveConnection: (draft: ConnectionDraft & { model: string }) => api.put<ModelConnection>(`${BASE}/connections`, draft),
  session: (id: string) => api.get<{ session: DesignerSession; waiting: DesignerCard[]; active: boolean }>(`${BASE}/sessions/${id}`),
  patchSession: (id: string, patch: { title?: string; connectionId?: string; model?: string }) =>
    api.patch<{ session: DesignerSession; waiting: DesignerCard[]; active: boolean }>(`${BASE}/sessions/${id}`, patch),
  startTurn: (id: string, text: string) => api.post<{ turn: number }>(`${BASE}/sessions/${id}/turns`, { text }),
  stop: (id: string) => api.post<{ stopped: boolean }>(`${BASE}/sessions/${id}/stop`, {}),
  answer: (id: string, cardId: string, value: unknown) => api.post<{ answered: true }>(`${BASE}/sessions/${id}/answers`, { cardId, value }),
  eventsSince: (id: string, after: number) => api.get<{ events: DesignerEvent[]; last: number; more: boolean }>(`${BASE}/sessions/${id}/events-since?after=${String(after)}`),
  versions: (id: string) => api.get<{ available: boolean; versions: DesignerVersion[] }>(`${BASE}/sessions/${id}/versions`),
  restore: (id: string, n: number, record: boolean) =>
    api.post<{ version: { n: number; name: string } | null; applied: boolean }>(`${BASE}/sessions/${id}/versions/${String(n)}/restore`, { record }),
  createSession: (input: { appKey?: string; name?: string; target: DesignerTarget; connectionId: string; model: string; text?: string }) =>
    api.post<{ session: DesignerSession; turn: number | null }>(`${BASE}/sessions`, input),
};

export const designerStateQuery = () => queryOptions({ queryKey: designerKeys.state, queryFn: designerApi.state });
export const yourAppsQuery = () => queryOptions({ queryKey: designerKeys.apps, queryFn: designerApi.yourApps });
export const catalogQuery = () => queryOptions({ queryKey: designerKeys.catalog, queryFn: designerApi.catalog, staleTime: 5 * 60_000, retry: false });
export const modelsQuery = () => queryOptions({ queryKey: designerKeys.models, queryFn: designerApi.models, staleTime: 30_000 });
export const sessionQuery = (id: string) => queryOptions({ queryKey: designerKeys.session(id), queryFn: () => designerApi.session(id) });
export const versionsQuery = (id: string) => queryOptions({ queryKey: designerKeys.versions(id), queryFn: () => designerApi.versions(id) });
