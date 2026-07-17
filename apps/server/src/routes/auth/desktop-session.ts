/**
 * `POST /api/v1/auth/desktop-session` — the desktop shell's boot-token
 * auto-login (11-electron.md §5).
 *
 * This is the only route in the product that hands out a super-admin session
 * without a password, so it is written as four independent gates, each of which
 * alone is sufficient to refuse:
 *
 *  1. EXISTENCE. `compose.ts` registers this factory only when
 *     `ADMINIUM_RUNTIME=desktop` AND a per-boot `ADMINIUM_BOOT_TOKEN` is set. A
 *     self-host or Docker instance does not have the route at all — the strongest
 *     form the gate can take, since an absent route cannot be misconfigured,
 *     bypassed, or reached by a bug in the three gates below.
 *  2. PEER. The socket's `remoteAddress` must be loopback (§2.4, "unconditionally").
 *     Not `request.ip` — see `auth/desktop-session.ts` for why that distinction is
 *     the difference between a check and a vulnerability.
 *  3. POLICY. `adminium_settings.desktop.singleUser` must be true — the mirror of
 *     `config.json`'s §2.3 `singleUser`, i.e. the user has not turned on "Require
 *     login on this device".
 *  4. TOKEN. Constant-time match against this boot's token, single-use.
 *
 * They run IN THAT ORDER, which is itself a decision: a non-loopback peer is
 * turned away before the process will so much as look at a token, and a disabled
 * device is turned away before that. Nothing that reaches the comparison can
 * learn anything from it that it did not already have.
 *
 * ─── The failure vocabulary ──────────────────────────────────────────────────
 *
 * Wrong token, replayed token, and a token from a previous boot are ONE answer:
 * 401 `INVALID_CREDENTIALS`, the same envelope `/auth/login` gives a bad
 * password. They are the same fact — "this is not a credential this server will
 * accept" — and telling them apart would answer questions worth asking (was this
 * token ever valid? has the real one been used yet?). §5's prose says a replay is
 * a 403; it is a 401 here because 403 means "authenticated, not allowed", and
 * nobody who fails this check is authenticated. The one thing that IS 403 is gate
 * 3: `DESKTOP_AUTOLOGIN_DISABLED` — a configuration answer, not a credential
 * answer, reachable only from loopback, and the SPA renders it as "go to login"
 * rather than "something went wrong".
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { settingsRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { AppError } from '../../errors.js';
import { auditAuth } from '../../auth/audit.js';
import { createBootTokenGuard, isLoopbackPeer } from '../../auth/desktop-session.js';
import { createSession, setSessionCookie } from '../../auth/sessions.js';
import { toUserView } from './handlers.js';
import { RATE_LIMIT_BUCKETS } from './index.js';
import { authDesktopSessionBody, authLoginReply, type AuthLoginReply } from './schema.js';

export interface DesktopSessionRoutesDeps {
  meta: MetaDb;
  /** This boot's `ADMINIUM_BOOT_TOKEN` (§2.2 step 4). Never persisted. */
  bootToken: string;
}

/** Uniform credential failure — identical for wrong, replayed, and stale. */
function invalidBootToken(): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', 'Invalid or already-used boot token.');
}

/**
 * The super admin this route signs in as (§5: "issues a normal session for the
 * super-admin user").
 *
 * THE OLDEST ACTIVE ONE, deterministically. A desktop install has exactly one
 * super admin — first run creates it and there is no second door — but "exactly
 * one" is an expectation about data, not a constraint the schema enforces, and
 * LAN share (§8.3) exists precisely so other people can get accounts. If a second
 * super admin ever appears, "whichever row the database felt like returning"
 * would make auto-login pick a different person on different boots. `createdAt`
 * ordering picks the one that first run created, every time, on every dialect.
 *
 * `status = 'active'` because a suspended or invited account is not a principal:
 * the session hook would refuse to resolve the session we just minted, and the
 * user would get a cookie that authenticates as nobody.
 */
async function findSuperAdmin(meta: MetaDb): Promise<User | null> {
  const row = await meta.db
    .selectFrom('adminium_users')
    .innerJoin('adminium_user_roles', 'adminium_user_roles.userId', 'adminium_users.id')
    .innerJoin('adminium_roles', 'adminium_roles.id', 'adminium_user_roles.roleId')
    .select('adminium_users.id')
    .where('adminium_roles.slug', '=', 'super-admin')
    .where('adminium_users.status', '=', 'active')
    .orderBy('adminium_users.createdAt', 'asc')
    .orderBy('adminium_users.id', 'asc')
    .executeTakeFirst();
  if (row === undefined) return null;
  return usersRepo(meta).findById(row.id);
}

