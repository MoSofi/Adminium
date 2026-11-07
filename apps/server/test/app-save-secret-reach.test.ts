// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT COUNTS AS A SECRET, AND WHERE A SECRET IS LOOKED FOR.
 *
 *  - A download (or a workspace file's own list) is refused only for a real
 *    secret: a `.env` value named as one (a key, a token, a password, a
 *    database address), the SMTP password, a sealed value. A host, a sender
 *    address or a public site's address named in the code refuses nothing.
 *    Save as app still asks about those: a hit may be a slip.
 *  - Every `.env` of the project is read (`.env.local`, `.env.production`),
 *    never an example's.
 *  - The warning layer reads a column's literal default, an option list and
 *    a role as it reads every other place a person types.
 *
 * Every secret here is an obviously fake value; a provider's shape is built
 * at run time.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import type { AppManifest } from '@adminium/manifest';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { readContent } from '../src/apps/save/gates/content.js';
import { collectKnownSecrets, scanForSecrets, type KnownSecret } from '../src/apps/save/gates/secrets.js';
import { secretWarnings } from '../src/apps/save/gates/warnings.js';
import { packLeaks } from '../src/project/apps/pack-leaks.js';
import { TEST_SECRET } from './helpers.js';

const FAKE = {
  apiKey: 'fake-shop-api-key-7731-not-real',
  dbPassword: 'fake-db-pass-4410-not-real',
  localSecret: 'fake-local-only-value-9921',
  productionToken: 'fake-production-token-5532',
  smtpPassword: 'fake-smtp-pass-1180-not-real',
  site: 'https://shop.corner.example.test',
  example: 'placeholder-example-value-0042',
} as const;

const file = (path: string, text: string) => [path, Buffer.from(text, 'utf8')] as const;

describe('a hard refusal rests on real secrets', () => {
  let meta: MetaDb;
  let dir: string;
  let secrets: KnownSecret[];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'secret-reach-'));
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await settingsRepo(meta).set('email.smtp', {
      host: 'smtp.mail-host.example',
      port: 587,
      user: 'mailer-account-shop',
      passEncrypted: encryptSecret(FAKE.smtpPassword, emailSecretKey(TEST_SECRET)),
      from: 'orders@shop.corner.example.test',
      secure: false,
    });
    await writeFile(join(dir, '.env'), `PUBLIC_SITE=${FAKE.site}\nSHOP_API_KEY=${FAKE.apiKey}\nDATABASE_URL=postgres://shop:${FAKE.dbPassword}@db-9.internal.example:5432/shop\nSHOP_NAME=Corner shop downtown\n`);
    await writeFile(join(dir, '.env.local'), `LOCAL_SECRET=${FAKE.localSecret}\n`);
    await writeFile(join(dir, '.env.production'), `SHOP_TOKEN=${FAKE.productionToken}\n`);
    await writeFile(join(dir, '.env.example'), `SHOP_API_KEY=${FAKE.example}\n`);
    secrets = await collectKnownSecrets(meta, TEST_SECRET, join(dir, '.env'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const leaks = (text: string) => packLeaks([file('source/src/config.ts', text)], { secrets, connectionIds: [] });

  it('reads every .env of the project, never an example\'s', () => {
    const values = new Set(secrets.map((secret) => secret.value));
    for (const value of [FAKE.apiKey, FAKE.dbPassword, FAKE.localSecret, FAKE.productionToken, FAKE.smtpPassword]) expect(values.has(value), value).toBe(true);
    expect(values.has(FAKE.example)).toBe(false);
  });

  it('refuses nothing for a public address, a host, a sender or a name', () => {
    expect(leaks(`export const site = '${FAKE.site}/shop';`)).toEqual([]);
    expect(leaks(`const mail = { host: 'smtp.mail-host.example', from: 'orders@shop.corner.example.test', user: 'mailer-account-shop' };`)).toEqual([]);
    expect(leaks(`const db = 'db-9.internal.example'; const title = 'Corner shop downtown';`)).toEqual([]);
  });

  it('refuses every real secret, whichever .env it came from', () => {
    for (const value of [FAKE.apiKey, FAKE.dbPassword, FAKE.localSecret, FAKE.productionToken, FAKE.smtpPassword]) {
      expect(leaks(`const k = '${value}';`), value).toEqual([{ kind: 'secret', file: 'source/src/config.ts', line: 1 }]);
    }
  });

  it('still asks about a known value in Save as app', () => {
    const manifest = { kind: 'app', key: 'corner-shop', description: { key: 'd', fallback: `Visit ${FAKE.site}` } } as unknown as AppManifest;
    const found = scanForSecrets(readContent(manifest, new Map()), secrets, {});
    expect(found.map((item) => item.code)).toEqual(['SECRET_FOUND']);
  });
});

describe('the warning layer reads tables, option lists and roles', () => {
  // Built at run time: a literal of this shape in source is what a push protection refuses.
  const paymentKey = ['sk', 'live', 'x'.repeat(24)].join('_');
  const randomKey = ['Zq8', 'Lm3', 'Xv7', 'Rt2', 'Nb9', 'Wk4', 'Hs6', 'Pd1'].join('');

  const app = (over: Record<string, unknown>): AppManifest =>
    ({
      kind: 'app',
      key: 'corner-shop',
      requiredSchema: { tables: [{ ref: 'orders', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'note', type: 'text', maxLength: 400, nullable: true }] }] },
      ...over,
    }) as unknown as AppManifest;
  const warn = (manifest: AppManifest) => secretWarnings(readContent(manifest, new Map()), {}, new Set());

  it('passes a clean schema, option list and role', () => {
    expect(
      warn(
        app({
          optionLists: { sizes: { label: 'Sizes', options: [{ value: 'small', label: 'Small' }] } },
          roles: [{ key: 'clerk', name: 'Clerk', description: 'Rings up orders.' }],
        }),
      ),
    ).toEqual([]);
  });

  it('warns about a literal column default that looks like a key', () => {
    const manifest = app({
      requiredSchema: { tables: [{ ref: 'orders', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'token', type: 'text', maxLength: 80, default: paymentKey }] }] },
    });
    const found = warn(manifest);
    expect(found).toEqual([expect.objectContaining({ group: 'choice', code: 'SECRET_LIKELY', kind: 'table', item: 'orders', answer: expect.objectContaining({ choices: ['clear', 'keep'] }) })]);
    expect(JSON.stringify(found)).not.toContain(paymentKey);
  });

  it('warns about a key pasted into an option list and a role', () => {
    const found = warn(
      app({
        optionLists: { sizes: { label: 'Sizes', options: [{ value: randomKey, label: 'Small' }] } },
        roles: [{ key: 'clerk', name: 'Clerk', description: `Uses ${randomKey} at the till.` }],
      }),
    );
    expect(found.map((item) => [item.code, item.kind])).toEqual([
      ['SECRET_LIKELY', 'option-list'],
      ['SECRET_LIKELY', 'role'],
    ]);
  });
});
