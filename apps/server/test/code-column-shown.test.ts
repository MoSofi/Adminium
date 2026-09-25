// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CODE ADMINIUM MAKES IS SHOWN TO STAFF — a studio's handover link, on
 * every engine this run can reach, through an app installed by the real
 * installer and the whole server.
 *
 * `share_token` reads like a secret by its name, and a secret is carried by
 * no response. But it is the code the app's shared link opens a project
 * with, on a table the app made, so the install says it is none: the desk
 * lists it, copies it, and gets the new one back when it makes a new link.
 * The public side never shows it unless an entry names it, and the page its
 * link opens — or any other endpoint of its table — never does. A manifest
 * column may say `secret` either way. What is kept for other readers (the
 * audit log) and what the assistant hands a model never carries a code.
 */
import { validateManifest, type Manifest } from '@adminium/manifest';
import { overridesRepo, permissionsRepo, publicKeysRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { planPublicEndpoints } from '../src/apps/manifest-public.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { compileScope, ScopeCompileError, type PublicScopeDocument } from '../src/public-api/scope.js';
import { defaultDefinitionFor, endpointIssues } from '../src/public-api/endpoint.js';
import { createEndpointService, EndpointSaveRefused } from '../src/public-api/endpoint-service.js';
import { readRowsTool } from '../src/assistant/tools/rows.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const TOKEN = 'ABCDEFGHJKMNPQRS';

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'projects',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 120 },
          { ref: 'share_token', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { code: { length: 16 } } },
          { ref: 'share_expires_on', type: 'date', nullable: true },
          { ref: 'share_stopped', type: 'bool', default: false },
          // A booking reference: shown to staff, and to the public only where an entry names it.
          { ref: 'ref_code', type: 'text', maxLength: 8, nullable: true, rules: { code: { length: 6 } } },
          // The app knows better than the name: not a secret, and a secret.
          { ref: 'token_hint', type: 'text', maxLength: 40, nullable: true, rules: { secret: false } },
          { ref: 'studio_note', type: 'text', maxLength: 200, nullable: true, rules: { secret: true } },
        ],
      },
    ]),
    publicKeys: { handover: {} },
    publicAccess: [
      // A booking reference the entry names is shown; the link's code is not.
      { table: 'projects', methods: ['GET'], select: ['id', 'name', 'ref_code'] },
      { table: 'projects', methods: ['GET'], select: ['name'], claim: { by: 'token', column: 'share_token', expires: 'share_expires_on', stopped: 'share_stopped' }, key: 'handover' },
    ],
  };
}

