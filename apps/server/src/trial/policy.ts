// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trial mode and the hosted profile: every "is this allowed?" in one place.
 *
 * Three profiles, each from the environment alone (`config/env.ts`; no
 * setting switches one, no route writes one):
 *
 *   off     an ordinary server: everything here is allowed.
 *   trial   `ADMINIUM_TRIAL_MODE=on`: a stranger is its Super Admin, on the
 *           operator's server, until `ADMINIUM_TRIAL_ENDS_AT`.
 *   hosted  `ADMINIUM_HOSTED_MODE=on`: the same stranger after the Upgrade
 *           What would let their code or their connections reach
 *           the operator stays off; the clock, banners, caps and relay-only
 *           mail go.
 *
 * Each question is answered `{ allowed, reason }`. `reason` is a stable code
 * the dashboard translates ("Set by the operator", "Read-only: this trial has
 * ended"), null when allowed. A hook is one call, so grep finds every one:
 *
 *   refuseUnlessAllowed(app.trialPolicy, 'webhooks', 'Webhooks are off on this server.');
 *
 * which throws 403 `OFF_BY_OPERATOR` with `details: { question, reason }`
 * (`trial/refuse.ts`).
 *
 * Each switch is one question here, its hook where the effect happens, and
 * a test both ways; a question added later is a row in {@link QUESTIONS} and
 * a row in `trial-policy.test.ts`.
 *
 * The values a profile implies for variables that exist without it
 * (`ADMINIUM_NETWORK_POLICY=strict`, `ADMINIUM_LOCAL_DATABASES=off`,
 * telemetry and map servers off) are enforced in the parsed environment
 * itself (`enforceProfile`, `config/env.ts`), so code that reads those
 * variables needs no hook at all. The matching questions here answer the same.
 */
import type { Env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** This server's policy, built once from its environment (`app.ts`). */
    trialPolicy: TrialPolicy;
  }
}

export type Profile = 'off' | 'trial' | 'hosted';

/** Why something is not allowed. Stable: the dashboard and the API's error details carry it. */
export type PolicyReason =
  /** Trial mode switches it off. */
  | 'trial-mode'
  /** The hosted profile keeps it off. */
  | 'hosted-mode'
  /** The trial's end date has passed: the instance is read-only, public pages hidden, user mail stopped. */
  | 'trial-ended'
  /** `ADMINIUM_AI_OPERATOR_ONLY`: AI runs on the operator's connection unless it is the user's own key to a fixed provider. */
  | 'operator-ai-only'
  /** `ADMINIUM_AI_OPERATOR_SCOPE=dashboard`: the operator's AI builds dashboards only. */
  | 'operator-ai-scope'
  /** A trial's size caps: a database or the data folder past its limit. */
  | 'size-cap';

export const POLICY_REASONS: readonly PolicyReason[] = ['trial-mode', 'hosted-mode', 'trial-ended', 'operator-ai-only', 'operator-ai-scope', 'size-cap'];

export interface PolicyAnswer {
  allowed: boolean;
  /** Null when allowed. */
  reason: PolicyReason | null;
}

/** What the rules read: the profile, the clock, and the operator's AI variables. */
interface RuleContext {
  profile: Profile;
  /** Trial mode, and the end date has passed. */
  ended: boolean;
  aiOperatorOnly: boolean;
  aiOperatorScope: 'dashboard' | null;
}

type Rule = (ctx: RuleContext) => PolicyReason | null;

/** Allowed or not per profile: `true` keeps it as an ordinary server has it. */
const profiles =
  (trial: boolean, hosted: boolean): Rule =>
  (ctx) =>
    ctx.profile === 'trial' && !trial ? 'trial-mode' : ctx.profile === 'hosted' && !hosted ? 'hosted-mode' : null;

/** Not past a trial's size caps; a hosted or ordinary server has none. */
const uncappedOutsideTrial: Rule = (ctx) => (ctx.profile === 'trial' ? 'size-cap' : null);

/** Allowed until a trial ends; a hosted or ordinary server has no end. */
const untilTrialEnds: Rule = (ctx) => (ctx.ended ? 'trial-ended' : null);

/** Off in trial mode and under `ADMINIUM_AI_OPERATOR_ONLY`; the hosted profile drops operator AI. */
const unlessOperatorAi: Rule = (ctx) => profiles(false, true)(ctx) ?? (ctx.aiOperatorOnly ? 'operator-ai-only' : null);

