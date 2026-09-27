// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LIMITS ON A CHANGE A GUEST MAKES (`limits`): a ticket sent on to a
 * friend is an email to an address the sender chose, with a name they typed —
 * the create's mail relay, moved to a change. So:
 *
 *  - per value: at most `n` changes a day that write one address (counted as
 *    its mailbox, whatever tags it wears), across every table of the
 *    connection — five tickets a day to one friend, however they are sent;
 *  - plain text: the name it is sent to holds letters, spaces and ordinary
 *    punctuation, and never a link.
 *
 * Charged first and counted with the charge, as the create's caps are, and
 * handed back when the change does not go through.
 */
import { createHmac } from 'node:crypto';

import type { PublicChallengesRepo } from '@adminium/meta';

import { DAY_MS } from './claim-code.js';
import { capValue, plainText, type AnonymousCaps, type CapCharge } from './anonymous-caps.js';

/** The markers' purpose: changes counted per value. */
export const CHANGE_LIMIT_PURPOSE = 'change-limit';

export type ChangeLimits = Pick<AnonymousCaps, 'perValue' | 'plainText'>;

/** Where one value is counted: its mailbox (or number) on this connection, never which table or column wrote it. */
export function limitSubject(key: Buffer, connectionId: string, value: string): string {
  return `limit:${createHmac('sha256', key).update(JSON.stringify([connectionId, value])).digest('hex')}`;
}

/** The first plain-text column this change writes something else into, or null. */
export function notPlainChange(limits: ChangeLimits, values: Readonly<Record<string, unknown>>): string | null {
  return (limits.plainText ?? []).find((column) => Object.prototype.hasOwnProperty.call(values, column) && !plainText(values[column])) ?? null;
}

/** Charge a change for every limited value it writes; refused (and taken back) when one is over its day. */
export async function chargeChange(
  repo: Pick<PublicChallengesRepo, 'mark' | 'sentSince' | 'unmark'>,
  input: { limits: ChangeLimits; key: Buffer; keyId: string; connectionId: string; ref: string; values: Readonly<Record<string, unknown>>; now: number },
): Promise<CapCharge> {
  const perValue = input.limits.perValue;
  const subjects = new Set<string>();
  for (const column of perValue?.columns ?? []) {
    if (!Object.prototype.hasOwnProperty.call(input.values, column)) continue;
    const value = capValue(input.values[column]);
    if (value !== null) subjects.add(limitSubject(input.key, input.connectionId, value));
  }
  const ids: string[] = [];
  const release = async () => {
    if (ids.length > 0) await repo.unmark(ids);
  };
  if (perValue === undefined || subjects.size === 0) return { ok: true, release };
  for (const subject of subjects) ids.push(await repo.mark({ keyId: input.keyId, ref: input.ref, sessionId: null, subject, purpose: CHANGE_LIMIT_PURPOSE }, input.now));
  for (const subject of subjects) {
    if ((await repo.sentSince(subject, input.now - DAY_MS, CHANGE_LIMIT_PURPOSE)) > perValue.n) {
      await release();
      return { ok: false };
    }
  }
  return { ok: true, release };
}
