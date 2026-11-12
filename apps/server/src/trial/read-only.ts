// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial past its end date is read-only.
 *
 * The operator's control service switches a trial off and archives it at its
 * end date, so this is a backstop: it holds only while a container outlives
 * its date. Then every page and record stays visible and Export everything
 * keeps working, but nothing is created, changed or deleted.
 *
 * One `onRequest` hook, registered before every plugin and route, refuses
 * every write method (POST, PUT, PATCH, DELETE) on every path once the policy
 * answers no to `writes`, with 403 `OFF_BY_OPERATOR` (`trial/refuse.ts`), so
 * a route added later is read-only too without a line of its own. What still
 * goes through is the short list below: signing in and out, the first-run
 * setup, the export, and the few reads a page sends as a POST. The CLI's
 * `archive` does not come through here at all.
 *
 * Writes that no request makes (scheduled automations, an app's reminders)
 * are not stopped here; user mail is (`email/send.ts`, `outbox/sender.ts`).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { TrialPolicy } from './policy.js';
import { OffByOperatorError } from './refuse.js';

const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** What still writes once a trial has ended: `METHOD path`, a `:name` standing for one path segment. */
export const READ_ONLY_ALLOWED: readonly string[] = [
  // Signing in and out, and getting back in with a forgotten password.
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/2fa/verify',
  'POST /api/v1/auth/logout',
  'DELETE /api/v1/auth/sessions/:id',
  'POST /api/v1/auth/password/forgot',
  'POST /api/v1/auth/password/reset',
  // The first-run setup with the operator's setup token.
  'POST /api/v1/setup/token',
  'POST /api/v1/setup/super-admin',
  // Export everything, and a table's own export.
  'POST /api/v1/export/zip',
  'POST /api/v1/exports/preview',
  'POST /api/v1/exports',
  // Reads a page sends as a POST: widget data, files and links, drawn documents.
  'POST /api/v1/widget-data/query',
  'POST /api/v1/widget-data/batch',
  'POST /api/v1/files/resolve',
  'POST /api/v1/project/resolve',
  'POST /api/v1/documents/render',
  'POST /api/v1/apps/:key/documents/render',
  'POST /api/v1/add-ons/:key/documents/render',
  // The person's own display choices and their notifications marked read.
  'PATCH /api/v1/me/prefs',
  'POST /api/v1/me/notifications/:id/read',
  'POST /api/v1/me/notifications/read-all',
];

interface Allowed {
  method: string;
  segments: readonly string[];
}

const ALLOWED: readonly Allowed[] = READ_ONLY_ALLOWED.map((entry) => {
  const [method = '', path = ''] = entry.split(' ');
  return { method, segments: path.split('/') };
});

/** Whether `method path` (no query) is on {@link READ_ONLY_ALLOWED}. */
export function writesWhenEnded(method: string, path: string): boolean {
  const segments = path.split('/');
  return ALLOWED.some(
    (allowed) =>
      allowed.method === method &&
      allowed.segments.length === segments.length &&
      allowed.segments.every((part, i) => (part.startsWith(':') ? (segments[i] ?? '') !== '' : part === segments[i])),
  );
}

/** The path the router will read: no query, no trailing slash. */
function pathOf(request: FastifyRequest): string {
  const path = request.url.split('?')[0] ?? request.url;
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export function registerTrialReadOnly(app: FastifyInstance, policy: Pick<TrialPolicy, 'allows'>): void {
  app.addHook('onRequest', async (request) => {
    if (!WRITE_METHODS.has(request.method)) return;
    const answer = policy.allows('writes');
    if (answer.allowed || writesWhenEnded(request.method, pathOf(request))) return;
    throw new OffByOperatorError('writes', answer.reason ?? 'trial-ended', 'This trial has ended, so this installation is read-only.');
  });
}
