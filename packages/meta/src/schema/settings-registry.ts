// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings registry: every global settings key with its Zod schema, code
 * default, and secret flag. `adminium_settings` stores explicit overrides
 * only — unset keys fall back to these defaults, so new releases can change
 * defaults without data migrations.
 */

import { z } from 'zod';

import { accentSchema, densitySchema, localeSchema, themeSchema } from './json-payloads.js';

export interface SettingDef<T = unknown> {
  schema: z.ZodType<T>;
  default: T;
  /** Sensitive fields stored encrypted; redacted in API reads (write-only from the UI). */
  secret?: boolean;
  /**
   * May this key travel in a config bundle (`adminium export-zip`)?
   *
   * DEFAULT FALSE — the flag is opt-IN, so a key added by a future wave is NOT
   * exportable until someone reads this comment and decides it is. That default
   * is the point. The export used to name the *non*-portable keys instead
   * (`INSTANCE_IDENTITY_SETTINGS`, a deny-list of two), and it rotted inside the
   * same wave that added it: `system.superAdminCreatedAt` — the once-only
   * first-boot CLAIM whose mere presence permanently closes `/setup/*` — was not
   * on it, so a full-instance bundle carried the claim into fresh installs and
   * bricked them (zero users, setup closed forever, no account creatable). See
   * `apps/server/src/export/redaction.ts`, whose own header argues exactly this:
   * a deny-list rots, an allow-list fails closed.
   *
   * The bar for `portable: true` is "this is CONFIGURATION the operator authored
   * and would want on another instance" — not instance identity, not a bootstrap
   * claim, not anything whose meaning is "something already happened here".
   */
  portable?: boolean;
  description: string;
}

interface DefOptions {
  secret?: boolean;
  portable?: boolean;
}

function def<T>(
  schema: z.ZodType<T>,
  dflt: T,
  description: string,
  opts: DefOptions = {},
): SettingDef<T> {
  return {
    schema,
    default: dflt,
    description,
    ...(opts.secret === undefined ? {} : { secret: opts.secret }),
    ...(opts.portable === undefined ? {} : { portable: opts.portable }),
  };
}

/** Shorthand for the common case: operator-authored config that a bundle carries. */
const P: DefOptions = { portable: true };

/**
 * An app-instance slug: the URL segment naming ONE tenant of a hosted app.
 *
 * Lowercase kebab, because it is typed into a URL bar and read back off one.
 * `staff` and `customer` are refused by name — the slug sits in the same
 * position as the SIDE, and a slug called `staff` would make
 * `/apps/clients/staff/` mean two things at once. Refusing them here is the
 * whole reason that ambiguity cannot occur rather than merely being unlikely.
 */
export const surfaceInstanceSlug = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase letters, digits and single hyphens')
  .refine((v) => v !== 'staff' && v !== 'customer', {
    message: '`staff` and `customer` are reserved — they name a side, not an instance',
  });

/** True when `value` is exactly the origin `URL` serializes for it. */
function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

const smtpSchema = z
  .object({
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    user: z.string(),
    passEncrypted: z.string(),
    from: z.string(),
    secure: z.boolean(),
  })
  .nullable();

/**
 * One configured From address. A document's `brand.fromEmail` must be one of
 * these or `email.smtp.from` — a relay refuses or spam-folders an arbitrary
 * From (SPF/DKIM), so the choice is a list an operator curates, not a text
 * field a template fills.
 */
const emailSenderSchema = z.object({
  name: z.string().max(120),
  address: z
    .string()
    .trim()
    .min(3)
    .max(320)
    .refine((value) => value.includes('@'), 'must be an email address'),
});
export type EmailSender = z.infer<typeof emailSenderSchema>;

const llmProviderSchema = z
  .enum(['anthropic', 'openai', 'openai-compatible', 'ollama', 'adminium-managed'])
  .nullable();

