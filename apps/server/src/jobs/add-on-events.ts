// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Add-on event handlers, as job kinds (26-add-on-runtime.md §5.3, 26-T10).
 *
 * ─── Why job kinds and not a parallel runner ───────────────────────────────
 *
 * §5.3, and it is the same argument as reusing `adminium_manifests`: the worker
 * already resolves handlers through a registry keyed by `job.kind`, already
 * retries with attempt counts, already supports cooperative cancellation, and
 * already publishes progress on `jobs:<jobId>`. An add-on that books a parcel
 * collection wants every one of those. Registering a kind gets them; a parallel
 * runner would mean reimplementing them, worse.
 *
 * ─── The kind namespace ────────────────────────────────────────────────────
 *
 * `add-on:<key>:<event>`. Namespaced because job kinds are one flat string
 * space shared with `export-run`, `import-run`, `llm-run` and the rest — an
 * add-on called `export` declaring an event called `run` must not be able to
 * shadow the exporter. The registry throws on a duplicate kind at registration,
 * so a collision is a boot failure rather than a silent takeover, and the prefix
 * makes one impossible in the first place.
 *
 * ─── INTERNAL, for the same reason `add-on-download` is ────────────────────
 *
 * The payload is the event's, and it reaches an add-on's server half — which
 * runs in this process (O1, ratified in-process 2026-08-29). A `jobs.manage`
 * holder able to hand-craft that payload through `POST /jobs` would be feeding
 * arbitrary input straight to in-process third-party-shaped code, bypassing
 * whatever the emitting host would have validated. These kinds are enqueued by
 * the dispatch path and nowhere else.
 *
 * ─── The handler contract, defined here because nowhere else defines it ────
 *
 * A manifest's `events[]` names `{ on, server }` — the event and the module
 * that handles it — and says nothing about what that module exports. So the
 * contract is stated here and nowhere else: the module exports `handle`, and
 * receives the payload plus a context carrying the ONE outbound client it is
 * allowed (the guarded one — an add-on never constructs its own) and its own
 * decrypted credential. Anything else is a load-time refusal with the add-on
 * named, never a silent no-op.
 */

import { z } from 'zod';

import type { AddOnHttpClient } from '../add-ons/egress.js';
import type { JobHandlerContext, JobRegistry } from './registry.js';

/** `add-on:<key>:<event>` — see the header on why this is namespaced. */
export function addOnEventKind(addOnKey: string, event: string): string {
  return `add-on:${addOnKey}:${event}`;
}

/**
 * The payload an add-on event job carries.
 *
 * Deliberately opaque: Adminium does not know what a `shipping-carrier`'s
 * `order.dispatched` event contains, and a schema that guessed would either
 * reject valid payloads or claim a validation it did not perform. The
 * EMITTER validates; this only bounds the envelope.
 */
export const addOnEventPayloadSchema = z.object({
  addOnKey: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),
  event: z.string().min(1).max(80),
  /** The event's own body, passed through untouched. */
  data: z.record(z.string(), z.unknown()).default({}),
  /** Owner convention (routes/jobs): who triggered it, when a person did. */
  userId: z.string().optional(),
});
export type AddOnEventPayload = z.infer<typeof addOnEventPayloadSchema>;

/** What an add-on's server half is handed when its event fires. */
export interface AddOnEventContext {
  /**
   * The ONE outbound client this add-on may use — exact-hostname allow-list,
   * redirect-refusing, body-metered, refusals audited. An add-on never
   * constructs its own; that it *could*, in-process, is what D13's publisher
   * gate is doing the work against.
   */
  http: AddOnHttpClient;
  /** The decrypted credential envelope, or null when it is not connected. */
  credential: Record<string, unknown> | null;
  /** Report progress; rides `jobs:<jobId>` unchanged (§5.3). */
  progress(pct: number, info?: { step?: string; message?: string }): void;
  log(message: string, data?: Record<string, unknown>): void;
  signal: AbortSignal;
}

/** The shape a `server` module must export to handle an event. */
export interface AddOnEventModule {
  handle(data: Record<string, unknown>, ctx: AddOnEventContext): Promise<unknown> | unknown;
}

/** Does this loaded module actually implement the contract? */
export function isEventModule(module: unknown): module is AddOnEventModule {
  return (
    module !== null &&
    typeof module === 'object' &&
    typeof (module as { handle?: unknown }).handle === 'function'
  );
}

/** One add-on event ready to be registered as a kind. */
export interface RegisterableAddOnEvent {
  addOnKey: string;
  event: string;
  /** The loaded `server` module for this event. */
  module: unknown;
  /** Built per add-on from its manifest, so the allow-list cannot be widened. */
  http: AddOnHttpClient;
  /** Resolves the decrypted credential at RUN time, not at registration. */
  credential: () => Promise<Record<string, unknown> | null>;
}

export interface RegisterAddOnEventsResult {
  registered: string[];
  /** Events whose module does not implement the contract, named not swallowed. */
  refused: Array<{ addOnKey: string; event: string; reason: 'NOT_AN_EVENT_MODULE' }>;
}

/**
 * Registers one job kind per add-on event.
 *
 * A module that does not implement the contract is REFUSED and reported rather
 * than registered — a kind whose handler cannot run is worse than no kind,
 * because the job would be enqueued, retried three times, and fail with a
 * message about a missing function rather than about a broken add-on.
 */
export function registerAddOnEventHandlers(
  registry: JobRegistry,
  events: readonly RegisterableAddOnEvent[],
): RegisterAddOnEventsResult {
  const registered: string[] = [];
  const refused: RegisterAddOnEventsResult['refused'] = [];

  for (const entry of events) {
    if (!isEventModule(entry.module)) {
      refused.push({ addOnKey: entry.addOnKey, event: entry.event, reason: 'NOT_AN_EVENT_MODULE' });
      continue;
    }
    const module = entry.module;
    const kind = addOnEventKind(entry.addOnKey, entry.event);

    registry.registerJobHandler(
      kind,
      addOnEventPayloadSchema,
      async (payload: AddOnEventPayload, ctx: JobHandlerContext) => {
        ctx.progress(5, { step: 'start', message: `${entry.addOnKey}: ${entry.event}` });
        // Resolved per run, never captured at registration: a credential
        // rotated or disconnected between boot and now must be the one this
        // sees, and a disconnected add-on must get `null` rather than a stale
        // secret closed over months ago.
        const credential = await entry.credential();
        const result = await module.handle(payload.data, {
          http: entry.http,
          credential,
          progress: ctx.progress,
          log: ctx.log,
          signal: ctx.signal,
        });
        ctx.progress(100, { step: 'done' });
        return result;
      },
      { internal: true },
    );
    registered.push(kind);
  }

  return { registered, refused };
}
