// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading a frame from Figma: the import a person asks for in the dialog, and the parts the model
 * reads later with `read_figma`.
 *
 * A read Figma counts (Tier 1: a frame's nodes, a picture) is spent only when nothing kept can
 * answer. So an import first asks the file's version (a cheap call), and serves what the cache holds
 * for that version; each half it lacks is fetched and kept on arrival. One import of a frame runs at
 * a time for a person: a second caller (a double click, a second tab) waits for it and gets its
 * answer.
 *
 * Figma counts a personal token's reads per Figma user, so the count and the pause are kept by the
 * Figma account `/v1/me` names (by a fingerprint of the token until it has answered), never by the
 * Adminium person. After Figma says a seat's reads are used up, the model's reads stop until the date
 * it gave (at most 31 days), or, with no date, until the person's own import succeeds. The person's
 * own imports still try: they chose to.
 *
 * The picture is asked at about two megapixels (its long side at most 2,000 px): the model counts any
 * picture as the same 1,500 tokens, and a larger one only risks the 5 MB cap. A PNG still over 5 MB is
 * made smaller here, never by asking Figma again.
 */
import { PNG } from 'pngjs';

import { ATTACHMENT_MAX_IMAGE_BYTES } from '../attachments.js';
import { FigmaError, type FigmaClient, type FigmaNode, type FigmaNodes } from './client.js';
import type { FigmaCache, FigmaEntryKey } from './cache.js';
import { distil, findNode, OUTLINE_LONG_CHARS, OUTLINE_SHORT_CHARS } from './distil.js';
import type { FigmaLink } from './link.js';
import { FIGMA_PAUSE_MAX_MS, tokenPrint, type FigmaCredential, type FigmaTokens } from './tokens.js';

/** The long side of a rendered frame, at most. */
export const RENDER_LONG_SIDE = 2000;
/** The most of a render read from Figma's storage, before it is made to fit under 5 MB. */
export const RENDER_DOWNLOAD_MAX_BYTES = 24 * 1024 * 1024;

export interface FigmaImport {
  fileKey: string;
  nodeId: string;
  version: string;
  fileName: string;
  /** The frame's own name, as Figma has it (outside words: quote it where a model reads it). */
  frame: string;
  width: number;
  height: number;
  /** The design document, long and short. */
  outline: string;
  short: string;
  picture: Buffer;
  /** Reads Figma counted for this import: 0 when it came from what this server kept. */
  reads: number;
}

export interface FigmaPart {
  text: string;
  picture?: Buffer;
  reads: number;
}

export interface FigmaReader {
  /** Read a frame: what the dialog's Import does. `by: 'model'` stops at a pause; a person's import tries anyway. */
  importFrame(userId: string, link: FigmaLink, opts?: { by?: 'person' | 'model' }): Promise<FigmaImport>;
  /**
   * One part of a frame the person imported (`read_figma`): from the kept document when it holds it,
   * else from Figma. `allowance` is how many counted reads this call may spend; past it, it refuses.
   */
  readPart(userId: string, frame: { fileKey: string; nodeId: string; version: string }, node: string, opts: { picture: boolean; allowance: number; small: boolean }): Promise<FigmaPart>;
  /** Counted reads spent by a Figma account (or a token's fingerprint) since this server started. */
  readsBy(account: string): number;
  /** A person's kept copies, gone (they disconnected Figma). */
  forget(userId: string): void;
}

export interface FigmaReaderDeps {
  client: FigmaClient;
  cache: FigmaCache;
  tokens: FigmaTokens;
  now?: () => number;
}

/** Thrown by `readPart` when the call would spend more counted reads than it may. */
export class FigmaAllowanceError extends Error {
  override readonly name = 'FigmaAllowanceError';
}

export function createFigmaReader(deps: FigmaReaderDeps): FigmaReader {
  const now = deps.now ?? (() => Date.now());
  const { client, cache, tokens } = deps;
  /** Who each token is, once `/v1/me` said: by the token's fingerprint. */
  const accounts = new Map<string, { id: string; handle: string }>();
  const counted = new Map<string, number>();
  const running = new Map<string, Promise<FigmaImport>>();

  const credentialOf = async (userId: string): Promise<FigmaCredential> => {
    const credential = await tokens.figmaTokenOf(userId);
    if (credential === null) throw new FigmaError({ kind: 'not-connected' });
    return credential;
  };
  /** The Figma account a token is: asked once, then known. */
  const accountOf = async (credential: FigmaCredential): Promise<string> => {
    const print = tokenPrint(credential.token);
    const known = accounts.get(print);
    if (known !== undefined) return known.id;
    try {
      const who = await client.me(credential.token);
      accounts.set(print, who);
      return who.id;
    } catch (error) {
      // A token Figma refuses is a dead one, whatever call found it out.
      if (error instanceof FigmaError && (error.refusal.kind === 'no-access' || error.refusal.kind === 'token')) throw new FigmaError({ kind: 'token' });
      if (error instanceof FigmaError && error.refusal.kind === 'limit') return credential.figmaUserId ?? print;
      throw error;
    }
  };
  /** A counted read is about to be spent. */
  const spend = (account: string): void => {
    counted.set(account, (counted.get(account) ?? 0) + 1);
  };
  /** A refusal that pauses the account, kept with the token. */
  const pauseOn = async (error: unknown, account: string, userId: string): Promise<void> => {
    if (!(error instanceof FigmaError) || error.refusal.kind !== 'limit' || error.refusal.type !== 'low') return;
    const after = error.refusal.retryAfterSeconds;
    const dated = after !== null;
    await tokens.pause(account, { until: now() + Math.min(FIGMA_PAUSE_MAX_MS, (after ?? Number.MAX_SAFE_INTEGER / 1000) * 1000), dated }, userId);
  };
  const refusePaused = async (account: string): Promise<void> => {
    const pause = await tokens.pausedFor(account);
    if (pause !== null && pause.until > now()) throw new FigmaError({ kind: 'paused', until: pause.until, dated: pause.dated });
  };

  /** A rendered picture of a node, made to fit under 5 MB: asked at about 2 MP, scaled down here when it is still too large. */
  const renderOf = async (credential: FigmaCredential, account: string, fileKey: string, node: FigmaNode): Promise<Buffer> => {
    const box = node['absoluteBoundingBox'] as { width?: number; height?: number } | undefined;
    const long = Math.max(box?.width ?? 0, box?.height ?? 0);
    const scale = long <= 0 ? 1 : Math.max(0.01, Math.min(2, RENDER_LONG_SIDE / long));
    spend(account);
    const url = await client.render(credential.token, fileKey, node.id, scale);
    const png = await client.download(url, RENDER_DOWNLOAD_MAX_BYTES);
    return fitPicture(png);
  };

  const importFrame = async (userId: string, link: FigmaLink, by: 'person' | 'model'): Promise<FigmaImport> => {
    const credential = await credentialOf(userId);
    const account = await accountOf(credential);
    if (by === 'model') await refusePaused(account);
    try {
      const meta = await client.meta(credential.token, link.fileKey);
      let key: FigmaEntryKey = { userId, fileKey: link.fileKey, nodeId: link.nodeId, version: meta.version };
      let reads = 0;
      let nodes = cache.nodes(key);
      if (nodes === null) {
        spend(account);
        reads += 1;
        nodes = await client.nodes(credential.token, link.fileKey, [link.nodeId]);
        if (nodes.nodes[link.nodeId] === null || nodes.nodes[link.nodeId] === undefined) throw new FigmaError({ kind: 'no-frame' });
        // Kept for the version the nodes came with: the file may have moved since the version was asked.
        key = { ...key, version: nodes.version };
        cache.putNodes(key, nodes);
      }
      const answer = nodes.nodes[link.nodeId];
      if (answer === null || answer === undefined) throw new FigmaError({ kind: 'no-frame' });
      let picture = cache.render(key);
      if (picture === null) {
        reads += 1;
        picture = await renderOf(credential, account, link.fileKey, answer.document);
        cache.putRender(key, picture);
      }
      const file = { name: nodes.name !== '' ? nodes.name : meta.name, key: link.fileKey, version: key.version };
      const long = distil({ answer, file, maxChars: OUTLINE_LONG_CHARS });
      const short = distil({ answer, file, maxChars: OUTLINE_SHORT_CHARS });
      // The person's own import worked: whatever paused the Designer's reads is over.
      if (by === 'person') await tokens.unpause(account);
      return { fileKey: link.fileKey, nodeId: link.nodeId, version: key.version, fileName: file.name, frame: long.name, width: long.width, height: long.height, outline: long.text, short: short.text, picture, reads };
    } catch (error) {
      await pauseOn(error, account, userId);
      throw error;
    }
  };

  return {
    importFrame(userId, link, opts = {}) {
      const by = opts.by ?? 'person';
      const key = `${userId}\n${link.fileKey}\n${link.nodeId}`;
      const already = running.get(key);
      if (already !== undefined) return already;
      const work = importFrame(userId, link, by).finally(() => running.delete(key));
      running.set(key, work);
      return work;
    },
    async readPart(userId, frame, node, opts) {
      const credential = await credentialOf(userId);
      const account = await accountOf(credential);
      await refusePaused(account);
      const maxChars = opts.small ? OUTLINE_SHORT_CHARS : 12_000;
      let reads = 0;
      try {
        let kept: FigmaNodes | null = cache.nodes({ userId, ...frame });
        let found = kept === null ? null : findNode(kept.nodes[frame.nodeId]?.document as FigmaNode, node);
        if (found === null) {
          // Not in what was kept (a deploy forgot it): asked for that node alone.
          if (opts.allowance < 1 + (opts.picture ? 1 : 0)) throw new FigmaAllowanceError('reads');
          spend(account);
          reads += 1;
          kept = await client.nodes(credential.token, frame.fileKey, [node]);
          found = kept.nodes[node]?.document ?? null;
          if (found === null) throw new FigmaError({ kind: 'no-frame' });
        }
        const answer = kept?.nodes[frame.nodeId] ?? kept?.nodes[node] ?? null;
        const text = distil({ answer: { document: found, components: answer?.components ?? {}, componentSets: answer?.componentSets ?? {}, styles: answer?.styles ?? {} }, file: { name: kept?.name ?? '', key: frame.fileKey, version: kept?.version ?? frame.version }, maxChars }).text;
        if (!opts.picture) return { text, reads };
        const pictureKey = { userId, fileKey: frame.fileKey, nodeId: node, version: kept?.version ?? frame.version };
        let picture = cache.render(pictureKey);
        if (picture === null) {
          if (opts.allowance - reads < 1) throw new FigmaAllowanceError('reads');
          reads += 1;
          picture = await renderOf(credential, account, frame.fileKey, found);
          cache.putRender(pictureKey, picture);
        }
        return { text, picture, reads };
      } catch (error) {
        await pauseOn(error, account, userId);
        throw error;
      }
    },
    readsBy: (account) => counted.get(account) ?? 0,
    forget: (userId) => {
      cache.forget(userId);
    },
  };
}

/** A PNG made to fit under the picture cap: scaled down here, as many times as it takes, or refused. */
export function fitPicture(png: Buffer, maxBytes = ATTACHMENT_MAX_IMAGE_BYTES): Buffer {
  if (png.length <= maxBytes) return png;
  let image: PNG;
  try {
    image = PNG.sync.read(png);
  } catch {
    throw new FigmaError({ kind: 'render-failed' });
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const factor = Math.min(0.9, Math.sqrt(maxBytes / png.length) * 0.9 ** (attempt + 1));
    image = scaleDown(image, factor);
    const out = PNG.sync.write(image);
    if (out.length <= maxBytes) return out;
    png = out;
  }
  throw new FigmaError({ kind: 'too-large' });
}

/** A picture made smaller by `factor`, each new pixel the average of the ones it covers. */
function scaleDown(source: PNG, factor: number): PNG {
  const width = Math.max(1, Math.floor(source.width * factor));
  const height = Math.max(1, Math.floor(source.height * factor));
  const out = new PNG({ width, height });
  const stepX = source.width / width;
  const stepY = source.height / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * stepY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * stepY));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * stepX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * stepX));
      const sum = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const at = (sy * source.width + sx) * 4;
          for (let c = 0; c < 4; c += 1) (sum as number[])[c] = (sum[c] as number) + (source.data[at + c] as number);
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const to = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) out.data[to + c] = Math.round((sum[c] as number) / count);
    }
  }
  return out;
}
