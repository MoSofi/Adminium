// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Team directory data layer over the `/api/v1/users` routes — the client half
 * of the v1 user-management blocker (a self-hosted Adminium could create
 * exactly one account and had no surface to create a second).
 *
 * THE INVITE LINK IS A ONE-TIME SECRET, structurally identical to the
 * plaintext key in `api-keys/apiKeysApi.ts`: `POST /users` mints an activation
 * token, returns it exactly once, and stores only its hash — nothing can
 * retrieve it again. So, exactly as there, it is deliberately NOT written into
 * the react-query cache: a cached secret is a secret that outlives its one
 * render and rides along with every devtools dump.
 *
 * AND THERE IS NO SECOND CHANNEL. This build has no mail transport at all —
 * no `apps/server/src/email/`, no `nodemailer`, no route that can write the
 * `email.smtp` setting, and `notifications/notify.ts` says so outright — which
 * is why every create/resend reply carries `emailSent: false` as a literal
 * rather than a flag. The link in that one reply is the ONLY way a teammate
 * ever reaches the activation screen; if it is lost the invite has to be
 * deleted and re-issued. `TeamPage` renders it in a copy banner for that
 * reason, and gates the "email it" affordance behind `emailSendGate` so the
 * absence is explained rather than mimed.
 *
 * SYNC NOTE: `UserDto` mirrors the Zod reply in
 * `apps/server/src/routes/users/schema.ts` (the copied-mirror convention from
 * `app/bootstrap.ts` — the dashboard does not import server types). Change
 * both together. `authUserView` in `routes/auth/schema.ts` is the same safe
 * projection plus `roleIds`; neither ever carries `passwordHash`,
 * `totpSecretEncrypted` or `recoveryCodes`.
 */
import { infiniteQueryOptions } from '@tanstack/react-query';
import type { Tone } from '@adminium/ui';

import { api } from '../app/api.js';

export type UserStatus = 'active' | 'invited' | 'suspended';

/**
 * `invited` is NOT settable through PATCH — it is the invite route's outcome,
 * and only activation leaves it (mirrors `userPatchBody`).
 */
export type UserStatusPatch = 'active' | 'suspended';

/** Enough of a role to render a chip without holding `system:roles:manage`. */
export interface UserRoleRef {
  id: string;
  slug: string;
  name: string;
}

/** Public projection of `adminium_users` — never hashes or secrets (07 §7.6). */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  totpEnabled: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  updatedAt: number;
  /**
   * Embedded, not ids: the list route joins them so the directory can render
   * role chips for a `system:users:manage` admin who cannot read `GET /roles`
   * at all. The role list is still fetched, but only for the pickers.
   */
  roles: UserRoleRef[];
}

export interface UsersListReply {
  users: UserDto[];
  /** Pass back as `cursor` for the next page; `null` on the last page. */
  nextCursor: string | null;
  /** Whole-directory tallies — NOT page-scoped, so they survive paging. */
  counts: { active: number; invited: number; suspended: number };
}

/**
 * The activation half of a create/resend reply.
 *
 * `activationPath` is a PATH, not a URL: the server cannot know the origin a
 * self-host is reached on (reverse proxy, LAN address, tunnel), so it declines
 * to guess and the client joins it to the origin the admin is actually looking
 * at — which is by construction one that works. See {@link activationLink}.
 */
export interface UserInvite {
  token: string;
  /** Epoch ms, like every other instant in the API. */
  expiresAt: number;
  /** `/reset/<token>` — the dashboard path that consumes it. */
  activationPath: string;
}

export interface UserCreateBody {
  email: string;
  name: string;
  /**
   * OMITTED, not `[]`, when nothing is picked: sending any role additionally
   * requires `system:roles:manage`, and an admin who holds only
   * `system:users:manage` must still be able to invite someone.
   */
  roleIds?: string[];
}

/**
 * Both `POST /users` and `POST /users/:id/invite/resend` answer with this —
 * the resend mints a FRESH token rather than re-reading the old one, because
 * only its hash was ever stored.
 */
export interface UserInviteReply {
  user: UserDto;
  invite: UserInvite;
  /** Always `false` in this build — there is no transport. See the header. */
  emailSent: false;
}

export interface UserPatch {
  name?: string;
  email?: string;
  status?: UserStatusPatch;
}

export interface UserDeleteReply {
  ok: true;
  permanent: boolean;
  /** The suspended row; `null` when the row was hard-deleted. */
  user: UserDto | null;
}

/** The directory's filter bar, as one value so it can key the query. */
export interface UserFilters {
  q: string;
  /** `''` = any status. */
  status: UserStatus | '';
  /** `''` = any role. */
  roleId: string;
}

export const EMPTY_USER_FILTERS: UserFilters = { q: '', status: '', roleId: '' };

export const TEAM_USERS_KEY = ['team', 'users'] as const;

// --- request building (pure — unit-tested without a DOM) ---------------------

/**
 * `/api/v1/users?…` for one page of the directory.
 *
 * Empty filters are OMITTED rather than sent blank: `?q=` is a filter for the
 * empty string as far as a route schema is concerned, and the difference
 * between "no filter" and "filter that matches nothing" is the difference
 * between a full directory and an empty one.
 */