/**
 * One row of the desktop capability grant table.
 *
 * A grant is the record that an installed micro-SaaS manifest was consented to a
 * host capability — `{ manifestId, capabilityId }` is its identity, `grantedAt`
 * its audit trail. The desktop `CapabilityHost` reads these to decide whether a
 * `capabilities.invoke` may reach a provider; a call with no matching grant is
 * refused with `CAPABILITY_NOT_GRANTED`. The dashboard's consent step writes one
 * and its revoke control removes one.
 *
 * Bounds, not free strings: `capabilityId` is a dotted id from a closed host
 * vocabulary (`printer.escpos`, …) and `manifestId` a reverse-DNS app id, so both
 * are short. This is the meta-store boundary; the route validates `capabilityId`
 * against the known set on top of it.
 */
export const capabilityGrantSchema = z.object({
  manifestId: z.string().min(1).max(200),
  capabilityId: z.string().min(1).max(120),
  grantedAt: z.number().int().nonnegative(),
});
export const capabilityGrantsSchema = z.array(capabilityGrantSchema);

/** One consented desktop capability grant. */
export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>;

export const SETTINGS_REGISTRY = {
  'appearance.theme': def<z.infer<typeof themeSchema>>(themeSchema, 'system', 'Default UI theme', P),
  'appearance.accent': def<z.infer<typeof accentSchema>>(accentSchema, 'indigo', 'Default accent color', P),
  'appearance.density': def<z.infer<typeof densitySchema>>(densitySchema, 'comfortable', 'Default layout density', P),
  'locale.default': def<z.infer<typeof localeSchema>>(localeSchema, 'en_US', 'Default locale', P),
  /**
   * Monotonic stamp over the runtime-translation tables. Every mutation
   * bumps it inside its own transaction, and clients key their bundle
   * cache / ETag on it.
   *
   * NOT `MAX(updated_at)` over the rows: reset-to-built-in is a hard DELETE,
   * so the most common admin operation is invisible to a max-timestamp — the
   * cache would go stale exactly when an admin undoes a bad edit.
   *
   * NOT portable. This is instance state, not authored configuration: a
   * counter from another install means nothing here, and carrying it would
   * let an imported bundle push a target instance's clients into believing
   * they already hold the newest strings.
   */
  'i18n.version': def(z.number().int().min(0), 0, 'Runtime-translation version stamp'),
  'branding.appName': def(z.string().min(1).max(60), 'Adminium', 'Application display name', P),
  'branding.logoFileId': def<string | null>(z.string().nullable(), null, 'Logo file id', P),
  /**
   * The `v<version>` chip in the sidebar rail. On by default — knowing which
   * build you are looking at is a support handshake — but a white-labelled
   * deployment is entitled to hide the fact that it is Adminium underneath.
   */
  'branding.showVersion': def(z.boolean(), true, 'Show the app version in the sidebar', P),
  'branding.faviconFileId': def<string | null>(z.string().nullable(), null, 'Favicon file id', P),
  'auth.sessionTtlHours': def(z.number().int().min(1).max(8760), 720, 'Session lifetime in hours', P),
  /**
   * ADVISORY, NOT A PERIMETER — the name overpromises, so read this before
   * relying on it. Exactly two things in the product read this flag:
   *
   * 1. `apps/server/src/routes/auth/handlers.ts` — `needsTwoFactorSetup` puts
   *    `twoFactorSetupRequired` on the login reply and on `GET /auth/session`
   *    when the account has no TOTP. That is a SIGNAL for the client to route
   *    into the enroll flow, deliberately not a denial: `/auth/2fa/enroll` and
   *    `/auth/2fa/activate` are themselves `requireAuth`, so refusing the
   *    session would leave the user no door to enroll through.
   * 2. Same file, `disable2faHandler` — `POST /auth/2fa/disable` throws
   *    ForbiddenError while the flag is on, so an account that IS enrolled
   *    cannot opt back out.
   *
   * NOTHING ELSE READS IT. In as many words: no server-side preHandler blocks
   * an un-enrolled principal. A caller that simply ignores the signal — any
   * API client that is not our dashboard — holds a full session and can call
   * every route without ever enrolling. API-key principals are outside the
   * question structurally: `apps/server/src/plugins/auth.ts` resolves an
   * `Authorization: Bearer adm_…` key and returns before a session exists, so
   * no session-conditioned gate could reach them even if one were added. What
   * this flag hardens is enrollment (you cannot leave once in), not access.
   *
   * Marked `P`, so a config bundle carries it: `adminium import-zip` replays
   * settings through `settingsRepo.set` (see the import service under
   * `apps/server/src/export/`), which can land `true` on an instance where
   * nobody has TOTP enrolled. Survivable precisely BECAUSE it is not a
   * perimeter — everyone can still log in — so the recovery is to turn it off
   * at Settings → Security (`PUT /settings/security`, needs `settings.manage`).
   * If no admin UI is reachable, the floor is SQL; there is no
   * `adminium settings` subcommand to do it with:
   *
   *     DELETE FROM adminium_settings WHERE key = 'auth.require2fa';
   *
   * Deleting the row suffices — `packages/meta/src/repos/settings.ts` `get()`
   * returns the registry default when no row exists, and that default is
   * `false`.
   */
  'auth.require2fa': def(z.boolean(), false, 'Require TOTP for all users', P),
  'auth.allowSignup': def(z.boolean(), false, 'Allow self-signup (default invite-only)', P),

  /*
   * The public API's runtime off switch (level 2).
   *
   * DEFAULT FALSE, and deliberately NOT `portable`. It is an instance-level
   * decision about whether this database is reachable from the internet, and
   * carrying it in a config bundle would turn "I replayed my setup on a new
   * box" into "I published a database I had not scoped yet". That is the same
   * class of mistake as `system.superAdminCreatedAt` travelling in a bundle,
   * which is the incident this file's `portable` comment was written for.
   *
   * Level 1 (`ADMINIUM_PUBLIC_API_ORIGINS`) still gates registration, so this
   * key does nothing on an instance that never opted in — two independent
   * switches, both of which must be on.
   */
  'publicApi.enabled': def(z.boolean(), false, 'Serve the scoped public API at /api/v1/public'),

  /*
   * WHERE a hosted app's surfaces appear.
   *
   * `surfaces.apps` — per app key, whether the STAFF surface is blended into
   * this dashboard (`internal`, the default whenever a staff surface exists) or
   * left as its own thing (`external`). Hosted is the normal case and "we do
   * not need another surface" is the point of the whole wave, so external is
   * the OPT-OUT, not the default.
   *
   * `connectionId` on the same record is WHICH DATABASE that staff surface
   * reads. A customer surface already answers this: its publishable key names a
   * scope and a scope names a connection, `NOT NULL` since wave 0014. The staff
   * side has no key by design — it reads through the operator's session — and
   * the key was also the thing carrying that identity, so nothing replaced it.
   * The app was left to infer its database from "the only one serving", which
   * is a guess that holds until an instance has two connections and then fails
   * as a schema mismatch against somebody else's tables.
   *
   * Optional, and absent keeps the old inference: a single-connection instance
   * — nearly all of them — needs no answer here, and demanding one would make
   * every existing surface stop booting on upgrade.
   *
   * `instances` serves the SAME app over MORE THAN ONE database — the shape the
   * dashboard's own generated pages have always had, where every page carries a
   * `connectionId` and two connections simply produce two sets. Each entry adds
   * a mount at `/apps/<appKey>/<slug>/<side>/` reading its own connection; the
   * unslugged `/apps/<appKey>/<side>/` stays exactly where it is, reading
   * `connectionId` above, so no existing URL moves.
   *
   * THE SLUG GOES BEFORE THE SIDE, and that is not cosmetic. After it —
   * `/apps/clients/staff/<slug>` — the segment collides with the app's own
   * routes, and `/apps/clients/staff/invoices` becomes a question with two
   * answers. Before it, the only values in that position are `staff`, `customer`
   * and slugs, so refusing those two names as slugs makes the ambiguity
   * impossible rather than merely unlikely.
   *
   * `name` is what the operator CALLS this app, overriding the name the app
   * was built with. Every app ships its own — "Outline", "Wren House" — baked
   * into its bundle as an i18n string and emitted into `surface.json` in all
   * eight locales. That is a fine default and a poor permanent answer: the
   * name belongs to the business running the app, not to the sample it was
   * shipped as, and rebuilding a bundle to change a word is not something an
   * operator can do.
   *
   * ONE STRING, NOT EIGHT. The app's own labels are localized because the app
   * ships them; this one is typed by an operator who has one name for their
   * business and uses it in every language. Absent means "use what the app
   * ships", which is why it is optional rather than seeded with the app's
   * label — a stored copy would silently stop tracking the app's own name
   * across upgrades.
   *
   * `surfaces.domains` — `host → {appKey, side}`. A request whose `Host`
   * matches serves that surface at `/` instead of the dashboard.
   *
   * NEITHER IS PORTABLE, and a domain map is the clearest case in this file.
   * It names one instance's DNS. Carrying it in a config bundle would point a
   * fresh install at a domain it does not own and take the dashboard away from
   * whoever restored the bundle — the `system.superAdminCreatedAt` lesson in
   * this file's own header, with a worse blast radius.
   *
   * Both are read on a HOT path (Host routing runs per request), so both go
   * through the same short-TTL cache as `publicApi.enabled` rather than a
   * meta-store SELECT per request.
   */
  'surfaces.apps': def<
    Record<
      string,
      {
        staff?: 'internal' | 'external' | undefined;
        name?: string | undefined;
        connectionId?: string | undefined;
        instances?: { slug: string; connectionId: string }[] | undefined;
      }
    >
  >(
    z.record(
      z.string(),
      z.object({
        staff: z.enum(['internal', 'external']).optional(),
        name: z.string().trim().min(1).max(60).optional(),
        connectionId: z.string().min(1).optional(),
        instances: z
          .array(
            z.object({
              slug: surfaceInstanceSlug,
              connectionId: z.string().min(1),
            }),
          )
          .max(32)
          .refine(
            (list) => new Set(list.map((i) => i.slug)).size === list.length,
            { message: 'instance slugs must be unique within an app' },
          )
          .optional(),
      }),
    ),
    {},
    'Per-app surface placement, display name, connection binding and extra instances',
  ),
  'surfaces.domains': def<
    Record<string, { appKey: string; side: 'staff' | 'customer'; instance?: string | undefined }>
  >(
    z.record(
      z.string(),
      z.object({
        appKey: z.string().min(1),
        side: z.enum(['staff', 'customer']),
        /*
         * Which INSTANCE this host serves. Absent is the app's own mount,
         * which is what every existing mapping means and keeps meaning. A host
         * is the only signal a mapped domain has — the app cannot read the
         * mapping — so the server has to answer with it rather than expect the
         * bundle to work it out.
         */
        instance: surfaceInstanceSlug.optional(),
      }),
    ),
    {},
    'Host → app surface mapping; the operator points DNS and their proxy at this instance',
  ),
  'auth.passwordMinLength': def(z.number().int().min(8).max(128), 10, 'Minimum password length', P),
  'email.smtp': def<z.infer<typeof smtpSchema>>(smtpSchema, null, 'SMTP transport; email features degrade gracefully when unset', { secret: true, portable: true }),
  // ── email documents ───────────────────────────────────────────────────────
  //
  // `email.senders` is the From addresses a document may choose beyond
  // `email.smtp.from` (which is always the implicit first entry). Portable:
  // it is configuration the operator authored, not a secret and not identity.
  'email.senders': def<EmailSender[]>(z.array(emailSenderSchema).max(50), [], 'Configured From addresses a document may send from', P),
  // The cap on one message's attachments, enforced when a document is saved
  // and re-checked when it is queued. 10 MiB is where most relays start
  // refusing; the floor keeps a PDF possible and the ceiling stays under the
  // 50 MiB the strictest common providers accept.
  'email.maxAttachmentBytes': def(z.number().int().min(262_144).max(52_428_800), 10_485_760, 'Largest total attachment payload per message, in bytes', P),
  'llm.provider': def<z.infer<typeof llmProviderSchema>>(llmProviderSchema, null, 'LLM provider', P),
  'llm.apiKey': def<string | null>(z.string().nullable(), null, 'LLM provider API key', { secret: true, portable: true }),
  'llm.model': def<string | null>(z.string().nullable(), null, 'LLM model override (null = provider default)', P),
  'llm.baseUrl': def<string | null>(z.string().nullable(), null, 'Base URL for openai-compatible / ollama', P),
  'llm.maxOutputTokens': def<number | null>(z.number().int().positive().nullable(), null, 'Max output tokens (null = provider default)', P),
  'retention.auditLogDays': def(z.number().int().min(30).max(3650), 365, 'Audit log retention in days', P),
  'retention.exportsDays': def(z.number().int().min(1).max(365), 30, 'Export artifact retention in days', P),
  'retention.webhookDeliveriesDays': def(z.number().int().min(1), 30, 'Webhook delivery log retention in days', P),
  'retention.automationRunsDays': def(z.number().int().min(1), 90, 'Automation run retention in days', P),
  'retention.notificationsDays': def(z.number().int().min(1), 90, 'Read-notification retention in days', P),
  'retention.llmRunsDays': def(z.number().int().min(1), 90, 'Unapplied LLM run retention in days', P),
  'retention.jobsDays': def(z.number().int().min(1), 30, 'Finished job retention in days', P),
  // ── the page assistant ────────────────────────────────────────────────────
  //
  // What the assistant is called wherever it introduces itself. Portable: it
  // is a name the operator chose, and it means the same on any instance.
  'assistant.name': def(z.string().min(1).max(40), 'Milo', 'What the page assistant is called', P),
  /*
   * May the assistant's tools read ROWS from a connected database — masked,
   * grant-checked per table and capped per call — or only documents and schema?
   *
   * NOT portable, and that is the whole point of the flag being opt-in. This
   * is one instance's privacy policy about its own customers' data. Importing
   * a bundle somebody else exported must never be what switches it on.
   */
  'assistant.rowData': def(z.boolean(), true, 'Let the page assistant read masked rows from a connection'),
  'retention.assistantSessionsDays': def(z.number().int().min(1), 30, 'Closed assistant session retention in days', P),
  // ── files & storage ───────────────────────────────────────────────────────
  //
  // `files.maxBytes` default is 200 MiB figure, which is also the number the
  // File Manager comp puts in front of the user. The hard ceiling is 2 GiB and
  // is below S3's 5 GiB single-PUT limit by design (D26): one request, one
  // spool, one PUT, no multipart.
  'files.maxBytes': def(z.number().int().min(1024).max(2_147_483_648), 209_715_200, 'Largest single upload, in bytes', P),
  // The SECURITY BOUNDARY, not a convenience list (D8). A type absent from
  // here is refused whatever the file claims to be and whatever a column's
  // `accept` allows — a column narrows this, it never widens it.
  'files.allowedTypes': def(
    z.array(z.string().min(1).max(20)),
    ['pdf', 'png', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'zip', 'office', 'mp4', 'mp3', 'wav', 'webm', 'ogg', 'csv', 'text', 'markdown', 'json'],
    'File types accepted on upload (the sniffed type must be one of these)',
    P,
  ),
  // An upload nobody attached is litter: the create form was abandoned, the
  // tab was closed. 24 hours is long enough that a form left open over lunch
  // still saves, and short enough that the litter does not accumulate.
  'files.unattachedHours': def(z.number().int().min(1).max(720), 24, 'Hours an unattached upload is kept before it is moved to trash', P),
  'retention.filesTrashDays': def(z.number().int().min(1).max(365), 30, 'Days a trashed file is kept before its bytes are deleted', P),
  /*
   * NULL BY DEFAULT — kept forever. Every other retention key here has a
   * window because what it sweeps is a BYPRODUCT: a trashed file, an audit
   * batch, an export somebody already downloaded. An issued document is not a
   * byproduct. It went to a customer, it may be the only record of a
   * transaction, and a product that quietly deleted one after ninety days
   * would be destroying business records on a default nobody chose.
   *
   * SCOPE, because O15's own re-read narrowed it: this sweeps the REGISTER —
   * `adminium_documents` and the bytes behind it. Authored templates
   * (`adminium_invoice_documents`) are not expiring business records and are
   * explicitly out of its reach.
   */
  'retention.documentsDays': def(z.number().int().min(1).max(3650).nullable(), null, 'Days an issued document is kept before its bytes are deleted; empty keeps them forever', P),
  // Above this, a grid cell shows the chip rather than the image. There is no
  // server-side resizing (D24/D39) — the thumbnail IS the original, rendered
  // small — so the cap is what stops a 40 px box from downloading 12 MB.
  'files.thumbnailMaxBytes': def(z.number().int().min(0).max(52_428_800), 2_097_152, 'Largest image rendered as a grid thumbnail, in bytes', P),
  'retention.auditArchive': def(z.boolean(), false, 'Archive audit batches to adminium_files before deleting', P),
  'telemetry.enabled': def(z.boolean(), false, 'Anonymous telemetry (opt-in)', P),
  // Separate from telemetry.enabled and likewise OFF by default: an update
  // check is an outbound call that discloses the instance's IP + version to
  // the vendor, so a self-hosted instance opts into it explicitly rather than
  // inheriting consent from the telemetry answer.
  'updates.checkEnabled': def(z.boolean(), false, 'Check for new releases (opt-in outbound call)', P),
  // The add-on catalog's browse-online switch. OFF by default, and for the
  // same reason `updates.checkEnabled` is: an online browse discloses this
  // deployment's IP, the time, and the exact `package@version` it pulls to a
  // third-party registry. The bundled set (D3) makes the Add-ons page useful
  // with the switch off, so default-off costs a fresh install nothing.
  // `ADMINIUM_NETWORK_FEATURES=off` and the desktop's air-gap mode both
  // override it downward; nothing overrides it up.
  'addOns.catalogEnabled': def(z.boolean(), false, 'Browse the online add-on catalog (opt-in outbound call)', P),
  // The app catalog's own switch (b, R2: two switches, not one). Off by default for the
  // add-on switch's reason: browsing online discloses this deployment's IP, the time and
  // the exact app and version it pulls. The bundled set and uploads keep Hosted apps
  // useful with it off, and the same two overrides force it down.
  'apps.catalogEnabled': def(z.boolean(), false, 'Browse the online app catalog (opt-in outbound call)', P),
  // ── NOT portable ──────────────────────────────────────────────────────────
  // Everything below identifies THIS instance, records that something already
  // happened to it, or answers a question about the MACHINE it runs on. A
  // bundle that carried any of them would fuse two installs into one identity,
  // decide one device's login policy from another's, or — worst, for the claim —
  // hand a fresh install a "setup already done" flag it can never clear. See
  // `SettingDef.portable`.
  /**
   * The desktop shell's answer, mirrored out of `<userData>/config.json`
   * (`singleUser`) at every boot by the composition root. `POST
   * /api/v1/auth/desktop-session` reads THIS — the route refuses while it is
   * false, which is what the "Require login on this device" toggle turns off.
   *
   * NAMING: the store's key is `desktop.single_user`. This registry's convention
   * is `<domain>.<camelCase>` for all 30 of its siblings, and the key is a TS
   * literal type here rather than a string in a doc, so it follows the code.
   *
   * DEFAULT FALSE — i.e. "ask for the password" — even though `config.json`
   * default is `true` checkbox ships ticked. That is not a contradiction, because
   * THIS DEFAULT IS ONLY EVER REACHED WHEN THE MIRROR DID NOT RUN. When the
   * desktop shell passes `ADMINIUM_DESKTOP_SINGLE_USER`, every boot overwrites
   * this row with the user's real answer and the default is dead code; the only
   * world where it decides anything is one where the wrapper failed to tell the
   * server what the user chose.
   *
   * In that world the two candidate defaults fail in opposite directions:
   *
   *   true  ⇒ a user who explicitly turned ON "Require login on this device" is
   *           silently auto-logged-in anyway. The control fails OPEN, against
   *           exactly the threat it exists for (someone else at this keyboard),
   *           and nothing anywhere says so.
   *   false ⇒ auto-login stops working and the user sees the standard login
   *           screen. A visible missing convenience, and their password still
   *           opens the app.
   *
   * A broken promise about a password beats a broken promise about a shortcut, so
   * the unmirrored case fails closed and loudly rather than open and silently.
   *
   * NEVER portable: it is per-DEVICE policy. A bundle that carried it would
   * answer "may this machine skip its login?" using another machine's answer.
   */
  'desktop.singleUser': def(z.boolean(), false, 'Desktop: skip login on this computer'),
  /**
   * The desktop capability grant table. Written by the consent step on manifest
   * install and cleared by its revoke control; read by the main-process
   * `CapabilityHost` on every `capabilities.invoke` to gate a call against a
   * real, revocable grant.
   *
   * NAMING: the `adminium_settings` key is `desktop.capability_grants`.
   * This registry's convention is `<domain>.<camelCase>` — the same override
   * `desktop.singleUser` makes over `desktop.single_user`, and for the same
   * reason: the key is a TS literal type here, so it follows the code.
   *
   * NEVER portable: a grant is a per-DEVICE authorization to touch THIS machine's
   * hardware. A bundle that carried it would silently pre-authorize an app to
   * reach a receipt printer on a machine whose owner never consented.
   */
  'desktop.capabilityGrants': def<z.infer<typeof capabilityGrantsSchema>>(
    capabilityGrantsSchema,
    [],
    'Desktop: consented capability grants',
  ),
  'system.instanceId': def<string | null>(z.string().nullable(), null, 'Stable instance identity (seeded at bootstrap)'),
  'system.bootstrappedAt': def<number | null>(z.number().nullable(), null, 'First-run timestamp (epoch ms)'),
  /**
   * The first-super-admin CLAIM. Its row's PRESENCE — not its value — is the
   * once-only gate: `createFirstSuperAdmin` INSERTs it inside the same
   * transaction that creates the user, so the `key` PRIMARY KEY makes a second
   * (or concurrent) bootstrap attempt fail atomically on every dialect. Never
   * `set()` this key from application code.
   *
   * NEVER portable, for the same reason it is never `set()`: importing it into
   * an instance with zero users closes `/setup/*` (409) forever, so no super
   * admin can be created and nobody can log in. The instance is scrap.
   */
  'system.superAdminCreatedAt': def<number | null>(z.number().nullable(), null, 'First-super-admin bootstrap claim (epoch ms)'),
  /*
   * The first-boot source-connection seed, in two keys because the seed has two
   * distinct facts to remember and collapsing them into one produces a dead
   * end.
   *
   * `system.sourceConnectionId` — WHICH row the seed made. Written on the first
   * attempt whether it worked or not, so a retry updates that row instead of
   * inserting a second one every time the container restarts.
   *
   * `system.sourceSeededAt` — that a HEALTHY seed happened. Written only after
   * the DSN probes OK, and it is the once-only gate: set, the seed never runs
   * again, so a connection the operator later deletes STAYS deleted rather than
   * reappearing on the next `docker compose up`.
   *
   * Why not one key. A single claim written on failure too would strand the
   * common mistake — a typo in `ADMINIUM_SOURCE_URL`. `PATCH /connections/:id`
   * takes `name` and `settings` and NOT a DSN (routes/connections/schema.ts),
   * so a stored bad DSN cannot be corrected anywhere in the product; the
   * operator's fix is to correct compose, which the seed must therefore still
   * be listening for. Split, the retry path is "no healthy seed yet" and the
   * once-only path is "there was one" — neither borrows the other's meaning.
   *
   * Neither is portable (the default). Both mean "something already happened
   * here", which is the exact bar the `portable` comment above sets, and
   * `system.superAdminCreatedAt` is the incident it was written for: a bundle
   * carrying `sourceConnectionId` would name a connection row that does not
   * exist in the target, and one carrying `sourceSeededAt` would suppress the
   * new instance's own seed — booting it to an empty dashboard with no
   * indication why.
   */
  /*
   * Which (built-in role, system key) pairs the seed has EVER granted, as
   * `"<role slug>:<key>"` strings.
   *
   * It exists because the seed runs at every boot and used to grant any listed
   * key whose row was missing — and Team → Roles revokes by DELETING that row.
   * So taking a capability away from the built-in Admin lasted until the next
   * restart, silently, which is the opposite of what a revocable permission
   * means. With this ledger the seed asks "have I ever given this?" instead of
   * "is it there now?": a revocation stays revoked, and a key a later version
   * adds is still delivered to an existing install, because its pair has never
   * been seeded.
   *
   * Not portable — it records what already happened on THIS instance, the bar
   * the `portable` comment above sets. Carrying it into a fresh install would
   * tell that install's seed it had already run, leaving every built-in role
   * with no system grants at all.
   */
  'system.seededRoleGrants': def<string[]>(z.array(z.string()), [], 'Built-in (role, system key) pairs the seed has already granted once'),
  'system.sourceConnectionId': def<string | null>(z.string().nullable(), null, 'Connection id the first-boot source seed created'),
  'system.sourceSeededAt': def<number | null>(z.number().nullable(), null, 'First-boot source-connection seed claim, healthy probes only (epoch ms)'),
  /**
   * The bundle FORMAT version of this store. Not portable: the target records
   * its own, and the version a bundle was written at already travels in the
   * manifest (`BundleManifest.configVersion`), which is what replay reads.
   * Copying the source's value would let an old bundle silently downgrade the
   * number a newer target reports about itself.
   */
  'system.configVersion': def(z.number().int().min(1), 1, 'Config bundle format version'),
  /**
   * Where this instance answers, as links in outbound email must spell it:
   * `https://admin.example.com`. Read by `security/public-origin.ts` in the
   * server, which explains the whole mechanism.
   *
   * WHY IT EXISTS. Those links used to be built from the request that caused
   * the mail, and `POST /auth/password/forgot` is unauthenticated. Its caller
   * chose the host a real reset token was mailed under (password-reset
   * poisoning). Nothing a request carries can say where the instance really
   * answers, so this key does.
   *
   * WHO WRITES IT: an admin in Studio, or the server itself, once, from the
   * browser `Origin` of an admin who can manage settings while the key is still
   * unset. Unset means "not learned yet", never "use the request's Origin".
   *
   * NEVER portable. It is this instance's address, not configuration. Imported
   * into another instance, it would send that instance's reset tokens to this
   * one's host.
   *
   * Stored already normalized: the schema accepts exactly what `URL#origin`
   * serializes (lower case, no default port, no path, no trailing slash), so a
   * value read back can be concatenated with a path as-is.
   */
  'system.publicOrigin': def<string | null>(
    z
      .string()
      .max(255)
      .refine(isHttpOrigin, 'must be an http(s) origin with no path, such as https://admin.example.com')
      .nullable(),
    null,
    'Public origin that links in outbound email point at',
  ),
} as const;

export type SettingsRegistry = typeof SETTINGS_REGISTRY;
export type SettingKey = keyof SettingsRegistry;
export type SettingValue<K extends SettingKey> = SettingsRegistry[K] extends SettingDef<infer T> ? T : never;

export const SETTING_KEYS = Object.keys(SETTINGS_REGISTRY) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, key);
}

export function isSecretSettingKey(key: SettingKey): boolean {
  return SETTINGS_REGISTRY[key].secret === true;
}

/**
 * True when the registry declares `key` safe to carry in a config bundle.
 * Opt-in, so an undeclared (i.e. new) key is never exported — see
 * {@link SettingDef.portable}.
 */
export function isPortableSettingKey(key: SettingKey): boolean {
  return SETTINGS_REGISTRY[key].portable === true;
}
