// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Audit-coverage registry (08-server-api.md §7 item 9): every state-changing
 * route either writes an audit row, or carries a written reason why it does not.
 *
 * ── WHY A DECLARATIVE MARKER AND NOT A SOURCE SCAN ──────────────────────────
 * "Does this route audit?" cannot be answered by grepping the handler body. The
 * scan that was tried first produced 17 false negatives across three structural
 * classes, all of them ordinary code:
 *
 *  - the write lives in a SHARED HELPER — `afterMutation()` in `routes/data`
 *    audits on behalf of every CRUD route that calls it;
 *  - the handler is HOISTED to a const and registered as a bare identifier
 *    (`app.put('/connections/:id/overrides', opts, putOverridesHandler as never)`),
 *    so its body is not lexically inside the `app.put(...)` call a scan anchors on;
 *  - the handler lives in a SIBLING FILE (`routes/auth/handlers.ts`).
 *
 * And it fails in the other direction too. `POST /widget-data/query` LOOKS
 * audited — `runDescriptor` really does call `app.rbac.audit` — but only on the
 * permission-denied branch; a SUCCESSFUL query writes nothing. Any scan reading
 * "an audit call appears near this route" would have passed it.
 *
 * So coverage is DECLARED, exactly the way §6 rate-limit buckets are: a
 * route-level `config.audit` marker, validated in an `onRoute` hook (`app.ts`),
 * read back off `route.config`. The marker is a claim by the route's author, not
 * a proof — its job is to make the claim explicit, reviewable, and impossible to
 * forget, because a state-changing route carrying no mark at all fails
 * {@link assertAuditCoverage}.
 *
 * ── THE THREE AUDIT WRITE PATHS ─────────────────────────────────────────────
 * A registry that knew only `app.rbac.audit` would false-alarm on 14 routes.
 * {@link AuditWritePath} names all three:
 *
 *  - `rbac`   — `app.rbac.audit(request, …)`, the decorator (~60 call sites).
 *               Reachable only from routes registered AFTER `rbacPlugin`, i.e.
 *               in `compose.ts` — never from inside `buildServer`, because
 *               Fastify 5 snapshots the parent's hooks/decorators into each
 *               child scope at creation time (see `plugins/rbac.ts`).
 *  - `auth`   — `auditAuth(meta, request, …)` from `src/auth/audit.ts`: the ten
 *               mutating `/auth` routes, `PATCH /me`, the desktop-session
 *               exchange, and the two routes `buildServer` registers itself,
 *               which for the reason above cannot use `rbac`.
 *  - `worker` — a bare `auditRepo(meta).append()` from a job worker, with no
 *               request in scope. The route enqueues; the row is written when
 *               the job runs. Invisible to a route-level registry, hence named.
 *
 * ── THE TABLE ───────────────────────────────────────────────────────────────
 * {@link AUDIT_COVERAGE} carries the marks for routes whose modules are not
 * annotated in place. It is checked identically to a marker, and a marker on the
 * route always wins over a table entry. New routes should carry the marker; the
 * table is a ledger to drain, not a second idiom.
 */
import type { RouteOptions } from 'fastify';

/** Which of the three write paths a route's audit row travels. */
export type AuditWritePath = 'rbac' | 'auth' | 'worker';

/** A route's declared audit coverage. */
export type AuditMark =
  | { readonly kind: 'audited'; readonly via: AuditWritePath }
  | { readonly kind: 'exempt'; readonly reason: string }
  | { readonly kind: 'gap'; readonly note: string };

/** This route writes an audit row, on `via`. */
export function audited(via: AuditWritePath): AuditMark {
  return { kind: 'audited', via };
}

/**
 * This route deliberately writes no audit row, and `reason` says why. The reason
 * is required and length-checked, because "exempt" with no argument is exactly
 * how a real gap gets filed as intentional.
 */
export function auditExempt(reason: string): AuditMark {
  return { kind: 'exempt', reason };
}

/**
 * This route SHOULD audit and does not — a known, tracked defect rather than a
 * decision. Distinct from `auditExempt` on purpose: the coverage test asserts
 * the gap set against a hard-coded list, so a gap can only ever be removed
 * without touching the test, never added.
 */
export function auditGap(note: string): AuditMark {
  return { kind: 'gap', note };
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** §7-item-9 coverage marker; validated by the `onRoute` hook in app.ts. */
    audit?: AuditMark;
  }
  interface FastifyInstance {
    /** Collected by the `onRoute` hook in app.ts; asserted by the coverage test. */
    auditCoverage: AuditCoverageRegistry;
  }
}