/** Every question and its rule, grouped by what they switch off. */
const QUESTIONS = {
  // ── connections ──────────────────────────────────────────────────────────
  /** "Allow databases on this server" (`connections.allowLocalDatabases`). Also locked by `ADMINIUM_LOCAL_DATABASES=off`. */
  localDatabases: profiles(false, false),
  /** A SQLite file as a source, on every front door (the wizards show it disabled with the reason). */
  sqliteSources: profiles(false, false),
  /** The server's own network (private ranges) for sources, webhooks and storage: `ADMINIUM_NETWORK_POLICY=open`. */
  privateNetwork: profiles(false, false),
  /** On an operator host, a login other than `ADMINIUM_SOURCE_URL`'s user and database. */
  anyDatabaseLogin: profiles(false, false),
  /** `POST /connections/test` without the per-instance rate limit. */
  unlimitedConnectionTests: profiles(false, false),
  /** `/meta/relocate`, `/setup/probe`, `/setup/adopt`: the meta store is fixed by env. */
  metaStoreRoutes: profiles(false, false),
  /** A source host that is not on `ADMINIUM_DATABASE_HOSTS`: otherwise the list is the only hosts allowed. */
  unlistedDatabaseHosts: profiles(false, false),
  // ── storage ──────────────────────────────────────────────────────────────
  /** Creating or testing storage destinations; only the default `local` one under the data dir. */
  storageDestinations: profiles(false, false),
  // ── outgoing traffic ─────────────────────────────────────────────────────
  /** The automation webhook action, at save and at run. */
  webhooks: profiles(false, true),
  /** Add-on HTTP for every add-on (the egress client's declared hosts). */
  addOnHttp: profiles(false, true),
  /** Payment provider connections. */
  paymentProviders: profiles(false, true),
  /** Map pictures and routing servers (`ADMINIUM_MAP_SERVER` / `_ROUTING_SERVER`, enforced off in trial mode). */
  geoServers: profiles(false, true),
  /** The Designer's picture search and Figma. */
  designerNetwork: profiles(false, true),
  /** The release check (`updates.checkEnabled`, locked off). */
  updateCheck: profiles(false, true),
  /** Usage data (`telemetry.enabled`, and `ADMINIUM_TELEMETRY` enforced off). */
  telemetry: profiles(false, true),
  /** The user's own SMTP server: in trial mode all mail goes through the operator's relay. */
  ownSmtp: profiles(false, true),
  /** Marketing campaigns. */
  marketingCampaigns: profiles(false, true),
  /** A user-typed `llm.baseUrl`, for every provider. */
  aiBaseUrl: unlessOperatorAi,
  /** AI connections other than the user's own key to a fixed public provider (`openai-compatible`, Ollama). */
  customAiProviders: unlessOperatorAi,
  // ── own code ─────────────────────────────────────────────────────────────
  /** `POST /add-ons/upload` and `POST /apps/upload`: installs only from the catalogue or the image's bundle. */
  packageUploads: profiles(false, false),
  /** Designer uploads of site zips, styles and skills, and `PUT` of files. */
  designerUploads: profiles(false, false),
  /** The Designer writing code: hooks, actions, build code, `run_tests` (declarative only). */
  designerCode: profiles(false, false),
  /** Own build commands, and "Start with an app" (it fetches a repository and runs its build). */
  ownBuilds: profiles(false, false),
  /** The Designer's `request_package`. */
  requestPackage: profiles(false, false),
  /** The project's `.env` (read, and the Designer writing a key to it): not read at all. */
  projectDotEnv: profiles(false, false),
  // ── public pages ─────────────────────────────────────────────────────────
  /** Search engines may index public pages: no `noindex`, no disallowing `robots.txt`. */
  searchIndexing: profiles(false, true),
  /** Editing `system.publicOrigin`: the origin is the operator's. */
  publicOriginSetting: profiles(false, false),
  /** Answering any `Host`: otherwise only the public origin and `ADMINIUM_OPERATOR_DOMAINS` (421). */
  anyHost: profiles(false, false),
  /** Mapped domains of the user's own (`publicPages.websites`): only the operator's list. */
  mappedDomains: profiles(false, false),
  /** Pay pages. */
  payPages: profiles(false, true),
  /** Inbound payment webhooks. */
  paymentWebhooks: profiles(false, true),
  // ── past the end date ────────────────────────────────────────────────────
  /** Creating, editing and deleting: read-only once the trial has ended. */
  writes: untilTrialEnds,
  /** Public pages answering at all. */
  publicPages: untilTrialEnds,
  /** User-authored mail (system mail keeps its own quota). */
  userMail: untilTrialEnds,
  // ── size caps: asked only once a cap is passed ───────────────────────────
  /** Adding to a source database past `ADMINIUM_TRIAL_DATA_MAX_MB` of live data: INSERT, UPDATE, DDL that adds. */
  dataOverCap: uncappedOutsideTrial,
  /** Uploads, Designer writes and exports past `ADMINIUM_TRIAL_STORAGE_MAX_MB` in the data folder. */
  storageOverCap: uncappedOutsideTrial,
  /** More source connections than a trial's {@link TRIAL_SOURCE_CONNECTIONS}. */
  extraSourceConnections: uncappedOutsideTrial,
  // ── operator AI ──────────────────────────────────────────────────────────
  /** Customer screens built on the operator's AI connection. */
  customerScreensOnOperatorAi: (ctx) => (ctx.aiOperatorScope === 'dashboard' ? 'operator-ai-scope' : null),
} satisfies Record<string, Rule>;

