// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Profile data layer for `/account`: `PATCH /api/v1/me`, which has existed in
 * `routes/me` since M2 with no screen behind it — the account page rendered
 * name and email as dead text.
 *
 * EMAIL IS A CREDENTIAL. The server refuses an email change that arrives
 * without the current password (`mePatchBody`'s refine), re-verifies it
 * against the hash, and rejects a collision with `UNIQUE_VIOLATION`. So the
 * password field here is not decoration and must not be sent speculatively:
 * `name`-only saves omit it, which is why the patch type keeps the three
 * fields independently optional rather than pairing them.
 *
 * SYNC NOTE: the reply shape mirrors `apps/server/src/routes/me/schema.ts`
 * (`meReply`), which wraps the §1.4 `{ data: … }` envelope around the same
 * `authUserView` the bootstrap payload carries — so a successful patch can
 * seed `['bootstrap']` instead of forcing a second round trip.
 */
import type { SessionUser } from '../app/bootstrap.js';

import { api } from '../app/api.js';

/** Absent = unchanged. `password` is required only when `email` changes. */
export interface MePatch {
  name?: string;
  email?: string;
  password?: string;
}

export async function patchMe(patch: MePatch): Promise<SessionUser> {
  return (await api.patch<{ data: { user: SessionUser } }>('/api/v1/me', patch)).data.user;
}
