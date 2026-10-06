// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shop of `state-actions.fixture.ts` behind the composed server, with the
 * people its tests sign in as: each a role of their own grants, and — for
 * some — the app's own manager role beside it, which a move is kept for.
 */
import { pagesRepo, permissionsRepo, rolesRepo, usersRepo, type User } from '@adminium/meta';

import { matrixRowsFromGrants } from '../src/rbac/permissions.js';

import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { installInvoicing, writerFor, type Dialect, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { shopManifest } from './state-actions.fixture.js';

export type Doc = Record<string, unknown>;
type Reply = Awaited<ReturnType<Served['composed']['app']['inject']>>;

export interface Shop {
  h: InvoicingHarness;
  served: Served;
  w: Awaited<ReturnType<typeof writerFor>>;
  /** A table's id, as the routes take it. */
  id(ref: string): string;
  api(method: string, url: string, payload?: unknown, as?: string): Promise<Reply>;
  /** One of an order's actions, as a record page sends it. */
  act(order: unknown, action: string, body: unknown, as?: string): Promise<Reply>;
  /** Somebody signed in: a role of their own with these table grants (`<ref>` → its actions and limits), and the app's roles named. */
  person(name: string, grants: 'super-admin' | Record<string, Doc>, appRoles?: readonly string[], more?: readonly string[]): Promise<User>;
  /** The id of the page that lists the orders. */
  pageId: string;
  order(values?: Doc): Promise<number>;
  row(ref: string, key: unknown): Promise<Doc>;
  close(): Promise<void>;
}

export const errorOf = (res: { json: () => unknown }) => (res.json() as { error: { code: string; message: string; details?: Doc } }).error;

export async function shop(dialect: Dialect, manifest: Doc = shopManifest()): Promise<Shop> {
  const h = await installInvoicing(dialect, manifest);
  const w = await writerFor(h);
  const served = await servePublic(h, null);
  const cookies = new Map<string, string>();
  const id = (ref: string) => w.targetOf(ref).table.id;
  const api: Shop['api'] = (method, url, payload, as = 'boss') =>
    served.composed.app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: as === '' ? {} : { cookie: cookies.get(as)! }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const person: Shop['person'] = async (name, grants, appRoles = [], more = []) => {
    const user = await usersRepo(h.meta).create({ email: `${name}@shop.dev`, name, passwordHash: await adminPasswordHash() });
    const roles = rolesRepo(h.meta);
    if (grants === 'super-admin') {
      await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
    } else {
      const role = await roles.create({ slug: `${name}-role`, name } as never);
      for (const [ref, actions] of Object.entries(grants)) {
        await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${id(ref)}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      }
      // Grants of any other kind, as the Roles screen writes them (`page:<id>:view`).
      for (const row of matrixRowsFromGrants(more).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions);
      await roles.assignToUser(user.id, role.id);
    }
    for (const slug of appRoles) await roles.assignToUser(user.id, (await roles.findBySlug(slug))!.id);
    // Each from an address of their own: sign-ins are counted per address, five a minute.
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.0.0.${String(cookies.size + 1)}`, payload: { email: `${name}@shop.dev`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
    return user;
  };
  await person('boss', 'super-admin');
  const page = await pagesRepo(h.meta).findBySlug(h.connectionId, 'shop-orders');
  return {
    pageId: page!.id,
    h,
    served,
    w,
    id,
    api,
    act: (order, action, body, as) => api('POST', `/data/${h.connectionId}/${encodeURIComponent(id('orders'))}/${String(order)}/actions/${action}`, body, as),
    person,
    order: async (values = {}) => Number((await w.create('orders', { customer: 'Ada', ...values }))['id']),
    row: async (ref, key) => (await h.rows(`SELECT * FROM ${h.real(ref)} WHERE id = ${String(key)}`))[0]!,
    close: async () => {
      await served.close();
      await h.close();
    },
  };
}
