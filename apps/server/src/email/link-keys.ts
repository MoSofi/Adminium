// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE KEYS A MAIL'S SIGNED LINKS ARE MADE WITH: its unsubscribe link and its
 * click links.
 *
 * Not taken from `ADMINIUM_SECRET` itself. A link sits in a mailbox for
 * months and must still work (an unsubscribe link for at least thirty days,
 * by law), so its keys come from the install's address keys
 * (`consent/keys.ts`): random, kept encrypted under the secret, and
 * re-encrypted, never replaced, when the secret changes
 * (`resealUnderNewSecret`). A link is made with the newest key and checked
 * against every version there is, so a key renewed after a leak still reads
 * the links already sent.
 *
 * Each kind of link has a key of its own, so a click token can never pass
 * for an unsubscribe token or the other way round.
 */
import type { MetaDb } from '@adminium/meta';

import { addressKeyRing } from '../consent/keys.js';

const UNSUBSCRIBE = 'mail-link:unsubscribe:v1';
const CLICK = 'mail-link:click:v1';

export interface MailLinkKeys {
  /** The key a new unsubscribe link is signed with. */
  unsubscribe(): Promise<string>;
  /** Every key an unsubscribe link may have been signed with, newest first. */
  unsubscribeAll(): Promise<string[]>;
  /** The key a new click link is signed with. */
  click(): Promise<string>;
  /** Every key a click link may have been signed with, newest first. */
  clickAll(): Promise<string[]>;
}

export function mailLinkKeys(meta: MetaDb, secret: string): MailLinkKeys {
  const ring = addressKeyRing(meta, secret);
  return {
    unsubscribe: () => ring.derivedForWrite(UNSUBSCRIBE),
    unsubscribeAll: () => ring.derivedAll(UNSUBSCRIBE),
    click: () => ring.derivedForWrite(CLICK),
    clickAll: () => ring.derivedAll(CLICK),
  };
}
