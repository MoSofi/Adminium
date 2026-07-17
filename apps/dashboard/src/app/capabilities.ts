/**
 * `GET /api/v1/system/info` — the deployment's capability flags, and the §8.2
 * gating matrix built on them (11-electron.md §8.1, §8.2).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE, from `designs/Empty States.dc.html` and
 * quoted in §8.2: **never hide, always explain** — icon + headline + one line of
 * guidance + (when possible) an action. So the helpers below never answer a bare
 * boolean for a feature the user can see. They return a {@link FeatureGate}: is
 * it enabled, and if not, WHAT DO WE SAY. A boolean would let a caller render a
 * greyed-out button with no explanation, which is the exact failure the rule
 * names.
 *
 * The one exception is `hosted-plan` surfaces (§8.2 row 1: billing, usage
 * meters, AI credits), which are "not rendered at all" — they are Cloud portal
 * pages (12-cloud-platform.md), so there is no user here to explain anything to.
 * See {@link isHostedPlanSurface}.
 *
 * WHAT IS DELIBERATELY ABSENT: §8.2 has six rows; this module has helpers for
 * the three whose surfaces exist (hosted-plan, email sends, LLM). The other
 * three have no page, no route and no server resource in this build — scheduled
 * reports ("delivery = email if SMTP configured, else snapshot into
 * `adminium_exports`") and webhooks/integrations ("rows show a 'Requires
 * internet' hint") have meta tables and nothing else; the marketplace
 * ("'Install from file' always works; browsing the storefront opens the system
 * browser") is 13-marketplace.md's, unbuilt.
 *
 * A helper written now for a caller that does not exist is a gate that gates
 * nothing while looking like coverage, and this codebase has shipped that
 * mistake before. Each of those rows is one small function, written by whoever
 * builds the surface, against `smtpConfigured` / `networkFeaturesAllowed` —
 * which this task's whole job was to make available and true.
 *
 * WHY THE SERVER AND NOT `window.adminiumDesktop`: §4 — "the SPA trusts the
 * server for feature gating and the bridge only for native affordances". See
 * `lib/desktop-runtime.ts`, which says the same thing from the other side.
 *
 * SYNC NOTE: `SystemInfo` mirrors the Zod reply in
 * `apps/server/src/routes/system/schema.ts` (the copied-mirror convention from
 * `app/bootstrap.ts`). Change both together.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';

import { api } from './api.js';

export type Runtime = 'self-host' | 'desktop';

export interface SystemInfo {
  version: string;
  node: string;
  dialect: 'postgres' | 'mysql' | 'sqlite' | null;
  /** Which wrapper booted the server (§4 detection contract). */
  runtime: Runtime;
  /** `email.smtp` is set. NOT "email will succeed" — see the server schema. */
  smtpConfigured: boolean;
  /**
   * Operator POLICY for outbound features (`ADMINIUM_NETWORK_FEATURES`), NOT a
   * reachability claim. Nothing in the product may render this as "the internet
   * is up": §8.2's webhooks row says "rows show a 'Requires internet' HINT",
   * and a hint is all anyone here is entitled to.
   */
  networkFeaturesAllowed: boolean;
  /**
   * §6 step 2 card 4: can this build seed the demo database?
   *
   * `false` means `POST /desktop/demo-database` is not mounted — either this is
   * not the desktop runtime, or it is a desktop build with no
   * `ADMINIUM_DEMO_SEED_SCRIPT`. The first-run wizard renders the card either
   * way and explains itself when this is false (§8.2: "never hide, always
   * explain"), which is why the flag is a fact rather than a reason to omit a
   * card.
   */
  desktopDemo: boolean;
  /**
   * §8.3: is this desktop process bound to every interface, i.e. reachable from
   * the LAN right now?
   *
   * THE BIND, NOT THE TOGGLE. `config.json`'s `lanShare.enabled` is an intent
   * the user can change at any moment; this is the state of the server's own
   * socket, which is what `desktop/lan-share.ts` derives it from. The two
   * disagree for a whole server lifetime whenever a rebind has failed or has not
   * happened yet — precisely the window in which §8.1's chip must not claim
   * "Sharing on LAN" over a loopback-only server, or the reverse.
   *
   * Always `false` on self-host: binding `0.0.0.0` behind a reverse proxy is the
   * normal, correct configuration there and is not this feature.
   */
  lanShare: boolean;
}

/**
 * The flags change only when an operator changes them — never per navigation —
 * but SMTP is editable from Settings inside this same session, so this is not
 * `staleTime: Infinity` like `['bootstrap']`. Five minutes keeps a freshly
 * configured SMTP from leaving "Configure SMTP to send email" on screen for the
 * rest of the session, without making a poll out of it.
 */
const SYSTEM_INFO_STALE_MS = 5 * 60_000;

export function systemInfoQuery() {
  return queryOptions({
    queryKey: ['system', 'info'] as const,
    staleTime: SYSTEM_INFO_STALE_MS,
    queryFn: () => api.get<SystemInfo>('/api/v1/system/info'),
  });
}