/** Methods that cannot change state, so nothing here needs a mark. */
const READ_ONLY_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Shortest reason accepted — long enough to be an explanation, not a shrug. */
const MIN_REASON_LENGTH = 12;

/** `POST /api/v1/jobs` — the key the marker check and the table share. */
export function auditRouteKey(method: string, url: string): string {
  return `${method} ${url}`;
}

/**
 * Marks for the routes whose modules are not annotated in place.
 *
 * Two of the exemptions are not new judgements — they are the reasons those
 * route modules already state in their own headers, quoted verbatim so the
 * ledger cannot quietly drift away from the source it claims to summarize.
 */
export const AUDIT_COVERAGE: Readonly<Record<string, AuditMark>> = {
  // ── /auth (08 §2.1) — every mutation, via `auditAuth` in routes/auth/handlers.ts.
  // Registered inside `buildServer`, so `app.rbac` is not reachable from them.
  'POST /api/v1/auth/login': audited('auth'), // login | login_failed | 2fa_challenge
  'POST /api/v1/auth/2fa/verify': audited('auth'), // login | 2fa_failed
  'POST /api/v1/auth/logout': audited('auth'),
  'DELETE /api/v1/auth/sessions/:id': audited('auth'), // session_revoked
  'POST /api/v1/auth/password/change': audited('auth'), // password_changed
  'POST /api/v1/auth/password/forgot': audited('auth'), // password_reset_requested
  'POST /api/v1/auth/password/reset': audited('auth'), // password_reset
  'POST /api/v1/auth/2fa/enroll': audited('auth'), // 2fa_enroll_started
  'POST /api/v1/auth/2fa/activate': audited('auth'), // 2fa_enrolled
  'POST /api/v1/auth/2fa/disable': audited('auth'), // 2fa_disabled
  // 11-electron.md §5, both the rejection and the failure paths.
  'POST /api/v1/auth/desktop-session': audited('auth'),

  // ── /me — the caller's own account and their own UI state.
  'PATCH /api/v1/me': audited('auth'), // me_updated, routes/me/handlers.ts
  'PATCH /api/v1/me/prefs': auditExempt(
    'Per-user UI preference (adminium_user_prefs), not workspace state: nobody else can observe the change and there is nothing to hold an actor to.',
  ),
  'POST /api/v1/me/notifications/:id/read': auditExempt(
    'Marks the caller’s own notification read — personal UI state, and one row per notification view would drown the trail.',
  ),
  'POST /api/v1/me/notifications/read-all': auditExempt(
    'Same personal read-state write as /:id/read, in bulk.',
  ),
  'PUT /api/v1/me/notification-prefs': auditExempt(
    'The caller’s own delivery preferences — a per-user setting, not a workspace one.',
  ),
  // routes/me-views/index.ts:12, verbatim: "Overrides are personal and
  // reversible, so they are not audited — only shared-default writes are
  // (see routes/pages)."
  'PUT /api/v1/me/views/:pageId/layout': auditExempt(
    'Overrides are personal and reversible, so they are not audited — only shared-default writes are (see routes/pages).',
  ),
  'DELETE /api/v1/me/views/:pageId/layout': auditExempt(
    'Overrides are personal and reversible, so they are not audited — only shared-default writes are (see routes/pages).',
  ),
  // routes/onboarding/index.ts:13, verbatim: "stored in
  // `adminium_user_prefs.uiState` … so it is not audit-logged, matching the
  // sibling `me/prefs` writes."
  'POST /api/v1/onboarding/dismiss': auditExempt(
    'Stored in adminium_user_prefs.uiState … so it is not audit-logged, matching the sibling me/prefs writes.',
  ),

  // ── Dry runs and stateless parses. Nothing persists, so there is no state
  // change for a trail to explain. (They still cost a live connection attempt,
  // which is the §6 rate limiter's problem, not this one's.)
  'POST /api/v1/connections/test': auditExempt(
    'Dry run: opens a probe connection against a submitted DSN and persists nothing.',
  ),
  'POST /api/v1/connections/:id/test': auditExempt(
    'Dry run against a stored connection; writes no row and changes no configuration.',
  ),
  'POST /api/v1/llm/config/test': auditExempt(
    'Dry run: round-trips the submitted provider credentials and stores neither them nor the result.',
  ),
  'POST /api/v1/schema-import/parse': auditExempt(
    'Stateless: parses a submitted schema document into a preview and persists nothing.',
  ),

  // ── READS expressed as POST, because the query descriptor does not fit a URL.
  // The permission-denied branch DOES audit (rbac permission.denied); a
  // successful query writes nothing, and should not — it is a read.
  'POST /api/v1/widget-data/query': auditExempt(
    'A read expressed as POST (the descriptor is too large for a query string); auditing successful reads is not the §7 item 9 contract.',
  ),
  'POST /api/v1/widget-data/batch': auditExempt(
    'A read expressed as POST, same as /query — the batch form of the same descriptor.',
  ),

  // ── Connections + schema (08 §2.4–§2.6).
  'POST /api/v1/connections': audited('rbac'), // connection.create
  'PATCH /api/v1/connections/:id': audited('rbac'), // connection.update
  'DELETE /api/v1/connections/:id': audited('rbac'), // connection.delete
  'POST /api/v1/connections/:id/introspect': audited('rbac'), // schema.introspect[.enqueue]
  'POST /api/v1/connections/:id/generate': audited('rbac'), // schema.generate
  // Both URLs share one hoisted handler in routes/schema/index.ts —
  // `schema.overrides.replace`. This pair is the hoisted-handler blind spot.
  'PUT /api/v1/connections/:id/schema/overrides': audited('rbac'),
  'PUT /api/v1/connections/:id/overrides': audited('rbac'),

  // ── CRUD (08 §3). Every one of these audits through the shared
  // `afterMutation()` helper in routes/data/index.ts — the shared-helper blind spot.
  'POST /api/v1/data/:connectionId/:table': audited('rbac'), // record.create
  'PATCH /api/v1/data/:connectionId/:table/:recordId': audited('rbac'), // record.update
  'DELETE /api/v1/data/:connectionId/:table/:recordId': audited('rbac'), // record.delete
  'POST /api/v1/data/:connectionId/:table/bulk': audited('rbac'), // record.bulk-*
  'POST /api/v1/data/undo/:token': audited('rbac'), // record.undo

  // ── Data-io (M7). The routes audit the request; the workers audit completion.
  'POST /api/v1/exports': audited('rbac'), // export.request (+ export.complete, worker)
  'POST /api/v1/imports/upload': audited('rbac'), // import.upload
  'POST /api/v1/imports': audited('rbac'), // import.validate
  'POST /api/v1/imports/:id/run': audited('rbac'), // import.run (+ record.import, worker)
  'POST /api/v1/scheduled-reports': audited('rbac'), // report.schedule
  'PATCH /api/v1/scheduled-reports/:id': audited('rbac'), // report.schedule.update
  'DELETE /api/v1/scheduled-reports/:id': audited('rbac'), // report.schedule.delete

  // ── Pages, views, widgets.
  'POST /api/v1/pages': audited('rbac'), // page.create
  'PATCH /api/v1/pages/:pageId': audited('rbac'), // page.update
  'DELETE /api/v1/pages/:pageId': audited('rbac'), // page.delete
  'PATCH /api/v1/pages/:pageId/layout': audited('rbac'), // page.layout.update
  'PATCH /api/v1/pages/:pageId/config': audited('rbac'), // page.config.update
  'POST /api/v1/pages/:pageId/duplicate': audited('rbac'), // page.duplicate
  'PUT /api/v1/pages/nav-order': audited('rbac'), // page.nav.reorder
  'POST /api/v1/pages/:pageId/views': audited('rbac'), // view.create
  'PATCH /api/v1/pages/:pageId/views/:viewId': audited('rbac'), // view.update
  'DELETE /api/v1/pages/:pageId/views/:viewId': audited('rbac'), // view.delete

  // ── Workspace settings, branding, templates, i18n.
  'PUT /api/v1/settings/defaults': audited('rbac'), // settings.defaults.update
  'PUT /api/v1/settings/branding': audited('rbac'), // settings.branding.update
  'PUT /api/v1/settings/security': audited('rbac'), // settings.security.update
  'PUT /api/v1/settings/telemetry': audited('rbac'), // settings.telemetry.update
  'POST /api/v1/branding/logo': audited('rbac'), // settings.branding.logo.update
  'DELETE /api/v1/branding/logo': audited('rbac'), // settings.branding.logo.remove
  'PUT /api/v1/email-templates/:key/:locale': audited('rbac'), // email-template.update
  'PUT /api/v1/i18n/keys': audited('rbac'), // i18n.key.update
  'DELETE /api/v1/i18n/keys': audited('rbac'), // i18n.key.reset
  'POST /api/v1/i18n/keys/bulk': audited('rbac'), // i18n.keys.bulk
  'POST /api/v1/i18n/import/:locale': audited('rbac'), // i18n.import
  'POST /api/v1/i18n/locales': audited('rbac'), // i18n.locale.create
  'PATCH /api/v1/i18n/locales/:locale': audited('rbac'), // i18n.locale.update
  'DELETE /api/v1/i18n/locales/:locale': audited('rbac'), // i18n.locale.delete

  // ── Identity + access (08 §5). The most audit-sensitive surface there is.
  'POST /api/v1/roles': audited('rbac'), // role.create
  'PATCH /api/v1/roles/:id': audited('rbac'), // role.update
  'DELETE /api/v1/roles/:id': audited('rbac'), // role.delete
  'PUT /api/v1/roles/:id/permissions': audited('rbac'), // role.permission.change
  'POST /api/v1/users/:id/roles': audited('rbac'), // user.role.assign
  'DELETE /api/v1/users/:id/roles/:roleId': audited('rbac'), // user.role.unassign
  'POST /api/v1/users': audited('rbac'), // user.invite
  'PATCH /api/v1/users/:id': audited('rbac'), // user.update | user.suspend | user.reactivate
  'DELETE /api/v1/users/:id': audited('rbac'), // user.delete
  'PUT /api/v1/users/:id/roles': audited('rbac'), // user.roles.replace
  'POST /api/v1/users/:id/invite/resend': audited('rbac'), // user.invite.resend
  'POST /api/v1/api-keys': audited('rbac'), // api-key.create
  'DELETE /api/v1/api-keys/:id': audited('rbac'), // api-key.revoke

  // The public surface's management routes (28-public-surface.md §3.3). Every
  // one of these changes what an anonymous caller can reach, so all of them are
  // audited via `app.rbac.audit` (hence the `rbac` WRITE PATH, not the `system`
  // category the rows carry) — including `reveal`, which is a READ. Re-reading a publishable
  // secret is the whole difference from `adm_sk_` and it should leave a trail.
  'PUT /api/v1/public-api': audited('rbac'), // public-api.toggle
  'POST /api/v1/public-scopes': audited('rbac'), // public-scope.create
  'PATCH /api/v1/public-scopes/:id': audited('rbac'), // public-scope.update
  'DELETE /api/v1/public-scopes/:id': audited('rbac'), // public-scope.delete
  'POST /api/v1/public-keys': audited('rbac'), // public-key.create
  'POST /api/v1/public-keys/:id/rotate': audited('rbac'), // public-key.rotate
  'DELETE /api/v1/public-keys/:id': audited('rbac'), // public-key.revoke

  // ── Desktop-only doors (11-electron.md). Registered only under
  // ADMINIUM_RUNTIME=desktop, so most topologies never see these keys — an
  // unused entry is harmless, a missing one fails the desktop boot's coverage.
  'POST /api/v1/desktop/local-database': audited('rbac'), // connection.create
  'POST /api/v1/desktop/demo-database': audited('rbac'), // connection.create
  'POST /api/v1/desktop/backup': audited('rbac'), // desktop_backup_created
  'POST /api/v1/desktop/capability-grants': audited('rbac'), // desktop_capability_granted
  'DELETE /api/v1/desktop/capability-grants': audited('rbac'), // desktop_capability_revoked

  // ── LLM assist (06-llm-assist.md).
  'PUT /api/v1/llm/config': audited('rbac'), // llm.config.update
  'POST /api/v1/llm/runs': audited('rbac'), // llm.run.create
  'POST /api/v1/llm/runs/:id/execute': audited('rbac'), // llm.run.execute
  'POST /api/v1/llm/runs/:id/response': audited('rbac'), // llm.run.response
  'POST /api/v1/llm/runs/:id/apply': audited('rbac'), // llm.run.apply
  'POST /api/v1/llm/runs/:id/undo/:token': audited('rbac'), // llm.run.undo

  // ── Background jobs (08 §2.17). The generic enqueue/cancel door; the
  // per-domain enqueues (exports, imports, introspect, reports) audit in their
  // own categories, and the worker audits what the job then did.
  'POST /api/v1/jobs': audited('rbac'), // job.enqueue
  'POST /api/v1/jobs/:id/cancel': audited('rbac'), // job.cancel

  // ── Local bridge. Unauthenticated by design, so it goes through `auditAuth`
  // like the other credential-facing doors rather than `app.rbac.audit`, which
  // would have no principal to stamp. See routes/bridge/index.ts § AUDIT.
  'POST /api/v1/bridge/handoff': audited('auth'), // bridge_handoff | bridge_handoff_refused
};

