// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's own Figma token: kept encrypted on their own row, read only where a Figma request is
 * made, and never anywhere else.
 *
 * - One token per person (plan 69, ruled O1): a shared token would let anyone import whatever its
 *   owner can open. Each person's imports and the Designer's reads in their turns use theirs.
 * - Encrypted with the server's AES-GCM helper under a key of its own purpose, never the two-factor
 *   key. The column is not on `User`, so it is never on a request's user; `figmaTokenOf` is the one
 *   reader.
 * - `ADMINIUM_FIGMA_TOKEN` stands in for the token of the project's owner, and only theirs, under
 *   `adminium design` (which listens on this machine only, so never on a project shared on the
 *   network). It is read from the process's environment, never from the project's `.env`.
 * - The pause after Figma said a seat's reads are used up is kept by the Figma account the token
 *   belongs to, with the token: Figma counts a personal token's reads per Figma user.
 */
import { createHash } from 'node:crypto';

import { figmaTokensRepo, type FigmaPause, type MetaDb } from '@adminium/meta';

import { decryptSecret, deriveKey, encryptSecret } from '../../config/secrets.js';

/** The purpose a token's key is derived for: its own, so no other secret's key opens it. */
export const FIGMA_TOKEN_SALT = 'adminium:figma-token:v1';
/** The longest a pause is kept: a month, as Figma's monthly reads come back. */
export const FIGMA_PAUSE_MAX_MS = 31 * 24 * 60 * 60 * 1000;

export interface FigmaStatus {
  connected: boolean;
  /** `mine`: the person's own, kept here; `environment`: the project's `ADMINIUM_FIGMA_TOKEN`. */
  source: 'mine' | 'environment' | null;
  handle: string | null;
}

export interface FigmaCredential {
  token: string;
  source: 'mine' | 'environment';
  /** The Figma account the token is, when known (`/v1/me` named it). */
  figmaUserId: string | null;
}

export interface FigmaTokens {
  /** What the person's dialog and Security card show: never the token. */
  status(userId: string): Promise<FigmaStatus>;
  /** The token a Figma request made for this person uses, or null when they have none. */
  figmaTokenOf(userId: string): Promise<FigmaCredential | null>;
  save(userId: string, token: string, who: { id: string; handle: string }): Promise<boolean>;
  /** Take the person's token off this server. False when they had none. */
  remove(userId: string): Promise<boolean>;
  pausedFor(figmaUserId: string): Promise<FigmaPause | null>;
  pause(figmaUserId: string, pause: FigmaPause, viaUserId: string | null): Promise<void>;
  unpause(figmaUserId: string): Promise<void>;
}

export interface FigmaTokensDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  /**
   * The project's own token: `ADMINIUM_FIGMA_TOKEN` from the process's environment, given only under
   * `adminium design`; with the one person it stands for (the project's owner).
   */
  environment?: { token: string; ownerId(): Promise<string | null> } | undefined;
}

/** A token's fingerprint: what a count is kept by before Figma has said whose it is. Never the token. */
export const tokenPrint = (token: string): string => `t:${createHash('sha256').update(token).digest('hex').slice(0, 16)}`;

export function createFigmaTokens(deps: FigmaTokensDeps): FigmaTokens {
  const key = deriveKey(deps.secret, FIGMA_TOKEN_SALT);
  const repo = figmaTokensRepo(deps.meta);
  const environmentFor = async (userId: string): Promise<string | null> => {
    if (deps.environment === undefined || deps.environment.token.trim() === '') return null;
    return (await deps.environment.ownerId()) === userId ? deps.environment.token.trim() : null;
  };
  const mine = async (userId: string): Promise<{ token: string; handle: string | null; figmaUserId: string | null } | null> => {
    const row = await repo.read(userId);
    if (row === null || row.encrypted === null) return null;
    try {
      return { token: decryptSecret(row.encrypted, key), handle: row.handle, figmaUserId: row.figmaUserId };
    } catch {
      // Kept under another ADMINIUM_SECRET: it cannot be read, and is as good as none.
      return null;
    }
  };
  return {
    async status(userId) {
      if ((await environmentFor(userId)) !== null) return { connected: true, source: 'environment', handle: null };
      const row = await repo.read(userId);
      return row === null || row.encrypted === null ? { connected: false, source: null, handle: null } : { connected: true, source: 'mine', handle: row.handle };
    },
    async figmaTokenOf(userId) {
      const fromEnvironment = await environmentFor(userId);
      if (fromEnvironment !== null) return { token: fromEnvironment, source: 'environment', figmaUserId: null };
      const own = await mine(userId);
      return own === null ? null : { token: own.token, source: 'mine', figmaUserId: own.figmaUserId };
    },
    save: (userId, token, who) => repo.save(userId, { encrypted: encryptSecret(token, key), handle: who.handle, figmaUserId: who.id }),
    remove: (userId) => repo.clear(userId),
    pausedFor: (figmaUserId) => repo.pausedFor(figmaUserId),
    pause: (figmaUserId, pause, viaUserId) => repo.pause(figmaUserId, pause, viaUserId),
    unpause: (figmaUserId) => repo.unpause(figmaUserId),
  };
}