/**
 * What the flags say the SPA should assume when the answer has not arrived yet.
 *
 * `runtime: 'self-host'` and `networkFeaturesAllowed: true` are the majority
 * deployment, and both fail SAFE in the sense that matters: they under-claim
 * desktop-ness (no chip rather than a wrong chip) and they leave network
 * features offered rather than hiding them from an instance that can use them.
 * `smtpConfigured: false` is the deliberately pessimistic one — offering a Send
 * button that silently drops mail is worse than an explained disabled one.
 *
 * NOT EXPORTED: these are defaults for "not yet", NOT for "we asked and it
 * failed", and the difference is a locked-out user being told falsely that their
 * instance has no mail server. {@link useCapabilities} is the only legitimate
 * reader because it hands back {@link Capabilities.resolved} alongside them, so
 * a caller cannot take a default for an answer without saying so.
 */
const UNKNOWN_SYSTEM_INFO: Pick<
  SystemInfo,
  'runtime' | 'smtpConfigured' | 'networkFeaturesAllowed' | 'lanShare' | 'desktopDemo'
> = {
  runtime: 'self-host',
  smtpConfigured: false,
  networkFeaturesAllowed: true,
  // Fails safe in the same sense as `runtime`: a chip that has not yet been told
  // the server is sharing draws nothing, where one that assumed `true` would
  // announce a network exposure that may not exist.
  lanShare: false,
  // Pessimistic, like `smtpConfigured`: a demo card that has not been told the
  // route exists must not offer a button that 404s. The wizard reads this only
  // once `resolved` is true, so the value below is what "still asking" renders.
  desktopDemo: false,
};

export interface Capabilities {
  flags: Pick<
    SystemInfo,
    'runtime' | 'smtpConfigured' | 'networkFeaturesAllowed' | 'lanShare' | 'desktopDemo'
  >;
  /**
   * Did the flags come from the SERVER (`true`), or are they still
   * {@link UNKNOWN_SYSTEM_INFO}'s assumptions (`false`)?
   *
   * The distinction exists because the two "unresolved" cases are not the same
   * fact and must not be rendered as one. Pending is momentary and harmless.
   * FAILED is neither: `/system/info` can 5xx on a meta-store blip, the query
   * client retries twice on a 5xx and then stops, and `flags` sits on the
   * defaults for the rest of the page's life. A surface that reads
   * `smtpConfigured: false` in that state and prints "this Adminium has no email
   * server configured" is telling a user locked out of their account a lie about
   * a healthy instance, and taking their password reset away over one failed
   * probe. Anything asserting a configuration FACT must check this; anything
   * merely choosing a layout need not.
   */
  resolved: boolean;
}

/**
 * The one way to read `/system/info` in a component: the flags, already merged
 * with their defaults, plus whether they are real.
 *
 * Non-suspending on purpose — the callers are a topbar badge, a pre-auth form
 * and two settings panels, none of which should hold a route hostage to a
 * probe. It exists because the merge was hand-copied at four call sites, and a
 * hand-copied merge is where the pending/failed distinction went missing.
 */
export function useCapabilities(): Capabilities {
  const query = useQuery(systemInfoQuery());
  const data = query.data;
  return {
    flags: {
      runtime: data?.runtime ?? UNKNOWN_SYSTEM_INFO.runtime,
      smtpConfigured: data?.smtpConfigured ?? UNKNOWN_SYSTEM_INFO.smtpConfigured,
      networkFeaturesAllowed: data?.networkFeaturesAllowed ?? UNKNOWN_SYSTEM_INFO.networkFeaturesAllowed,
      lanShare: data?.lanShare ?? UNKNOWN_SYSTEM_INFO.lanShare,
      desktopDemo: data?.desktopDemo ?? UNKNOWN_SYSTEM_INFO.desktopDemo,
    },
    resolved: data !== undefined,
  };
}

// ── The §8.2 matrix ──────────────────────────────────────────────────────────

/**
 * A gated feature and the copy that explains it. `reason` is a CODE, not a
 * string: this module has no `t()` (it is imported by pure tests), and the
 * caller — which already has the surrounding sentence's context — localizes it.
 */
export interface FeatureGate {
  enabled: boolean;
  /** `null` ⇔ `enabled` — there is nothing to explain about a working feature. */
  reason: GateReason | null;
}

export type GateReason =
  /** §8.2 email row: "Configure SMTP to send email" + link. */
  | 'smtp-not-configured'
  /** The operator declared this install air-gapped (`ADMINIUM_NETWORK_FEATURES=off`). */
  | 'network-disabled';

const ENABLED: FeatureGate = { enabled: true, reason: null };

type Flags = Pick<SystemInfo, 'smtpConfigured' | 'networkFeaturesAllowed'>;

