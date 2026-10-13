// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S OWN SUMMARIES, mounted under `/api/v1`. Per-user `/me` surface:
 * the session is the scope, and nothing here takes a person, a role, a table
 * or a section from the caller.
 *
 * - `GET  /me/summaries`                the rules that make this person a
 *   summary: each one's id, name and whether it is switched on.
 * - `POST /me/summaries/:ruleId/send`   "send me mine now": the rule's own
 *   sections, read as this person at this moment, to their own address.
 *
 * WHAT THE SECOND ONE MAY NOT BE USED FOR.
 *  - To read as somebody else, or other sections: the body is empty, and the
 *    sections are the stored rule's.
 *  - To learn which rules exist: a rule that is not there, one of a part that
 *    is off, and one that writes to roles the person does not hold all answer
 *    the same 404, with the same words.
 *  - To fill a mailbox: three an hour for each person and rule, counted only
 *    for a rule that is theirs (so the count says nothing of the others).
 *
 * A rule that is switched OFF still sends a person their own on request: it
 * is how somebody sees what a summary would say before it is switched on. It
 * is written to nobody else by that.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { automationsRepo, rolesRepo, type Automation, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { digestStepsFor, sendDigest } from '../../automations/digest.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { NotFoundError, RateLimitedError, UnauthorizedError } from '../../errors.js';
import { offeredRoles, rulePartOff } from '../../rbac/app-parts.js';

/** How many of one rule's summaries a person may ask for in {@link MINE_WINDOW_MS}. */
export const MINE_MAX = 3;
export const MINE_WINDOW_MS = 3_600_000;

export interface SummariesRoutesDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  /** The queue a summary's email goes to; the email layer's own when absent. */
  secret?: string | undefined;
  now?: (() => number) | undefined;
}

const summaryView = z.object({
  id: z.string(),
  name: z.string(),
  /** Whether the rule sends by itself; a person may ask for their own either way. */
  enabled: z.boolean(),
});

export const summariesReply = z.object({ data: z.array(summaryView) });
export const summarySendParams = z.object({ ruleId: z.string().min(1).max(64) });
export const summarySendReply = z.object({
  data: z.object({
    sent: z.boolean(),
    /** Why nothing was queued: no mail server is set up, or the rule's template is gone. */
    reason: z.enum(['no-email', 'no-template']).nullable(),
    /** How many more may be asked for in this hour. */
    left: z.number().int(),
  }),
});

function requireUserId(request: FastifyRequest): string {
  const id = (request as unknown as { user?: { id?: string } }).user?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

export function summariesRoutes(deps: SummariesRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  /** When each person asked for each rule's summary, within the hour: one process, as the request limiter is. */
  const asked = new Map<string, number[]>();

  /** The rules that make this person a summary now, each with the steps that do. */
  const mine = async (userId: string): Promise<{ rule: Automation; steps: ReturnType<typeof digestStepsFor> }[]> => {
    const held = new Set((await offeredRoles(meta, await rolesRepo(meta).rolesForUser(userId))).map((role) => role.id));
    const out: { rule: Automation; steps: ReturnType<typeof digestStepsFor> }[] = [];
    if (held.size === 0) return out;
    for (const rule of await automationsRepo(meta).list()) {
      const steps = digestStepsFor(rule.graph.nodes, held);
      // A step with no template or no section is not finished: it would send nothing.
      const whole = steps.filter((step) => step.templateKey !== null && step.templateKey !== '' && step.sections.length > 0);
      if (whole.length === 0 || rule.connectionId === null || (await rulePartOff(meta, rule))) continue;
      out.push({ rule, steps: whole });
    }
    return out;
  };

  return async (app) => {
    app.get('/me/summaries', { schema: { response: { 200: summariesReply } } }, async (request) => {
      const userId = requireUserId(request);
      return { data: (await mine(userId)).map(({ rule }) => ({ id: rule.id, name: rule.name, enabled: rule.enabled })) };
    });

    app.post('/me/summaries/:ruleId/send', { schema: { params: summarySendParams, response: { 200: summarySendReply } } }, async (request, reply) => {
      const userId = requireUserId(request);
      const found = (await mine(userId)).find(({ rule }) => rule.id === request.params.ruleId);
      // Not there, not theirs, or of a part that is off: one answer, so the door says nothing of the rules it will not open.
      if (found === undefined) throw new NotFoundError('There is no summary of yours by that id.');
      const at = now();
      const key = `${userId}:${found.rule.id}`;
      const recent = (asked.get(key) ?? []).filter((moment) => at - moment < MINE_WINDOW_MS);
      if (recent.length >= MINE_MAX) {
        const resetAt = (recent[0] as number) + MINE_WINDOW_MS;
        void reply.header('retry-after', String(Math.max(1, Math.ceil((resetAt - at) / 1000))));
        throw new RateLimitedError(`You have asked for this summary ${String(MINE_MAX)} times in the last hour. Try again later.`, { bucket: 'summary-mine', limit: MINE_MAX, resetAt });
      }
      asked.set(key, [...recent, at]);
      // Forgotten once the hour is over, so the map holds only people who asked lately.
      if (asked.size > 5000) for (const [other, moments] of asked) if (moments.every((moment) => at - moment >= MINE_WINDOW_MS)) asked.delete(other);

      let sent = false;
      let reason: 'no-email' | 'no-template' | null = null;
      for (const [n, step] of found.steps.entries()) {
        const outcome = await sendDigest(
          { meta, manager: deps.manager, secret: deps.secret },
          {
            ruleId: found.rule.id,
            ruleName: found.rule.name,
            // Its own run: no other mail of this rule shares the key, so none is dropped as a repeat of it.
            runId: `mine:${userId}:${String(at)}:${String(n)}`,
            connectionId: found.rule.connectionId as string,
            userId,
            templateKey: step.templateKey as string,
            roles: step.to?.roles ?? [],
            sections: step.sections,
            // They asked: a summary with nothing in it is still what theirs says today.
            sendEmpty: true,
            madeAt: at,
          },
          at,
          { asked: true },
        );
        if (outcome.sent) sent = true;
        else if (outcome.why === 'no-email' || outcome.why === 'no-template') reason = outcome.why;
      }
      return { data: { sent, reason: sent ? null : (reason ?? 'no-email'), left: MINE_MAX - recent.length - 1 } };
    });
  };
}
