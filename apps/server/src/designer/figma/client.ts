// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Figma's REST API, as the Designer reads it.
 *
 * Every call goes to https://api.figma.com through the fetch that checks and pins the address it
 * calls; there is no setting that points it anywhere else. Tests reach a fake through that fetch's
 * own seams (`resolve` and `connect`), given by a test-only compose option. The token is sent only to
 * Figma's API, in `X-Figma-Token`, and never logged. The picture Figma renders comes back as an
 * address on its storage: it is fetched with no token, capped, and kept only when its bytes are a PNG.
 *
 * What can go wrong is one closed list (`FigmaRefusal`), so every caller says it in the same words.
 * A 403 from a file call is ambiguous (a dead token, or a file this account cannot open): `/v1/me`
 * tells the two apart.
 */
import { plainWords } from '../untrusted.js';
import { safeFetch, SafeFetchError, type SafeFetchOptions } from '../../net/safe-fetch.js';

export const FIGMA_API = 'https://api.figma.com';

/** Why Figma could not be read, as one closed list. */
export type FigmaRefusal =
  | { kind: 'network-off' }
  /** The token no longer works (expired, revoked, or never did). */
  | { kind: 'token' }
  /** The token works, and its account cannot open this file. */
  | { kind: 'no-access' }
  /** The file has no such frame (any more). */
  | { kind: 'no-frame' }
  /** Figma could not draw the frame. */
  | { kind: 'render-failed' }
  /** The frame renders larger than a picture may be, even made smaller here. */
  | { kind: 'too-large' }
  /** The frame's design document is larger than this server reads. */
  | { kind: 'document-too-large' }
  /** Figma's rate limit: `low` is a View or Collab seat's monthly reads; `high` asks to wait a little. */
  | { kind: 'limit'; type: 'low' | 'high'; retryAfterSeconds: number | null }
  /** Figma did not answer, or answered with an error of its own. */
  | { kind: 'unreachable' }
  /** The person has no Figma token here. */
  | { kind: 'not-connected' }
  /** The Designer's own reads stop for this Figma account until then (Figma said its seat's reads are used up). */
  | { kind: 'paused'; until: number; dated: boolean };

export class FigmaError extends Error {
  override readonly name = 'FigmaError';
  constructor(readonly refusal: FigmaRefusal) {
    super(figmaWords(refusal));
  }
}

/** The sentence for a refusal, in English (the dashboard says it in the person's language, by its kind). */
export function figmaWords(refusal: FigmaRefusal, now = Date.now()): string {
  switch (refusal.kind) {
    case 'network-off':
      return 'Figma is off on this server: network features are turned off.';
    case 'token':
      return 'Your Figma token no longer works. Paste a new one.';
    case 'no-access':
      return 'Your Figma account cannot open this file. Ask its owner to share it with you.';
    case 'no-frame':
      return 'That frame is not in the file any more.';
    case 'render-failed':
      return 'Figma could not draw this frame. Try again, or pick another frame.';
    case 'too-large':
      return 'Pick a smaller frame: this one renders over 5 MB.';
    case 'document-too-large':
      return 'This frame holds more than can be read at once. Pick a smaller frame.';
    case 'limit':
      if (refusal.type === 'high') return `Figma asked us to wait. Try again in ${String(Math.max(1, Math.ceil((refusal.retryAfterSeconds ?? 60) / 60)))} minutes.`;
      return refusal.retryAfterSeconds === null
        ? "Figma's limit for your seat is used up for now. You can read again next month."
        : `Figma's limit for your seat is used up for now. You can read again on ${new Date(now + refusal.retryAfterSeconds * 1000).toISOString().slice(0, 10)}.`;
    case 'unreachable':
      return 'Figma did not answer. Try again in a moment.';
    case 'not-connected':
      return 'Connect Figma first: in the Designer, Attach, then From Figma….';
    case 'paused':
      return refusal.dated
        ? `Figma reads are paused for you until ${new Date(refusal.until).toISOString().slice(0, 10)}. The Designer works from the design document you imported.`
        : 'Figma reads are paused for you: Figma did not say until when. The Designer works from the design document you imported. Try an import again later.';
  }
}

