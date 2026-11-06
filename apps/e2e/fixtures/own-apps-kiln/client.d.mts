// SPDX-License-Identifier: AGPL-3.0-only
/** Types for the parts of `client.mjs` the specs import. */

export class ApiError extends Error {
  status: number;
  body: unknown;
}

export interface RequestOptions {
  /** Statuses to return rather than throw on. */
  allow?: number[];
  headers?: Record<string, string>;
}

export class Client {
  constructor(base: string);
  base: string;
  cookies: Map<string, string>;
  csrf: string | null;
  // The replies are whatever the route answers: each caller reads the fields it needs.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  req(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<any>;
  get(path: string, options?: RequestOptions): Promise<any>;
  post(path: string, body?: unknown, options?: RequestOptions): Promise<any>;
  put(path: string, body?: unknown, options?: RequestOptions): Promise<any>;
  patch(path: string, body?: unknown, options?: RequestOptions): Promise<any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  refreshCsrf(): Promise<unknown>;
}

export function signIn(options: { url: string; email: string; password: string; name?: string; sessionFile?: string | null; setup?: boolean }): Promise<Client>;