export type PolicyQuestion = keyof typeof QUESTIONS;
export const POLICY_QUESTIONS = Object.keys(QUESTIONS) as PolicyQuestion[];

/** A trial's size caps, in bytes and counts; null outside trial mode (the hosted profile drops them). */
export interface TrialLimits {
  dataMaxBytes: number;
  uploadMaxBytes: number;
  storageMaxBytes: number;
  emailsPerDay: number;
  emailsPerHour: number;
  /** Source connections at most. */
  sourceConnections: number;
}

/** A trial's source connections, and the relay's hourly mail cap. */
export const TRIAL_EMAILS_PER_HOUR = 20;
export const TRIAL_SOURCE_CONNECTIONS = 3;

const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PolicyEnv = Pick<
  Env,
  | 'ADMINIUM_TRIAL_MODE'
  | 'ADMINIUM_HOSTED_MODE'
  | 'ADMINIUM_TRIAL_ENDS_AT'
  | 'ADMINIUM_TRIAL_UPGRADE_URL'
  | 'ADMINIUM_PUBLIC_ORIGIN'
  | 'ADMINIUM_TRIAL_DATA_MAX_MB'
  | 'ADMINIUM_TRIAL_UPLOAD_MAX_MB'
  | 'ADMINIUM_TRIAL_STORAGE_MAX_MB'
  | 'ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY'
  | 'ADMINIUM_AI_OPERATOR_ONLY'
  | 'ADMINIUM_AI_OPERATOR_SCOPE'
> &
  Partial<Pick<Env, 'ADMINIUM_NETWORK_POLICY'>>;

export interface TrialState {
  on: boolean;
  /** The end date, ISO 8601 UTC; null outside trial mode. */
  endsAt: string | null;
  /**
   * Whole days left, counting a part day as one, so the last day before the
   * end reads 1. Null outside trial mode AND once the trial has ended: the end
   * is a state read from {@link endsAt}, never a count of 0.
   */
  daysLeft: number | null;
  /** Ended: `now` is at or past the end date. */
  ended: boolean;
}

export interface TrialPolicy {
  profile: Profile;
  /** The answer to one question, at `now` (only the questions of a trial's end read the clock). */
  allows(question: PolicyQuestion, now?: number): PolicyAnswer;
  /** The trial's clock at `now`. */
  trial(now?: number): TrialState;
  /** The Upgrade button's address with `?instance=<ADMINIUM_PUBLIC_ORIGIN>`; null outside trial mode or unset. */
  upgradeUrl: string | null;
  /** A trial's size caps; null outside trial mode. */
  limits: TrialLimits | null;
  /**
   * `ADMINIUM_NETWORK_POLICY=strict`, which both profiles imply: outgoing calls (add-on HTTP among them)
   * never reach this server or its own network.
   */
  strictNetwork: boolean;
}

export function profileOf(env: Pick<Env, 'ADMINIUM_TRIAL_MODE' | 'ADMINIUM_HOSTED_MODE'>): Profile {
  // Both on fails the boot (`config/env.ts`); a caller that built an env by hand still gets the stricter one.
  if (env.ADMINIUM_TRIAL_MODE) return 'trial';
  if (env.ADMINIUM_HOSTED_MODE) return 'hosted';
  return 'off';
}

