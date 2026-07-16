/**
 * First-run setup API client (M10-T04): GET /api/v1/setup/state and
 * POST /api/v1/setup/super-admin. Shapes mirror apps/server
 * src/routes/setup/schema.ts (type-only copy per the 01-architecture.md §2.3
 * matrix — the dashboard may not import server runtime code). Change both
 * together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

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
 */
export async function createSuperAdmin(input: SetupSuperAdminInput): Promise<SetupUser> {
  const body = await api.post<{ data: { user: SetupUser } }>('/api/v1/setup/super-admin', {
    email: input.email,
    password: input.password,
    ...(input.name === undefined || input.name.length === 0 ? {} : { name: input.name }),
    consent: input.consent,
  });
  return body.data.user;
}
