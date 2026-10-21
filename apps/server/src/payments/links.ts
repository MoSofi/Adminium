// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pay links and the pay address.
 *
 * ─── A LINK ────────────────────────────────────────────────────────────────
 *
 * 16 random bytes (22 characters), so a link cannot be guessed. Stored as its
 * SHA-256 (what a request is looked up by) and SEALED with this server's
 * secret (so staff can copy or print the same link again without a new one
 * being made). One current link per payable: a new one retires the last. A
 * link dies when it expires (30 days unless set otherwise), when it is
 * revoked, and when a newer one replaces it; a payable that is paid, voided
 * or gone answers with its own state on the page.
 *
 * A link that is unknown, revoked, replaced or expired reads the same to
 * whoever holds it, so the page is no oracle for which tokens once existed.
 *
 * ─── THE PAY ADDRESS ───────────────────────────────────────────────────────
 *
 * Where customers open links: saved explicitly in Studio (never captured,
 * never a request's Host), either this server's public address or one of
 * its customer domains. Every pay route asks `payReachable` first: the
 * same "can customers reach this server?" answer the setup card shows, about
 * the pay address. When it is false, links stop working.
 */
import { createHash, randomBytes } from 'node:crypto';

import { paymentLinksRepo, paymentSettingsRepo, type MetaDb, type PayableRef, type PaymentLink } from '@adminium/meta';
import { z } from 'zod';

import { decryptSecret, deriveKey, encryptSecret } from '../config/secrets.js';
import { normalizePublicOrigin } from '../security/public-origin.js';
import { reachability, type Reachability, type ReachabilityFacts } from './reachability.js';

/** How long a link works unless the shop says otherwise. */
export const LINK_LIFETIME_MS = 30 * 24 * 3_600_000;

/** The settings document that holds the pay address. */
export const PAY_ADDRESS_DOC = 'pay-address';

export const payAddressSchema = z.object({ origin: z.string().min(1).max(255) }).strict();

const LINK_SALT = 'adminium:payment-link';

export function linkTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** True for something shaped like a link token, before any lookup is made. */
export function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

export interface LinkSeal {
  seal(token: string): string;
  unseal(sealed: string): string;
}

export function linkSealFromSecret(secret: string): LinkSeal {
  const key = deriveKey(secret, LINK_SALT);
  return { seal: (token) => encryptSecret(token, key), unseal: (sealed) => decryptSecret(sealed, key) };
}

export interface MintedLink {
  link: PaymentLink;
  token: string;
  /** An older link was retired by this one. */
  replaced: boolean;
}

/** Makes a payable's new current link. */
export async function mintLink(
  meta: MetaDb,
  seal: LinkSeal,
  input: { payable: PayableRef; mode: 'test' | 'live'; createdBy: string | null; lifetimeMs?: number },
  at: number = Date.now(),
): Promise<MintedLink> {
  const token = randomBytes(16).toString('base64url');
  const { link, replaced } = await paymentLinksRepo(meta).mint(
    {
      tokenHash: linkTokenHash(token),
      tokenSealed: seal.seal(token),
      payable: input.payable,
      mode: input.mode,
      expiresAt: at + (input.lifetimeMs ?? LINK_LIFETIME_MS),
      createdBy: input.createdBy,
    },
    at,
  );
  return { link, token, replaced };
}

/** The link a token opens, or null for every way it cannot (the same null for all of them). */
export async function linkForToken(meta: MetaDb, token: string, at: number = Date.now()): Promise<PaymentLink | null> {
  if (!looksLikeToken(token)) return null;
  const link = await paymentLinksRepo(meta).byHash(linkTokenHash(token));
  if (link === null || !link.current || link.revokedAt !== null || link.expiresAt <= at) return null;
  return link;
}

/**
 * What a token opens, for the pay page: the link, or why not. An expired link
 * says so (its holder had it from the shop); unknown, revoked and replaced
 * answer alike, so the page tells nobody which tokens ever existed.
 */
export async function linkStateForToken(meta: MetaDb, token: string, at: number = Date.now()): Promise<{ state: 'open'; link: PaymentLink } | { state: 'expired' } | { state: 'test-ended' } | { state: 'unknown' }> {
  if (!looksLikeToken(token)) return { state: 'unknown' };
  const link = await paymentLinksRepo(meta).byHash(linkTokenHash(token));
  // A test link the shop's going live ended: its holder was staff, and may be told so.
  if (link !== null && link.revokedAt !== null && link.revokeReason === 'test-ended') return { state: 'test-ended' };
  if (link === null || !link.current || link.revokedAt !== null) return { state: 'unknown' };
  if (link.expiresAt <= at) return { state: 'expired' };
  return { state: 'open', link };
}

/** Whether a link still opens: current, not revoked, not expired. */
export function linkOpens(link: PaymentLink, at: number = Date.now()): boolean {
  return link.current && link.revokedAt === null && link.expiresAt > at;
}

/** The pay address, normalised, or null when none is saved. */
export async function payAddress(meta: MetaDb): Promise<string | null> {
  const saved = await paymentSettingsRepo(meta).get(PAY_ADDRESS_DOC, payAddressSchema);
  return saved === null ? null : normalizePublicOrigin(saved.origin);
}

/** "Can customers reach the pay page?", about the saved pay address. */
export async function payReachable(meta: MetaDb, facts: Omit<ReachabilityFacts, 'publicOrigin'>): Promise<Reachability> {
  return reachability({ ...facts, publicOrigin: await payAddress(meta) });
}

/** The URL a customer opens. */
export function payUrl(address: string, token: string): string {
  return `${address.replace(/\/$/, '')}/pay/${token}`;
}