describe.each(LEGS)('a code Adminium makes — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let cookie: string;
  let projects: string;
  let ip = 0;
  const from = () => {
    ip += 1;
    return `10.8.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const url = (rest = '') => `/api/v1/data/${h.connectionId}/${encodeURIComponent(projects)}${rest}`;
  const stored = async (column: string) => (await h.rows(`select ${column} from ${h.real('projects')} where id = 1`))[0]![column];
  const login = async (email: string) =>
    sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: ADMIN_PASSWORD } })).headers['set-cookie']);

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    await h.rows(
      `insert into ${h.real('projects')} (name, share_token, ref_code, token_hint, studio_note, share_stopped) values ('Harbour rebrand', '${TOKEN}', 'ABC123', 'ends in QRS', 'owes us lunch', ${dialect === 'postgres' ? 'false' : '0'})`,
    );
    const keys = await publicKeysRepo(h.meta).listManagedBy('studio');
    served = await servePublic(h, keys.find((key) => key.purpose === 'handover')!.id);
    const desk = await usersRepo(h.meta).create({ email: 'desk@studio.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    cookie = await login('desk@studio.dev');
    projects = (await createPublicViews(h.meta).viewFor(h.connectionId))!.table(h.real('projects')).id;
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('is listed and read by the staff who read the table, beside a column the app keeps secret', async () => {
    const list = await served.composed.app.inject({ method: 'GET', url: url(), headers: { cookie } });
    expect(list.statusCode, list.body).toBe(200);
    const [row] = (list.json() as { data: Record<string, unknown>[] }).data;
    expect(row).toMatchObject({ share_token: TOKEN, ref_code: 'ABC123', token_hint: 'ends in QRS' });
    expect(row).not.toHaveProperty('studio_note');
    const one = await served.composed.app.inject({ method: 'GET', url: url('/1'), headers: { cookie } });
    expect((one.json() as { data: Record<string, unknown> }).data['share_token']).toBe(TOKEN);
  });

  it.skipIf(!available)('comes back with the new code when the desk makes a new link, and is never the one the desk types', async () => {
    const made = await served.composed.app.inject({ method: 'POST', url: url('/1/regenerate-code'), headers: { cookie }, payload: { column: 'share_token' } });
    expect(made.statusCode, made.body).toBe(200);
    const code = (made.json() as { data: Record<string, unknown> }).data['share_token'];
    expect(code).toMatch(/^[0-9A-Z]{16}$/);
    expect(code).toBe(await stored('share_token'));
    expect(code).not.toBe(TOKEN);
    // Typed back by a whole-record form: saved, and the code is not taken.
    const typed = await served.composed.app.inject({ method: 'PATCH', url: url('/1'), headers: { cookie }, payload: { values: { share_token: 'CHOSENBYDESK0000', name: 'Harbour rebrand' } } });
    expect(typed.statusCode, typed.body).toBe(200);
    expect(await stored('share_token')).toBe(code);
    // A new project has its link from the start.
    const created = await served.composed.app.inject({ method: 'POST', url: url(), headers: { cookie }, payload: { values: { name: 'Window display' } } });
    expect(created.statusCode, created.body).toBe(201);
    expect((created.json() as { data: Record<string, unknown> }).data['share_token']).toMatch(/^[0-9A-Z]{16}$/);
  });

  it.skipIf(!available)('is never shown by a public read that does not name it, nor by the page its link opens', async () => {
    const code = String(await stored('share_token'));
    const opened = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim/token', remoteAddress: from(), headers: served.headers(), payload: { token: code } });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string } }).data.session;
    const handover = await served.get(`/records/${h.real('projects')}_claimed`, session);
    expect(handover.statusCode, handover.body).toBe(200);
    expect((handover.json() as { data: Record<string, unknown>[] }).data).toEqual([{ name: 'Harbour rebrand' }]);

    await served.useKey((await publicKeysRepo(h.meta).listManagedBy('studio')).find((key) => key.purpose === 'customer')!.id);
    const listed = await served.get(`/records/${h.real('projects')}`);
    expect(listed.statusCode, listed.body).toBe(200);
    const rows = (listed.json() as { data: Record<string, unknown>[] }).data;
    expect(rows.find((row) => row['name'] === 'Harbour rebrand')).toEqual({ id: 1, name: 'Harbour rebrand', ref_code: 'ABC123' });
    for (const row of rows) {
      for (const hidden of ['share_token', 'token_hint', 'studio_note']) expect(row).not.toHaveProperty(hidden);
    }
    expect(listed.body).not.toContain(code);
  });

  it.skipIf(!available)('is left out of a generated endpoint, and a shared link’s code is refused wherever its page would show it', async () => {
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const table = view.table(projects);
    const generated = defaultDefinitionFor(view, table, 'projects')!;
    expect(generated.select).toContain('name');
    expect(generated.select).not.toContain('share_token');
    expect(generated.select).not.toContain('ref_code');
    const definition = {
      ...generated,
      select: ['name', 'share_token'],
      auth: { role: 'authenticated' },
      identity: { strategy: 'token', match: ['share_token'], column: 'id' },
    };
    const issues = endpointIssues(definition, { view, ref: 'projects_claimed' } as never);
    expect(issues.map((issue) => issue.code)).toContain('ENDPOINT_SELECT_TOKEN');
  });

  it.skipIf(!available)('is left out of an entry that names no columns, with a column the app keeps secret', async () => {
    const parsed = validateManifest({ ...manifest(), publicKeys: undefined, publicAccess: [{ table: 'projects', methods: ['GET'] }] });
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const [planned] = planPublicEndpoints((parsed as { manifest: Manifest }).manifest, { projects: h.real('projects') }, view);
    expect(planned!.issues).toEqual([]);
    expect(planned!.definition!.select).toEqual(['id', 'name', 'share_expires_on', 'share_stopped', 'token_hint']);
  });

  it.skipIf(!available)('stops being a secret only by Super Admin’s save', async () => {
    const remapper = await rolesRepo(h.meta).create({ slug: 'remapper', name: 'Remapper' });
    await permissionsRepo(h.meta).grant(remapper.id, 'system', 'schema.remap', { allowed: true });
    const person = await usersRepo(h.meta).create({ email: 'remap@studio.dev', name: 'Remap', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(person.id, remapper.id);
    const theirs = await login('remap@studio.dev');
    const current = (await overridesRepo(h.meta).listForConnection(h.connectionId)).map((row) => ({
      op: row.op,
      tableName: row.tableName,
      ...(row.columnName === null ? {} : { columnName: row.columnName }),
      value: row.value,
      status: row.status,
    }));
    const put = (headers: Record<string, string>, overrides: unknown[]) =>
      served.composed.app.inject({ method: 'PUT', url: `/api/v1/connections/${h.connectionId}/overrides`, headers, payload: { overrides } });
    // Saving the app's rules as they are opens nothing: a remapper may.
    const same = await put({ cookie: theirs }, current);
    expect(same.statusCode, same.body).toBe(200);
    // Saying the app's secret is none shows it: Super Admin only.
    const opened = current.map((item) => (item.op === 'column.secret' && item.columnName === 'studio_note' ? { ...item, value: { secret: false } } : item));
    expect(opened).not.toEqual(current);
    const refused = await put({ cookie: theirs }, opened);
    expect(refused.statusCode, refused.body).toBe(403);
    expect((await put({ cookie }, opened)).statusCode).toBe(200);
  });

  it.skipIf(!available)('is never kept in the audit log, which says only that a new code was made', async () => {
    const made = await served.composed.app.inject({ method: 'POST', url: url('/1/regenerate-code'), headers: { cookie }, payload: { column: 'share_token' } });
    expect(made.statusCode, made.body).toBe(200);
    const code = String(await stored('share_token'));
    const audit = await served.composed.app.inject({ method: 'GET', url: `/api/v1/audit?entityTable=${encodeURIComponent(projects)}&limit=100`, headers: { cookie } });
    expect(audit.statusCode, audit.body).toBe(200);
    const entries = (audit.json() as { entries: { action: string; changes: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } | null }[] }).entries;
    expect(entries.length).toBeGreaterThan(2);
    expect(audit.body).not.toContain(code);
    expect(audit.body).not.toContain(TOKEN);
    expect(audit.body).not.toContain('ABC123');
    // The newest: the link just made again, said changed.
    expect(entries[0]!.changes).toMatchObject({ before: { share_token: '[code]', ref_code: '[code]' }, after: { share_token: '[new code]', ref_code: '[code]' } });
  });

  it.skipIf(!available)('comes back from a new link only to a caller who may read the table', async () => {
    const linker = await rolesRepo(h.meta).create({ slug: 'linker', name: 'Linker' });
    await permissionsRepo(h.meta).grant(linker.id, 'table', `${h.connectionId}/${projects}`, { read: false, create: false, update: true, delete: false, export: false, import: false, read_pii: false } as never);
    const person = await usersRepo(h.meta).create({ email: 'linker@studio.dev', name: 'Linker', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(person.id, linker.id);
    const theirs = await login('linker@studio.dev');
    const made = await served.composed.app.inject({ method: 'POST', url: url('/1/regenerate-code'), headers: { cookie: theirs }, payload: { column: 'share_token' } });
    expect(made.statusCode, made.body).toBe(200);
    const data = (made.json() as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('share_token');
    expect(data).not.toHaveProperty('ref_code');
    expect(made.body).not.toContain(String(await stored('share_token')));
  });

  it.skipIf(!available)('is never shown, filtered or ordered by through another endpoint of its table', async () => {
    const views = createPublicViews(h.meta);
    const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async () => undefined });
    const view = (await views.viewFor(h.connectionId))!;
    const generated = defaultDefinitionFor(view, view.table(projects), 'projects_open')!;
    const save = (definition: Record<string, unknown>) =>
      service.saveEndpoint({ connectionId: h.connectionId, ref: 'projects_open', definition: definition as never, origin: 'custom', actorId: null });
    for (const definition of [
      { ...generated, methods: ['GET'], select: ['id', 'name', 'share_token'] },
      { ...generated, methods: ['GET'], filterable: ['share_token'] },
      { ...generated, methods: ['GET'], orderable: ['share_token'] },
    ]) {
      const refused = await save(definition).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused, JSON.stringify(definition)).toBeInstanceOf(EndpointSaveRefused);
      expect((refused as EndpointSaveRefused).issues.map((issue) => issue.code)).toContain('ENDPOINT_SHARE_CODE_READ');
    }
    // The booking reference is no shared link's: named, it is shown.
    await expect(save({ ...generated, methods: ['GET'], select: ['id', 'name', 'ref_code'] })).resolves.toBeDefined();
    // Nor through a scope written by hand.
    const scope = (expose: string[]) =>
      served.composed.app.inject({
        method: 'POST',
        url: '/api/v1/public-scopes',
        headers: { cookie },
        payload: {
          connectionId: h.connectionId,
          side: 'customer',
          name: `by hand ${expose.join(' ')}`,
          document: JSON.stringify({ version: 1, side: 'customer', timezone: 'UTC', resources: [{ ref: 'every_project', table: projects, actions: ['read'], expose }] }),
        },
      });
    const refused = await scope(['id', 'share_token']);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.body).toContain('SCOPE_SHARE_CODE_READ');
    const fine = await scope(['id', 'name']);
    expect(fine.statusCode, fine.body).toBe(201);
  });

  it.skipIf(!available)('is never handed to the assistant, which a third-party model reads', async () => {
    const deps = { meta: h.meta, manager: h.manager, canReadTable: async () => async () => true } as never;
    const read = await readRowsTool.run({ connectionId: h.connectionId, table: projects }, deps);
    expect(read.error).toBeUndefined();
    const rows = (read.result as { rows: Record<string, unknown>[] }).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const one of rows) {
      expect(one['share_token'] ?? null).toBeNull();
      expect(one['ref_code'] ?? null).toBeNull();
    }
    expect(JSON.stringify(read)).not.toContain(String(await stored('share_token')));
    // Nor read back by a filter or an order.
    for (const args of [{ where: `share_token.eq.${String(await stored('share_token'))}` }, { sort: 'ref_code.asc' }]) {
      const probed = await readRowsTool.run({ connectionId: h.connectionId, table: projects, ...args }, deps);
      expect(probed.error, JSON.stringify(args)).toBeDefined();
    }
  });
});

describe('what the effective model makes of a secret guessed from a name', () => {
  const model = {
    irVersion: 1,
    dialect: 'postgres',
    source: { kind: 'live', connectionId: 'c' },
    name: 'c',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [
      {
        id: 'public.projects',
        schema: 'public',
        name: 'projects',
        kind: 'table',
        comment: null,
        primaryKey: ['id'],
        columns: ['share_token', 'api_token', 'card_token'].map((name, i) => ({
          name,
          ordinal: i + 1,
          dbType: 'text',
          logicalType: 'text',
          nullable: true,
          default: null,
          isPrimaryKey: false,
          isUnique: false,
          isGenerated: false,
          enumRef: null,
          maxLength: null,
          numericPrecision: null,
          numericScale: null,
          isArray: false,
          comment: null,
          references: null,
          semantics: {
            primary: 'secret',
            flags: { secret: true, pii: name === 'card_token' ? 'payment-id' : null, maskedByDefault: true },
            format: null,
            pair: null,
            confidence: 0.95,
            source: 'heuristic',
          },
        })),
      },
    ],
    relations: [],
    enums: [],
  };
  const row = (op: string, columnName: string, value: Record<string, unknown>, origin = 'app') =>
    ({ id: `${op}-${columnName}`, connectionId: 'c', op, tableName: 'public.projects', columnName, value, origin, status: 'active', llmRunId: null, createdAt: 0, updatedAt: 0 }) as never;

  it('takes a column said to be no secret for none, drops the mask the guess wrote, and keeps a mask for personal data', () => {
    const effective = applyOverrides(model as never, [
      row('column.pii', 'share_token', { masked: true }, 'auto'),
      row('column.pii', 'card_token', { masked: true, kind: 'payment-id' }, 'auto'),
      row('column.code', 'share_token', { length: 16 }),
      row('column.secret', 'share_token', { secret: false }),
      row('column.code', 'card_token', { length: 16 }),
      row('column.secret', 'card_token', { secret: false }),
    ]);
    const [share, api, card] = effective.tables[0]!.columns;
    expect(share!.semantics).toMatchObject({ primary: 'plain', flags: { secret: false, maskedByDefault: false } });
    expect(share!.masked).toBeUndefined();
    expect(api!.semantics!.flags.secret).toBe(true);
    expect(card!.semantics!.flags).toMatchObject({ secret: false, pii: 'payment-id' });
    expect(card!.masked).toBe(true);
  });

  it('lets `column.secret` say it either way, over the guess and the code alike', () => {
    const effective = applyOverrides(model as never, [
      row('column.secret', 'api_token', { secret: false }),
      row('column.code', 'share_token', { length: 16 }),
      row('column.secret', 'share_token', { secret: true }),
    ]);
    const [share, api] = effective.tables[0]!.columns;
    expect(api!.semantics!.flags.secret).toBe(false);
    expect(share!.semantics!.flags.secret).toBe(true);
  });
});

describe('the scope of a shared link', () => {
  const document = (expose: string[], extra: Record<string, unknown> = {}) =>
    ({
      version: 1,
      side: 'customer',
      timezone: 'UTC',
      claim: { strategy: 'token', ref: 'projects_claimed', match: ['share_token'] },
      resources: [{ ref: 'projects_claimed', table: 'public.projects', actions: ['read'], expose, ...extra }],
    }) as unknown as PublicScopeDocument;

  it('never shows, filters, searches or orders by the code it opens with', () => {
    expect(() => compileScope(document(['id', 'name']))).not.toThrow();
    for (const doc of [document(['id', 'share_token']), document(['id', 'name'], { filterable: ['share_token'] })]) {
      try {
        compileScope(doc);
        expect.unreachable('the scope compiled');
      } catch (error) {
        expect(error).toBeInstanceOf(ScopeCompileError);
        expect((error as ScopeCompileError).issues.map((issue) => issue.code)).toContain('SCOPE_CLAIM_TOKEN_SHOWN');
      }
    }
  });
});
