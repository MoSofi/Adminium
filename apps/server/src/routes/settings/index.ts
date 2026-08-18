// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Global-defaults settings routes (10-i18n-theming.md §7.2/§7.3, M8-T04):
 *
 *   GET /api/v1/settings/defaults — the four workspace default axes plus
 *     per-axis adoption counts (`following` = users with a NULL override,
 *     i.e. users who will see a change to that default immediately).
 *   PUT /api/v1/settings/defaults — full-object write. Audit-logged
 *     (category `settings`) and broadcast as `settings.defaults.updated` on
 *     the `config-changed` realtime channel so signed-in users following
 *     defaults re-resolve live without a reload.
 *
 * Both guarded by `system:settings:manage` (Super Admin built-in role).
 * Factory plugin registered by composition, like the sibling resources —
 * see apps/server/scripts/demo-v01.mjs.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { settingsRepo, type MetaDb, type SettingValue } from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import { BRANDING_UPDATED, readBranding } from '../../branding/service.js';
import { encryptSecret } from '../../config/secrets.js';
import { assertSmtpHostAllowed, emailSecretKey } from '../../email/config.js';
import { ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  settingsBrandingPutBody,
  settingsDefaultsPutBody,
  settingsDefaultsReply,
  settingsEmailPutBody,
  settingsEmailReply,
  settingsSecurityPutBody,
  settingsSecurityReply,
  settingsTelemetryPutBody,
  settingsTelemetryReply,
  settingsWorkspaceReply,
  type SettingsDefaultsReply,
  type SettingsEmailPutBody,
  type SettingsEmailReply,
  type SettingsEmailView,
  type SettingsSecurityReply,
  type SettingsTelemetryReply,
  type SettingsWorkspaceReply,
} from './schema.js';

/** Realtime event type carried on the `config-changed` channel (§7.2). */
export const SETTINGS_DEFAULTS_UPDATED = 'settings.defaults.updated';

export interface SettingsRoutesDeps {
  meta: MetaDb;
  /**
   * Purpose-scoped key that encrypts `email.smtp.passEncrypted`
   * (`email/config.ts`). OPTIONAL, and derived from `ADMINIUM_SECRET` when it
   * is absent: composition already derives one for the email job handler, and
   * passing it in keeps a single derivation per process — but the settings
   * routes are also registered by harnesses that know nothing about mail, and
   * a required parameter there would only ever be filled with the same
   * derivation this module can do for itself.
   */
  emailKey?: Uint8Array;
}

/** The stored shape of the `email.smtp` registry key (07-meta-store.md §7.1). */
type StoredSmtp = SettingValue<'email.smtp'>;

const AXES = ['theme', 'accent', 'density', 'locale'] as const;
type Axis = (typeof AXES)[number];

/** Settings-registry key per preference axis (07-meta-store.md §7.1). */
const SETTING_KEY: Record<Axis, 'appearance.theme' | 'appearance.accent' | 'appearance.density' | 'locale.default'> = {
  theme: 'appearance.theme',
  accent: 'appearance.accent',
  density: 'appearance.density',
  locale: 'locale.default',
};

/** True when two `email.smtp` values are the same row — a no-op PUT writes nothing. */
function sameSmtp(a: StoredSmtp, b: StoredSmtp): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.user === b.user &&
    a.passEncrypted === b.passEncrypted &&
    a.from === b.from &&
    a.secure === b.secure
  );
}

/** The password-free projection used by both the reply and the audit row. */
function viewOf(stored: StoredSmtp): SettingsEmailView {
  if (stored === null) {
    return { configured: false, host: null, port: null, user: null, from: null, secure: null };
  }
  return {
    configured: true,
    host: stored.host,
    port: stored.port,
    user: stored.user,
    from: stored.from,
    secure: stored.secure,
  };
}