/**
 * The profile a RAW environment asks for, before it is parsed: for the project boot, which decides whether to read
 * the folder's `.env` before anything validates the environment that file would fill. On as the schema reads it.
 */
export function rawProfile(raw: Readonly<Record<string, string | undefined>>): Profile {
  const on = (name: string): boolean => ['on', 'true', '1'].includes(raw[name] ?? '');
  return profileOf({ ADMINIUM_TRIAL_MODE: on('ADMINIUM_TRIAL_MODE'), ADMINIUM_HOSTED_MODE: on('ADMINIUM_HOSTED_MODE') });
}

/** One question that depends on the profile alone (not the clock or an AI variable), for code that runs before the environment is parsed. */
export function allowsIn(profile: Profile, question: PolicyQuestion): PolicyAnswer {
  const reason = QUESTIONS[question]({ profile, ended: false, aiOperatorOnly: false, aiOperatorScope: null });
  return { allowed: reason === null, reason };
}

/** The Upgrade address as the button opens it: the operator's page, told which instance as a hint. */
function upgradeUrlOf(env: PolicyEnv): string | null {
  if (!env.ADMINIUM_TRIAL_MODE || env.ADMINIUM_TRIAL_UPGRADE_URL === undefined) return null;
  const url = new URL(env.ADMINIUM_TRIAL_UPGRADE_URL);
  if (env.ADMINIUM_PUBLIC_ORIGIN !== undefined) url.searchParams.set('instance', env.ADMINIUM_PUBLIC_ORIGIN);
  return url.toString();
}

export function trialPolicy(env: PolicyEnv, clock: () => number = Date.now): TrialPolicy {
  const profile = profileOf(env);
  const endsAt = profile === 'trial' ? (env.ADMINIUM_TRIAL_ENDS_AT ?? null) : null;
  const endMs = endsAt === null ? null : Date.parse(endsAt);

  const trial = (now: number = clock()): TrialState => {
    if (profile !== 'trial') return { on: false, endsAt: null, daysLeft: null, ended: false };
    // A trial with no end date fails the boot; one built by hand without it has not ended.
    const ended = endMs !== null && now >= endMs;
    return { on: true, endsAt, daysLeft: endMs === null || ended ? null : Math.ceil((endMs - now) / DAY_MS), ended };
  };

  return {
    profile,
    allows(question, now = clock()) {
      const reason = QUESTIONS[question]({
        profile,
        ended: trial(now).ended,
        aiOperatorOnly: env.ADMINIUM_AI_OPERATOR_ONLY,
        aiOperatorScope: env.ADMINIUM_AI_OPERATOR_SCOPE ?? null,
      });
      return { allowed: reason === null, reason };
    },
    trial,
    upgradeUrl: upgradeUrlOf(env),
    limits:
      profile === 'trial'
        ? {
            dataMaxBytes: env.ADMINIUM_TRIAL_DATA_MAX_MB * MB,
            uploadMaxBytes: env.ADMINIUM_TRIAL_UPLOAD_MAX_MB * MB,
            storageMaxBytes: env.ADMINIUM_TRIAL_STORAGE_MAX_MB * MB,
            emailsPerDay: env.ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY,
            emailsPerHour: TRIAL_EMAILS_PER_HOUR,
            sourceConnections: TRIAL_SOURCE_CONNECTIONS,
          }
        : null,
    strictNetwork: profile !== 'off' || env.ADMINIUM_NETWORK_POLICY === 'strict',
  };
}

/** An ordinary server's policy: everything allowed. The default of a route or service a harness builds without one. */
export const ORDINARY_POLICY: TrialPolicy = trialPolicy({
  ADMINIUM_TRIAL_MODE: false,
  ADMINIUM_HOSTED_MODE: false,
  ADMINIUM_TRIAL_ENDS_AT: undefined,
  ADMINIUM_TRIAL_UPGRADE_URL: undefined,
  ADMINIUM_PUBLIC_ORIGIN: undefined,
  ADMINIUM_TRIAL_DATA_MAX_MB: 500,
  ADMINIUM_TRIAL_UPLOAD_MAX_MB: 10,
  ADMINIUM_TRIAL_STORAGE_MAX_MB: 1000,
  ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY: 50,
  ADMINIUM_AI_OPERATOR_ONLY: false,
  ADMINIUM_AI_OPERATOR_SCOPE: undefined,
});
