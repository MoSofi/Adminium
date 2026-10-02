// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The check before `/design` renders. Absent (not found) on a server that does
 * not run the Designer. With no session it is not a redirect to the login
 * form: the server signs its owner in with the one-use link `adminium design`
 * opened, so a page with no session here was reached by a spent link, and the
 * page says so. A server whose owner has a password sends them to sign in.
 */
import type { QueryClient } from '@tanstack/react-query';
import { notFound, redirect } from '@tanstack/react-router';

import { ApiError } from '../app/api.js';
import { bootstrapQuery } from '../app/bootstrap.js';
import { systemInfoQuery } from '../app/capabilities.js';

export async function designerGate({ context, location }: { context: { queryClient: QueryClient }; location: { href: string } }): Promise<void> {
  const info = await context.queryClient.ensureQueryData(systemInfoQuery());
  if (info.designer === undefined || info.designer.mode === 'off') throw notFound();
  try {
    await context.queryClient.ensureQueryData(bootstrapQuery());
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (!info.designer.link) throw redirect({ to: '/login', search: { returnTo: location.href } });
  }
}
