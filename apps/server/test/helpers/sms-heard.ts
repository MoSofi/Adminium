// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stands in for the provider's first signed reply: a server counts replies as
 * arriving, and its texts say "Reply STOP", only after one reached its reply
 * address. A test that is not about that records it here.
 */
import type { MetaDb } from '@adminium/meta';

import { inboundAddress, inboundToken } from '../../src/inbound/index.js';
import { SmsSecret, accountRefOf } from '../../src/sms/credentials.js';
import { markReplyAddressHeard } from '../../src/sms/inbound/index.js';

/** The Twilio account `accountSid` has been heard from at `origin`. */
export async function twilioRepliesHeard(meta: MetaDb, input: { secret: string; origin: string; accountSid: string; at?: number }): Promise<void> {
  const account = accountRefOf({ provider: 'twilio', accountSid: input.accountSid, authToken: new SmsSecret('unused') });
  const door = inboundAddress(input.origin, 'sms', 'twilio', inboundToken(input.secret, 'sms', 'twilio', account));
  await markReplyAddressHeard(meta, door, input.at ?? Date.now());
}
