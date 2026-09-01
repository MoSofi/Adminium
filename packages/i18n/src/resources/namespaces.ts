// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The namespace axis, and which side of the bundle split each one is on
 * (10-i18n-theming.md §2.3).
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
export const NAMESPACES = ['common', 'ui', 'studio', 'generated', 'errors'] as const;
export type Namespace = (typeof NAMESPACES)[number];

/**
 * Bundled into the caller's main chunk for en-US and loaded at init for every
 * locale: this is the text the first paint needs, and the fallback chain that
 * stands behind a partially-translated locale. It must never be async.
 */
export const EAGER_NAMESPACES = ['common', 'ui', 'generated', 'errors'] as const;
export type EagerNamespace = (typeof EAGER_NAMESPACES)[number];

/**
 * Loaded on demand, en-US included (10-T06 — the split this file's header in
 * ./index.ts promised from the first wave).
 *
 * `studio` is the whole admin console: 975 messages, ~36 KiB of the en-US
 * catalogue, behind a role gate that most users never pass and route bodies
 * that are already lazy. Every other locale was already paying for it twice —
 * once as English in the entry chunk, once as their own translation over the
 * wire — and an en-US operator was downloading a console they may never open.
 *
 * The contract a deferred namespace owes: nothing outside its own surface may
 * read a key from it, and that surface must await {@link Namespace} loading
 * before it renders. See `apps/dashboard/src/studio/routes.tsx`.
 */
export const DEFERRED_NAMESPACES = ['studio'] as const;
export type DeferredNamespace = (typeof DEFERRED_NAMESPACES)[number];

/** A single namespace's message tree (nested string leaves). */
export type ResourceBundle = { readonly [key: string]: string | ResourceBundle };