/**
 * §8.2, "Email sends (templates, dunning-style lifecycle mails, invites)":
 * "Enabled only when SMTP is configured in settings; otherwise buttons disabled
 * with 'Configure SMTP to send email' + link".
 *
 * Note what is NOT consulted: `networkFeaturesAllowed`. An air-gapped install
 * with an SMTP relay on its own LAN sends mail perfectly well — §7's email row
 * says "actual sending requires user-configured SMTP", and says nothing about
 * the internet. Folding the two flags together would break exactly that
 * deployment.
 */
export function emailSendGate(flags: Flags): FeatureGate {
  return flags.smtpConfigured ? ENABLED : { enabled: false, reason: 'smtp-not-configured' };
}

/**
 * May this deployment be OFFERED a feature that needs the network?
 *
 * `enabled` means MAY BE OFFERED, never WILL SUCCEED — the server cannot promise
 * the latter (see `SystemInfo.networkFeaturesAllowed`). Callers pair the enabled
 * case with a "requires internet" hint and let failures use the standard retry
 * UI.
 *
 * NOT EXPORTED. §8.2's webhooks/integrations row is the obvious caller and it
 * does not exist yet — there is no webhooks page, no integrations page, and no
 * `/api/v1/webhooks` route in this build. Exporting this for that future caller
 * would ship a gate nothing gates, which reads as coverage and is not; when the
 * webhooks surface lands, exporting it is a one-line change made by someone who
 * has a call site to point at. Today `llmAffordances` is the only consumer.
 */
function networkFeatureGate(flags: Flags): FeatureGate {
  return flags.networkFeaturesAllowed ? ENABLED : { enabled: false, reason: 'network-disabled' };
}

/**
 * §8.2, "LLM provider-API mode": "Available, labeled; BYO round-trip is the
 * default and is highlighted first in desktop".
 *
 * Two separate answers, and conflating them is the trap:
 *
 *  - `providerApi` — the direct-API path. It needs the internet, so an
 *    air-gapped install gets the explained-disabled state rather than a card
 *    that times out. On a normal install it is enabled AND labeled: §6 step 4's
 *    "API-credential mode is available but labeled 'Requires internet & an API
 *    key'".
 *  - `byoFirst` — presentation only. Desktop leads with the copy/paste
 *    round-trip (§6 step 4, §7's LLM row, 06-llm-assist.md). It is NOT gated:
 *    BYO makes zero network calls and works in every runtime.
 */
export interface LlmAffordances {
  providerApi: FeatureGate;
  /** Order BYO first and highlight it (desktop, or anywhere without network). */
  byoFirst: boolean;
}

export function llmAffordances(
  info: Pick<SystemInfo, 'runtime' | 'networkFeaturesAllowed'>,
): LlmAffordances {
  return {
    providerApi: networkFeatureGate({ smtpConfigured: false, ...info }),
    // Air-gapped self-hosts get the same lead as desktop: on an install where
    // the direct path cannot work, showing it first is an invitation to a dead
    // end. §7 makes the desktop case contractual; this makes it coherent.
    byoFirst: info.runtime === 'desktop' || !info.networkFeaturesAllowed,
  };
}

/**
 * §8.2 row 1 — "Hosted-plan surfaces (billing, usage meters, AI credits): Not
 * rendered at all — these are Cloud portal pages (12-cloud-platform.md), absent
 * from self-host/desktop nav".
 *
 * "Not rendered at all" is a stronger promise than a gate, and the codebase
 * mostly keeps it BY CONSTRUCTION rather than by checking: there is no billing
 * page, no usage meter, and `studio/ai/providerCatalog.ts` omits the
 * `adminium-managed` (Cloud AI credits) provider outright. Absent code cannot
 * leak.
 *
 * This predicate covers the one surface that is NOT absent: `/state/$stateId`
 * addresses every system state by id (`states/stateMap.ts`), including
 * `suspended` — a 402 "billing past due" screen with an "Update payment" button.
 * That state can only ever be produced by a Cloud instance, so on self-host and
 * desktop it is a billing page a user can navigate to in a product that has no
 * billing. The `/state/$stateId` route (`app/router.tsx`) asks this before
 * rendering — not `StatePage` itself, which also serves the legitimate inline
 * states (`StudioGuard`'s forbidden, and the error boundaries') that have
 * nothing to do with billing.
 */
const HOSTED_PLAN_STATE_IDS: readonly string[] = ['suspended'];

/**
 * NO `runtime` PARAMETER, deliberately. Both members of {@link Runtime} —
 * `self-host` and `desktop` — are billing-free, so a runtime argument could not
 * change this answer; it would read as a live gate while being an always-true
 * comparison, which is worse than no gate at all. When `cloud` joins the enum
 * (12-cloud-platform.md), THIS is the function that gets the carve-out, and its
 * callers do not change.
 */
export function isHostedPlanSurface(stateId: string): boolean {
  return HOSTED_PLAN_STATE_IDS.includes(stateId);
}
