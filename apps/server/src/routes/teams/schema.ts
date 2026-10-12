// SPDX-License-Identifier: AGPL-3.0-only
/** Zod schemas for teams and for the people a writer may name. */
import { z } from 'zod';

export const teamMemberDto = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  status: z.enum(['active', 'invited', 'suspended', 'sample']),
  lead: z.boolean(),
});

export const teamDto = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(teamMemberDto),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type TeamDto = z.infer<typeof teamDto>;

export const teamListReply = z.object({
  teams: z.array(teamDto),
  /** The most people one person's reach may hold; `over` names who leads more than that, and so reaches only the first of them. */
  reachMax: z.number(),
  over: z.array(z.object({ userId: z.string(), name: z.string() })),
});

export const teamIdParams = z.object({ id: z.string() });
export const teamMemberParams = z.object({ id: z.string(), userId: z.string() });

export const teamBody = z.object({ name: z.string().trim().min(1).max(80) });
export const teamMemberBody = z.object({ lead: z.boolean() });

export const teamOkReply = z.object({ ok: z.literal(true) });

export const peopleQuery = z.object({
  /** Part of a name, any case. */
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** A person as a picker shows one: who, and nothing else. */
export const personDto = z.object({
  id: z.string(),
  name: z.string(),
  /** A person an app's sample data made. */
  sample: z.boolean(),
});

export const peopleReply = z.object({ people: z.array(personDto) });
