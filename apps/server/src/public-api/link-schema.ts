// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wire shapes of signing in by an emailed link, and the config reply that
 * tells a page a key signs people in that way.
 *
 * Kept beside the link's own code rather than in the route schema file, and
 * built ON that file's shapes, so the one config reply every page reads stays
 * one shape: the claim's strategy and verify simply gain `email-link`.
 */
import { z } from 'zod';

import { publicConfigReply } from '../routes/public/schema.js';

/** Codes only the link routes answer. */
export const LINK_ERROR_CODES = [
  /** The link was used, has expired, was taken back, or never existed (410). */
  'LINK_EXPIRED',
] as const;
export type LinkErrorCode = (typeof LINK_ERROR_CODES)[number];

/** `GET /public/config`, with a claim that may sign people in by an emailed link. */
export const publicConfigReplyWithLink = z.object({
  data: publicConfigReply.shape.data.extend({
    claim: z
      .object({
        strategy: z.enum(['lookup', 'email-code', 'external', 'email-link', 'token']),
        ref: z.string(),
        match: z.array(z.string()),
        /**
         * `email-code`: a found session can be raised to `verified` by a code
         * emailed to the person. `email-link`: the person asks for a link by
         * address and nothing else opens a session. Strategy `token`: a shared
         * link opens one row (`POST /public/claim/token`).
         */
        verify: z.enum(['email-code', 'email-link']).optional(),
      })
      .nullable(),
  }),
});

/** A link's token as the page read it from the fragment: 32 bytes, base64url. */
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'a sign-in link token');

/** `POST /public/claim/link` — the address, and the language the email is written in. */
export const linkStartBody = z
  .object({
    email: z.string().min(3).max(254),
    /** A language tag (`fr`, `pt-BR`); the browser's own when absent. */
    lang: z.string().min(2).max(35).optional(),
  })
  .strict();

/** The same answer for any address: where it went, masked as the caller typed it. */
export const linkStartReply = z.object({ data: z.object({ sentTo: z.string() }) });

/** `POST /public/claim/link/peek` and `/resend`: the token alone. */
export const linkTokenBody = z.object({ token: tokenSchema }).strict();

/** `POST /public/claim/link/verify`: the link's token, or the address and the code on another device. */
export const linkVerifyBody = z.union([
  z.object({ token: tokenSchema }).strict(),
  z.object({ email: z.string().min(3).max(254), code: z.string().min(1).max(12) }).strict(),
]);

/** The name the link's page greets its person by — the first name, and nothing else. */
export const linkPeekReply = z.object({ data: z.object({ firstName: z.string() }) });

export const linkVerifyReply = z.object({
  data: z.object({
    /** `adm_pubs_…`, sent back in `x-adminium-public-session`. */
    session: z.string(),
    expiresAt: z.number().int(),
    level: z.literal('verified'),
  }),
});

/** `POST /public/claim/token`: the code from a shared link's fragment, as typed or pasted. */
export const tokenClaimBody = z.object({ token: z.string().min(8).max(40) }).strict();

/** A resend always answers the same: nothing about the link or its person. */
export const linkResendReply = z.object({ data: z.object({}) });