export function desktopSessionRoutes(deps: DesktopSessionRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  // Per REGISTRATION, which is per boot: the utilityProcess is forked fresh with
  // a fresh token each launch (§2.2), so the guard's lifetime and the token's
  // lifetime are the same object's lifetime. Nothing to expire, nothing to clean.
  const guard = createBootTokenGuard(deps.bootToken);
  const settings = settingsRepo(meta);

  return async (app) => {
    app.post(
      '/auth/desktop-session',
      {
        preHandler: [app.requireMeta],
        // The same §6 bucket as `/auth/login` and `/setup/super-admin`, for the
        // same two reasons: it is unauthenticated and credential-facing, and it
        // is reachable from the LAN whenever §8.3 sharing is on. Guessing the
        // token is hopeless (32 random bytes, one shot), but an unlimited
        // rejected-request loop still costs CPU and — because gate 2 audits
        // every non-loopback attempt — writes an audit row per try. A limiter
        // caps both. It is a marker, not an implementation: the §6 plugin keys
        // its buckets off `config.rateLimitBucket` when it lands, and a route
        // that forgot to declare one would be the one door it never covers.
        config: { rateLimitBucket: RATE_LIMIT_BUCKETS.login },
        schema: { body: authDesktopSessionBody, response: { 200: authLoginReply } },
      },
      async (request, reply): Promise<AuthLoginReply> => {
        // GATE 2 — the peer. `request.raw.socket` is the real connection;
        // `request.ip` is what a header said. See the module header.
        if (!isLoopbackPeer(request.raw.socket)) {
          // Audited: a non-loopback hit on this route is either LAN share doing
          // its job or somebody probing, and both are worth a row. The token is
          // NOT in the entry — nothing here ever writes it anywhere.
          await auditAuth(meta, request, {
            action: 'desktop_session_rejected',
            actorId: null,
            actorLabel: 'desktop-boot-token',
          });
          throw new AppError(
            403,
            'FORBIDDEN',
            'Desktop auto-login is available only from this computer.',
          );
        }

        // GATE 3 — the policy. Read per request, not cached: the boot mirror is
        // not the only writer we ever want to allow, and a stale cache here fails
        // OPEN, which is the wrong direction for the one flag that says "this
        // machine may skip its login".
        if (!(await settings.get('desktop.singleUser'))) {
          throw new AppError(
            403,
            'DESKTOP_AUTOLOGIN_DISABLED',
            'This device requires a login. Sign in with your password.',
          );
        }

        // GATE 4 — the token. Verified and BURNED in one step, before the session
        // exists: a failure after this point costs the user a relaunch, whereas a
        // token that survived a failed attempt could be retried by whoever caused
        // the failure.
        const claim = guard.claim(request.body.bootToken);
        if (claim !== 'ok') {
          await auditAuth(meta, request, {
            action: 'desktop_session_failed',
            actorId: null,
            actorLabel: 'desktop-boot-token',
          });
          throw invalidBootToken();
        }

        const user = await findSuperAdmin(meta);
        if (user === null) {
          // No super admin yet ⇒ this is a first-run boot and the wizard, not
          // this route, is the way in (§6). Not a credential failure: the token
          // was right. 409 says "the instance is not in a state where this means
          // anything", which is what the SPA needs to hear to route to /setup.
          throw new AppError(
            409,
            'CONFLICT',
            'This instance has no super admin yet — complete first-run setup.',
          );
        }

        const now = Date.now();
        const userAgent = request.headers['user-agent'];
        const { token } = await createSession(
          meta,
          user.id,
          {
            ip: request.ip,
            userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
          },
          now,
        );
        await usersRepo(meta).recordLogin(user.id, now);
        setSessionCookie(reply, token, request);
        // The same `login` action `/auth/login` writes — this IS a login, and an
        // audit reader asking "when did this account sign in?" must not have to
        // know the desktop shell exists to get the right answer. The mechanism is
        // the distinguishable part, so it rides in `changes`.
        await auditAuth(meta, request, {
          action: 'login',
          actorId: user.id,
          actorLabel: user.name,
          changes: { after: { method: 'desktop-boot-token' } },
        });

        const fresh = (await usersRepo(meta).findById(user.id)) ?? user;
        return { data: { user: toUserView(fresh) } };
      },
    );
  };
}
