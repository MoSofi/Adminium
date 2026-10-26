// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two tables of wave 0068 on every available engine: a mail service's
 * notice endpoint and a sending domain's DKIM key. Each column at its full
 * width, the secrets never in the clear in the row, a path token found by its
 * hash, one endpoint per service, and the creator's removal keeping the row.
 */
import { describe, expect, it } from 'vitest';

import { emailDkimKeysRepo, emailNoticeEndpointsRepo, noticeTokenHash, usersRepo, type MetaDb } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_790_000_000_000;

/** A stand-in for the server's AES-GCM envelope: the plain text never appears in what it returns. */
const crypto = {
  encrypt: (plain: string) => `enc:v1:${Buffer.from(plain, 'utf8').reverse().toString('base64')}`,
  decrypt: (token: string) => Buffer.from(token.slice('enc:v1:'.length), 'base64').reverse().toString('utf8'),
};

const TOKEN = 'tok_'.padEnd(43, 'Q');
const SECRET = JSON.stringify({ user: 'adminium-postmark', pass: 'p'.repeat(40) });
const PRIVATE = '-----BEGIN PRIVATE KEY-----\nMIIEvQ' + 'A'.repeat(1600) + '\n-----END PRIVATE KEY-----\n';

/** Every value of every row of a table, as one string: what a dump of the store would show. */
async function dump(meta: MetaDb, table: 'adminium_email_notice_endpoints' | 'adminium_email_dkim_keys'): Promise<string> {
  return JSON.stringify(await meta.db.selectFrom(table).selectAll().execute());
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`mail relay secrets [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    describe('notice endpoints', () => {
      it('keeps every column at its full width, and the secret and token only encrypted', async () => {
        const repo = emailNoticeEndpointsRepo(meta(), crypto);
        const service = 's'.repeat(16);
        const arn = `arn:aws:sns:us-east-1:123456789012:${'t'.repeat(320 - 35)}`;
        expect(arn).toHaveLength(320);
        const made = await repo.create({ service, token: TOKEN, secret: SECRET, publicKey: 'MFkw'.repeat(30), topicArn: arn }, T0);
        expect(made).toMatchObject({ service, topicArn: arn, hasSecret: true, secretSetAt: T0, noticeCount: 0, lastNoticeAt: null, confirmedAt: null, createdAt: T0 });
        expect(made!.id).toMatch(/^ntc_/);
        expect(made!.tokenHash).toBe(noticeTokenHash(TOKEN));
        expect(made).not.toHaveProperty('secret');

        const raw = await dump(meta(), 'adminium_email_notice_endpoints');
        expect(raw).not.toContain(TOKEN);
        expect(raw).not.toContain('p'.repeat(40));
        expect(raw).not.toContain('adminium-postmark');
        expect(await repo.secretOf(made!.id)).toBe(SECRET);
        expect(await repo.tokenOf(made!.id)).toBe(TOKEN);

        // One wider is refused before the engine sees it.
        await expect(repo.create({ service: 's'.repeat(17), token: TOKEN })).rejects.toThrow(/1–16/);
        await expect(repo.create({ service: 'other', token: 'x'.repeat(43), topicArn: `${arn}x` })).rejects.toThrow(/320/);
      });

      it('finds an endpoint by its path token, and by nothing else', async () => {
        const repo = emailNoticeEndpointsRepo(meta(), crypto);
        const made = (await repo.create({ service: 'mailgun', token: TOKEN }, T0))!;
        expect((await repo.byToken(TOKEN))?.id).toBe(made.id);
        expect(await repo.byToken(`${TOKEN}x`)).toBeNull();
        expect(await repo.byToken(made.tokenHash)).toBeNull();
        expect((await repo.byService('mailgun'))?.id).toBe(made.id);

        const next = 'n'.repeat(43);
        expect(await repo.replaceToken(made.id, next, T0 + 1)).toBe(true);
        expect(await repo.byToken(TOKEN)).toBeNull();
        expect((await repo.byToken(next))?.id).toBe(made.id);
        expect(await repo.tokenOf(made.id)).toBe(next);
        await expect(repo.replaceToken(made.id, 'short')).rejects.toThrow(/16/);
      });

      it('holds one endpoint per service', async () => {
        const repo = emailNoticeEndpointsRepo(meta(), crypto);
        expect(await repo.create({ service: 'postmark', token: TOKEN }, T0)).not.toBeNull();
        expect(await repo.create({ service: 'postmark', token: 'z'.repeat(43) }, T0)).toBeNull();
        // The same token for another service is refused too: a token names one endpoint.
        expect(await repo.create({ service: 'brevo', token: TOKEN }, T0)).toBeNull();
        expect((await repo.list()).map((row) => row.service)).toEqual(['postmark']);
      });

      it('replaces and takes off the secret, the key and the topic, and counts notices', async () => {
        const repo = emailNoticeEndpointsRepo(meta(), crypto);
        const made = (await repo.create({ service: 'ses', token: TOKEN, topicArn: 'arn:aws:sns:eu-west-1:123456789012:bounces' }, T0))!;
        expect(made.hasSecret).toBe(false);
        expect(await repo.secretOf(made.id)).toBeNull();
        expect(await repo.confirm(made.id, T0 + 1)).toBe(true);
        expect((await repo.byId(made.id))?.confirmedAt).toBe(T0 + 1);
        // Another topic has not answered the handshake.
        await repo.setTopicArn(made.id, 'arn:aws:sns:eu-west-1:123456789012:other', T0 + 2);
        expect(await repo.byId(made.id)).toMatchObject({ topicArn: 'arn:aws:sns:eu-west-1:123456789012:other', confirmedAt: null, secretSetAt: T0 + 2 });

        await repo.setSecret(made.id, 'key-1', T0 + 3);
        expect(await repo.byId(made.id)).toMatchObject({ hasSecret: true, secretSetAt: T0 + 3 });
        expect(await repo.secretOf(made.id)).toBe('key-1');
        await repo.setSecret(made.id, null, T0 + 4);
        expect(await repo.byId(made.id)).toMatchObject({ hasSecret: false, secretSetAt: null });

        await repo.setPublicKey(made.id, 'MFkwEwYH', T0 + 5);
        expect((await repo.byId(made.id))?.publicKey).toBe('MFkwEwYH');

        await repo.noticed(made.id, T0 + 10);
        await repo.noticed(made.id, T0 + 20);
        expect(await repo.byId(made.id)).toMatchObject({ noticeCount: 2, lastNoticeAt: T0 + 20 });
        expect(await repo.noticed('ntc_nobody')).toBe(false);

        expect(await repo.remove(made.id)).toBe(true);
        expect(await repo.byId(made.id)).toBeNull();
      });

      it('keeps the endpoint when the person who made it is removed', async () => {
        const person = await usersRepo(meta()).create({ email: 'owner@example.test', name: 'Owner', passwordHash: 'x' }, T0);
        const repo = emailNoticeEndpointsRepo(meta(), crypto);
        const made = (await repo.create({ service: 'sendgrid', token: TOKEN, createdBy: person.id }, T0))!;
        expect(made.createdBy).toBe(person.id);
        await meta().db.deleteFrom('adminium_users').where('id', '=', person.id).execute();
        expect((await repo.byId(made.id))?.createdBy).toBeNull();
      });
    });

    describe('DKIM keys', () => {
      it('keeps the domain and selector at full width, and the private key only encrypted', async () => {
        const repo = emailDkimKeysRepo(meta(), crypto);
        const domain = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
        expect(domain).toHaveLength(253);
        const selector = 's'.repeat(63);
        const publicKey = `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA${'k'.repeat(348)}`;
        const made = await repo.add({ domain: domain.toUpperCase(), selector, privateKey: PRIVATE, publicKey }, T0);
        expect(made).toMatchObject({ domain, selector, publicKey, createdAt: T0 });
        expect(made!.id).toMatch(/^dkim_/);
        expect(made).not.toHaveProperty('privateKey');

        const raw = await dump(meta(), 'adminium_email_dkim_keys');
        expect(raw).not.toContain('BEGIN PRIVATE KEY');
        expect(raw).not.toContain('A'.repeat(100));
        expect(await repo.privateKeyOf(made!.id)).toBe(PRIVATE);

        await expect(repo.add({ domain: `${domain}x`, selector, privateKey: PRIVATE, publicKey })).rejects.toThrow(/253/);
        await expect(repo.add({ domain: 'example.test', selector: `${selector}x`, privateKey: PRIVATE, publicKey })).rejects.toThrow(/63/);
      });

      it('holds one key per domain and selector, and gives the newest for a domain', async () => {
        const repo = emailDkimKeysRepo(meta(), crypto);
        const first = (await repo.add({ domain: 'Meridian.example', selector: 'adminium', privateKey: PRIVATE, publicKey: 'p1' }, T0))!;
        expect(await repo.add({ domain: 'meridian.example', selector: 'adminium', privateKey: PRIVATE, publicKey: 'p2' }, T0 + 1)).toBeNull();
        const second = (await repo.add({ domain: 'meridian.example', selector: 'adminium2', privateKey: PRIVATE, publicKey: 'p3' }, T0 + 2))!;
        expect((await repo.forDomain(' MERIDIAN.example '))?.id).toBe(second.id);
        expect(await repo.forDomain('other.example')).toBeNull();
        expect((await repo.list()).map((row) => row.selector)).toEqual(['adminium', 'adminium2']);
        expect(await repo.remove(second.id)).toBe(true);
        expect((await repo.forDomain('meridian.example'))?.id).toBe(first.id);
        expect(await repo.privateKeyOf(second.id)).toBeNull();
      });

      it('keeps the key when the person who made it is removed', async () => {
        const person = await usersRepo(meta()).create({ email: 'owner@example.test', name: 'Owner', passwordHash: 'x' }, T0);
        const repo = emailDkimKeysRepo(meta(), crypto);
        const made = (await repo.add({ domain: 'meridian.example', selector: 'adminium', privateKey: PRIVATE, publicKey: 'p', createdBy: person.id }, T0))!;
        await meta().db.deleteFrom('adminium_users').where('id', '=', person.id).execute();
        expect((await repo.byId(made.id))?.createdBy).toBeNull();
      });
    });
  });
}
