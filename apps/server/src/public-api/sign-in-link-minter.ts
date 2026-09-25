// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sign-in link an app's own email carries (`{{signInLink}}` in an outbox
 * template): minted by the sender at the moment it sends, for the one person
 * the message is addressed to.
 *
 * It is the same link a person asks for — one use, twenty minutes, behind the
 * page's Continue, the token in the URL's fragment — with two differences the
 * owner ruled: it has no code (the email is about a document, not a sign-in),
 * and it neither counts toward the per-address caps nor takes any link back,
 * since the studio sends it, not a stranger.
 *
 * ── WHAT IS CHECKED HERE, WHOEVER ASKS ─────────────────────────────────────
 * The sender says which row and which address; neither is taken on trust. The
 * row is read through the app's own link identity (the key that signs its
 * people in, on that connection and table), and the address must still be the
 * row's — else no link, and the email goes without one. A place to land
 * (`to`) is kept only when it is one of the routes the app's customer side
 * declares, and it only ever names a path under the app: never a URL.
 */
import { createHash } from 'node:crypto';

import { manifestsRepo, publicChallengesRepo, publicKeysRepo, type DsnCrypto, type MetaDb } from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import type { SignInLinkMinter } from '../outbox/sign-in-link.js';
import { hashAddress } from './claim-code.js';
import type { PublicViews } from './runtime.js';
import {
  LINK_MAIL_PURPOSE,
  LINK_TTL_MS,
  linkIdentityOf,
  linkSubject,
  newLinkToken,
  personByKey,
  scopeOfKey,
  sealPointer,
} from './sign-in-link.js';

/** What the outbox sender hands over for one message (its own interface, `outbox/sign-in-link.ts`). */
export type SignInLinkMintInput = Parameters<SignInLinkMinter['mint']>[0];

export interface SignInLinkMinterDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  views: PublicViews;
  crypto: DsnCrypto;
  addressSecret: Buffer;
}

const normal = (value: unknown): string | null => (typeof value === 'string' ? value.trim().toLowerCase() : null);

/** One path segment of a place to land: nothing that could make it a URL or climb out of the app. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

/**
 * Whether `to` is one of the routes the app's customer side declares: a
 * route's `:name` segments stand for one segment of `to`, and everything else
 * must be the same. Undeclared, or shaped like anything but a path, is no.
 */
export function declaredRoute(routes: readonly string[], to: string): boolean {
  const segments = to.split('/').filter((part) => part !== '');
  if (segments.length === 0 || to.includes('//') || !segments.every((part) => SEGMENT.test(part))) return false;
  return routes.some((route) => {
    const pattern = route.split('/').filter((part) => part !== '');
    return pattern.length === segments.length && pattern.every((part, i) => (part.startsWith(':') && part.length > 1) || part === segments[i]);
  });
}

/** The routes an installed app's customer side declares. */
async function customerRoutes(meta: MetaDb, appKey: string): Promise<string[]> {
  // Only the manifest document is read: nothing here opens a stored credential.
  const refuse = () => {
    throw new Error('credentials are not read here');
  };
  const installed = await manifestsRepo(meta, { encrypt: refuse, decrypt: refuse }).findByKey(appKey);
  const frontends = (installed?.document as { frontends?: { side?: string; routes?: Record<string, string> }[] } | undefined)?.frontends ?? [];
  return frontends.filter((frontend) => frontend.side === 'customer').flatMap((frontend) => Object.values(frontend.routes ?? {}));
}

export function createSignInLinkMinter(deps: SignInLinkMinterDeps): SignInLinkMinter {
  return {
    async mint(input) {
      const view = await deps.views.viewFor(input.connectionId);
      if (view === null) return null;
      let tableId: string;
      try {
        tableId = view.table(input.table).id;
      } catch {
        return null;
      }
      // The app's own key that signs its people in by link, on this connection and table.
      const keys = (await publicKeysRepo(deps.meta).listManagedBy(input.appKey)).filter(
        (key) => key.revokedAt === null && (key.expiresAt === null || key.expiresAt > input.now),
      );
      for (const key of keys) {
        const keyed = await scopeOfKey(deps.meta, deps.views, key.id, input.now);
        const identity = keyed === null ? null : linkIdentityOf(keyed.scope);
        if (keyed === null || identity === null || keyed.connectionId !== input.connectionId) continue;
        let table;
        try {
          table = view.table(identity.resource.table);
        } catch {
          continue;
        }
        if (table.id !== tableId) continue;
        // The row by the column a session is pinned to: the key the sender names.
        const value = (input.pk as Readonly<Record<string, unknown>>)[identity.column];
        if (typeof value !== 'string' && typeof value !== 'number') return null;
        const { db, dialect } = await deps.manager.data(input.connectionId);
        const person = await personByKey({ db, view, table, identity, timezone: keyed.scope.timezone, dialect, value });
        const current = normal(person?.[identity.email]);
        // Still this person's address, as the sender said — or no link at all.
        if (person === null || current === null || current !== normal(input.email)) return null;

        const { token, hash } = newLinkToken();
        const destinationHash = hashAddress(deps.addressSecret, current);
        await publicChallengesRepo(deps.meta).create(
          {
            keyId: keyed.keyId,
            ref: identity.ref,
            destinationHash,
            // No code rides with a studio's link: nothing can be typed against it.
            codeHash: createHash('sha256').update(`no-code.${hash}`).digest('hex'),
            expiresAt: input.now + LINK_TTL_MS,
            sessionId: null,
            purpose: LINK_MAIL_PURPOSE,
            newDestinationEnc: sealPointer(deps.crypto, value),
            subject: linkSubject(destinationHash),
            tokenHash: hash,
          },
          input.now,
        );
        const to = input.to === undefined ? undefined : input.to.replace(/^\/+/, '');
        const lands = to !== undefined && declaredRoute(await customerRoutes(deps.meta, input.appKey), to);
        return `${input.base.replace(/\/+$/, '')}/c#${token}${lands ? `&to=${to}` : ''}`;
      }
      return null;
    },
  };
}
