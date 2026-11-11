// SPDX-License-Identifier: AGPL-3.0-only
/**
 * First-run setup service (M10 +). The ONE code path behind both front doors:
 * the `/api/v1/setup/*` routes the dashboard's first-run wizard drives, and the
 * `adminium try` CLI wizard. Neither reimplements any of this (M10 risk
 * mitigation: "CLI subcommands share the same server services as the Studio
 * routes; one code path, two front doors").
 *
 * Framework-free on purpose — no Fastify types cross this boundary. It throws
 * domain errors (`SetupClosedError`, `WeakPasswordError`) that each front door
 * maps to its own vocabulary (HTTP envelope / CLI exit code).
 *
 * SECURITY (the whole attack surface of a self-hosted first boot): creating the
 * super admin is once-only by construction. `createFirstSuperAdmin`
 * (@adminium/meta) claims `system.superAdminCreatedAt` — a PRIMARY KEY row —
 * inside the same transaction that inserts the user, so a second or concurrent
 * attempt loses atomically on every dialect. This service adds no second,
 * weaker gate of its own: it asks meta and reports what meta decided.
 *
 * THE SETUP TOKEN (`setup/token.ts`) is the same shape: `createFirstSuperAdmin`
 * checks and consumes it inside that transaction. `checkToken` here is the
 * cheap, non-consuming read the wizard's first screen and the two store routes
 * use; it is never what lets an account be created.
 */
import {
  FirstUserExistsError,
  SetupTokenError,
  createFirstSuperAdmin,
  isBootstrapRequired,
  readSetupToken,
  seedBuiltinRoles,
  seedSystemSettings,
  settingsRepo,
  setupTokenMatches,
  type MetaDb,
  type User,
} from '@adminium/meta';

/** The consent answers the wizard collects (both default OFF — see below). */
export interface SetupConsent {
  /** `telemetry.enabled` — anonymous telemetry. Exit criterion: off by default. */
  telemetry: boolean;
  /** `updates.checkEnabled` — the release check's outbound call. */
  updateCheck: boolean;
}

export interface CreateSuperAdminInput {
  email: string;
  password: string;
  name?: string | undefined;
  /** Omitted ⇒ both stay at their registry defaults (false). */
  consent?: SetupConsent | undefined;
  /** What the wizard's first screen collected; checked only when this server asks for one. */
  setupToken?: string | undefined;
}

export interface SetupState {
  /** True only on a never-bootstrapped instance: zero users AND no claim. */
  required: boolean;
  /** Password policy the wizard should enforce client-side too. */
  passwordMinLength: number;
  /**
   * A source database is already connected while setup is still open: a
   * project's `databases` in `adminium.config.ts`, or the first-boot
   * `ADMINIUM_SOURCE_URL` seed, made it before anyone signed in. The wizard
   * then opens on the account step instead of asking for a database a second
   * time (walkthrough finding V7). Always `false` once setup is closed.
   */
  databaseConnected: boolean;
  /**
   * This server asks for its one-time setup token before anything else
   * (`setup/token.ts`). Always `false` once setup is closed.
   */
  tokenRequired: boolean;
}

/** Bootstrap already happened — permanently closed. Front doors map this to 409. */
export class SetupClosedError extends Error {
  override readonly name = 'SetupClosedError';
  constructor(message = 'Setup has already been completed.') {
    super(message);
  }
}

/**
 * The setup token is missing or wrong. Front doors map this to 403. Nothing was
 * created or claimed, and the token is still good for the right person.
 */
export class SetupTokenInvalidError extends Error {
  override readonly name = 'SetupTokenInvalidError';
  constructor(message = 'That setup token is not right. Copy it from the server log, where Adminium printed it when it started.') {
    super(message);
  }
}

/** Password fails the `auth.passwordMinLength` policy. Front doors map to 422. */
export class WeakPasswordError extends Error {
  override readonly name = 'WeakPasswordError';
  readonly minLength: number;
  constructor(minLength: number) {
    super(`Password must be at least ${String(minLength)} characters.`);
    this.minLength = minLength;
  }
}

export interface SetupServiceDeps {
  meta: MetaDb;
  /** argon2id hasher — injected so this module stays free of the auth tree. */
  hashPassword: (plain: string) => Promise<string>;
  now?: (() => number) | undefined;
  /**
   * Whether this server asks for the setup token, as its boot decided
   * (`setupTokenRequired`, `setup/token.ts`). `true`: a missing row is a
   * refusal, never an open door; another process on the same store cannot
   * open it by deleting the row. `false`: no token is asked, whatever row is
   * there. Unset (tests, an embedder that builds its own server): the row decides.
   */
  tokenRequired?: boolean | undefined;
}

