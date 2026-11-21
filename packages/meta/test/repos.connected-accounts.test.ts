// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connected accounts (wave 0100), on every available dialect: one account per
 * install and target, a link per target that a new one retires, a flow used
 * once, one refresh at a time, and an older answer that never overwrites a
 * newer one. The one-row credential index is left as it was.
 */
import { sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, connectedAccountsRepo, installTarget, manifestsRepo, SERVER_SCOPE } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const crypto = {
  encrypt: (v: string) => `enc:${Buffer.from(v, 'utf8').toString('base64')}`,
  decrypt: (v: string) => Buffer.from(v.slice(4), 'base64').toString('utf8'),
};

const addOn = (manifestKey: string) => ({
  manifestKey,
  version: '1.0.0',
  kind: 'add-on' as const,
  source: 'marketplace',
  document: { kind: 'add-on', key: manifestKey, version: '1.0.0' },
  scopeKey: SERVER_SCOPE,
});

const elin = { connectionId: 'con_1', tableName: 'team', rowKey: '7' };
const noor = { connectionId: 'con_1', tableName: 'team', rowKey: '8' };
const tokens = (n: number) => ({ accessToken: `at-${String(n)}`, refreshToken: `rt-${String(n)}` });

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`connectedAccountsRepo [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    let repo: ReturnType<typeof connectedAccountsRepo>;
    let manifests: ReturnType<typeof manifestsRepo>;
    let installId: string;

    let linkNumber = 0;
    /** A finished sign-in, through a link of its own. */
    const connect = async (target = elin, subject = 'sub-elin', manifestId = installId, at = T0) => {
      linkNumber += 1;
      const link = await repo.mintLink({ ...target, providers: ['calendar-google'], purpose: 'connect', tokenHash: String(linkNumber).padStart(64, '0'), createdBy: null, expiresAt: at + 1000 }, at);
      return (await repo.connect({ manifestId, target, subject, address: `${subject}@example.com`, tokens: tokens(1), expiresAt: at + 3_600_000, refreshExpiresAt: null, scopes: ['a', 'b'], state: 'connected' }, link.id, at))!;
    };

    const mint = (target = elin, hash = 'a'.repeat(64), expiresAt = T0 + 1000) =>
      repo.mintLink({ ...target, providers: ['calendar-google'], purpose: 'connect', tokenHash: hash, createdBy: null, expiresAt }, T0);

    const flow = (linkId: string, state = 's'.repeat(64), expiresAt = T0 + 1000) =>
      repo.putFlow({ stateHash: state, nonceHash: 'n'.repeat(64), manifestId: installId, ...elin, linkId, verifierSealed: crypto.encrypt('v'), redirectUri: 'https://x.example/cb', expiresAt }, T0);

    beforeEach(async () => {
      repo = connectedAccountsRepo(meta(), crypto);
      manifests = manifestsRepo(meta(), crypto);
      installId = (await manifests.install(addOn('calendar-google'))).row.id;
    });

    it('keeps several accounts on one install, and the one-row credential beside them', async () => {
      await manifests.setCredential(installId, { kind: 'oauth2', secret: { oauthApp: 1, clientId: 'id', clientSecret: 's' } });
      await connect(elin, 'sub-elin');
      await connect(noor, 'sub-noor');
      expect((await repo.forInstall(installId)).map((one) => one.subject).sort()).toEqual(['sub-elin', 'sub-noor']);
      expect((await manifests.getCredential(installId))?.secret['clientId']).toBe('id');
    });

    it('reads no token in a list, and opens them in one method', async () => {
      const made = await connect();
      expect(JSON.stringify(await repo.forInstall(installId))).not.toContain('at-1');
      expect(made.hasTokens).toBe(true);
      expect(await repo.tokensOf(made.id)).toEqual(tokens(1));
      const raw = await meta().db.selectFrom('adminium_connected_accounts').select('payload').executeTakeFirstOrThrow();
      expect(raw.payload).not.toContain('at-1');
    });

    it('keeps one row per install and target, and a second connect updates it', async () => {
      const first = await connect();
      const second = await connect();
      expect(second.id).toBe(first.id);
      expect(second.version).toBe(first.version + 1);
      expect(await repo.forInstall(installId)).toHaveLength(1);
    });

    it('keeps two installs of one add-on apart on the same target', async () => {
      const other = (await manifests.install({ ...addOn('calendar-google'), scopeKey: 'con_2', instanceSlug: 'kiln' })).row.id;
      await connect(elin, 'sub-a', installId);
      await connect(elin, 'sub-b', other);
      expect((await repo.onTarget(installId, elin))?.subject).toBe('sub-a');
      expect((await repo.onTarget(other, elin))?.subject).toBe('sub-b');
      expect(await repo.forTarget(elin)).toHaveLength(2);
    });

    it('gives an install-level account a target of its own', async () => {
      const target = installTarget(installId);
      await connect(target, 'sub-install');
      expect((await repo.onTarget(installId, target))?.subject).toBe('sub-install');
    });

    it('goes with the install', async () => {
      await connect();
      const link = await mint();
      await flow(link.id);
      await manifests.uninstall(installId);
      expect(await repo.forTarget(elin)).toEqual([]);
      expect(await repo.flowByState('s'.repeat(64), T0)).toBeNull();
    });

    it('lets one process hold the right to refresh at a time', async () => {
      const made = await connect();
      expect(await repo.takeLease(made.id, T0, T0 + 30_000)).toBe(true);
      expect(await repo.takeLease(made.id, T0 + 1, T0 + 30_001)).toBe(false);
      // A process that died holding it does not hold it for ever.
      expect(await repo.takeLease(made.id, T0 + 30_000, T0 + 60_000)).toBe(true);
      // A holder that ran past its time does not free the lease someone else holds now.
      await repo.releaseLease(made.id, T0 + 30_000);
      expect(await repo.takeLease(made.id, T0 + 30_001, T0 + 60_001)).toBe(false);
      await repo.releaseLease(made.id, T0 + 60_000);
      expect(await repo.takeLease(made.id, T0 + 30_001, T0 + 60_001)).toBe(true);
    });

    it('writes a sign-in only while its link stands, and spends it with the write', async () => {
      const input = { manifestId: installId, target: elin, subject: 'sub-elin', address: null, tokens: tokens(1), expiresAt: null, refreshExpiresAt: null, scopes: null, state: 'connected' as const };
      const link = await mint();
      expect((await repo.connect(input, link.id, T0))?.subject).toBe('sub-elin');
      expect(await repo.linkByHash('a'.repeat(64), T0)).toBeNull();
      // The link is gone now: a second answer for it writes nothing.
      expect(await repo.connect({ ...input, subject: 'sub-late' }, link.id, T0)).toBeNull();
      expect((await repo.onTarget(installId, elin))?.subject).toBe('sub-elin');
    });

    it('reads a late "grant gone" only against the version it was asked about', async () => {
      const made = await connect();
      await connect();
      expect(await repo.markGone(made.id, made.version, T0)).toBe(false);
      expect((await repo.find(made.id))?.state).toBe('connected');
      expect(await repo.markGone(made.id, made.version + 1, T0)).toBe(true);
    });

    it('keeps row keys that differ only in case apart, on every engine', async () => {
      const upper = { ...elin, rowKey: 'SKU-A' };
      const lower = { ...elin, rowKey: 'sku-a' };
      await connect(upper, 'sub-upper');
      expect(await repo.forTarget(lower)).toEqual([]);
      await connect(lower, 'sub-lower');
      expect((await repo.onTarget(installId, upper))?.subject).toBe('sub-upper');
      expect((await repo.onTarget(installId, lower))?.subject).toBe('sub-lower');
    });

    it('never writes an older answer over a newer one', async () => {
      const made = await connect();
      const next = { tokens: tokens(2), expiresAt: T0, refreshExpiresAt: null, scopes: null };
      expect(await repo.writeTokens(made.id, made.version, next, T0)).toBe(true);
      expect(await repo.writeTokens(made.id, made.version, { ...next, tokens: tokens(3) }, T0)).toBe(false);
      expect(await repo.tokensOf(made.id)).toEqual(tokens(2));
      // A refresh that named no scopes leaves the ones granted.
      expect((await repo.find(made.id))?.scopes).toEqual(['a', 'b']);
    });

    it('moves "since" only on a real change of state', async () => {
      const made = await connect();
      expect(await repo.setState(made.id, 'reconnect', T0 + 5)).toBe(true);
      expect(await repo.setState(made.id, 'reconnect', T0 + 9)).toBe(false);
      expect((await repo.find(made.id))?.stateSince).toBe(T0 + 5);
    });

    it('says a refused client once, on the install', async () => {
      await manifests.setCredential(installId, { kind: 'oauth2', secret: { oauthApp: 1 } });
      expect(await repo.markRefused(installId, 'invalid_client', T0)).toBe(true);
      expect(await repo.markRefused(installId, 'invalid_client', T0 + 1)).toBe(false);
      expect(await repo.refusedOf(installId)).toEqual({ code: 'invalid_client', at: T0 });
      // Saving the registration again leaves what was said until it is cleared.
      await manifests.setCredential(installId, { kind: 'oauth2', secret: { oauthApp: 1, clientId: 'new' } });
      expect((await repo.refusedOf(installId))?.code).toBe('invalid_client');
      await repo.clearRefused(installId);
      expect(await repo.refusedOf(installId)).toBeNull();
    });

    it('lets a new link retire the last, and the sign-in it started', async () => {
      const first = await mint(elin, 'a'.repeat(64));
      await flow(first.id);
      const second = await mint(elin, 'b'.repeat(64));
      expect(await repo.linkByHash('a'.repeat(64), T0)).toBeNull();
      expect((await repo.linkByHash('b'.repeat(64), T0))?.id).toBe(second.id);
      expect(await repo.flowByState('s'.repeat(64), T0)).toBeNull();
    });

    it('reads an expired link as no link, and spends a link once', async () => {
      const link = await mint();
      expect(await repo.linkByHash('a'.repeat(64), T0 + 1000)).toBeNull();
      expect(await repo.spendLink(link.id)).toBe(true);
      expect(await repo.spendLink(link.id)).toBe(false);
    });

    it('keeps one flow per link, used once', async () => {
      const link = await mint();
      await flow(link.id, 'x'.repeat(64));
      await flow(link.id, 'y'.repeat(64));
      expect(await repo.flowByState('x'.repeat(64), T0)).toBeNull();
      const found = await repo.flowByState('y'.repeat(64), T0);
      expect(found?.linkId).toBe(link.id);
      const taken = await Promise.all([repo.takeFlow(found!.id), repo.takeFlow(found!.id)]);
      expect(taken.filter(Boolean)).toHaveLength(1);
    });

    it('sweeps what ran out', async () => {
      const old = await mint(elin, 'a'.repeat(64), T0 + 10);
      await flow(old.id, 's'.repeat(64), T0 + 10);
      await mint(noor, 'b'.repeat(64), T0 + 99_999);
      expect(await repo.sweep(T0 + 10)).toEqual({ flows: 1, links: 1 });
      expect((await repo.linkByHash('b'.repeat(64), T0 + 10))?.rowKey).toBe('8');
    });

    it('reads a row whose tokens were cleared as holding none', async () => {
      const made = await connect();
      await sql`UPDATE adminium_connected_accounts SET payload = NULL`.execute(meta().db);
      expect((await repo.find(made.id))?.hasTokens).toBe(false);
      expect(await repo.tokensOf(made.id)).toBeNull();
    });
  });

  describe.skipIf(!dialect.available)(`0100_connected_accounts upgrade [${dialect.name}]`, () => {
    it('upgrades a store that already holds a credential, and leaves it', async () => {
      const t = await dialect.make();
      try {
        await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS.filter((m) => m.name < '0100_connected_accounts') });
        const at = T0;
        await sql`INSERT INTO adminium_manifests (id, manifest_key, version, kind, source, manifest, status, scope_key, instance_slug, installed_at, updated_at)
          VALUES ('mft_01', 'calendar-google', '1.0.0', 'add-on', 'marketplace', '{}', 'installed', ${SERVER_SCOPE}, '', ${at}, ${at})`.execute(t.meta.db);
        await sql`INSERT INTO adminium_add_on_credentials (id, manifest_id, kind, payload, created_at, updated_at) VALUES ('aoc_01', 'mft_01', 'api-key', 'sealed', ${at}, ${at})`.execute(t.meta.db);
        await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
        const row = await t.meta.db.selectFrom('adminium_add_on_credentials').selectAll().executeTakeFirstOrThrow();
        expect(row.payload).toBe('sealed');
        expect(row.refusedCode).toBeNull();
        expect(await connectedAccountsRepo(t.meta, crypto).forInstall('mft_01')).toEqual([]);
      } finally {
        await t.destroy();
      }
    });
  });
}
