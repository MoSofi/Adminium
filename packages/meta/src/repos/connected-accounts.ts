// SPDX-License-Identifier: AGPL-3.0-only
/**
 * connectedAccountsRepo — the accounts people connected on an add-on install,
 * the links that let them, and the sign-ins in progress (wave 0100).
 *
 * Only `apps/server/src/connected-accounts` calls this. The sealed tokens are
 * opened in one method ({@link ConnectedAccountsRepo.tokensOf}), which the
 * token service alone calls. Every list and read here leaves them out, so a
 * screen of accounts never touches key material.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { CONNECTED_ADDRESS_WIDTH, CONNECTED_ROW_WIDTH, CONNECTED_SUBJECT_WIDTH, CONNECTED_TABLE_WIDTH } from '../migrations/0100_connected_accounts.js';
import type { AdminiumConnectedAccountsTable, AdminiumConnectLinksTable, AdminiumOauthFlowsTable } from '../schema/tables.js';
import type { CredentialCrypto } from './manifests.js';
import { affected, isDuplicateKeyError, packJson, readJson, readJsonOrNull } from './util.js';

export { CONNECTED_ADDRESS_WIDTH, CONNECTED_ROW_WIDTH, CONNECTED_SUBJECT_WIDTH, CONNECTED_TABLE_WIDTH };

/** The table an install-level account names in its target. */
export const INSTALL_ACCOUNT_TABLE = '@install';

/**
 * An account's own state. `setup` is not here: a refused client is the
 * install's, read from the credential row.
 */
export const CONNECTED_ACCOUNT_STATES = ['connecting', 'connected', 'partial', 'reconnect', 'disconnecting'] as const;
export type ConnectedAccountState = (typeof CONNECTED_ACCOUNT_STATES)[number];

export type ConnectPurpose = 'connect' | 'reconnect';

/** What an account or a link is tied to. */
export interface AccountTarget {
  connectionId: string;
  tableName: string;
  rowKey: string;
}

/** The target of an account kept for the install as a whole. */
export function installTarget(manifestId: string): AccountTarget {
  return { connectionId: '', tableName: INSTALL_ACCOUNT_TABLE, rowKey: manifestId };
}

export interface ConnectedAccount extends AccountTarget {
  id: string;
  manifestId: string;
  subject: string;
  address: string | null;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
  scopes: string[] | null;
  state: ConnectedAccountState;
  stateSince: number;
  version: number;
  leaseUntil: number | null;
  /** Whether sealed tokens are held. False after an export or a restore under another secret. */
  hasTokens: boolean;
  connectedAt: number;
  updatedAt: number;
}

export interface AccountTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ConnectLink extends AccountTarget {
  id: string;
  providers: string[];
  purpose: ConnectPurpose;
  createdBy: string | null;
  expiresAt: number;
  createdAt: number;
}

export interface OAuthFlow extends AccountTarget {
  id: string;
  stateHash: string;
  nonceHash: string;
  manifestId: string;
  linkId: string;
  verifierSealed: string;
  redirectUri: string;
  expiresAt: number;
  createdAt: number;
}

const ACCOUNT_COLUMNS = [
  'id',
  'manifestId',
  'connectionId',
  'tableName',
  'rowKey',
  'subject',
  'address',
  'expiresAt',
  'refreshExpiresAt',
  'scopes',
  'state',
  'stateSince',
  'version',
  'leaseUntil',
  'connectedAt',
  'updatedAt',
] as const;

type AccountRow = Pick<Selectable<AdminiumConnectedAccountsTable>, (typeof ACCOUNT_COLUMNS)[number]> & { held: unknown };

function accountOf(row: AccountRow): ConnectedAccount {
  return {
    id: row.id,
    manifestId: row.manifestId,
    connectionId: row.connectionId,
    tableName: row.tableName,
    rowKey: row.rowKey,
    subject: row.subject,
    address: row.address,
    expiresAt: row.expiresAt === null ? null : Number(row.expiresAt),
    refreshExpiresAt: row.refreshExpiresAt === null ? null : Number(row.refreshExpiresAt),
    scopes: readJsonOrNull<string[]>(row.scopes),
    state: row.state as ConnectedAccountState,
    stateSince: Number(row.stateSince),
    version: Number(row.version),
    leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil),
    hasTokens: Number(row.held) === 1,
    connectedAt: Number(row.connectedAt),
    updatedAt: Number(row.updatedAt),
  };
}

function linkOf(row: Selectable<AdminiumConnectLinksTable>): ConnectLink {
  return {
    id: row.id,
    connectionId: row.connectionId,
    tableName: row.tableName,
    rowKey: row.rowKey,
    providers: readJson<string[]>(row.providers),
    purpose: row.purpose as ConnectPurpose,
    createdBy: row.createdBy,
    expiresAt: Number(row.expiresAt),
    createdAt: Number(row.createdAt),
  };
}

