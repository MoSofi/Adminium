// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A row written by the dashboard's own data routes, as the person behind a
 * request: the same session (or key), so every grant, column limit, row
 * limit, rule, audit and live update of an ordinary write applies, and a
 * refusal is passed on in its own words. Engine routes that act for a staff
 * member on an app's table (a chat becoming an enquiry, a found company
 * added) write through here, never around the data routes.
 *
 * Browser-only headers are not passed on: the outer request already passed
 * the cross-site check.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '../errors.js';

/** Headers an act passes on when it asks another route of this server as the same person. */
export const AS_PERSON_HEADERS = ['cookie', 'authorization', 'user-agent', 'accept-language'] as const;

export interface AsPersonRefusal {
  /** The error code used when the data route's reply names none. */
  code: string;
  /** The message used when the data route's reply names none. */
  message: string;
}

function forwarded(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of AS_PERSON_HEADERS) {
    const value = request.headers[name];
    if (typeof value === 'string' && value !== '') headers[name] = value;
  }
  if (typeof request.host === 'string' && request.host !== '') headers['host'] = request.host;
  return headers;
}

/** Creates one row as the person behind `request`; returns the stored row, or throws the data route's refusal. */
export async function createAsPerson(
  app: FastifyInstance,
  request: FastifyRequest,
  connectionId: string,
  tableId: string,
  values: Record<string, unknown>,
  refusal: AsPersonRefusal,
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(tableId)}`,
    headers: forwarded(request),
    remoteAddress: request.ip,
    payload: { values },
  });
  let body: { data?: Record<string, unknown>; error?: { code?: string; message?: string; details?: unknown } } = {};
  try {
    body = JSON.parse(res.body) as typeof body;
  } catch {
    body = {};
  }
  if (res.statusCode === 201 || res.statusCode === 200) return body.data ?? {};
  throw new AppError(res.statusCode, body.error?.code ?? refusal.code, body.error?.message ?? refusal.message, body.error?.details);
}
