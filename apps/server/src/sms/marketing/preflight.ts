// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER A MARKETING RUN CAN GO AT ALL, and why not.
 *
 * Asked when the console opens the send dialog, when a run is made, when it
 * starts and at every batch, so a change made meanwhile (the sender turned
 * into a name, the public address removed) stops the run before its next
 * text. Every refusal that applies is listed, not just the first, so the
 * console can say all of what to put right.
 *
 *  - texts switched off by the operator, or marketing switched off;
 *  - no provider connected, or its key cannot be read; no sender;
 *  - the sender is a name, or a pool that may hold names: a name cannot
 *    receive STOP;
 *  - no STOP can reach this server: no public https address, the network
 *    features off, or the desktop app. Service
 *    texts can still go there; marketing cannot.
 *
 * The template's own checks are {@link templateRefusals}.
 */
import { checkTextTemplate, codeNamesIn, placeholdersIn } from '@adminium/manifest';

import type { SmsService } from '../service.js';
import type { TextRunRefusal } from './types.js';

export interface PreflightDeps {
  sms: Pick<SmsService, 'view'>;
  /** Whether a STOP reply can reach this server now, and if not, why (`SmsInboundChannel.replyReach`). */
  replyReach: () => Promise<{ state: string; canReceiveStop: boolean }>;
  /** The operator's answers. */
  operator: (question: 'smsProviders' | 'marketingCampaigns') => { allowed: boolean };
}

export interface RunRefusal {
  reason: TextRunRefusal;
  /** More for the console: the reply door's state, the template's own refusal. Never a number or a key. */
  detail: string | null;
}

export interface Preflight {
  ok: boolean;
  refusals: RunRefusal[];
  /** The sender the run would go from; null when none is set. */
  sender: { kind: 'number' | 'name' | 'pool'; value: string } | null;
  /** Whether replies reach this server, and the reply door's state. */
  replies: { canReceiveStop: boolean; state: string };
}

export async function preflight(deps: PreflightDeps): Promise<Preflight> {
  const refusals: RunRefusal[] = [];
  if (!deps.operator('smsProviders').allowed) refusals.push({ reason: 'off-by-operator', detail: null });
  if (!deps.operator('marketingCampaigns').allowed) refusals.push({ reason: 'marketing-off-by-operator', detail: null });
  const view = await deps.sms.view();
  if (view === null || !view.keyReadable) refusals.push({ reason: 'not-connected', detail: null });
  const sender = view?.sender ?? null;
  if (view !== null && sender === null) refusals.push({ reason: 'no-sender', detail: null });
  // A pool can hold names, and only a number certainly takes a reply.
  if (sender !== null && sender.kind !== 'number') refusals.push({ reason: 'marketing-from-name', detail: sender.kind });
  const reach = await deps.replyReach();
  if (!reach.canReceiveStop && view !== null && view.keyReadable) refusals.push({ reason: 'marketing-without-replies', detail: reach.state });
  return { ok: refusals.length === 0, refusals, sender, replies: { canReceiveStop: reach.canReceiveStop, state: reach.state } };
}

/**
 * What is wrong with a run's template, every language of it: none switched
 * on, or one that reads a code, a sign-in link or asks for YES. `names` are the
 * placeholders the audience fills; one the template names and nothing fills
 * (with no backup) is listed in `unfilled`.
 */
export function templateRefusals(content: Readonly<Record<string, string>>, codeColumns: ReadonlySet<string>, names: readonly string[]): { refusals: RunRefusal[]; unfilled: string[] } {
  const bodies = Object.values(content);
  if (bodies.length === 0) return { refusals: [{ reason: 'template-off', detail: null }], unfilled: [] };
  const refusals: RunRefusal[] = [];
  const unfilled = new Set<string>();
  const known = new Set(names);
  for (const body of bodies) {
    const checked = checkTextTemplate(body, codeNamesIn(body, codeColumns));
    if (!checked.ok && !refusals.some((one) => one.detail === checked.reason)) refusals.push({ reason: 'template-refused', detail: checked.reason });
    for (const placeholder of placeholdersIn(body)) if (!known.has(placeholder.name) && placeholder.backup === undefined) unfilled.add(placeholder.name);
  }
  return { refusals, unfilled: [...unfilled].sort() };
}
