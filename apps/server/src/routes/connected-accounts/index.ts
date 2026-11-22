// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The staff doors of connected accounts.
 *
 * ─── ON A ROW (`/connected-accounts…`) ──────────────────────────────────────
 * One rule, asked on every route, as the person's own role reaches the row:
 *
 *   read the state         read on the row
 *   connect, reconnect     `accounts:<app>:connect` and update on the row
 *   disconnect             `accounts:<app>:disconnect` and update on the row
 *   send a link            `accounts:<app>:send-link` and read on the row;
 *                          it goes to the row's own address, never a typed one
 *   copy a link            `accounts:<app>:send-link` and update on the row
 *
 * So a front desk that reads the team sends links and copies none, an owner
 * does both, and a specialist reaches only their own row. A row a person does
 * not reach answers as one that is not there. An API key acts for nobody here.
 *
 * ─── ON THE INSTALL (`/add-ons/:key/connect/…`) ─────────────────────────────
 * The app registration (client id and secret) and install-level accounts are
 * `manifests.manage`, like every other add-on connection.
 */
import { appModulesOf, auditRepo, manifestsRepo, type ConnectedAccount, type CredentialCrypto, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { OAUTH_TENANT } from '@adminium/add-on-contracts';

import { audited } from '../../audit/coverage.js';
import { accountSpecOf, callbackPath, type AppRegistration } from '../../connected-accounts/spec.js';
import { ConnectRefusedError, parseAddOn, type AccountTable, type ConnectedAccounts } from '../../connected-accounts/service.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import { forwardedOf } from '../../forms/reach.js';
import { canReadPii } from '../../crud/mask.js';
import { installOnConnection, requireInstall, selectorOf } from '../../installs/resolve.js';
import { appAccountsPermission, PERMISSIONS } from '../../rbac/permissions.js';

const rowRef = z.object({
  connection: z.string().min(1).max(36),
  table: z.string().min(1).max(128),
  row: z.string().min(1).max(191),
});
const withAddOn = rowRef.extend({ addOn: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) });
const linkBody = rowRef.extend({ copy: z.boolean().optional() });
const addOnKey = z.object({ key: z.string().min(1).max(160) });
const accountParams = addOnKey.extend({ id: z.string().min(1).max(36) });

