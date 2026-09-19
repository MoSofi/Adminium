// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The namespace axis, and which side of the bundle split each one is
 * on.
 *
 * DATA-FREE ON PURPOSE. `create-i18n.ts` needs the namespace list, and it is
 * on the dashboard's boot path — so if these constants lived beside
 * `EN_US_RESOURCES` (./index.ts), importing the list would pull every en-US
 * mirror into the entry chunk and leave the split depending on whether Rollup
 * happened to shake the unused binding out. Nothing here imports a bundle, so
 * there is nothing to shake.
 */

/** Every authored namespace. The editor, the parity gate and the translation
 *  routes all work across the whole set, regardless of how it is delivered. */
export const NAMESPACES = [
  'common',
  'ui',
  'studio',
  'generated',
  'errors',
  'email',
  'invoices',
  'automations',
  'dataio',
  'files',
  'reportBuilder',
  'onboarding',
  'project',
  'assistant',
  'addOns',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

/**
 * Bundled into the caller's main chunk for en-US and loaded at init for every
 * locale: this is the text the first paint needs, and the fallback chain that
 * stands behind a partially-translated locale. It must never be async.
 */
export const EAGER_NAMESPACES = ['common', 'ui', 'generated', 'errors'] as const;
export type EagerNamespace = (typeof EAGER_NAMESPACES)[number];

/**
 * Loaded on demand, en-US included (the split this file's header
 * in./index.ts promised from the first wave).
 *
 * `studio` is the whole admin console: 975 messages, ~36 KiB of the en-US
 * catalogue, behind a role gate that most users never pass and route bodies
 * that are already lazy. Every other locale was already paying for it twice —
 * once as English in the entry chunk, once as their own translation over the
 * wire — and an en-US operator was downloading a console they may never open.
 *
 * `email` is the Email templates manager and editor (39-email-templates-and-
 * campaigns.md): a few hundred messages behind two lazy routes that most
 * sessions never open, and a surface that keeps growing — every string it
 * gained while it lived under `common` landed in the entry chunk of every
 * route.
 *
 * `invoices` is the Invoices manager and editor: the same shape as
 * `email` — two lazy routes, a few hundred messages, a surface most
 * sessions never open — and the same bargain.
 *
 * `automations` is Automation rules and Workflow logs (42-automations-and-
 * workflow-logs.md): two lazy admin routes behind a permission most users
 * never hold, carrying the flow builder's whole vocabulary — every node kind,
 * operator, unit, status and picker tile — which is a lot of text for a page
 * the majority of sessions never open.
 *
 * `reportBuilder` is the report builder — the Reports manager and its block
 * editor: two lazy routes carrying a 25-kind block vocabulary, its
 * inspector's field labels and twelve starter cards, for a surface most
 * sessions never open. NOT `reports`, which is the `common:` block
 * Scheduled Reports reads.
 *
 * `dataio` is the import wizard, the exports manager and the export builder,
 * and `files` is the Files library and its upload dialog — three lazy route
 * bodies and one dialog. Both lived under `common` until 2026-09-08, which
 * meant every route downloaded them; the entry-chunk ratchet is what noticed.
 * Two keys did NOT come along: `dataio.import.title`/`dataio.exports.title`
 * were read by the statically imported `data-io/routes.tsx` and are
 * byte-identical to `common:nav.imports` /`nav.exports`, so that module reads
 * the `common:` twins instead — the same Topbar problem the `studio` split
 * hit. `files.uploadsUnavailable` went the same way: its reader is the
 * page-files TEMPLATE, which renders inside a user-built page and would never
 * await this namespace, and the widget already falls back to a byte-identical
 * `ui:templates.files.uploadsUnavailable`.
 *
 * `email` gained 143 keys in the same change, and they are the reason the
 * SERVER loads the whole deferred set (packages/i18n/src/server.ts): every one
 * of those call sites is in apps/server's email-template machinery, and they
 * had been sitting in `common` since before `email.json` existed — shipping
 * server-only text in every dashboard user's boot chunk.
 *
 * `onboarding` is the six-step first-run wizard: 107 messages for the ONE
 * screen an instance shows once in its life. Measured at 2.5 KiB gzipped — four
 * times the entry ratchet's remaining headroom — for a surface no session ever
 * returns to, which is the same bargain every namespace above it took. It is
 * the only deferred namespace whose surface renders BEFORE anyone signs in, so
 * `setup/onboarding/onboardingMessages.ts` awaits it under the Suspense
 * boundary that already waits on `setup.state`. Two blocks did NOT come along:
 * `common:setup.account.*` and `common:setup.consent.*` are read by
 * `setup/accountValidation.ts` and `setup/TelemetryConsent.tsx`, which the
 * DESKTOP setup host renders too — a surface that would never await this
 * namespace.
 *
 * `project` is what the dashboard says about a project's own browser code:
 * a page or widget that did not load, a cell that could not be drawn, the
 * UI kit's empty table. A handful of messages, for the few servers that run
 * a project folder at all; its readers are the lazily loaded project
 * modules, which await it before they render.
 *
 * `assistant` is the page assistant's modal: everything it says on the four
 * pages it can be opened from, including four sets of per-page copy. It is
 * behind a `lazy()` import inside three already-lazy routes, and most sessions
 * never open it — so the entry chunk pays only for this namespace's loader
 * entries, which is the same bargain every namespace above it took. Its two
 * BUTTON strings are the exception that shapes the rule: a host page renders
 * the button before the modal's chunk exists, so each host route awaits this
 * namespace beside its own.
 *
 * The contract a deferred namespace owes: nothing outside its own surface may
 * read a key from it, and that surface must await {@link Namespace} loading
 * before it renders. See `apps/dashboard/src/studio/routes.tsx`,
 * `apps/dashboard/src/email/emailMessages.ts`,
 * `apps/dashboard/src/invoices/invoicesMessages.ts` and
 * `apps/dashboard/src/automations/automationsMessages.ts`,
 * `apps/dashboard/src/data-io/dataIoMessages.ts`,
 * `apps/dashboard/src/files/filesMessages.ts`,
 * `apps/dashboard/src/report-builder/reportBuilderMessages.ts` and
 * `apps/dashboard/src/project/projectMessages.ts` and
 * `apps/dashboard/src/assistant/assistantMessages.ts`.
 */
export const DEFERRED_NAMESPACES = [
  'studio',
  'email',
  'invoices',
  'automations',
  'dataio',
  'files',
  'reportBuilder',
  'onboarding',
  'project',
  'assistant',
  /*
   * What the DASHBOARD says about an add-on's own pages — the states a host
   * draws when the add-on is absent, switched off, or its module will not load
   * (51d). Deferred because every one of those strings is rendered by the lazy
   * page host and by nothing else: in `common` they were 0.85 KiB of an entry
   * chunk that is measured to the byte.
   */
  'addOns',
] as const;
export type DeferredNamespace = (typeof DEFERRED_NAMESPACES)[number];

/** A single namespace's message tree (nested string leaves). */
export type ResourceBundle = { readonly [key: string]: string | ResourceBundle };
