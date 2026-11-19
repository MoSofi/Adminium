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
 *
 * Four acts: create (`createAsPerson`, `createRowAsPerson` with a retry
 * key), change (`updateAsPerson`, refused when a column moved since the
 * person saw it) and read (`readAsPerson`, null for a row out of reach).
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

/** What a data route answered: the row, or the refusal in its own words. */
async function ask(
  app: FastifyInstance,
  request: FastifyRequest,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload: Record<string, unknown> | undefined,
): Promise<{ statusCode: number; body: { data?: Record<string, unknown>; replayed?: boolean; error?: { code?: string; message?: string; details?: unknown } } }> {
  const res = await app.inject({ method, url, headers: forwarded(request), remoteAddress: request.ip, ...(payload === undefined ? {} : { payload }) });
  let body: { data?: Record<string, unknown>; replayed?: boolean; error?: { code?: string; message?: string; details?: unknown } } = {};
  try {
    body = JSON.parse(res.body) as typeof body;
  } catch {
    body = {};
  }
  return { statusCode: res.statusCode, body };
}

const rowsUrl = (connectionId: string, tableId: string): string => `/api/v1/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(tableId)}`;
const recordUrl = (connectionId: string, tableId: string, recordId: string): string => `${rowsUrl(connectionId, tableId)}/${encodeURIComponent(recordId)}`;

/** What a create may carry beside its values: the retry key a table that keeps one replays by. */
export interface AsPersonCreateExtra {
  clientKey?: string | undefined;
}

/**
 * Creates one row as the person behind `request`; returns the stored row and
 * whether the data route answered an earlier save of the same retry key
 * instead of making a second. Throws the data route's refusal.
 */
export async function createRowAsPerson(
  app: FastifyInstance,
  request: FastifyRequest,
  connectionId: string,
  tableId: string,
  values: Record<string, unknown>,
  refusal: AsPersonRefusal,
  extra: AsPersonCreateExtra = {},
): Promise<{ row: Record<string, unknown>; replayed: boolean }> {
  const { statusCode, body } = await ask(app, request, 'POST', rowsUrl(connectionId, tableId), { values, ...(extra.clientKey === undefined ? {} : { clientKey: extra.clientKey }) });
  if (statusCode === 201 || statusCode === 200) return { row: body.data ?? {}, replayed: body.replayed === true };
  throw new AppError(statusCode, body.error?.code ?? refusal.code, body.error?.message ?? refusal.message, body.error?.details);
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
  return (await createRowAsPerson(app, request, connectionId, tableId, values, refusal)).row;
}

/**
 * Changes one row as the person behind `request`, by the data route's own
 * PATCH: their grants, column limits, row limits (the row as its changer),
 * rules, audit and live updates apply. `seen` holds columns as the person
 * saw them (at most 16): the change is made only while each still holds that
 * value, else refused 409 `ROW_CHANGED`. Returns the stored row, or throws
 * the data route's refusal.
 */
export async function updateAsPerson(
  app: FastifyInstance,
  request: FastifyRequest,
  connectionId: string,
  tableId: string,
  recordId: string,
  change: { values: Record<string, unknown>; seen?: Record<string, string | number | boolean | null> | undefined },
  refusal: AsPersonRefusal,
): Promise<Record<string, unknown>> {
  const seen = change.seen === undefined || Object.keys(change.seen).length === 0 ? undefined : change.seen;
  const { statusCode, body } = await ask(app, request, 'PATCH', recordUrl(connectionId, tableId, recordId), { values: change.values, ...(seen === undefined ? {} : { seen }) });
  if (statusCode === 200) return body.data ?? {};
  throw new AppError(statusCode, body.error?.code ?? refusal.code, body.error?.message ?? refusal.message, body.error?.details);
}

/**
 * One row as the person behind `request` reads it (their grants, row limits
 * and masks), or null when they cannot open it: a row out of their reach
 * answers as one not there.
 */
export async function readAsPerson(app: FastifyInstance, request: FastifyRequest, connectionId: string, tableId: string, recordId: string): Promise<Record<string, unknown> | null> {
  const { statusCode, body } = await ask(app, request, 'GET', recordUrl(connectionId, tableId, recordId), undefined);
  return statusCode === 200 && body.data !== undefined && body.data !== null ? body.data : null;
}
