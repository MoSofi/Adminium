// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `routes/connect/`: the operator hand-off ("Connect
 * Supabase"). No reply carries a connection string or a password.
 */
import { z } from 'zod';

import { CONNECT_PROVIDER_IDS } from '../../connect/providers.js';

export const connectProvider = z.enum(CONNECT_PROVIDER_IDS);

export const connectStartBody = z.object({
  provider: connectProvider,
});

export const connectStartReply = z.object({
  /** The operator's page, with this instance's origin, the state and the challenge. The browser goes there. */
  redirectUrl: z.string(),
});

export const connectReturnBody = z.object({
  provider: connectProvider,
  state: z.string().min(1).max(200),
  code: z.string().min(1).max(500),
});

export const connectCompleteBody = z.object({
  pendingId: z.string().min(1).max(200),
  /** The project's database password, typed into this instance. Never sent to the operator. */
  password: z.string().min(1).max(1024),
});

export const connectedConnection = z.object({
  id: z.string(),
  name: z.string(),
  engine: z.literal('postgres'),
  readOnly: z.boolean(),
  /** The schema was read: the wizard can go on to the tables. */
  introspected: z.boolean(),
});

export const connectResultReply = z.discriminatedUnion('status', [
  z.object({ status: z.literal('connected'), connection: connectedConnection }),
  z.object({
    /** An existing project: the operator never sees its password, so this instance asks for it. */
    status: z.literal('needs-password'),
    pendingId: z.string(),
    /** The project's name as the operator gave it, or null. */
    project: z.string().nullable(),
  }),
]);
export type ConnectResultReply = z.infer<typeof connectResultReply>;
