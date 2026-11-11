// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one-time setup token's stored half: a salt and a hash, never the token.
 *
 * A fresh server instance answers `POST /setup/super-admin` to whoever reaches
 * it first, and on a one-click host there is a window between the deploy
 * finishing and the owner opening the URL. The server mints a token at boot and
 * prints it in its log (`apps/server/src/setup/token.ts`); this module keeps
 * the proof of it in `system.setupToken` and answers "does this candidate
 * match?". `createFirstSuperAdmin` checks it and deletes the row inside the
 * same transaction that claims the first account, so a token can open exactly
 * one account and a wrong one claims nothing.
 *
 * The token is high-entropy (80 random-looking bits, or an operator's own
 * value of at least 16 characters), so one salted SHA-256 is enough: there is
 * nothing for a slow hash to protect against that a guess rate limit does not.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { MetaDb } from './connect.js';
import { settingsRepo } from './repos/settings.js';

/** The settings key. Its row exists only while setup is open AND the gate is on. */
export const SETUP_TOKEN_KEY = 'system.setupToken';

export interface StoredSetupToken {
  /** Hex. Also what the server derives the printed token from. */
  salt: string;
  /** Hex SHA-256 of `salt:normalized token`. */
  hash: string;
}

/** A wrong or missing token while the gate is on. Nothing was claimed. */
export class SetupTokenError extends Error {
  override name = 'SetupTokenError';
  constructor() {
    super('The setup token is missing or wrong.');
  }
}

/**
 * The spelling the hash is taken over: case, spaces and dashes do not matter,
 * so `k7qd 9mxr…` typed from a phone matches `K7QD-9MXR-…` from the log. The
 * printed alphabet (Crockford base32) has no I, L or O, so those read as the
 * digits a person most likely meant.
 */
export function normalizeSetupToken(token: string): string {
  return token.replace(/[\s-]+/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function newSetupTokenSalt(): string {
  return randomBytes(16).toString('hex');
}

export function hashSetupToken(salt: string, token: string): string {
  return createHash('sha256').update(`${salt}:${normalizeSetupToken(token)}`).digest('hex');
}

/** Constant-time: the comparison is over two equal-length hex digests. */
export function setupTokenMatches(stored: StoredSetupToken, candidate: string | undefined): boolean {
  if (candidate === undefined || normalizeSetupToken(candidate) === '') return false;
  const want = Buffer.from(stored.hash, 'hex');
  const got = Buffer.from(hashSetupToken(stored.salt, candidate), 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function readSetupToken(meta: MetaDb): Promise<StoredSetupToken | null> {
  return settingsRepo(meta).get(SETUP_TOKEN_KEY);
}

export async function writeSetupToken(meta: MetaDb, stored: StoredSetupToken, at: number = Date.now()): Promise<void> {
  await settingsRepo(meta).set(SETUP_TOKEN_KEY, stored, { at });
}

/** Turn the gate off. True when there was a row to remove. */
export async function clearSetupToken(meta: MetaDb): Promise<boolean> {
  return settingsRepo(meta).unset(SETUP_TOKEN_KEY);
}

/**
 * How a caller of `createFirstSuperAdmin` answers the gate.
 *
 * `setupToken`: what a person typed into the wizard. `local: true`: an
 * in-process caller that already holds this machine's files (the CLI's own
 * wizards), which the gate exists to tell apart from a stranger on the network.
 * Passing neither while a row exists is a refusal: the gate fails closed.
 */
export interface SetupTokenProof {
  setupToken?: string | undefined;
  local?: boolean | undefined;
}

/**
 * Inside the claiming transaction: check the candidate, then consume the row.
 * Throws {@link SetupTokenError} before anything is written when it does not match.
 */
export async function consumeSetupToken(trxMeta: MetaDb, proof: SetupTokenProof): Promise<void> {
  const stored = await readSetupToken(trxMeta);
  if (stored === null) return;
  if (proof.local !== true && !setupTokenMatches(stored, proof.setupToken)) throw new SetupTokenError();
  await clearSetupToken(trxMeta);
}