/** One `METHOD /url` pair and the mark that covers it. */
export interface AuditCoverageRow {
  method: string;
  url: string;
  mark: AuditMark | null;
  /** Where the mark came from; `null` when there is none. */
  source: 'route' | 'table' | null;
}

export interface AuditCoverageRegistry {
  /** Called from the `onRoute` hook in app.ts for every registered route. */
  record(route: RouteOptions): void;
  /** Every state-changing `/api` route seen so far, in registration order. */
  rows(): readonly AuditCoverageRow[];
  /** Rows carrying neither a marker nor a table entry — the failure set. */
  unmarked(): readonly AuditCoverageRow[];
  /** Rows explicitly marked {@link auditGap}, as `METHOD /url` keys. */
  knownGaps(): readonly string[];
}

/**
 * Throws when `value` is present but is not a well-formed {@link AuditMark}.
 *
 * Boot-time, like the unknown-rate-bucket throw in `plugins/core.ts`: a
 * malformed marker is a programming error, and one that would otherwise read to
 * the registry as "covered".
 */
export function assertWellFormedMark(value: unknown, where: string): AuditMark | undefined {
  if (value === undefined) return undefined;
  const mark = value as { kind?: unknown; via?: unknown; reason?: unknown; note?: unknown };
  if (mark.kind === 'audited') {
    if (mark.via === 'rbac' || mark.via === 'auth' || mark.via === 'worker') {
      return value as AuditMark;
    }
    throw new Error(
      `route ${where} declares config.audit with unknown write path ${JSON.stringify(mark.via)} — use audited('rbac' | 'auth' | 'worker') (src/audit/coverage.ts)`,
    );
  }
  if (mark.kind === 'exempt' || mark.kind === 'gap') {
    const prose = mark.kind === 'exempt' ? mark.reason : mark.note;
    if (typeof prose === 'string' && prose.trim().length >= MIN_REASON_LENGTH) {
      return value as AuditMark;
    }
    throw new Error(
      `route ${where} declares audit${mark.kind === 'exempt' ? 'Exempt' : 'Gap'}() without a usable reason — say why in at least ${String(MIN_REASON_LENGTH)} characters (src/audit/coverage.ts)`,
    );
  }
  throw new Error(
    `route ${where} declares config.audit that is none of audited() / auditExempt() / auditGap() (src/audit/coverage.ts)`,
  );
}

