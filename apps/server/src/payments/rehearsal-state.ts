// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's REHEARSAL switch, kept in meta (`rehearsal.ts` says what a
 * rehearsal does). Apart from the rest so the customer side's config can read
 * it without reaching the sample-data and write machinery.
 */
import { createHash } from 'node:crypto';

import { paymentSettingsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

/** How long a rehearsal stays on once switched on. */
export const REHEARSAL_MS = 4 * 3_600_000;

const docOf = (userId: string): string => `rehearsal:${userId}`;
const stateSchema = z.object({ until: z.number() }).strict();

/** Until when this person's rehearsal is on, or null when it is off. */
export async function rehearsalUntil(meta: MetaDb, userId: string, at: number = Date.now()): Promise<number | null> {
  const state = await paymentSettingsRepo(meta).get(docOf(userId), stateSchema).catch(() => null);
  return state !== null && state.until > at ? state.until : null;
}

/** Switches this person's rehearsal on (for {@link REHEARSAL_MS}) or off. Answers until when it is on. */
export async function setRehearsal(meta: MetaDb, userId: string, on: boolean, at: number = Date.now()): Promise<number | null> {
  const docs = paymentSettingsRepo(meta);
  if (!on) {
    await docs.remove(docOf(userId)).catch(() => undefined);
    return null;
  }
  const until = at + REHEARSAL_MS;
  await docs.set(docOf(userId), stateSchema, { until }, at);
  return until;
}

/**
 * What the customer side's config adds for a person rehearsing on it: until
 * when the rehearsal runs (for its TEST band) and the CSRF token their writes
 * through the public API carry (they are held to the staff cookie's rules,
 * and the customer side otherwise hands out no token). A person who may
 * manage payments, signed in, with rehearsal on; anyone else gets nothing.
 */
export async function rehearsalConfig(
  meta: MetaDb,
  request: FastifyRequest,
): Promise<{ rehearsal?: { until: string; csrfToken: string } }> {
  const user = (request as unknown as { user?: { id?: string } | null }).user;
  const session = (request as unknown as { session?: { id: string } | null }).session;
  if (user?.id === undefined || session == null || !request.server.hasDecorator('csrfTokenFor') || typeof request.can !== 'function') return {};
  const until = await rehearsalUntil(meta, user.id);
  if (until === null) return {};
  if (!(await request.can('system:payments:manage').catch(() => false))) return {};
  return { rehearsal: { until: new Date(until).toISOString(), csrfToken: request.server.csrfTokenFor(session.id) } };
}


/** How long a rehearsal row stays its rehearsing person's, for the mail it makes: as long as a rehearsal lasts, and a day more. */
const REHEARSAL_ROW_MS = 28 * 3_600_000;
const rowSchema = z.object({ userId: z.string().min(1), at: z.number() }).strict();
const rowDocOf = (connectionId: string, table: string, pk: Record<string, unknown>): string =>
  `rehearsal-row:${createHash('sha256').update(JSON.stringify([connectionId, table, Object.keys(pk).sort().map((key) => [key, String(pk[key])])]), 'utf8').digest('base64url')}`;

/**
 * Notes a row as a rehearsing person's (a rehearsal's order, or a message the
 * app queued about one): its mail goes to them, marked TEST, never to the
 * address the row carries.
 */
export async function noteRehearsalRow(meta: MetaDb, connectionId: string, table: string, pk: Record<string, unknown>, userId: string, at: number = Date.now()): Promise<void> {
  await paymentSettingsRepo(meta).set(rowDocOf(connectionId, table, pk), rowSchema, { userId, at }, at);
}

/** The person whose rehearsal made this row, or null. */
export async function rehearsalRowOwner(meta: MetaDb, connectionId: string, table: string, pk: Record<string, unknown>, at: number = Date.now()): Promise<string | null> {
  const noted = await paymentSettingsRepo(meta).get(rowDocOf(connectionId, table, pk), rowSchema).catch(() => null);
  return noted !== null && at - noted.at < REHEARSAL_ROW_MS ? noted.userId : null;
}