function flowOf(row: Selectable<AdminiumOauthFlowsTable>): OAuthFlow {
  return {
    id: row.id,
    stateHash: row.stateHash,
    nonceHash: row.nonceHash,
    manifestId: row.manifestId,
    connectionId: row.connectionId,
    tableName: row.tableName,
    rowKey: row.rowKey,
    linkId: row.linkId,
    verifierSealed: row.verifierSealed,
    redirectUri: row.redirectUri,
    expiresAt: Number(row.expiresAt),
    createdAt: Number(row.createdAt),
  };
}

/** What a finished sign-in writes on an account. */
export interface ConnectInput {
  manifestId: string;
  target: AccountTarget;
  subject: string;
  address: string | null;
  tokens: AccountTokens;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
  scopes: string[] | null;
  state: ConnectedAccountState;
}

/** Delete-then-insert under a unique index: a double press can meet itself, and the second try finds the first's row to replace. */
async function onceMore(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await write();
  }
}

export function connectedAccountsRepo(meta: MetaDb, crypto: CredentialCrypto) {
  const { db } = meta;

  const accounts = () =>
    db
      .selectFrom('adminium_connected_accounts')
      .select(ACCOUNT_COLUMNS)
      .select((eb) => eb.case().when('payload', 'is not', null).then(1).else(0).end().as('held'));

  /** The three columns of a target, for a query's `where`. */
  const keyOf = (target: AccountTarget) => ({ connectionId: target.connectionId, tableName: target.tableName, rowKey: target.rowKey });

  return {
    // ─── Accounts ───────────────────────────────────────────────────────────

    async find(id: string): Promise<ConnectedAccount | null> {
      const row = await accounts().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : accountOf(row as AccountRow);
    },

    /** One install's account on a target. */
    async onTarget(manifestId: string, target: AccountTarget): Promise<ConnectedAccount | null> {
      const row = await accounts().where('manifestId', '=', manifestId).where((eb) => eb.and(keyOf(target))).executeTakeFirst();
      return row === undefined ? null : accountOf(row as AccountRow);
    },

    /** Every install's account on a target: a row may be connected through one of several add-ons. */
    async forTarget(target: AccountTarget): Promise<ConnectedAccount[]> {
      const rows = await accounts().where((eb) => eb.and(keyOf(target))).orderBy('id').execute();
      return rows.map((row) => accountOf(row as AccountRow));
    },

    async forInstall(manifestId: string): Promise<ConnectedAccount[]> {
      const rows = await accounts().where('manifestId', '=', manifestId).orderBy('id').execute();
      return rows.map((row) => accountOf(row as AccountRow));
    },

    /** A page of every account, in id order, for the sweep. */
    async page(after: string | null, limit: number): Promise<ConnectedAccount[]> {
      let query = accounts().orderBy('id').limit(limit);
      if (after !== null) query = query.where('id', '>', after);
      const rows = await query.execute();
      return rows.map((row) => accountOf(row as AccountRow));
    },

    /**
     * Writes a finished sign-in and spends the link that allowed it, in one
     * transaction. Null: the link is gone (a disconnect or a newer link came
     * while the provider was answering), and nothing is written.
     */
    async connect(input: ConnectInput, linkId: string, at: number): Promise<ConnectedAccount | null> {
      const payload = crypto.encrypt(JSON.stringify(input.tokens));
      const shared = {
        subject: input.subject,
        address: input.address,
        payload,
        expiresAt: input.expiresAt,
        refreshExpiresAt: input.refreshExpiresAt,
        scopes: input.scopes === null ? null : packJson(input.scopes),
        state: input.state,
        stateSince: at,
        leaseUntil: null,
        updatedAt: at,
      };
      const id = await db.transaction().execute(async (trx) => {
        const spent = await trx.deleteFrom('adminium_connect_links').where('id', '=', linkId).executeTakeFirst();
        if (affected(spent.numDeletedRows) !== 1) return null;
        const existing = await trx
          .selectFrom('adminium_connected_accounts')
          .select(['id', 'version'])
          .where('manifestId', '=', input.manifestId)
          .where((eb) => eb.and(keyOf(input.target)))
          .executeTakeFirst();
        if (existing !== undefined) {
          await trx.updateTable('adminium_connected_accounts').set({ ...shared, version: Number(existing.version) + 1 }).where('id', '=', existing.id).execute();
          return existing.id;
        }
        const made = newId('cac');
        await trx
          .insertInto('adminium_connected_accounts')
          .values({ id: made, manifestId: input.manifestId, ...keyOf(input.target), ...shared, version: 1, connectedAt: at })
          .execute();
        return made;
      });
      return id === null ? null : this.find(id);
    },

    /** The sealed tokens, opened. Null when none are held. Throws on a key that cannot open them. */
    async tokensOf(id: string): Promise<AccountTokens | null> {
      const row = await db.selectFrom('adminium_connected_accounts').select('payload').where('id', '=', id).executeTakeFirst();
      if (row === undefined || row.payload === null) return null;
      return JSON.parse(crypto.decrypt(row.payload)) as AccountTokens;
    },

    /** Takes the right to refresh, if nobody holds it. One statement, so two processes cannot both win. */
    async takeLease(id: string, at: number, until: number): Promise<boolean> {
      const res = await db
        .updateTable('adminium_connected_accounts')
        .set({ leaseUntil: until })
        .where('id', '=', id)
        .where((eb) => eb.or([eb('leaseUntil', 'is', null), eb('leaseUntil', '<=', at)]))
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Lets go of a lease, only if it is still the one taken: a holder that ran past its time never frees the next one's. */
    async releaseLease(id: string, until: number): Promise<void> {
      await db.updateTable('adminium_connected_accounts').set({ leaseUntil: null }).where('id', '=', id).where('leaseUntil', '=', until).execute();
    },

    /** Saves refreshed tokens, only over the version they were read at. False: someone wrote first. */
    async writeTokens(
      id: string,
      version: number,
      next: { tokens: AccountTokens; expiresAt: number | null; refreshExpiresAt: number | null; scopes: string[] | null },
      at: number,
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_connected_accounts')
        .set({
          payload: crypto.encrypt(JSON.stringify(next.tokens)),
          expiresAt: next.expiresAt,
          refreshExpiresAt: next.refreshExpiresAt,
          ...(next.scopes === null ? {} : { scopes: packJson(next.scopes) }),
          version: version + 1,
          leaseUntil: null,
          updatedAt: at,
        })
        .where('id', '=', id)
        .where('version', '=', version)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Moves an account's state. "Since" moves only on a real change. */
    async setState(id: string, state: ConnectedAccountState, at: number): Promise<boolean> {
      const res = await db
        .updateTable('adminium_connected_accounts')
        .set({ state, stateSince: at, updatedAt: at })
        .where('id', '=', id)
        .where('state', '<>', state)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /**
     * The provider said this grant is gone: true when that still describes the
     * row. A reconnect that landed meanwhile moved the version, and stands.
     */
    async markGone(id: string, version: number, at: number): Promise<boolean> {
      const res = await db
        .updateTable('adminium_connected_accounts')
        .set({ state: 'reconnect', stateSince: at, updatedAt: at })
        .where('id', '=', id)
        .where('version', '=', version)
        .where('state', '<>', 'reconnect')
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async remove(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_connected_accounts').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows) === 1;
    },

    // ─── The install's own state ────────────────────────────────────────────

    /** The provider refused this install's client. True for the first to say so. */
    async markRefused(manifestId: string, code: string, at: number): Promise<boolean> {
      const res = await db
        .updateTable('adminium_add_on_credentials')
        .set({ refusedCode: code, refusedAt: at })
        .where('manifestId', '=', manifestId)
        .where('refusedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Takes the next try at a refused client. One statement, so one process gets it. */
    async retryRefused(manifestId: string, seenAt: number, at: number): Promise<boolean> {
      const res = await db
        .updateTable('adminium_add_on_credentials')
        .set({ refusedAt: at })
        .where('manifestId', '=', manifestId)
        .where('refusedAt', '=', seenAt)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async clearRefused(manifestId: string): Promise<void> {
      await db.updateTable('adminium_add_on_credentials').set({ refusedCode: null, refusedAt: null }).where('manifestId', '=', manifestId).execute();
    },

    async refusedOf(manifestId: string): Promise<{ code: string; at: number } | null> {
      const row = await db
        .selectFrom('adminium_add_on_credentials')
        .select(['refusedCode', 'refusedAt'])
        .where('manifestId', '=', manifestId)
        .executeTakeFirst();
      if (row === undefined || row.refusedCode === null || row.refusedAt === null) return null;
      return { code: row.refusedCode, at: Number(row.refusedAt) };
    },

    // ─── Links ──────────────────────────────────────────────────────────────

    /** A new link for a target. The target's earlier link, and any sign-in it started, end here. */
    async mintLink(input: AccountTarget & { providers: string[]; purpose: ConnectPurpose; tokenHash: string; createdBy: string | null; expiresAt: number }, at: number): Promise<ConnectLink> {
      const id = newId('clk');
      const write = () => db.transaction().execute(async (trx) => {
        const old = await trx
          .selectFrom('adminium_connect_links')
          .select('id')
          .where('connectionId', '=', input.connectionId)
          .where('tableName', '=', input.tableName)
          .where('rowKey', '=', input.rowKey)
          .execute();
        if (old.length > 0) {
          const ids = old.map((row) => row.id);
          await trx.deleteFrom('adminium_oauth_flows').where('linkId', 'in', ids).execute();
          await trx.deleteFrom('adminium_connect_links').where('id', 'in', ids).execute();
        }
        await trx
          .insertInto('adminium_connect_links')
          .values({
            id,
            connectionId: input.connectionId,
            tableName: input.tableName,
            rowKey: input.rowKey,
            providers: packJson(input.providers),
            purpose: input.purpose,
            tokenHash: input.tokenHash,
            createdBy: input.createdBy,
            expiresAt: input.expiresAt,
            createdAt: at,
          })
          .execute();
      });
      await onceMore(write);
      const row = await db.selectFrom('adminium_connect_links').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return linkOf(row);
    },

    /** The link a token's hash opens, while it is alive. */
    async linkByHash(tokenHash: string, at: number): Promise<ConnectLink | null> {
      const row = await db
        .selectFrom('adminium_connect_links')
        .selectAll()
        .where('tokenHash', '=', tokenHash)
        .where('expiresAt', '>', at)
        .executeTakeFirst();
      return row === undefined ? null : linkOf(row);
    },

    async linkById(id: string, at: number): Promise<ConnectLink | null> {
      const row = await db.selectFrom('adminium_connect_links').selectAll().where('id', '=', id).where('expiresAt', '>', at).executeTakeFirst();
      return row === undefined ? null : linkOf(row);
    },

    async linkOnTarget(target: AccountTarget, now: number): Promise<ConnectLink | null> {
      const row = await db.selectFrom('adminium_connect_links').selectAll().where('expiresAt', '>', now).where((eb) => eb.and(keyOf(target))).executeTakeFirst();
      return row === undefined ? null : linkOf(row);
    },

    /** Spends a link. True for the one caller that removed it. */
    async spendLink(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_connect_links').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows) === 1;
    },

    async removeLinksOnTarget(target: AccountTarget): Promise<void> {
      const rows = await db.selectFrom('adminium_connect_links').select('id').where((eb) => eb.and(keyOf(target))).execute();
      if (rows.length === 0) return;
      const ids = rows.map((row) => row.id);
      await db.deleteFrom('adminium_oauth_flows').where('linkId', 'in', ids).execute();
      await db.deleteFrom('adminium_connect_links').where('id', 'in', ids).execute();
    },

    // ─── Sign-ins in progress ───────────────────────────────────────────────

    /** Writes a flow. A link has one at a time: a new start replaces the last. */
    async putFlow(input: Omit<OAuthFlow, 'id' | 'createdAt'>, at: number): Promise<void> {
      await onceMore(() => db.transaction().execute(async (trx) => {
        await trx.deleteFrom('adminium_oauth_flows').where('linkId', '=', input.linkId).execute();
        await trx
          .insertInto('adminium_oauth_flows')
          .values({
            id: newId('ofl'),
            stateHash: input.stateHash,
            nonceHash: input.nonceHash,
            manifestId: input.manifestId,
            connectionId: input.connectionId,
            tableName: input.tableName,
            rowKey: input.rowKey,
            linkId: input.linkId,
            verifierSealed: input.verifierSealed,
            redirectUri: input.redirectUri,
            expiresAt: input.expiresAt,
            createdAt: at,
          })
          .execute();
      }));
    },

    /** Reads a flow without using it, so a wrong browser cannot burn the right one's sign-in. */
    async flowByState(stateHash: string, at: number): Promise<OAuthFlow | null> {
      const row = await db
        .selectFrom('adminium_oauth_flows')
        .selectAll()
        .where('stateHash', '=', stateHash)
        .where('expiresAt', '>', at)
        .executeTakeFirst();
      return row === undefined ? null : flowOf(row);
    },

    /** Uses a flow. True for the one caller that removed it, so a replayed code is inert. */
    async takeFlow(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_oauth_flows').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows) === 1;
    },

    /** Removes flows and links past their time. */
    async sweep(at: number): Promise<{ flows: number; links: number }> {
      const flows = await db.deleteFrom('adminium_oauth_flows').where('expiresAt', '<=', at).executeTakeFirst();
      const links = await db.deleteFrom('adminium_connect_links').where('expiresAt', '<=', at).executeTakeFirst();
      return { flows: affected(flows.numDeletedRows), links: affected(links.numDeletedRows) };
    },
  };
}

export type ConnectedAccountsRepo = ReturnType<typeof connectedAccountsRepo>;