export function settingsRoutes(deps: SettingsRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const settings = settingsRepo(meta);

  /**
   * Derived at most once, and only if an SMTP password is actually written —
   * `deriveKey` throws on an empty secret, and a harness that never touches
   * this section should not have to supply one.
   */
  let cachedEmailKey: Uint8Array | null = deps.emailKey ?? null;
  function emailKey(): Uint8Array {
    if (cachedEmailKey === null) {
      // Same source `loadEnv()` reads, and validated there at boot to be at
      // least 16 characters — this is a fallback for a caller that did not
      // pass one, not a second configuration channel.
      const secret = process.env.ADMINIUM_SECRET ?? '';
      if (secret.length === 0) {
        throw new Error('ADMINIUM_SECRET is not set — the SMTP password cannot be encrypted.');
      }
      cachedEmailKey = emailSecretKey(secret);
    }
    return cachedEmailKey;
  }

  /**
   * Merges a PUT body onto what is stored. Two rules live here:
   *
   *  - an ABSENT `pass` keeps the stored one, so editing the port or the From
   *    does not make the admin retype a password (schema.ts argues why that
   *    matters); an empty-string `pass` clears it, for a relay that wants none;
   *  - a username with no password is refused. An anonymous relay is legitimate
   *    (`user: ''`), and so is an authenticated one, but a half-filled pair is
   *    a mistake that surfaces later as an opaque AUTH failure on a job.
   */
  function buildSmtpValue(
    next: NonNullable<SettingsEmailPutBody['smtp']>,
    stored: StoredSmtp,
  ): StoredSmtp {
    assertSmtpHostAllowed(next.host);
    const passEncrypted =
      next.pass === undefined
        ? (stored?.passEncrypted ?? '')
        : next.pass.length === 0
          ? ''
          : encryptSecret(next.pass, emailKey());
    if (next.user.length > 0 && passEncrypted.length === 0) {
      throw new ValidationFailedError('An SMTP username needs a password.', { field: 'pass' });
    }
    return {
      host: next.host,
      port: next.port,
      user: next.user,
      passEncrypted,
      from: next.from,
      secure: next.secure,
    };
  }

  async function emailReply(): Promise<SettingsEmailReply> {
    return { data: viewOf(await settings.get('email.smtp')) };
  }

  async function readDefaults(): Promise<{
    theme: SettingsDefaultsReply['data']['theme'];
    accent: SettingsDefaultsReply['data']['accent'];
    density: SettingsDefaultsReply['data']['density'];
    locale: SettingsDefaultsReply['data']['locale'];
  }> {
    const [theme, accent, density, locale] = await Promise.all([
      settings.get('appearance.theme'),
      settings.get('appearance.accent'),
      settings.get('appearance.density'),
      settings.get('locale.default'),
    ]);
    return { theme, accent, density, locale };
  }

  /** `following` = totalUsers − users holding a non-NULL override for the axis. */
  async function readAdoption(): Promise<SettingsDefaultsReply['data']['adoption']> {
    const totalRow = await meta.db
      .selectFrom('adminium_users')
      .select((eb) => eb.fn.countAll().as('total'))
      .executeTakeFirst();
    const totalUsers = Number(totalRow?.total ?? 0);

    const prefRows = await meta.db
      .selectFrom('adminium_user_prefs')
      .select(['theme', 'accent', 'density', 'locale'])
      .execute();

    const following = { theme: totalUsers, accent: totalUsers, density: totalUsers, locale: totalUsers };
    for (const row of prefRows) {
      for (const axis of AXES) {
        if (row[axis] !== null) following[axis] -= 1;
      }
    }
    return { totalUsers, following };
  }

  async function reply(): Promise<SettingsDefaultsReply> {
    const [defaults, adoption] = await Promise.all([readDefaults(), readAdoption()]);
    return { data: { ...defaults, adoption } };
  }

  /** Registry-backed workspace identity view (M5-T05), logo included. */
  async function workspaceReply(): Promise<SettingsWorkspaceReply> {
    return { data: { branding: await readBranding(meta) } };
  }

  /** The enforced `auth.*` policy (see schema.ts for what reads each key). */
  async function securityReply(): Promise<SettingsSecurityReply> {
    const [sessionTtlHours, require2fa, passwordMinLength] = await Promise.all([
      settings.get('auth.sessionTtlHours'),
      settings.get('auth.require2fa'),
      settings.get('auth.passwordMinLength'),
    ]);
    return { data: { sessionTtlHours, require2fa, passwordMinLength } };
  }

  /** The two outbound-call consents (M10-T04). */
  async function telemetryReply(): Promise<SettingsTelemetryReply> {
    const [telemetry, updateCheck] = await Promise.all([
      settings.get('telemetry.enabled'),
      settings.get('updates.checkEnabled'),
    ]);
    return { data: { telemetry, updateCheck } };
  }

  return async (app) => {
    /** Same channel as the defaults broadcast; no-ops in harnesses with no realtime. */
    function publishBrandingChanged(at: number): void {
      if (app.hasDecorator('realtime')) {
        app.realtime.publish('config-changed', BRANDING_UPDATED, {}, at);
      }
    }

    app.get(
      '/settings/defaults',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: settingsDefaultsReply } },
      },
      async () => reply(),
    );

    app.put(
      '/settings/defaults',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { body: settingsDefaultsPutBody, response: { 200: settingsDefaultsReply } },
      },
      async (request) => {
        const before = await readDefaults();
        const next = request.body;
        const at = app.rbac.now();
        const actingUserId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;

        for (const axis of AXES) {
          if (before[axis] === next[axis]) continue;
          await settings.set(SETTING_KEY[axis], next[axis], { updatedBy: actingUserId, at });
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'settings.defaults.update',
          changes: { before: { ...before }, after: { ...next } },
        });

        // Live propagation (§7.2/§7.3): every signed-in session follows
        // `config-changed`; clients following a default re-resolve via
        // bootstrap invalidation on this event type.
        if (app.hasDecorator('realtime')) {
          app.realtime.publish('config-changed', SETTINGS_DEFAULTS_UPDATED, { ...next }, at);
        }

        return reply();
      },
    );

    // --- workspace identity (M5-T05, sectioned puts per 08 §2.16) -------------
    // Same conventions as /settings/defaults: Zod body, super-admin guard,
    // audit with before/after images. No realtime broadcast — nothing in the
    // bootstrap payload derives from this key yet.

    app.get(
      '/settings/workspace',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: settingsWorkspaceReply } },
      },
      async () => workspaceReply(),
    );

    app.put(
      '/settings/branding',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { body: settingsBrandingPutBody, response: { 200: settingsWorkspaceReply } },
      },
      async (request) => {
        const before = (await workspaceReply()).data.branding;
        const at = app.rbac.now();
        const actingUserId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;
        if (before.appName !== request.body.appName) {
          await settings.set('branding.appName', request.body.appName, {
            updatedBy: actingUserId,
            at,
          });
        }
        if (before.showVersion !== request.body.showVersion) {
          await settings.set('branding.showVersion', request.body.showVersion, {
            updatedBy: actingUserId,
            at,
          });
        }
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'settings.branding.update',
          changes: { before: { ...before }, after: { ...request.body } },
        });
        // Branding IS in every client's chrome (rail wordmark, logo, version
        // chip), so unlike the other sections here a write has to reach open
        // sessions — same `config-changed` channel the defaults use.
        publishBrandingChanged(at);
        return workspaceReply();
      },
    );

    // --- security (auth.*) ---------------------------------------------------
    // Same shape as the sections above. Nothing here needs a realtime
    // broadcast: `sessionTtlHours` binds the next mint, `passwordMinLength`
    // the next password write, and `require2fa` is re-read on every login and
    // /auth/session — no client holds a stale copy to invalidate.

    app.get(
      '/settings/security',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: settingsSecurityReply } },
      },
      async () => securityReply(),
    );

    app.put(
      '/settings/security',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { body: settingsSecurityPutBody, response: { 200: settingsSecurityReply } },
      },
      async (request) => {
        const before = (await securityReply()).data;
        const next = request.body;
        const at = app.rbac.now();
        const actingUserId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;

        if (before.sessionTtlHours !== next.sessionTtlHours) {
          await settings.set('auth.sessionTtlHours', next.sessionTtlHours, {
            updatedBy: actingUserId,
            at,
          });
        }
        if (before.require2fa !== next.require2fa) {
          await settings.set('auth.require2fa', next.require2fa, { updatedBy: actingUserId, at });
        }
        if (before.passwordMinLength !== next.passwordMinLength) {
          await settings.set('auth.passwordMinLength', next.passwordMinLength, {
            updatedBy: actingUserId,
            at,
          });
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'settings.security.update',
          changes: { before: { ...before }, after: { ...next } },
        });

        return securityReply();
      },
    );

    // --- telemetry + update check (M10-T04) ----------------------------------
    // Where the first-run consent answers are revisited. Audited like every
    // other settings write: flipping telemetry on is a decision someone should
    // be able to trace later.

    app.get(
      '/settings/telemetry',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: settingsTelemetryReply } },
      },
      async () => telemetryReply(),
    );

    app.put(
      '/settings/telemetry',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { body: settingsTelemetryPutBody, response: { 200: settingsTelemetryReply } },
      },
      async (request) => {
        const before = (await telemetryReply()).data;
        const next = request.body;
        const at = app.rbac.now();
        const actingUserId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;

        if (before.telemetry !== next.telemetry) {
          await settings.set('telemetry.enabled', next.telemetry, { updatedBy: actingUserId, at });
        }
        if (before.updateCheck !== next.updateCheck) {
          await settings.set('updates.checkEnabled', next.updateCheck, {
            updatedBy: actingUserId,
            at,
          });
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'settings.telemetry.update',
          changes: { before: { ...before }, after: { ...next } },
        });

        return telemetryReply();
      },
    );

    // --- email / SMTP --------------------------------------------------------
    // The transport the whole email pipeline dials (password reset, user
    // invites, the notification `email` channel, scheduled report delivery).
    // Same conventions as the sections above, with one asymmetry the header in
    // schema.ts argues: the write takes a plaintext password, the read never
    // returns one.
    //
    // No realtime broadcast. Nothing in an open client's chrome derives from
    // this key — `smtpConfigured` on `/system/info` is read on demand — so
    // there is no stale copy in a browser to invalidate.

    app.get(
      '/settings/email',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: settingsEmailReply } },
      },
      async () => emailReply(),
    );

    app.put(
      '/settings/email',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        // Carried on the route rather than added to the AUDIT_COVERAGE table:
        // a marker travels with the code it describes (audit/coverage.ts).
        config: { audit: audited('rbac') },
        schema: { body: settingsEmailPutBody, response: { 200: settingsEmailReply } },
      },
      async (request) => {
        const stored = await settings.get('email.smtp');
        const before = viewOf(stored);
        const at = app.rbac.now();
        const actingUserId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;

        const next = request.body.smtp;
        const value = next === null ? null : buildSmtpValue(next, stored);
        if (!sameSmtp(stored, value)) {
          await settings.set('email.smtp', value, { updatedBy: actingUserId, at });
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'settings.email.update',
          // The SAFE views — an audit row is read back by humans through the
          // audit UI and travels in an audit export, so the password must be as
          // absent here as it is in the reply.
          changes: { before: { ...before }, after: { ...viewOf(value) } },
        });

        return emailReply();
      },
    );
  };
}