export function buildUsersPath(filters: UserFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q !== '') params.set('q', q);
  if (filters.status !== '') params.set('status', filters.status);
  if (filters.roleId !== '') params.set('roleId', filters.roleId);
  if (cursor !== null && cursor !== '') params.set('cursor', cursor);
  const query = params.toString();
  return query === '' ? '/api/v1/users' : `/api/v1/users?${query}`;
}

/**
 * Origin + `activationPath` → the link the admin copies.
 *
 * Tolerant of both a leading slash and its absence, and of a trailing slash on
 * the origin, because a link that is silently wrong here is a teammate who
 * cannot sign in and an admin with no way to tell why.
 */
export function activationLink(origin: string, activationPath: string): string {
  const base = origin.replace(/\/+$/, '');
  const path = activationPath.startsWith('/') ? activationPath : `/${activationPath}`;
  return `${base}${path}`;
}

/** Status → pill tone. `invited` is not in the UI registry; the other two are. */
export function userStatusTone(status: UserStatus): Tone {
  switch (status) {
    case 'active':
      return 'pos';
    case 'invited':
      return 'warn';
    case 'suspended':
      return 'danger';
  }
}

/**
 * `DELETE /users/:id`, and the flag that decides which act it is.
 *
 * Without `permanent`, the route SUSPENDS: the user's prefs, sessions and
 * reset tokens all CASCADE from `adminium_users` and `adminium_settings.
 * updated_by` goes NULL, so a row delete quietly erases history the audit log
 * then cannot explain. The screen therefore spends the flag deliberately — see
 * the note on `TeamPage`'s remove flow.
 */
export function userDeletePath(id: string, permanent: boolean): string {
  return permanent ? `/api/v1/users/${id}?permanent=true` : `/api/v1/users/${id}`;
}

// --- instant formatting ------------------------------------------------------

/**
 * Intl formatters, memoized per BCP-47 tag.
 *
 * These live here because the dashboard has no shared date module and
 * `@adminium/widgets` does not re-export its own `formatStamp`/`formatSince`
 * from the package root (only the widget views are public). `audit/` and
 * `account/` import these rather than growing a third and fourth copy.
 */
const formatterCache = new Map<
  string,
  { dateTime: Intl.DateTimeFormat; relative: Intl.RelativeTimeFormat }
>();

function formatters(localeTag: string) {
  let cached = formatterCache.get(localeTag);
  if (cached === undefined) {
    cached = {
      dateTime: new Intl.DateTimeFormat(localeTag, { dateStyle: 'medium', timeStyle: 'short' }),
      relative: new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' }),
    };
    formatterCache.set(localeTag, cached);
  }
  return cached;
}

/** Absolute date + time. `null` in, `null` out — the caller renders the dash. */
export function formatStamp(epochMs: number | null, localeTag: string): string | null {
  if (epochMs === null || !Number.isFinite(epochMs)) return null;
  return formatters(localeTag).dateTime.format(new Date(epochMs));
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

/**
 * "3 hours ago" / "in 2 days" for last-seen and expiry stamps.
 *
 * Signed on purpose: an invite expiry is in the FUTURE and an invite that has
 * already lapsed is in the past, and the same readout has to tell those apart.
 * Anything under a minute falls through to `second`, which reads "now".
 */
export function formatSince(epochMs: number | null, localeTag: string, now: number): string | null {
  if (epochMs === null || !Number.isFinite(epochMs)) return null;
  const delta = epochMs - now;
  const { relative } = formatters(localeTag);
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(delta) >= ms) return relative.format(Math.round(delta / ms), unit);
  }
  return relative.format(Math.round(delta / 1000), 'second');
}

// --- queries + mutations -----------------------------------------------------

/**
 * One keyset-paginated directory, filters included in the key so a filter
 * change is a new list rather than an append onto the old one.
 */
export function usersQuery(filters: UserFilters) {
  return infiniteQueryOptions({
    queryKey: [...TEAM_USERS_KEY, filters] as const,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<UsersListReply>(buildUsersPath(filters, pageParam)),
    getNextPageParam: (last: UsersListReply) => last.nextCursor,
  });
}

export function createUser(body: UserCreateBody): Promise<UserInviteReply> {
  return api.post<UserInviteReply>('/api/v1/users', body);
}

export function resendInvite(id: string): Promise<UserInviteReply> {
  return api.post<UserInviteReply>(`/api/v1/users/${id}/invite/resend`);
}

/**
 * The rest of the write half. These DO return the updated `UserDto`, but the
 * callers ignore it and invalidate {@link TEAM_USERS_KEY} instead: a page of a
 * keyset list cannot be patched in place correctly (a status change can move a
 * row out of the current filter), and a half-applied optimistic edit on a
 * permissions screen is exactly the wrong thing to show.
 */
export function patchUser(id: string, patch: UserPatch): Promise<UserDto> {
  return api.patch<UserDto>(`/api/v1/users/${id}`, patch);
}

export function deleteUser(id: string, permanent: boolean): Promise<UserDeleteReply> {
  return api.delete<UserDeleteReply>(userDeletePath(id, permanent));
}

export function setUserRoles(id: string, roleIds: readonly string[]): Promise<UserDto> {
  return api.put<UserDto>(`/api/v1/users/${id}/roles`, { roleIds: [...roleIds] });
}
