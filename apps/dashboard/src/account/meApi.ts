// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Profile data layer for `/account`: `PATCH /api/v1/me`, which has existed in
 * `routes/me` since M2 with no screen behind it — the account page rendered
 * name and email as dead text.
 *
 * EMAIL IS A CREDENTIAL. The server refuses an email change that arrives
 * without the current password (`mePatchBody`'s refine), re-verifies it
 * against the hash, rejects a collision with `UNIQUE_VIOLATION`, and then
 * only mails a link to the new address: the account keeps its old one until
 * that link is opened (`confirmEmailChange`). So the
 * password field here is not decoration and must not be sent speculatively:
 * `name`-only saves omit it, which is why the patch type keeps the three
 * fields independently optional rather than pairing them.
 *
 * SYNC NOTE: the reply shape mirrors `apps/server/src/routes/me/schema.ts`
 * (`meReply`), which wraps the `{ data: … }` envelope around the same
 * `authUserView` the bootstrap payload carries — so a successful patch can
 * seed `['bootstrap']` instead of forcing a second round trip. `emailChange`
 * is there only when a link was just sent.
 */
import type { SessionUser } from '../app/bootstrap.js';

import { api } from '../app/api.js';

/** Absent = unchanged. `password` is required only when `email` changes. */
export interface MePatch {
  name?: string;
  email?: string;
  password?: string;
}

/** A new sign-in address waiting for its link to be opened; the account keeps its old one until then. */
export interface PendingEmailChange {
  pendingEmail: string;
  expiresAt: number;
}

export interface MeSaved {
  user: SessionUser;
  emailChange?: PendingEmailChange | undefined;
}

export async function patchMe(patch: MePatch): Promise<MeSaved> {
  return (await api.patch<{ data: MeSaved }>('/api/v1/me', patch)).data;
}

/** Opens the link mailed to the new address, as the account that asked for it. */
export async function confirmEmailChange(token: string): Promise<SessionUser> {
  return (await api.post<{ data: { user: SessionUser } }>('/api/v1/me/email/confirm', { token })).data.user;
}