const registrationBody = z
  .object({
    clientId: z.string().min(1).max(512),
    /** Left out: the saved secret stays. */
    clientSecret: z.string().min(1).max(4096).optional(),
    /** The provider's directory, for a registration kept to one. Null clears it. */
    tenant: z.string().regex(OAUTH_TENANT).nullable().optional(),
    /** The day the secret ends, if the studio wrote it down. Left out: kept, unless the secret changed. */
    secretEndsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .strict();

const checkBody = z
  .object({
    /** `pair`: a made-up code at the token endpoint. `app`: the app's own sign-in, on a named directory. */
    grant: z.enum(['pair', 'app']),
    scope: z.string().regex(/^https:\/\/[a-z0-9.-]+\/\.default$/).optional(),
    /** What is about to be saved, checked first so a mistyped secret never replaces a working one. Kept nowhere. */
    clientId: z.string().min(1).max(512).optional(),
    clientSecret: z.string().min(1).max(4096).optional(),
    tenant: z.string().regex(OAUTH_TENANT).nullable().optional(),
  })
  .strict();

const accountDto = z.object({
  id: z.string(),
  provider: z.string(),
  providerName: z.string(),
  /** `setup` is the install's: the provider refused its app, and the person has nothing to do. */
  state: z.enum(['connecting', 'connected', 'partial', 'reconnect', 'disconnecting', 'setup']),
  since: z.number(),
  address: z.string().nullable(),
  /** The connected address is not the one on the row: shown, not refused. */
  addressDiffers: z.boolean(),
  /** The provider will end this grant on this date (an app still in testing). */
  grantEndsAt: z.number().nullable(),
});

const rowReply = z.object({
  accounts: z.array(accountDto),
  providers: z.array(z.object({ key: z.string(), name: z.string() })),
  reach: z.enum(['cannot-connect', 'poll-only', 'push']),
  may: z.object({ connect: z.boolean(), sendLink: z.boolean(), copyLink: z.boolean(), disconnect: z.boolean() }),
});

const installReply = z.object({
  key: z.string(),
  per: z.enum(['install', 'row']),
  registered: z.boolean(),
  clientId: z.string().nullable(),
  tenant: z.string().nullable(),
  /** The address to register at the provider. Null until this server knows its public address. */
  redirectUri: z.string().nullable(),
  /** The public address moved since the registration was saved: the provider needs the new redirect address. */
  redirectMoved: z.boolean(),
  reach: z.enum(['cannot-connect', 'poll-only', 'push']),
  /** `secret-refused`: the provider refused the app. `cannot-read-keys`: sealed under another server secret. */
  install: z.enum(['ready', 'not-set-up', 'secret-refused', 'cannot-read-keys']),
  accounts: z.number(),
  /** A studio-wide refusal counts as connected: nobody has to reconnect for it. */
  counts: z.object({ connected: z.number(), reconnect: z.number() }),
  secretEndsOn: z.string().nullable(),
});

/** One person who may connect through this add-on, for its page. */
const personDto = z.object({
  connection: z.string(),
  table: z.string(),
  row: z.string(),
  name: z.string().nullable(),
  address: z.string().nullable(),
  /** The row has an address a link can go to, whether or not this reader may see it. */
  canEmail: z.boolean(),
  account: accountDto.nullable(),
  lastSyncedAt: z.number().nullable(),
  /** Connected through another calendar add-on, so not offered a link here. */
  elsewhere: z.boolean(),
});

/** The most people one add-on page lists. */
const PEOPLE_MAX = 200;
/** How many rows are looked through to find them: a reader's row limits are applied after the read. */
const PEOPLE_SCAN_MAX = 5_000;

export interface ConnectedAccountRoutesDeps {
  meta: MetaDb;
  crypto: CredentialCrypto;
  accounts: ConnectedAccounts;
  /** The row as this person reaches it, under their row limits, with its canonical key; null when they do not. */
  reachedRow(request: FastifyRequest, connectionId: string, table: string, row: string, action: 'read' | 'update'): Promise<{ rowKey: string } | null>;
  /** When an account's calendar was last read. */
  lastSyncedOf?(accountId: string): Promise<number | null>;
  /** The table's personal columns, shown only to whoever may read them. */
  maskedColumns?(connectionId: string, table: string): Promise<ReadonlySet<string>>;
}

function personId(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('A connected account is handled by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const id = request.user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

function accountOut(account: ConnectedAccount, refused: boolean, named: { key: string; name: string } | undefined, onFile: string | null, addressHidden = false): z.infer<typeof accountDto> {
  return {
    id: account.id,
    provider: named?.key ?? '',
    providerName: named?.name ?? '',
    state: account.state === 'disconnecting' ? account.state : refused ? 'setup' : account.hasTokens ? account.state : 'reconnect',
    since: account.stateSince,
    address: addressHidden ? null : account.address,
    // Says only that the two differ, which is what lets the desk notice a wrong account.
    addressDiffers: onFile !== null && account.address !== null && account.address.toLowerCase() !== onFile,
    grantEndsAt: account.refreshExpiresAt,
  };
}

function asRefusal(error: unknown): never {
  if (error instanceof ConnectRefusedError) throw new ValidationFailedError(error.message, { reason: error.code });
  throw error;
}

export function connectedAccountRoutes(deps: ConnectedAccountRoutesDeps): FastifyPluginAsyncZod {
  const { meta, accounts } = deps;
  const manifests = manifestsRepo(meta, deps.crypto);
  const audit = auditRepo(meta);

  /** The row's table, and the row as this person reaches it for `action`. A row out of reach is not there. */
  async function reach(request: FastifyRequest, input: z.infer<typeof rowRef>, action: 'read' | 'update'): Promise<{ table: AccountTable; rowKey: string }> {
    const missing = () => new NotFoundError('No such record.');
    const table = await accounts.tableOf(input.connection, input.table);
    if (table === null) throw missing();
    if (!(await request.can(`table:${input.connection}:${input.table}:read`))) throw missing();
    if (action === 'update' && !(await request.can(`table:${input.connection}:${input.table}:update`))) throw new ForbiddenError('You may not change this record.', 'TABLE_FORBIDDEN');
    const reached = await deps.reachedRow(request, input.connection, input.table, input.row, action);
    if (reached === null) throw missing();
    return { table, rowKey: reached.rowKey };
  }

  /** The columns of this table the reader may not see: an address or name there stays out of every reply. */
  async function hiddenFrom(request: FastifyRequest, connection: string, table: string): Promise<ReadonlySet<string>> {
    if (await canReadPii(request, connection, table)) return new Set();
    return (await deps.maskedColumns?.(connection, table)) ?? new Set();
  }

  const holds = (request: FastifyRequest, table: AccountTable, action: 'connect' | 'send-link' | 'disconnect') => request.can(appAccountsPermission(table.appKey, action));

  async function need(request: FastifyRequest, table: AccountTable, action: 'connect' | 'send-link' | 'disconnect'): Promise<void> {
    if (!(await holds(request, table, action))) throw new ForbiddenError('Your role may not do this.', 'FORBIDDEN', { action });
  }

  const record = (request: FastifyRequest, action: string, after: Record<string, unknown>) =>
    audit.append({ actorKind: 'user', actorId: request.user?.id ?? null, actorLabel: request.user?.email ?? 'unknown', category: 'add-on', action, changes: { after } });

  return async (app) => {
    app.get('/connected-accounts', { preHandler: app.requireAuth, schema: { querystring: rowRef, response: { 200: rowReply } } }, async (request) => {
      personId(request);
      const input = request.query;
      const { table, rowKey } = await reach(request, input, 'read');
      const target = { connectionId: input.connection, tableName: input.table, rowKey };
      const row = await accountsRow(accounts, target);
      const onFile = accounts.personOf(row, table.rule).address?.toLowerCase() ?? null;
      const hidden = await hiddenFrom(request, input.connection, input.table);
      const addressHidden = table.rule.address === undefined ? !(await canReadPii(request, input.connection, input.table)) : hidden.has(table.rule.address);
      const providers: { key: string; name: string }[] = [];
      const names = new Map<string, { key: string; name: string }>();
      for (const key of table.rule.from) {
        const install = await installOnConnection(manifests, key, input.connection);
        const manifest = install === null ? null : parseAddOn(install.document);
        if (install === null || manifest === null) continue;
        const named = { key, name: manifest.name };
        providers.push(named);
        names.set(install.row.id, named);
      }
      const list = [];
      for (const account of await accounts.repo.forTarget(target)) {
        const refused = (await accounts.repo.refusedOf(account.manifestId)) !== null;
        list.push(accountOut(account, refused, names.get(account.manifestId), onFile, addressHidden));
      }
      const canUpdate = (await request.can(`table:${input.connection}:${input.table}:update`)) && (await deps.reachedRow(request, input.connection, input.table, input.row, 'update')) !== null;
      const [connect, sendLink, disconnect] = await Promise.all([holds(request, table, 'connect'), holds(request, table, 'send-link'), holds(request, table, 'disconnect')]);
      return {
        accounts: list,
        providers,
        reach: await accounts.reachNow(forwardedOf(request)),
        may: { connect: connect && canUpdate, sendLink, copyLink: sendLink && canUpdate, disconnect: disconnect && canUpdate },
      };
    });

    /** Connect or reconnect, now, in this browser: a short link the page opens at once. */
    app.post('/connected-accounts/connect', { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { body: withAddOn, response: { 200: z.object({ url: z.string() }) } } }, async (request) => {
      const by = personId(request);
      const input = request.body;
      const { table, rowKey } = await reach(request, input, 'update');
      await need(request, table, 'connect');
      const target = { connectionId: input.connection, tableName: input.table, rowKey };
      const minted = await accounts.linkForRow(target, table, { createdBy: by, forwarded: forwardedOf(request), self: true, only: input.addOn }).catch(asRefusal);
      await record(request, 'connected-account.connect-started', { addOn: input.addOn, table: input.table, row: rowKey });
      return { url: minted.url };
    });

    /** Sends a link to the address on the row, or hands it back to someone who may copy it. */
    app.post(
      '/connected-accounts/link',
      { preHandler: app.requireAuth, config: { audit: audited('rbac') }, schema: { body: linkBody, response: { 200: z.object({ sentTo: z.string().nullable(), url: z.string().nullable() }) } } },
      async (request) => {
        const by = personId(request);
        const input = request.body;
        const { table, rowKey } = await reach(request, input, input.copy === true ? 'update' : 'read');
        await need(request, table, 'send-link');
        const target = { connectionId: input.connection, tableName: input.table, rowKey };
        if (input.copy === true) {
          const minted = await accounts.linkForRow(target, table, { createdBy: by, forwarded: forwardedOf(request) }).catch(asRefusal);
          await record(request, 'connected-account.link-copied', { table: input.table, row: rowKey });
          return { sentTo: null, url: minted.url };
        }
        const sent = await accounts.sendLink(target, table, { createdBy: by, forwarded: forwardedOf(request) }).catch(asRefusal);
        await record(request, 'connected-account.link-sent', { table: input.table, row: rowKey });
        const hidden = await hiddenFrom(request, input.connection, input.table);
        return { sentTo: table.rule.address !== undefined && hidden.has(table.rule.address) ? null : sent.sentTo, url: null };
      },
    );

    app.post(
      '/connected-accounts/disconnect',
      {
        preHandler: app.requireAuth,
        config: { audit: audited('rbac') },
        schema: { body: withAddOn, response: { 200: z.object({ removed: z.number(), incomplete: z.boolean(), revoked: z.boolean().nullable() }) } },
      },
      async (request) => {
        personId(request);
        const input = request.body;
        const { table, rowKey } = await reach(request, input, 'update');
        await need(request, table, 'disconnect');
        const target = { connectionId: input.connection, tableName: input.table, rowKey };
        const install = await installOnConnection(manifests, input.addOn, input.connection);
        const account = install === null ? null : await accounts.repo.onTarget(install.row.id, target);
        if (account === null) throw new NotFoundError('No connected account here.');
        const ended = await accounts.end(account.id);
        if (ended === null) throw new NotFoundError('No connected account here.');
        await record(request, 'connected-account.disconnected', { addOn: input.addOn, table: input.table, row: rowKey, ...ended });
        return ended;
      },
    );

    // ─── The install ────────────────────────────────────────────────────────

    const installOf = async (request: FastifyRequest, key: string) => {
      const installed = await requireInstall(manifests, key, selectorOf(request), { kind: 'add-on' });
      const manifest = parseAddOn(installed.document);
      const spec = manifest === null ? null : accountSpecOf(manifest);
      if (spec === null) throw new ValidationFailedError(`"${key}" does not keep connected accounts.`, { reason: 'no-accounts' });
      return { installed, spec };
    };

    app.get(
      '/add-ons/:key/connect/accounts',
      { preHandler: app.rbac.require(PERMISSIONS.manifestsManage), schema: { params: addOnKey, response: { 200: installReply } } },
      async (request) => {
        const { installed, spec } = await installOf(request, request.params.key);
        let registration: AppRegistration | null = null;
        let keys = true;
        const status = await manifests.credentialStatus(installed.row.id);
        if (status !== null) {
          const held = await accounts.installOf(installed.row.id);
          registration = held?.registration ?? null;
          keys = registration !== null;
        }
        const refused = await accounts.repo.refusedOf(installed.row.id);
        const redirectUri = await accounts.redirectUri(spec.key);
        const held = (await accounts.repo.forInstall(installed.row.id)).filter((account) => account.state !== 'disconnecting');
        const toReconnect = held.filter((account) => refused === null && (!account.hasTokens || account.state === 'reconnect' || account.state === 'partial')).length;
        return {
          key: spec.key,
          per: spec.per,
          registered: registration !== null,
          clientId: registration?.clientId ?? null,
          tenant: registration?.tenant ?? null,
          redirectUri,
          redirectMoved: registration?.redirectOrigin != null && redirectUri !== null && !redirectUri.startsWith(`${registration.redirectOrigin}/`),
          reach: await accounts.reachNow(forwardedOf(request)),
          install: status === null ? ('not-set-up' as const) : !keys ? ('cannot-read-keys' as const) : refused !== null ? ('secret-refused' as const) : ('ready' as const),
          accounts: held.length,
          counts: { connected: held.length - toReconnect, reconnect: toReconnect },
          secretEndsOn: registration?.secretEndsOn ?? null,
        };
      },
    );

    /**
     * Everyone who may connect through this add-on, as this person reaches
     * them. It serves the add-on's page, so a row out of their reach is left out.
     */
    app.get(
      '/add-ons/:key/connect/people',
      { preHandler: app.rbac.require(PERMISSIONS.manifestsManage), schema: { params: addOnKey, response: { 200: z.object({ people: z.array(personDto), more: z.boolean() }) } } },
      async (request) => {
        personId(request);
        const { installed, spec } = await installOf(request, request.params.key);
        const appKeys = installed.attachments.map((attachment) => attachment.attachedTo).filter((key) => key !== '*');
        const apps = await appModulesOf(meta, appKeys.length > 0 ? appKeys : undefined);
        const own = installed.row.connectionId;
        const connections = own != null ? [own] : [...new Set(apps.flatMap((one) => (one.connectionId === null ? [] : [one.connectionId])))];
        const refused = (await accounts.repo.refusedOf(installed.row.id)) !== null;
        const named = { key: spec.key, name: parseAddOn(installed.document)?.name ?? spec.key };
        const people: z.infer<typeof personDto>[] = [];
        let more = false;
        for (const connection of connections) {
          for (const { id: table, table: rule } of await accounts.tablesFrom(connection, spec.key)) {
            if (!(await request.can(`table:${connection}:${table}:read`))) continue;
            const rows = await accounts.listRows(connection, table, PEOPLE_SCAN_MAX + 1);
            if (rows.length > PEOPLE_SCAN_MAX) more = true;
            const hidden = await hiddenFrom(request, connection, table);
            const addressHidden = rule.rule.address !== undefined && hidden.has(rule.rule.address);
            for (const { rowKey, row } of rows.slice(0, PEOPLE_SCAN_MAX)) {
              if (people.length >= PEOPLE_MAX) {
                more = true;
                break;
              }
              if (!accounts.rowIsLive(row, rule.rule) || (await deps.reachedRow(request, connection, table, rowKey, 'read')) === null) continue;
              const person = accounts.personOf(row, rule.rule);
              const held = await accounts.repo.forTarget({ connectionId: connection, tableName: table, rowKey });
              const mine = held.find((account) => account.manifestId === installed.row.id);
              people.push({
                connection,
                table,
                row: rowKey,
                name: rule.rule.name !== undefined && hidden.has(rule.rule.name) ? null : person.name,
                address: addressHidden ? null : person.address,
                canEmail: person.address !== null,
                account: mine === undefined ? null : accountOut(mine, refused, named, person.address?.toLowerCase() ?? null, addressHidden),
                lastSyncedAt: mine === undefined ? null : ((await deps.lastSyncedOf?.(mine.id)) ?? null),
                elsewhere: held.some((account) => account.manifestId !== installed.row.id),
              });
            }
          }
        }
        return { people, more };
      },
    );

    /** "Check my setup": what the provider says of the saved ID and secret. Never its words. */
    app.post(
      '/add-ons/:key/connect/check',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { rateLimitBucket: 'connect-check', audit: audited('rbac') },
        schema: { params: addOnKey, body: checkBody, response: { 200: z.object({ result: z.enum(['accepted', 'refused', 'expired', 'not-set-up', 'unknown', 'unreachable']) }) } },
      },
      async (request) => {
        personId(request);
        const { installed, spec } = await installOf(request, request.params.key);
        const result = await accounts.checkApp(installed.row.id, request.body);
        await record(request, 'add-on.app-checked', { key: spec.key, grant: request.body.grant, result });
        return { result };
      },
    );

    app.put(
      '/add-ons/:key/connect/app',
      { preHandler: app.rbac.require(PERMISSIONS.manifestsManage), config: { audit: audited('rbac') }, schema: { params: addOnKey, body: registrationBody, response: { 200: z.object({ key: z.string(), redirectPath: z.string() }) } } },
      async (request) => {
        const { installed, spec } = await installOf(request, request.params.key);
        const { clientId, clientSecret, tenant, secretEndsOn } = request.body;
        const before = (await accounts.installOf(installed.row.id))?.registration ?? null;
        const secret = clientSecret ?? before?.clientSecret;
        const keptTenant = before?.tenant ?? null;
        // A new secret has its own end date: the old one's must not warn about it.
        const secretChanged = clientSecret !== undefined && clientSecret !== before?.clientSecret;
        const endsOn = secretEndsOn !== undefined ? secretEndsOn : secretChanged ? null : (before?.secretEndsOn ?? null);
        if (secret === undefined) throw new ValidationFailedError('Enter the client secret.', { reason: 'no-secret' });
        const redirectUri = await accounts.redirectUri(spec.key);
        const next: AppRegistration = {
          oauthApp: 1,
          clientId,
          clientSecret: secret,
          tenant: tenant === undefined ? keptTenant : tenant,
          // Saved with the address it was registered for, so a later move of the public address can say so.
          redirectOrigin: redirectUri === null ? null : new URL(redirectUri).origin,
          secretEndsOn: endsOn,
          secretToldFor: endsOn !== null && endsOn === before?.secretEndsOn && !secretChanged ? (before.secretToldFor ?? null) : null,
          keptCalendars: before?.keptCalendars ?? {},
        };
        await manifests.setCredential(installed.row.id, { kind: 'oauth2', secret: next });
        // A new secret is a new answer: the provider is asked again at the next refresh.
        await accounts.repo.clearRefused(installed.row.id);
        await record(request, 'add-on.app-registered', { key: spec.key, clientId, tenant: next.tenant, secretChanged: clientSecret !== undefined });
        return { key: spec.key, redirectPath: callbackPath(spec.key) };
      },
    );

    app.post(
      '/add-ons/:key/connect/accounts/link',
      { preHandler: app.rbac.require(PERMISSIONS.manifestsManage), config: { audit: audited('rbac') }, schema: { params: addOnKey, response: { 200: z.object({ url: z.string() }) } } },
      async (request) => {
        const by = personId(request);
        const { installed, spec } = await installOf(request, request.params.key);
        const minted = await accounts.linkForInstall(installed.row.id, spec.key, { createdBy: by, forwarded: forwardedOf(request) }).catch(asRefusal);
        await record(request, 'connected-account.connect-started', { addOn: spec.key, install: true });
        return { url: minted.url };
      },
    );

    app.post(
      '/add-ons/:key/connect/accounts/:id/disconnect',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: accountParams, response: { 200: z.object({ removed: z.number(), incomplete: z.boolean(), revoked: z.boolean().nullable() }) } },
      },
      async (request) => {
        personId(request);
        const { installed, spec } = await installOf(request, request.params.key);
        const account = await accounts.repo.find(request.params.id);
        if (account === null || account.manifestId !== installed.row.id) throw new NotFoundError('No connected account here.');
        const ended = await accounts.end(account.id);
        if (ended === null) throw new NotFoundError('No connected account here.');
        await record(request, 'connected-account.disconnected', { addOn: spec.key, account: account.id, ...ended });
        return ended;
      },
    );
  };
}

/** The row, read as the engine, for what its rule names. */
function accountsRow(accounts: ConnectedAccounts, target: { connectionId: string; tableName: string; rowKey: string }) {
  return accounts.readRow(target);
}