/** A node of Figma's document tree: only what the Designer reads is typed; the rest is kept as it came. */
export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  [field: string]: unknown;
}

export interface FigmaNodeAnswer {
  document: FigmaNode;
  components?: Record<string, { key?: string; name?: string; description?: string; componentSetId?: string }>;
  componentSets?: Record<string, { key?: string; name?: string; description?: string }>;
  styles?: Record<string, { key?: string; name?: string; styleType?: string; description?: string }>;
}

export interface FigmaNodes {
  /** The file's name. */
  name: string;
  version: string;
  lastModified: string;
  /** Each node asked for; null where the file has no such node. */
  nodes: Record<string, FigmaNodeAnswer | null>;
}

export interface FigmaClient {
  /** Who the token belongs to (`GET /v1/me`). */
  me(token: string): Promise<{ id: string; handle: string }>;
  /** The file's version, without reading the file (`GET /v1/files/:key/meta`, a cheap call). */
  meta(token: string, fileKey: string): Promise<{ name: string; version: string; lastModified: string }>;
  /** Nodes of the file with their subtrees (`GET /v1/files/:key/nodes`, a read Figma counts). */
  nodes(token: string, fileKey: string, ids: readonly string[], opts?: { depth?: number }): Promise<FigmaNodes>;
  /** The address of a PNG of one node (`GET /v1/images/:key`, a read Figma counts). */
  render(token: string, fileKey: string, nodeId: string, scale: number): Promise<string>;
  /** The rendered picture's bytes, from Figma's storage, with no token: a PNG of at most `maxBytes`. */
  download(url: string, maxBytes: number): Promise<Buffer>;
}

export interface FigmaClientDeps {
  /** Whether this server may call outside itself (`ADMINIUM_NETWORK_FEATURES`). */
  allowed(): boolean;
  /** Test seams only: how a name resolves and a connection is made. Never set by a setting. */
  seams?: Pick<SafeFetchOptions, 'resolve' | 'connect'>;
  timeoutMs?: number;
}

