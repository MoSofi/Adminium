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

export type DesignerTarget = 'auto' | 'dashboard' | 'web' | 'mobile';

/** How an app's phone side stands (mirrors the server's `designerPhoneReply`). */
export type PhoneStanding =
  | { state: 'none' }
  | { state: 'shape' | 'no-packages' | 'failed'; words: string }
  /** `packages` are what its package.json asks for, by name: what the yes installs. */
  | { state: 'unapproved'; words: string; packages: string[] }
  | { state: 'built'; build: string }
  | { state: 'working'; step: 'adding' | 'installing' | 'building' };

/** The door a real phone comes through. `url` carries the code a phone scans. */
export type PhoneDoorState =
  | { state: 'off' }
  | { state: 'starting'; app: string }
  | { state: 'open'; app: string; url: string; qr: string; address: string; sdk: string | null; connected: boolean; phoneSdk: string | null; lastSeen: number | null }
  | { state: 'closed'; app: string; why: 'stopped' | 'idle' | 'network' | 'failed'; words: string };

export interface PhoneStatus {
  phone: PhoneStanding;
  door: PhoneDoorState;
  addresses: { address: string; name: string }[];
}

export interface DesignerSession {
  id: string;
  appKey: string;
  title: string;
  target: DesignerTarget;
  connectionId: string;
  model: string;
  /** How hard the model is asked to work; absent at the model's own default. */
  effort?: DesignerEffort;
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
  /** Names in the project's `.env` the app did not obey (it decides them itself). */
  ignoredEnv?: string[];
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

/** How hard a model is asked to work on a reply, the least first. Mirrors `RUN_EFFORTS` of the server. */
export const DESIGNER_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type DesignerEffort = (typeof DESIGNER_EFFORTS)[number];

export interface ModelConnection {
  id: string;
  provider: string;
  source: 'database' | 'environment';
  state: 'ok' | 'unreachable';
  /** `efforts`: the levels the model takes, the least first; absent when it takes none. */
  models: { id: string; label: string; efforts?: DesignerEffort[] }[];
}

export interface DesignerModels {
  connections: ModelConnection[];
  selected: { connectionId: string; model: string } | null;
  verdicts: { connectionId: string; model: string; canBuild: boolean; message: string | null }[];
  canAdd: boolean;
  /** Inside the desktop app: where the app keeps keys (`null` and absent elsewhere: they are in the project's `.env`). */
  kept?: 'key-store' | 'plain' | null;
  /** Inside the desktop app: model names this project's `.env` sets, which are not used there. */
  ignoredEnv?: string[];
}

export interface ConnectionDraft {
  provider: 'anthropic' | 'openai' | 'openai-compatible' | 'ollama';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ListedModel {
  id: string;
  label: string;
  remote?: boolean;
}

export interface ConnectionTest {
  ok: boolean;
  /** `remote`: a local provider runs this model elsewhere (an Ollama `:cloud` model), which can need a paid plan. */
  models: ListedModel[];
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
  kind: 'image' | 'csv' | 'font' | 'doc';
  mediaType: string;
  bytes: number;
  rows?: number;
  columns?: string[];
}

/** A person's Figma connection (`GET /designer/figma`): never the token. */
export interface FigmaStatus {
  connected: boolean;
  /** `mine`: kept on this server for them; `environment`: the project's own token, under `adminium design`. */
  source: 'mine' | 'environment' | null;
  handle: string | null;
  /** False when this server calls nothing outside itself. */
  network: boolean;
  /** False where what this server keeps of a frame does not outlive the next deploy. */
  lasting: boolean;
}

/** A frame imported from Figma and kept on the server until the message it goes with is sent. */
export interface FigmaImport {
  importId: string;
  outlineName: string;
  pictureName: string;
  width: number;
  height: number;
  /** Reads Figma counted: 0 when it came from the copy this server kept. */
  reads: number;
}

/** Why Figma could not be read (`details.figma` of a refusal), as the server lists it. */
export type FigmaRefusal =
  | { kind: 'network-off' | 'token' | 'no-access' | 'no-frame' | 'render-failed' | 'too-large' | 'document-too-large' | 'unreachable' | 'not-connected' }
  | { kind: 'limit'; type: 'low' | 'high'; retryAfterSeconds: number | null }
  | { kind: 'paused'; until: number; dated: boolean };

export type DesignerCard =
  | {
      id: string;
      type: 'question';
      question: string;
      choices: string[];
      /** A session made before styles: the choices are the four looks of then, worded here. */
      look?: true;
      /** The style of the app's screens: every style there is, to draw the choices from. `more`: the keys behind "Show all". */
      style?: StyleChoice[];
      more?: string[];
    }
  /** Everything a step needs from outside the project, on one card: a checkbox each. `pictures`: what a design does with the page's pictures, asked once per app. */
  | { id: string; type: 'needs'; items: NeedItem[]; pictures?: { preselect: PicturesMode } }
  /** The spots a design made, waiting for their pictures: opens the picture dialog. Waits for no answer: an Apply is its answer. */
  | { id: string; type: 'spots'; spots: { id: string; label: string; shape: PictureShape }[]; rows?: { table: string; count: number } }
  /** A turn took a picture the person placed off its screen: keep it there, or let it go. */
  | { id: string; type: 'keep-spot'; spot: string; label: string; screen: string }
  /** Free pictures the Designer found: tick the ones to use. `shelf` and a picture's id name its small copy on this server. */
  | { id: string; type: 'pictures'; shelf: string; groups: PictureGroup[]; /** A site some of these are shown from, never copied. */ site?: string }
  /** Rows of an attached CSV into one of the app's tables: asked before any is loaded. */
  | { id: string; type: 'rows'; attachment: string; file: string; table: string; rows: number; left: number; reasons: string[]; mapping: { from: string; to: string }[] }
  | { id: string; type: 'package'; name: string; version: string; why: string; also?: { name: string; version: string }[] }
  /** An add-on the app needs and this server lacks. `listOff`: a yes switches the list of adminium.dev on first. `here`: it is in this server's store, so nothing is fetched. */
  | { id: string; type: 'add-on'; key: string; name: string; version: string | null; line: string; listOff?: true; here?: true; tables?: number }
  | {
      id: string;
      type: 'removal';
      appKey: string;
      changes: { kind: 'table' | 'column' | 'narrow'; table: string; tableName: string; column?: string; rows: number; detail?: string }[];
    };

/** What a known package is for: its line on the card is worded from this. */
export type NeedRole = 'screens' | 'public-client' | 'tailwind' | 'icons' | 'ui' | 'other';
export type NeedItem =
  | { id: string; kind: 'package'; name: string; version: string; role: NeedRole; why?: string }
  | { id: string; kind: 'font'; family: string; name: string; version: string; use: 'heading' | 'body' | 'other'; why?: string }
  | { id: string; kind: 'picture-site'; host: string; why?: string };

export type PictureShape = 'wide' | 'tall' | 'square';
/** What a design does with the page's pictures: leaves placeholders, or opens the picture dialog after it. */
export type PicturesMode = 'placeholders' | 'choose';
/** A licence's code, as the server reads it from the source: its badge is decided from it. */
export type LicenceCode = 'cc0' | 'pdm' | 'by' | 'by-sa' | 'pexels' | 'unsplash' | 'own' | 'template';
export type PictureSourceName = 'Openverse' | 'Pexels' | 'Unsplash';

/** What the picture dialog draws for an app (`GET …/pictures`). */
export interface PicturesView {
  /** The app builds its own screens: its pictures are in its own files, and the dialog does not open. */
  ownBuild: boolean;
  spots: { id: string; label: string; shape: PictureShape; shows: string; search: string; version: string; thumb: string | null; alt: string; decorative: boolean; licence: { code: LicenceCode; name: string; title: string; creator: string } | null }[];
  tables: { table: string; label: string; column: string; rows: { row: number; label: string; version: string; thumb: string | null }[] }[];
  /** Pictures already in the app, to use again: a file of `assets/pictures/`, or a picture attached in this session. */
  inApp: { key: string; name: string; thumb: string; licence: LicenceCode }[];
  mode: PicturesMode;
  /** Pictures the app's screens import themselves (made before spots). */
  legacy: number;
  /** The sources this server can search, each with the minutes it is busy for. */
  sources: { name: PictureSourceName; busy: number | null }[];
  /** `closed`: a page here may not be let load pictures from Unsplash. */
  unsplash: 'ok' | 'closed';
  version: number | null;
}
/** A picture a search found, named by the server's own ids. */
export interface FoundPicture {
  id: string;
  title: string;
  creator: string;
  source: string;
  licence: { code: LicenceCode; name: string };
  /** The picture's own page. */
  page: string;
  /** Shown from its source's site, never copied. */
  shown?: true;
}
export type PictureSearchReply =
  | { state: 'ok'; shelf: string; pictures: FoundPicture[]; more: boolean; page: number }
  | { state: 'busy'; source: PictureSourceName; minutes: number }
  | { state: 'off' }
  | { state: 'failed' };
export type PicturePinReply = { state: 'kept'; small: boolean; shown?: true } | { state: 'gone' } | { state: 'failed' };
export type PictureFillFrom = { shelf: string; picture: string } | { attachment: string } | { file: string } | { placeholder: true };
export interface PictureFill {
  spot?: string;
  row?: { table: string; row: number };
  version: string;
  from: PictureFillFrom;
  alt?: string;
  decorative?: boolean;
}
export interface PicturesApplied {
  results: { target: string; state: 'applied' | 'conflict' | 'gone'; small?: true }[];
  version: { n: number; name: string } | null;
  applied: boolean;
  before: number | null;
}

export interface PictureGroup {
  id: string;
  label: string;
  shape: 'wide' | 'tall' | 'square';
  pictures: { id: string; title: string; creator: string; licence: string; source: string }[];
}

export interface Swatch {
  bg: string;
  text: string;
  accent: string;
}
/** A style as a card offers it. */
export interface StyleChoice {
  key: string;
  title: string;
  description: string;
  swatch?: Swatch;
  origin: 'built-in' | 'project';
}
/** A style as the list holds it. */
export interface DesignerStyle extends StyleChoice {
  /** False for a style of words alone: applying it takes a turn. */
  hasTheme: boolean;
  hasPreview: boolean;
  problem?: string;
}
/** The look an app has. `earlier`: kept before styles, drawn as it was until a style is picked. */
export interface AppLook {
  skill: string;
  title: string;
  origin: 'built-in' | 'project' | 'earlier';
  accent?: string;
  swatch?: Swatch;
  /** What a design does with the page's pictures. */
  pictures?: PicturesMode;
}

/** The four looks of before styles: an older session's card still names them. */
export const LOOK_DIRECTIONS = ['clean', 'warm', 'bold', 'calm'] as const;
export type LookDirection = (typeof LOOK_DIRECTIONS)[number];

export interface SessionReply {
  session: DesignerSession;
  waiting: DesignerCard[];
  active: boolean;
  /** The look of the app's own screens, when it can be changed from the page. */
  look?: AppLook | null;
}

export type StepFacts = {
  subject?: string;
  count?: number;
  outcome?: 'added' | 'declined' | 'refused' | 'failed';
  ended?: 'stopped' | 'error' | 'miss';
  look?: string;
  /** A Figma read that did not happen: the person's reads are paused until then (epoch ms), dated when Figma said when. */
  until?: number;
  dated?: boolean;
};

/** One element of the previewed page, as the person pointed at it: what the screen said of it. */
export interface DesignerPicked {
  side: 'staff' | 'customer';
  /** The page of that side it is on. */
  path: string;
  /** The window's width the page was drawn in; null when the screen did not say. */
  page: number | null;
  /** Its tag and first classes: `button btn primary`. */
  part: string;
  /** The words it shows, on one line. */
  text: string;
  /** Its name where it has one that is not its words. */
  label: string;
  /** What it sits in, nearest first. */
  within: string[];
  nth: number;
  of: number;
  width: number;
  height: number;
}

export type DesignerEventBody =
  | { kind: 'turn-started'; text: string; attachments?: Pick<DesignerAttachment, 'id' | 'label' | 'kind' | 'rows'>[]; picked?: DesignerPicked }
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
  | { kind: 'style'; skill: string; title: string; fonts?: string[] }
  | { kind: 'limit'; which: LimitKind; value: number }
  | { kind: 'stopped' }
  | { kind: 'error'; code: string; message: string; provider?: string; status?: number }
  | { kind: 'turn-finished'; outcome: TurnOutcome }
  /** The app's folder taken, and handed back, by something a person did from a page: no turn runs. */
  | { kind: 'hold'; what: FolderHold }
  | { kind: 'released'; what: FolderHold }
  /** The Designer was shown the page after a build. */
  | { kind: 'sight'; side: string; path: string }
  /** Pictures put in their spots from the picture dialog, with no turn: what changed, and the version it was saved as. */
  | { kind: 'pictures'; names: string[]; version: { n: number; name: string } | null }
  /** The pictures' Undo: back to this version. */
  | { kind: 'pictures-undone'; to: number }
  /** The server's word on the page's pictures as a turn ends. */
  | { kind: 'pictures-note'; note: 'placeholders' | 'still-empty'; count: number };

/** What a person can do from a page that takes the app's folder for a moment. */
export type FolderHold = 'save' | 'style' | 'restore' | 'start' | 'pictures';

/** `by: 'person'`: caused from a page, outside any turn. It carries the last turn's number and belongs to none. */
export type DesignerEvent = DesignerEventBody & { seq: number; turn: number; at: number; by?: 'person' };

export type DesignerFileGroup = 'customer' | 'staff' | 'mobile' | 'dashboard' | 'settings';
/** A file a person may open: where it is in the project, what it is called on the page, and what it holds now (by hash). */
export interface DesignerFile {
  path: string;
  label: string;
  hash: string;
  size: number;
  note?: 'brief';
}
export interface DesignerFiles {
  groups: { key: DesignerFileGroup; files: DesignerFile[] }[];
  /** What has the app's folder right now. */
  busy: FolderHold | 'turn' | null;
  version: number | null;
}
/** Where some words are in the files, as they are on disk: by file (with its hash), by line. */
export interface DesignerFileHit {
  line: number;
  col: number;
  len: number;
  text: string;
  at: number;
}
export interface DesignerFilesFound {
  files: { path: string; hash: string; hits: DesignerFileHit[] }[];
  /** There were more places than are named. */
  more: boolean;
}
export interface DesignerFilesSaved {
  applied: boolean;
  version: { n: number; name: string } | null;
  files: { path: string; hash: string }[];
  /** Written and not applied: what the check, the build or the apply said. */
  problems?: { stage: 'check' | 'build' | 'apply'; lines: string[] };
}

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
  edges: { id: string; from: string; to: string; kind: ArchitectureEdgeKind; reads?: number; writes?: number; does?: 'posts' | 'prices' }[];
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
  styles: ['designer', 'styles'] as const,
  session: (id: string) => ['designer', 'session', id] as const,
  figma: ['designer', 'figma'] as const,
  versions: (id: string) => ['designer', 'versions', id] as const,
  architecture: (id: string) => ['designer', 'architecture', id] as const,
  files: (id: string) => ['designer', 'files', id] as const,
  pictures: (id: string) => ['designer', 'pictures', id] as const,
};

/** A file for a message, as its raw bytes (this client is JSON-only, so the call and its CSRF header are written out). */
/** A style of a person's own, sent as its raw bytes: a .zip of its folder, or one SKILL.md. */
async function addStyle(file: File): Promise<{ key: string; left: string[] }> {
  const response = await fetch(`${BASE}/styles?filename=${encodeURIComponent(file.name === '' ? 'style.zip' : file.name)}`, {
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
      typeof envelope.error?.message === 'string' ? envelope.error.message : `The style could not be added (${String(response.status)}).`,
      typeof envelope.error?.requestId === 'string' ? envelope.error.requestId : null,
      envelope.error?.details,
    );
  }
  return body as { key: string; left: string[] };
}

/** `part`: the file is one part of a tall picture this session holds, cut for a model to read. */
async function uploadAttachment(sessionId: string, file: Blob & { name?: string }, palette = '', part?: { of: string; part: number; parts: number }): Promise<DesignerAttachment> {
  const name = file.name === undefined || file.name === '' ? 'pasted' : file.name;
  const response = await fetch(`${BASE}/sessions/${sessionId}/attachments?filename=${encodeURIComponent(name)}${palette === '' ? '' : `&palette=${palette}`}${part === undefined ? '' : `&part_of=${part.of}&part=${String(part.part)}&parts=${String(part.parts)}`}`, {
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

/** One half of a Figma import, sent with a message: the server copies its own bytes in, so no body goes up. */
async function uploadFigma(sessionId: string, importId: string, part: 'picture' | 'outline'): Promise<DesignerAttachment> {
  const response = await fetch(`${BASE}/sessions/${sessionId}/attachments?filename=figma&figma=${encodeURIComponent(importId)}&figma_part=${part}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...csrfHeaders() },
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
  figma: () => api.get<FigmaStatus>(`${BASE}/figma`),
  /** Checked with Figma before it is kept; a token Figma refuses is not kept. */
  saveFigmaToken: (token: string) => api.put<FigmaStatus>(`${BASE}/figma`, { token }),
  removeFigma: () => api.delete<FigmaStatus>(`${BASE}/figma`),
  importFigma: (link: string) => api.post<FigmaImport>(`${BASE}/figma/import`, { link }),
  uploadFigma,
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
  patchSession: (id: string, patch: { title?: string; connectionId?: string; model?: string; /** `null`: back to the model's own default. */ effort?: DesignerEffort | null }) => api.patch<SessionReply>(`${BASE}/sessions/${id}`, patch),
  styles: () => api.get<{ styles: DesignerStyle[] }>(`${BASE}/styles`),
  addStyle,
  removeStyle: (key: string) => api.delete<{ removed: true }>(`${BASE}/styles/${encodeURIComponent(key)}`),
  stylePreviewUrl: (key: string) => `${BASE}/styles/${encodeURIComponent(key)}/preview`,
  setLook: (id: string, skill: string) => api.post<{ look: AppLook; version: { n: number; name: string } | null; applied: boolean }>(`${BASE}/sessions/${id}/look`, { skill }),
  /** `sees`: this page shows the preview and will say what it sees of each build. */
  startTurn: (id: string, text: string, attachments: readonly string[] = [], sees = false, picked: DesignerPicked | null = null) =>
    api.post<{ turn: number }>(`${BASE}/sessions/${id}/turns`, { text, ...(attachments.length === 0 ? {} : { attachments }), ...(sees ? { sees: true } : {}), ...(picked === null ? {} : { picked }) }),
  /** What the preview saw of the app's screen, for the turn that built it. */
  sendSight: (id: string, sight: { side: 'staff' | 'customer'; width: number; faults: Record<string, string | number>[]; picture?: string; path?: string }) => api.post<{ kept: boolean }>(`${BASE}/sessions/${id}/sight`, sight),
  uploadAttachment,
  attachmentUrl: (id: string, attachment: string) => `${BASE}/sessions/${id}/attachments/${attachment}`,
  pictureThumbUrl: (id: string, shelf: string, picture: string) => `${BASE}/sessions/${id}/picture-thumb/${shelf}/${picture}`,
  pictures: (id: string) => api.get<PicturesView>(`${BASE}/sessions/${id}/pictures`),
  searchPictures: (id: string, input: { q: string; source: PictureSourceName; shape?: PictureShape; page?: number; shelf?: string }) =>
    api.get<PictureSearchReply>(
      `${BASE}/sessions/${id}/pictures/search?${new URLSearchParams({ q: input.q, source: input.source, ...(input.shape === undefined ? {} : { shape: input.shape }), ...(input.page === undefined ? {} : { page: String(input.page) }), ...(input.shelf === undefined ? {} : { shelf: input.shelf }) }).toString()}`,
    ),
  pinPicture: (id: string, shelf: string, picture: string) => api.post<PicturePinReply>(`${BASE}/sessions/${id}/pictures/pin`, { shelf, picture }),
  applyPictures: (id: string, applyId: string, fills: readonly PictureFill[], mode?: PicturesMode) =>
    api.post<PicturesApplied>(`${BASE}/sessions/${id}/pictures/apply`, { id: applyId, fills, ...(mode === undefined ? {} : { mode }) }),
  undoPictures: (id: string, from: number, to: number) => api.post<{ version: { n: number; name: string } | null; applied: boolean }>(`${BASE}/sessions/${id}/pictures/undo`, { from, to }),
  readsImages: (connectionId: string, model: string) => api.post<{ readsImages: boolean | null }>(`${BASE}/models/reads-images`, { connectionId, model }),
  stop: (id: string) => api.post<{ stopped: boolean }>(`${BASE}/sessions/${id}/stop`, {}),
  answer: (id: string, cardId: string, value: unknown) => api.post<{ answered: true }>(`${BASE}/sessions/${id}/answers`, { cardId, value }),
  eventsSince: (id: string, after: number) => api.get<{ events: DesignerEvent[]; last: number; more: boolean }>(`${BASE}/sessions/${id}/events-since?after=${String(after)}`),
  versions: (id: string) => api.get<{ available: boolean; versions: DesignerVersion[] }>(`${BASE}/sessions/${id}/versions`),
  restore: (id: string, n: number, record: boolean) =>
    api.post<{ version: { n: number; name: string } | null; applied: boolean }>(`${BASE}/sessions/${id}/versions/${String(n)}/restore`, { record }),
  architecture: (id: string) => api.get<ArchitectureDoc>(`${BASE}/sessions/${id}/architecture`),
  /** The app's files a person may open and save by hand, in the groups the Code tab draws. */
  files: (id: string) => api.get<DesignerFiles>(`${BASE}/sessions/${id}/files`),
  /** A hand save: each file whole, with the hash it had when it was opened. All of them are written, or none. */
  searchFiles: (id: string, find: { query: string; matchCase: boolean; wholeWord: boolean }) =>
    api.get<DesignerFilesFound>(`${BASE}/sessions/${id}/files/search?q=${encodeURIComponent(find.query)}${find.matchCase ? '&case=1' : ''}${find.wholeWord ? '&word=1' : ''}`),
  saveFiles: (id: string, files: readonly { path: string; content: string; base: string }[]) => api.put<DesignerFilesSaved>(`${BASE}/sessions/${id}/files`, { files }),
  /** One of the app's files a person may open, whole, with the hash it has now. */
  fileContent: (id: string, path: string) => api.get<{ path: string; content: string; hash: string }>(`${BASE}/sessions/${id}/files/content?path=${encodeURIComponent(path)}`),
  /** The app's phone side: how it stands, the door a phone comes through, this computer's addresses. */
  phone: (id: string) => api.get<PhoneStatus>(`${BASE}/sessions/${id}/phone`),
  /** A person's yes: add the phone app (or get its packages), build it and apply the app. Answers at once; watch `phone`. */
  phoneAdd: (id: string) => api.post<PhoneStatus>(`${BASE}/sessions/${id}/phone/add`, {}),
  phoneOpen: (id: string, address: string) => api.post<PhoneStatus>(`${BASE}/sessions/${id}/phone/open`, { address }),
  phoneStop: (id: string) => api.post<PhoneStatus>(`${BASE}/sessions/${id}/phone/stop`, {}),
  previewTicket: (id: string, to: string) => api.post<{ url: string; origin: string; seenAs?: string[] }>(`${BASE}/sessions/${id}/preview-ticket`, { to }),
  /** A one-use link that signs this project's local owner in from the system's browser, landing on `to` (a path). */
  browserLink: (to: string) => api.post<{ data: { url: string } }>('/api/v1/auth/design-link', { to }),
  setOwnerPassword: (input: { email: string; password: string }) => api.post<{ email: string }>(`${BASE}/owner-password`, input),
  createSession: (input: { appKey?: string; name?: string; /** The session's title until the Designer names the app. */ title?: string; /** A style picked at the start. */ style?: string; target: DesignerTarget; connectionId: string; model: string; effort?: DesignerEffort; text?: string; /** With `text`: this page will show the preview and say what it sees. */ sees?: boolean }) =>
    api.post<{ session: DesignerSession; turn: number | null }>(`${BASE}/sessions`, input),
};

export const designerStateQuery = () => queryOptions({ queryKey: designerKeys.state, queryFn: designerApi.state });
export const figmaQuery = () => queryOptions({ queryKey: designerKeys.figma, queryFn: designerApi.figma, staleTime: 30_000, retry: false });
export const yourAppsQuery = () => queryOptions({ queryKey: designerKeys.apps, queryFn: designerApi.yourApps });
export const catalogQuery = () => queryOptions({ queryKey: designerKeys.catalog, queryFn: designerApi.catalog, staleTime: 5 * 60_000, retry: false });
export const modelsQuery = () => queryOptions({ queryKey: designerKeys.models, queryFn: designerApi.models, staleTime: 30_000 });
export const sessionQuery = (id: string) => queryOptions({ queryKey: designerKeys.session(id), queryFn: () => designerApi.session(id) });
export const versionsQuery = (id: string) => queryOptions({ queryKey: designerKeys.versions(id), queryFn: () => designerApi.versions(id) });
export const architectureQuery = (id: string) => queryOptions({ queryKey: designerKeys.architecture(id), queryFn: () => designerApi.architecture(id) });
