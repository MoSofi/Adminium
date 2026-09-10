// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DRAW A DOCUMENT (34-invoices-add-on.md §7.2 as ruled by D55; 34-T10).
 *
 * ─── Why this is a rule's STEP and not a trigger table of its own ──────────
 *
 * §7.2 designed `adminium_record_triggers`: a second table, a second matcher,
 * a second undo window, a second dedupe key, a second delay-by-origin rule.
 * Every one of those already existed by the time 34b started — plan 42 built
 * them for automations on 2026-09-08 — and O4's only objection to reusing
 * them was that `automations.manage` was a reserved grant, which 42 also
 * un-reserved in the same change. So the owner ruled reuse (D55), and "when a
 * new order is created, draw an invoice" is a rule with one step: this one.
 *
 * The consequence worth stating: this step is VISIBLE in the Automations UI,
 * because it is an ordinary rule. That is a deliberate trade — a rule
 * somebody can see and is told not to edit beats a render that fires from
 * nowhere with no page that explains it.
 *
 * ─── ONE FIELD, BECAUSE THE PROFILE OWNS EVERYTHING ELSE ───────────────────
 *
 * The action carries a `profileId` and nothing more. The mapping, the paper,
 * the formats, the number prefix and the provider all live on the profile,
 * where an operator edits them in Studio with the provider's own slot labels
 * in front of them. Copying any of it here would give one document two
 * sources of truth, and the copy in the rule would be the stale one.
 *
 * ─── THE DRY RUN STOPS ONE LINE SHORT, LIKE EVERY OTHER ACTION ─────────────
 *
 * Test resolves the profile, the provider and the outline — everything that
 * can be wrong before bytes exist — and does not render, does not store, and
 * does not touch the number sequence. That is what makes "Test executes
 * nothing" true for a step whose side effect is a numbered business document.
 */

import { documentProfilesRepo, type AutomationAction } from '@adminium/meta';

import { providerByKey } from '../../add-ons/runtime.js';
import {
  DOCUMENT_RENDER_CONTRACT,
  DOCUMENT_RENDER_VERSION,
  renderDocument,
  type RenderDeps,
} from '../../documents/render.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';

type DocumentRenderAction = Extract<AutomationAction, { kind: 'document.render' }>;

/**
 * How the step reaches the pipeline.
 *
 * On the CONTEXT rather than imported, for the same reason the email action
 * takes a transport factory: a unit test of this step must be able to run it
 * without a file store, a connection pool and an installed add-on.
 */
function depsOf(ctx: ActionContext): RenderDeps {
  const deps = ctx.documents;
  if (deps === undefined) {
    throw new ActionFailure('This deployment cannot draw documents — no document pipeline is wired.');
  }
  return deps;
}

export async function runDocumentRenderAction(
  action: DocumentRenderAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  if (action.profileId === null) {
    throw new ActionFailure('This step has no document mapping chosen.');
  }
  if (ctx.source === null) {
    /*
     * A schedule tick has no record. A document is ABOUT something — a row,
     * an order, a booking — so a rule that runs on a timer has nothing to
     * draw, and saying so is better than drawing an empty one.
     */
    throw new ActionFailure('A document needs a record; this rule ran on a schedule.');
  }

  const outcome = await renderDocument(depsOf(ctx), {
    profileId: action.profileId,
    pk: ctx.source.record.pk,
    // WHOEVER WROTE THE ROW, not the rule's author and not the system. A
    // triggered render reads the source with the requester's grants (D16), so
    // the identity has to be the one that caused the write.
    requestedBy: ctx.rule.createdBy ?? null,
    actorKind: 'system',
    jobId: ctx.runId,
  });

  switch (outcome.status) {
    case 'rendered':
      return { log: ctx.text.docOk(outcome.document.number ?? outcome.document.id) };
    case 'skipped':
      // Not a failure: a disabled mapping, an uninstalled add-on and a
      // deleted row are all ordinary, and none of them is something the
      // person reading the run log did wrong.
      return { log: ctx.text.docSkipped(outcome.reason) };
    case 'failed':
      throw new ActionFailure(`The document could not be drawn: ${outcome.error}`);
  }
}

export async function dryRunDocumentRenderAction(
  action: DocumentRenderAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  if (action.profileId === null) {
    throw new ActionFailure('This step has no document mapping chosen.');
  }

  const profile = await documentProfilesRepo(ctx.meta).findById(action.profileId);
  if (profile === null) throw new ActionFailure('That document mapping no longer exists.');
  if (!profile.enabled) return { log: ctx.text.docOff(profile.name) };

  const deps = depsOf(ctx);
  const runtime = deps.runtime();
  const provider =
    runtime === null
      ? null
      : providerByKey(
          runtime,
          DOCUMENT_RENDER_CONTRACT,
          DOCUMENT_RENDER_VERSION,
          profile.addOnKey,
        );
  if (provider === null) {
    throw new ActionFailure(`The add-on that draws this document (${profile.addOnKey}) is not installed.`);
  }

  // Everything that can be wrong before bytes exist has now been checked, and
  // nothing has been written: no render, no file, no number.
  return { log: ctx.text.docWould(profile.kind, profile.name) };
}
