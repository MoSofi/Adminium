// SPDX-License-Identifier: AGPL-3.0-only
/**
 * First-run setup API client (M10-T04): GET /api/v1/setup/state and
 * POST /api/v1/setup/super-admin. Shapes mirror apps/server
 * src/routes/setup/schema.ts (type-only copy per the 01-architecture.md §2.3
 * matrix — the dashboard may not import server runtime code). Change both
 * together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, setCsrfToken } from '../app/api.js';

export interface SetupState {
  /** True only on a never-bootstrapped instance (zero users AND no claim). */
  required: boolean;
  passwordMinLength: number;
}

/** The two outbound-call consents. Both default OFF (v0.5 exit criterion). */
export interface SetupConsent {
  telemetry: boolean;
  updateCheck: boolean;
}

export interface SetupSuperAdminInput {
  email: string;
  password: string;
  name?: string | undefined;
  consent: SetupConsent;
}

export interface SetupUser {
  id: string;
  email: string;
  name: string;
}

export const SETUP_STATE_QUERY_KEY = ['setup', 'state'] as const;

export function setupStateQuery() {
  return queryOptions({
    queryKey: SETUP_STATE_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: SetupState }>('/api/v1/setup/state')).data,
    // Setup state is a one-way door (required: true → false, never back), and
    // the route guards read it on every navigation — cache it for the session.
    staleTime: Infinity,
  });
}

/**
 * Creates the one-and-only super admin. Resolves with the created user and a
 * session cookie already set (the server signs the wizard in). A 409 means
 * setup was already completed — the caller must send the user to /login rather
 * than retry, since no retry can ever succeed.
 *
 * ─── WHY THIS WRITES THE CSRF HOLDER ─────────────────────────────────────────
 *
 * This call MINTS a session, and from the instant it resolves every mutation
 * this tab makes carries an ambient credential — so `security/csrf.ts` starts
 * demanding the session-bound token (`app/api.ts`). `GET /bootstrap` is the
 * other place that issues it, and the self-host wizard reaches it for free by
 * navigating into `appRoute` on success. The DESKTOP wizard does not: it stays
 * on `/desktop/setup` (a child of the router root, because there is no account
 * to bootstrap as when it loads) and goes straight on to create a database,
 * introspect it and generate pages. Those three calls were 403ing, and the
 * first symptom was the first-run wizard never reaching "Generate dashboard".
 *
 * So the token comes back in this reply and is installed here — in the shared
 * client both wizards call, rather than in either wizard — because the thing
 * that needs it is the SESSION being created, which is this function's doing.
 */
export async function createSuperAdmin(input: SetupSuperAdminInput): Promise<SetupUser> {
  const body = await api.post<{ data: { user: SetupUser; csrfToken?: string } }>(
    '/api/v1/setup/super-admin',
    {
      email: input.email,
      password: input.password,
      ...(input.name === undefined || input.name.length === 0 ? {} : { name: input.name }),
      consent: input.consent,
    },
  );
  // Optional on the wire only so fixtures predating the field keep typechecking
  // (the server's Zod reply schema makes it required), exactly as
  // `app/bootstrap.ts` treats its own copy.
  setCsrfToken(body.data.csrfToken ?? null);
  return body.data.user;
}
