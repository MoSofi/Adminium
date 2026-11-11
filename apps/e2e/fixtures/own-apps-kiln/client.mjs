// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A tiny Adminium API client for the Kiln Street fixture: cookies kept by hand,
 * the CSRF token read once from `/bootstrap`, `Origin` set to the server's own.
 *
 * Signing in is rate-limited (5 a minute), so a client signs in ONCE and the
 * caller may keep the cookies in a session file and reuse them next time.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} → ${String(status)}: ${typeof body === 'string' ? body : JSON.stringify(body).slice(0, 1500)}`);
    this.status = status;
    this.body = body;
  }
}

export class Client {
  constructor(base) {
    this.base = base.replace(/\/+$/, '');
    this.cookies = new Map();
    this.csrf = null;
  }

  keepCookies(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
  }

  async req(method, path, body, { allow = [], headers: extra = {} } = {}) {
    const headers = { origin: this.base, accept: 'application/json', ...extra };
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.csrf !== null && method !== 'GET') headers['x-adminium-csrf'] = this.csrf;
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const res = await fetch(`${this.base}/api/v1${path}`, { method, headers, body: payload });
    this.keepCookies(res);
    const text = await res.text();
    let json;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = text;
    }
    if (!res.ok && !allow.includes(res.status)) throw new ApiError(method, path, res.status, json);
    return json;
  }

  get(path, opts) { return this.req('GET', path, undefined, opts); }
  post(path, body, opts) { return this.req('POST', path, body, opts); }
  put(path, body, opts) { return this.req('PUT', path, body, opts); }
  patch(path, body, opts) { return this.req('PATCH', path, body, opts); }

  async refreshCsrf() {
    const boot = await this.get('/bootstrap');
    this.csrf = boot.data.csrfToken;
    return boot.data;
  }
}

/**
 * A signed-in super admin.
 *
 * Order: a saved session that still works → the first-run setup (when the
 * server has no account yet and `setup` is asked for, which lands signed in
 * without spending a login) → one sign-in.
 *
 * `setupToken`: the one-time token a server started with `adminium start`
 * prints and asks for before the first account (`setup/token.ts`). A server
 * this script composes itself (`smoke.mjs`) or one run by `dev` on this
 * computer asks for none, and `/setup/state` says which.
 */
export async function signIn({ url, email, password, name = 'Ines Calder', sessionFile = null, setup = false, setupToken = null }) {
  const c = new Client(url);
  if (sessionFile !== null && existsSync(sessionFile)) {
    try {
      c.cookies = new Map(JSON.parse(readFileSync(sessionFile, 'utf8')).cookies);
      const boot = await c.refreshCsrf();
      if (boot.user !== null && boot.user !== undefined) return c;
    } catch {
      /* stale: sign in below */
    }
    c.cookies = new Map();
    c.csrf = null;
  }
  const state = await c.get('/setup/state');
  if (state.data.required) {
    if (!setup) throw new Error('this server has no account yet: pass --setup to create the first super admin');
    if (state.data.tokenRequired === true && setupToken === null) {
      throw new Error('this server asks for its setup token first: pass --setup-token with the token from its log');
    }
    await c.post('/setup/super-admin', {
      email,
      password,
      name,
      consent: { telemetry: false, updateCheck: false },
      ...(setupToken === null ? {} : { setupToken }),
    });
  } else {
    await c.post('/auth/login', { email, password });
  }
  await c.refreshCsrf();
  if (sessionFile !== null) writeFileSync(sessionFile, JSON.stringify({ cookies: [...c.cookies] }), { mode: 0o600 });
  return c;
}
