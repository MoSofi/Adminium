/**
 * Invite minting (07-meta-store.md §3.6, 08-server-api.md §2.1).
 *
 * There is no mail transport in this build — no `email/` module, no
 * nodemailer, no route that can write the `email.smtp` setting — so an invite
 * cannot be delivered. It is minted here and returned to the INVITER as a
 * copyable activation link; passing it on is a human step. `emailSent` is a
 * literal `false` on the wire for the same reason.
 *
 * The token rides the existing password-reset table with `kind: 'invite'`, so
 * `resetPasswordHandler` consumes it unchanged: setting the first password
 * flips `invited → active` and revokes any sessions.
 */
import { passwordResetsRepo, type MetaDb } from '@adminium/meta';

import { RESET_TOKEN_PREFIX, hashToken, mintToken } from '../../auth/sessions.js';

/**
 * Invite links live 7 days (§3.6) — deliberately NOT `RESET_TOKEN_TTL_MS`.
 * That constant is 30 minutes because a forgot-password token is minted
 * seconds before the same person uses it; an invite is handed over
 * out-of-band and at 30 minutes would be dead on arrival.
 */
export const INVITE_TOKEN_TTL_MS = 7 * 86_400_000;

export interface MintedInvite {
  /** Plaintext, returned exactly once — only its SHA-256 lands at rest. */
  token: string;
  expiresAt: number;
  /** Dashboard route that consumes it (`ResetPage`, `/reset/$token`). */
  activationPath: string;
}

/** Mint a single-use activation token for an `invited` user. */
export async function mintInvite(
  meta: MetaDb,
  userId: string,
  at: number = Date.now(),
): Promise<MintedInvite> {
  const token = mintToken(RESET_TOKEN_PREFIX);
  const expiresAt = at + INVITE_TOKEN_TTL_MS;
  await passwordResetsRepo(meta).create(
    { userId, kind: 'invite', tokenHash: hashToken(token), expiresAt },
    at,
  );
  return { token, expiresAt, activationPath: `/reset/${token}` };
}