export function createAuditCoverageRegistry(
  table: Readonly<Record<string, AuditMark>> = AUDIT_COVERAGE,
): AuditCoverageRegistry {
  const collected: AuditCoverageRow[] = [];

  return {
    record(route) {
      if (!route.url.startsWith('/api/')) return;
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (READ_ONLY_METHODS.has(method)) continue;
        const declared = assertWellFormedMark(route.config?.audit, `${method} ${route.url}`);
        if (declared !== undefined) {
          collected.push({ method, url: route.url, mark: declared, source: 'route' });
          continue;
        }
        const fromTable = table[auditRouteKey(method, route.url)];
        collected.push(
          fromTable === undefined
            ? { method, url: route.url, mark: null, source: null }
            : { method, url: route.url, mark: fromTable, source: 'table' },
        );
      }
    },
    rows: () => collected,
    unmarked: () => collected.filter((row) => row.mark === null),
    knownGaps: () =>
      collected
        .filter((row) => row.mark?.kind === 'gap')
        .map((row) => auditRouteKey(row.method, row.url)),
  };
}

/** The failure message, exported so the coverage test renders the same list. */
export function formatAuditGaps(unmarked: readonly AuditCoverageRow[]): string {
  return [
    `${String(unmarked.length)} state-changing route(s) declare no audit coverage:`,
    ...unmarked.map((row) => `  ${row.method} ${row.url}`),
    '',
    'Declare it on the route — `config: { audit: audited("rbac") }`, or',
    '`auditExempt("why not")` — or add an entry to AUDIT_COVERAGE',
    '(apps/server/src/audit/coverage.ts).',
  ].join('\n');
}

export function assertAuditCoverage(registry: AuditCoverageRegistry): void {
  const unmarked = registry.unmarked();
  if (unmarked.length > 0) throw new Error(formatAuditGaps(unmarked));
}
