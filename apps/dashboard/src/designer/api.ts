// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium Designer's API, as the pages use it.
 *
 * SYNC NOTE: a type-only copy of `apps/server/src/routes/designer/schema.ts`
 * (the dashboard may not import server code). Change both together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, ApiError, csrfHeaders } from '../app/api.js';

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
  /** The person asking is the owner `design` made, still with no password. */
  ownerNeedsPassword?: boolean;
}

/** Who the preview signs in as: the dashboard says so when it is opened as them outside the Designer's frame. */
export const PREVIEW_USER_EMAIL = 'preview@adminium.localhost';

export interface YourApp {
  key: string;
  name: string;
  version: number | null;
  editedAt: number | null;
  sessionId: string | null;
  /** Every session on this app, newest first. */
  sessions: { id: string; title: string; updatedAt: number; turns: number }[];
}

/** A copy of a published app being made: three steps, and the session that opens on it. */
export interface StartJob {
  id: string;
  key: string;
  newKey: string;
  name: string;
  state: 'running' | 'done' | 'failed';
  steps: { id: 'get' | 'make' | 'build'; state: 'waiting' | 'running' | 'done' | 'failed'; detail?: string }[];
  sessionId: string | null;
}

export interface CatalogApp {
  key: string;
  version: string;
  name: string;
  tagline: string;
  category: string | null;
  sides: ('staff' | 'customer')[];
  /** Whether the list says where its source is: only then can it be made one's own. */
  copyable: boolean;
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
/** A spending mark: passing one warns the person and ends nothing. */
export type SpendMark = 'turn-tokens' | 'session-tokens';

/** A file a person attached to a message. */
export interface DesignerAttachment {
  id: string;
  label: string;
  kind: 'image' | 'csv';
  mediaType: string;
  bytes: number;
  rows?: number;
  columns?: string[];
}

export type DesignerCard =
  | { id: string; type: 'question'; question: string; choices: string[]; /** The look of the app's screens: the choices are directions, worded here. */ look?: true }
  /** Rows of an attached CSV into one of the app's tables: asked before any is loaded. */
  | { id: string; type: 'rows'; attachment: string; file: string; table: string; rows: number; left: number; reasons: string[]; mapping: { from: string; to: string }[] }
  | { id: string; type: 'package'; name: string; version: string; why: string; also?: { name: string; version: string }[] }
  /** An add-on the app needs and this server lacks. `listOff`: a yes switches the list of adminium.dev on first. `here`: it is in this server's store, so nothing is fetched. */
  | { id: string; type: 'add-on'; key: string; name: string; version: string | null; line: string; listOff?: true; here?: true }
  | {
      id: string;
      type: 'removal';
      appKey: string;
      changes: { kind: 'table' | 'column' | 'narrow'; table: string; tableName: string; column?: string; rows: number; detail?: string }[];
    };

/** The four looks an app's own screens can take. */
export const LOOK_DIRECTIONS = ['clean', 'warm', 'bold', 'calm'] as const;
export type LookDirection = (typeof LOOK_DIRECTIONS)[number];

export interface SessionReply {
  session: DesignerSession;
  waiting: DesignerCard[];
  active: boolean;
  /** The look of the app's own screens, when it can be changed from the page. */
  look?: { direction: LookDirection; accent?: string } | null;
}

export type StepFacts = {
  subject?: string;
  count?: number;
  outcome?: 'added' | 'declined' | 'refused' | 'failed';
  ended?: 'stopped' | 'error' | 'miss';
  look?: string;
};

export type DesignerEventBody =
  | { kind: 'turn-started'; text: string; attachments?: Pick<DesignerAttachment, 'id' | 'label' | 'kind' | 'rows'>[] }
  | { kind: 'text'; delta: string }
  | ({ kind: 'step'; id: string; tool: string; label: string; state: 'running' | 'done' | 'failed'; ms?: number; detail?: string } & StepFacts)
  | { kind: 'usage'; step: number; tokensIn: number; tokensOut: number; estimated: boolean; turnTokens: number }
  | { kind: 'spend'; which: SpendMark; mark: number; used: number }
  | { kind: 'card'; card: DesignerCard }
  | { kind: 'card-answered'; id: string; value: unknown }
  | { kind: 'check'; ok: boolean; findings: { file: string; path: string; message: string; level: string }[] }
  | { kind: 'build'; ok: boolean; problems: string[] }
  | { kind: 'apply'; ok: boolean; state: string; stage?: string; message?: string }
  | { kind: 'version'; n: number; name: string }
  | { kind: 'look'; direction: string }
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

export type ArchitectureCell = 'read' | 'write' | 'none';
export type ArchitectureEdgeKind = 'session' | 'customer-key' | 'uses' | 'relation' | 'add-on' | 'email';
export type BuiltIn = 'sign-in' | 'files' | 'automations' | 'import-export' | 'reports' | 'api';

/** How an app fits together, from what the engine applied. */
export interface ArchitectureDoc {
  name: string;
  applied: boolean;
  people: { id: string; kind: 'role' | 'customers'; label: string }[];
  uses: { id: 'dashboard' | 'staff' | 'customer'; label: string; count: number }[];
  tables: { id: string; ref: string; name: string; rows: number | null; columns: { name: string; type: string }[]; relations: { to: string; column: string }[] }[];
  addOns: { id: string; key: string; name: string; need: 'required' | 'suggested'; state: 'installed' | 'not-installed'; version: string | null; reason: string }[];
  builtIn: BuiltIn[];
  emails: { id: string; key: string; name: string; when: string }[];
  edges: { id: string; from: string; to: string; kind: ArchitectureEdgeKind; reads?: number; writes?: number }[];
  lists: {
    pages: { ref: string; name: string; kind: string; shows: string }[];
    roles: { tables: string[]; rows: { id: string; role: string; cells: ArchitectureCell[]; notes: (string | null)[] }[] };
    access: string[];
    screens: { id: string; name: string; side: 'staff' | 'customer' }[];
  };
  pending: { part: string; node: string | null }[];
}

export const designerKeys = {
  state: ['designer', 'state'] as const,
  apps: ['designer', 'your-apps'] as const,
  catalog: ['designer', 'catalog'] as const,
  models: ['designer', 'models'] as const,
  session: (id: string) => ['designer', 'session', id] as const,
  versions: (id: string) => ['designer', 'versions', id] as const,
  architecture: (id: string) => ['designer', 'architecture', id] as const,
};

/** A file for a message, as its raw bytes (this client is JSON-only, so the call and its CSRF header are written out). */
async function uploadAttachment(sessionId: string, file: File): Promise<DesignerAttachment> {
  const response = await fetch(`${BASE}/sessions/${sessionId}/attachments?filename=${encodeURIComponent(file.name === '' ? 'pasted' : file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/octet-stream', ...csrfHeaders() },
    body: file,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Said below.
  }
  if (!response.ok) {
    const envelope = (body ?? {}) as { error?: { code?: unknown; message?: unknown; requestId?: unknown; details?: unknown } };
    throw new ApiError(
      response.status,
      typeof envelope.error?.code === 'string' ? envelope.error.code : 'INTERNAL',
      typeof envelope.error?.message === 'string' ? envelope.error.message : `The file could not be attached (${String(response.status)}).`,
      typeof envelope.error?.requestId === 'string' ? envelope.error.requestId : null,
      envelope.error?.details,
    );
  }
  return (body as { attachment: DesignerAttachment }).attachment;
}

export const designerApi = {
  state: () => api.get<DesignerState>(`${BASE}/state`),
  yourApps: () => api.get<{ apps: YourApp[] }>(`${BASE}/sessions`),
  catalog: () => api.get<{ state: 'ok' | 'off' | 'unreachable'; apps: CatalogApp[] }>(`${BASE}/apps`),
  startCheck: (newKey: string) =>
    api.get<{ problem: string | null; build: { install: string; command: string; output: string; fingerprint: string } | null }>(`${BASE}/start-check?newKey=${encodeURIComponent(newKey)}`),
  start: (input: { key: string; newKey: string; name: string; approve: string; connectionId: string; model: string }) => api.post<StartJob>(`${BASE}/start`, input),
  startStatus: (jobId: string) => api.get<StartJob>(`${BASE}/start-status/${encodeURIComponent(jobId)}`),
  models: () => api.get<DesignerModels>(`${BASE}/models`),
  checkModel: (connectionId: string, model: string) => api.post<{ canBuild: boolean | null; message: string | null }>(`${BASE}/models/check`, { connectionId, model }),
  testConnection: (draft: ConnectionDraft) => api.post<ConnectionTest>(`${BASE}/connections/test`, draft),
  saveConnection: (draft: ConnectionDraft & { model: string }) => api.put<ModelConnection>(`${BASE}/connections`, draft),
  session: (id: string) => api.get<SessionReply>(`${BASE}/sessions/${id}`),
  patchSession: (id: string, patch: { title?: string; connectionId?: string; model?: string }) => api.patch<SessionReply>(`${BASE}/sessions/${id}`, patch),
  setLook: (id: string, direction: LookDirection) =>
    api.post<{ look: { direction: LookDirection }; version: { n: number; name: string } | null; applied: boolean }>(`${BASE}/sessions/${id}/look`, { direction }),
  startTurn: (id: string, text: string, attachments: readonly string[] = []) =>
    api.post<{ turn: number }>(`${BASE}/sessions/${id}/turns`, { text, ...(attachments.length === 0 ? {} : { attachments }) }),
  uploadAttachment,
  attachmentUrl: (id: string, attachment: string) => `${BASE}/sessions/${id}/attachments/${attachment}`,
  readsImages: (connectionId: string, model: string) => api.post<{ readsImages: boolean | null }>(`${BASE}/models/reads-images`, { connectionId, model }),
  stop: (id: string) => api.post<{ stopped: boolean }>(`${BASE}/sessions/${id}/stop`, {}),
  answer: (id: string, cardId: string, value: unknown) => api.post<{ answered: true }>(`${BASE}/sessions/${id}/answers`, { cardId, value }),
  eventsSince: (id: string, after: number) => api.get<{ events: DesignerEvent[]; last: number; more: boolean }>(`${BASE}/sessions/${id}/events-since?after=${String(after)}`),
  versions: (id: string) => api.get<{ available: boolean; versions: DesignerVersion[] }>(`${BASE}/sessions/${id}/versions`),
  restore: (id: string, n: number, record: boolean) =>
    api.post<{ version: { n: number; name: string } | null; applied: boolean }>(`${BASE}/sessions/${id}/versions/${String(n)}/restore`, { record }),
  architecture: (id: string) => api.get<ArchitectureDoc>(`${BASE}/sessions/${id}/architecture`),
  previewTicket: (id: string, to: string) => api.post<{ url: string; origin: string; seenAs?: string[] }>(`${BASE}/sessions/${id}/preview-ticket`, { to }),
  setOwnerPassword: (input: { email: string; password: string }) => api.post<{ email: string }>(`${BASE}/owner-password`, input),
  createSession: (input: { appKey?: string; name?: string; target: DesignerTarget; connectionId: string; model: string; text?: string }) =>
    api.post<{ session: DesignerSession; turn: number | null }>(`${BASE}/sessions`, input),
};

export const designerStateQuery = () => queryOptions({ queryKey: designerKeys.state, queryFn: designerApi.state });
export const yourAppsQuery = () => queryOptions({ queryKey: designerKeys.apps, queryFn: designerApi.yourApps });
export const catalogQuery = () => queryOptions({ queryKey: designerKeys.catalog, queryFn: designerApi.catalog, staleTime: 5 * 60_000, retry: false });
export const modelsQuery = () => queryOptions({ queryKey: designerKeys.models, queryFn: designerApi.models, staleTime: 30_000 });
export const sessionQuery = (id: string) => queryOptions({ queryKey: designerKeys.session(id), queryFn: () => designerApi.session(id) });
export const versionsQuery = (id: string) => queryOptions({ queryKey: designerKeys.versions(id), queryFn: () => designerApi.versions(id) });
export const architectureQuery = (id: string) => queryOptions({ queryKey: designerKeys.architecture(id), queryFn: () => designerApi.architecture(id) });
