// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a host page hands the assistant, and the reason the arrow points this
 * way.
 *
 * THE MODAL IMPORTS NO HOST. Not the email tree, not the invoice tree, not the
 * report tree — not even their types. Each host hands in its own renderer and
 * its own callbacks, so the preview a person sees is drawn by the SAME
 * component the editor draws it with (a preview built here would be a second
 * renderer to keep in step, and it would be wrong the first time either one
 * changed). `check-deps` counts a type-only import as an edge, so nothing in
 * this file may name a host's types either.
 *
 * WHICH HOST IS AN EDITOR. Whether {@link AssistantHostContext.applyDraft} is
 * present. An editor host can put the draft straight on screen — a client-only
 * act that writes nothing — so *Open in editor* there needs no confirmation
 * and no save grant. A manager host has nowhere to put it, so the same button
 * is the save flow with the editor opened afterwards.
 */
import type { ReactNode } from 'react';

import type { AssistantContext, AssistantHostRef } from './api.js';

/** What the turn knows about a drafted artefact beyond the artefact itself. */
export interface AssistantPreviewMeta {
  /** The document it was built from, by name, or `null` when it was built from nothing. */
  basedOn: string | null;
}

export interface AssistantHostContext {
  /** Which page this is — the server's context key. */
  context: AssistantContext;
  /** What the page is showing: the open document, the manager tab, the connections in view. */
  host: AssistantHostRef;
  /** An editor host's UNSAVED on-screen document, sent so the assistant can talk about it. */
  draft?: unknown;
  /**
   * The host's own renderer, read-only — the same sheet its editor shows.
   *
   * `meta` carries what the TURN knows and the artefact does not: which
   * document this one was built from, by name. A page that has no sheet for
   * an artefact draws the generic record preview from `assistant/parts`
   * instead; it is the host that decides that, not this tree, because the
   * decision needs the page's own arithmetic.
   */
  renderPreview: (artefact: Record<string, unknown>, meta: AssistantPreviewMeta) => ReactNode;
  /**
   * After a save: invalidate the page's list and, when `open`, navigate to the
   * editor. Invalidating BEFORE navigating is the order that matters — a list
   * invalidated while unmounted can stay stale for a second.
   */
  onCreated: (created: { id: string; kind: string; name: string }, open: boolean) => void;
  /**
   * Editor hosts only: replace the on-screen draft with the artefact and
   * select the first changed block. One undo step, because one thing happened.
   */
  applyDraft?: (artefact: Record<string, unknown>) => void;
}

/** Does this host have somewhere to put a draft without saving it? */
export function isEditorHost(host: AssistantHostContext): boolean {
  return typeof host.applyDraft === 'function';
}