/** The most of a design document read: a whole screen's JSON is often 1–5 MB. */
export const FIGMA_NODES_MAX_BYTES = 40 * 1024 * 1024;
const SMALL_MAX_BYTES = 256 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const object = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const string = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function createFigmaClient(deps: FigmaClientDeps): FigmaClient {
  const seams = deps.seams ?? {};
  const timeoutMs = deps.timeoutMs ?? 30_000;

  /** A GET to Figma's API with the token; its JSON, or the refusal its error means. */
  const call = async (token: string, path: string, maxBytes: number): Promise<Record<string, unknown>> => {
    if (!deps.allowed()) throw new FigmaError({ kind: 'network-off' });
    let body: Buffer;
    try {
      body = (await safeFetch(`${FIGMA_API}${path}`, { maxBytes, timeoutMs, maxRedirects: 0, headers: { 'x-figma-token': token, accept: 'application/json' }, ...seams })).body;
    } catch (error) {
      throw new FigmaError(refusalOf(error, maxBytes));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      throw new FigmaError({ kind: 'unreachable' });
    }
    const found = object(parsed);
    if (found === null) throw new FigmaError({ kind: 'unreachable' });
    return found;
  };

  const me: FigmaClient['me'] = async (token) => {
    const answer = await call(token, '/v1/me', SMALL_MAX_BYTES);
    const id = string(answer['id']);
    if (id === null || id === '') throw new FigmaError({ kind: 'unreachable' });
    // The handle is shown back to the person: one plain line, cut to 120 characters.
    const handle = plainWords(string(answer['handle']) ?? string(answer['email']) ?? 'Figma', 120) || 'Figma';
    return { id: id.slice(0, 200), handle };
  };

  /** A file call: a 403 is told apart by asking who the token is. */
  const fileCall = async (token: string, path: string, maxBytes: number): Promise<Record<string, unknown>> => {
    try {
      return await call(token, path, maxBytes);
    } catch (error) {
      if (!(error instanceof FigmaError) || error.refusal.kind !== 'no-access') throw error;
      try {
        await me(token);
      } catch (whoError) {
        if (whoError instanceof FigmaError && (whoError.refusal.kind === 'no-access' || whoError.refusal.kind === 'token')) throw new FigmaError({ kind: 'token' });
        throw whoError;
      }
      throw error;
    }
  };

  return {
    me,
    async meta(token, fileKey) {
      const answer = await fileCall(token, `/v1/files/${encodeURIComponent(fileKey)}/meta`, SMALL_MAX_BYTES);
      const file = object(answer['file']) ?? answer;
      const version = string(file['version']);
      if (version === null || version === '') throw new FigmaError({ kind: 'unreachable' });
      return { name: plainWords(string(file['name']) ?? '', 200), version: version.slice(0, 64), lastModified: string(file['last_touched_at']) ?? string(file['lastModified']) ?? '' };
    },
    async nodes(token, fileKey, ids, opts = {}) {
      const query = `ids=${ids.map((id) => encodeURIComponent(id)).join(',')}${opts.depth === undefined ? '' : `&depth=${String(Math.max(1, Math.floor(opts.depth)))}`}`;
      const answer = await fileCall(token, `/v1/files/${encodeURIComponent(fileKey)}/nodes?${query}`, FIGMA_NODES_MAX_BYTES);
      const nodes = object(answer['nodes']);
      const version = string(answer['version']);
      if (nodes === null || version === null) throw new FigmaError({ kind: 'unreachable' });
      const out: Record<string, FigmaNodeAnswer | null> = {};
      for (const id of ids) {
        const entry = object(nodes[id]);
        const document = object(entry?.['document']);
        out[id] = entry === null || document === null || typeof document['id'] !== 'string' ? null : (entry as unknown as FigmaNodeAnswer);
      }
      return { name: plainWords(string(answer['name']) ?? '', 200), version: version.slice(0, 64), lastModified: string(answer['lastModified']) ?? '', nodes: out };
    },
    async render(token, fileKey, nodeId, scale) {
      const fixed = Math.min(4, Math.max(0.01, Math.round(scale * 1000) / 1000));
      const answer = await fileCall(token, `/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${String(fixed)}`, SMALL_MAX_BYTES);
      const images = object(answer['images']);
      const url = images === null ? null : string(images[nodeId]);
      if (url === null || !/^https:\/\/[^\s"'<>]{1,2000}$/.test(url)) throw new FigmaError({ kind: 'render-failed' });
      return url;
    },
    async download(url, maxBytes) {
      if (!deps.allowed()) throw new FigmaError({ kind: 'network-off' });
      let body: Buffer;
      try {
        // No token, no header of Figma's: the storage address carries its own signature.
        body = (await safeFetch(url, { maxBytes, timeoutMs, ...seams })).body;
      } catch (error) {
        if (error instanceof SafeFetchError && error.reason === 'too-large') throw new FigmaError({ kind: 'too-large' });
        throw new FigmaError({ kind: 'render-failed' });
      }
      if (body.length < PNG.length || !body.subarray(0, PNG.length).equals(PNG)) throw new FigmaError({ kind: 'render-failed' });
      return body;
    },
  };
}

/** What a failed fetch to Figma's API means. */
function refusalOf(error: unknown, maxBytes: number): FigmaRefusal {
  if (!(error instanceof SafeFetchError)) return { kind: 'unreachable' };
  if (error.reason === 'too-large') return maxBytes === FIGMA_NODES_MAX_BYTES ? { kind: 'document-too-large' } : { kind: 'unreachable' };
  if (error.reason !== 'status') return { kind: 'unreachable' };
  const status = error.status ?? 0;
  if (status === 429) {
    const header = error.headers?.['x-figma-rate-limit-type']?.trim().toLowerCase();
    const after = Number.parseInt(error.headers?.['retry-after'] ?? '', 10);
    // With no type said, the limit is taken as the seat's own: reads stop rather than spend into it again.
    return { kind: 'limit', type: header === 'high' ? 'high' : 'low', retryAfterSeconds: Number.isFinite(after) && after >= 0 ? after : null };
  }
  if (status === 401) return { kind: 'token' };
  if (status === 403 || status === 404) return { kind: 'no-access' };
  return { kind: 'unreachable' };
}
