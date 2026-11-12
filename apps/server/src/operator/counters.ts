// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The totals the operator endpoint reports that other parts of the server
 * count: mail sent through the operator's mail relay, and the AI the operator
 * pays for. Each answers null, "not counted on this instance", until the part
 * that counts it says otherwise; the endpoint reports what these return and
 * nothing else.
 */
import type { MetaDb } from '@adminium/meta';

export interface RelayMailCount {
  /** Since midnight UTC. */
  today: number | null;
  /** Since the start of the hour, UTC. */
  thisHour: number | null;
}

/** Emails sent through the operator's mail relay today and this hour; null where this instance does not count them. */
export async function relayMailSent(meta: MetaDb, at: number): Promise<RelayMailCount> {
  void meta;
  void at;
  return Promise.resolve({ today: null, thisHour: null });
}

/** Tokens the Designer and the other AI features have spent on the operator's AI connection; null where this instance does not count them. */
export async function operatorAiTokensUsed(meta: MetaDb): Promise<number | null> {
  void meta;
  return Promise.resolve(null);
}