export interface SetupService {
  state(): Promise<SetupState>;
  /**
   * Setup is open and `token` opens it. Throws {@link SetupClosedError} or
   * {@link SetupTokenInvalidError}; resolves on a server that asks for no token.
   */
  checkToken(token: string | undefined): Promise<void>;
  createSuperAdmin(input: CreateSuperAdminInput): Promise<User>;
}

export function createSetupService(deps: SetupServiceDeps): SetupService {
  const { meta, hashPassword } = deps;
  const now = deps.now ?? (() => Date.now());
  const settings = settingsRepo(meta);

  async function state(): Promise<SetupState> {
    const [required, passwordMinLength] = await Promise.all([
      isBootstrapRequired(meta),
      settings.get('auth.passwordMinLength'),
    ]);
    return {
      required,
      passwordMinLength,
      databaseConnected: required && (await hasConnection()),
      tokenRequired: required && (deps.tokenRequired ?? (await readSetupToken(meta)) !== null),
    };
  }

  async function checkToken(token: string | undefined): Promise<void> {
    if (!(await isBootstrapRequired(meta))) throw new SetupClosedError();
    if (deps.tokenRequired === false) return;
    const stored = await readSetupToken(meta);
    if (stored === null) {
      if (deps.tokenRequired === true) throw new SetupTokenInvalidError();
      return;
    }
    if (!setupTokenMatches(stored, token)) throw new SetupTokenInvalidError();
  }

  /** Any connection row at all, healthy or not: either way it is not the wizard's to make. */
  async function hasConnection(): Promise<boolean> {
    const row = await meta.db.selectFrom('adminium_connections').select('id').limit(1).executeTakeFirst();
    return row !== undefined;
  }

  return {
    state,
    checkToken,

    async createSuperAdmin(input: CreateSuperAdminInput): Promise<User> {
      const passwordMinLength = await settings.get('auth.passwordMinLength');
      if (input.password.length < passwordMinLength) throw new WeakPasswordError(passwordMinLength);

      // Cheap, friendly pre-check. NOT the guard — the guard is the claim
      // inside createFirstSuperAdmin's transaction, which is what makes a
      // racing double-submit safe. This only spares the argon2 hash on the
      // common already-set-up call.
      if (!(await isBootstrapRequired(meta))) throw new SetupClosedError();
      // Same again for the token: spares the hash on a wrong one. The check
      // that counts is inside the claim below.
      await checkToken(input.setupToken);

      const at = now();

      // Defense in depth for the ONE state that bricks an install permanently:
      // `createFirstSuperAdmin` needs the `super-admin` role row, no migration
      // seeds it, and its failure rolls the claim back — so every retry re-fails
      // and no account can ever be created, by any door. Every boot path now runs
      // `firstRun` (cli/commands/start.ts), which is where the seed belongs; this
      // is the backstop for the paths that bypass it (`start --skip-migrate`, an
      // embedder calling `buildServer` directly, a future front door). Both seeds
      // are idempotent natural-key upserts and cost one indexed read per key when
      // already seeded — and they are only reachable while bootstrap is still
      // open (checked above), so an already-set-up instance never runs them.
      await seedBuiltinRoles(meta, at);
      // Seeds `system.instanceId`, which telemetry's payload builder requires:
      // without it a consenting instance silently reports nothing.
      await seedSystemSettings(meta, at);

      let user: User;
      try {
        user = await createFirstSuperAdmin(
          meta,
          {
            email: input.email,
            ...(input.name === undefined ? {} : { name: input.name }),
            passwordHash: await hashPassword(input.password),
          },
          at,
          { setupToken: input.setupToken, required: deps.tokenRequired },
        );
      } catch (error) {
        // The racer that lost the PK claim lands here.
        if (error instanceof FirstUserExistsError) throw new SetupClosedError();
        if (error instanceof SetupTokenError) throw new SetupTokenInvalidError();
        throw error;
      }

      // Consent is recorded only AFTER the claim is won, so a losing racer can
      // never rewrite the winner's telemetry answer. Absent ⇒ registry
      // defaults (both false) stand: telemetry is opt-in, never opt-out.
      if (input.consent !== undefined) {
        await settings.set('telemetry.enabled', input.consent.telemetry, { updatedBy: user.id, at });
        await settings.set('updates.checkEnabled', input.consent.updateCheck, {
          updatedBy: user.id,
          at,
        });
      }

      return user;
    },
  };
}
