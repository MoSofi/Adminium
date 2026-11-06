// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The gates a saved app file passes before it is written.
 *
 * Each gate on hand-made manifests and files: a clean file passes, a planted
 * leftover fails. The secret scan runs against a real meta store whose values
 * were sealed through the features' own repos and keys, so every decrypt path
 * it takes is the one its feature takes.
 *
 * Every secret here is an obviously fake value. Where a test needs something
 * shaped like a provider's key, it is built at run time.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { llmKeyCryptoFromSecret } from '@adminium/llm';
import type { AppManifest } from '@adminium/manifest';
import {
  automationsRepo,
  connectionsRepo,
  createSqliteMetaDb,
  destinationsRepo,
  firstRun,
  jobsRepo,
  manifestsRepo,
  settingsRepo,
  stopListRepo,
  usersRepo,
  type AutomationGraph,
  type MetaDb,
} from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { encryptTotpSecret, totpEncryptionKey } from '../src/auth/totp.js';
import { sealWebhookSecrets } from '../src/automations/webhook-secrets.js';
import { decryptSecret, deriveKey, encryptSecret } from '../src/config/secrets.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { addressKeyRing, stopListAddressKey } from '../src/consent/keys.js';
import { createFigmaTokens } from '../src/designer/figma/tokens.js';
import { emailSecretKey } from '../src/email/config.js';
import { createDkimKeys } from '../src/email/sender/dkim-keys.js';
import { storageCryptoFromSecret } from '../src/files/crypto.js';
import { SIGN_IN_LINK_JOB_KIND, startPayload } from '../src/public-api/sign-in-link.js';
import type { CheckItem } from '../src/apps/save/check.js';
import { readContent, targetOf } from '../src/apps/save/gates/content.js';
import { idProblems } from '../src/apps/save/gates/ids.js';
import { runSaveGates, type GateProblem } from '../src/apps/save/gates/index.js';
import { collectKnownSecrets, databaseAddressParts, scanForSecrets, type KnownSecret } from '../src/apps/save/gates/secrets.js';
import { manifestProblems, planProblems, trialPackProblems } from '../src/apps/save/gates/validate.js';
import { secretLooking, secretWarnings, shannonEntropy } from '../src/apps/save/gates/warnings.js';
import type { SaveChoices, SaveDialect, SaveSource } from '../src/apps/save/types.js';
import { TEST_SECRET } from './helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest read and changed freely
type Doc = Record<string, any>;

/** A valid self-made app: one table, one page, one email template. */
function shop(over: Doc = {}): AppManifest {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'corner-shop',
    name: 'Corner shop',
    version: '1.0.0',
    publisher: { id: 'local', name: 'This Adminium' },
    license: 'UNLICENSED',
    description: { key: 'corner-shop.description', fallback: 'A small shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'number', type: 'text', maxLength: 40 },
            { ref: 'note', type: 'text', maxLength: 400, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 'shop.orders', fallback: 'Orders' }, nav: { group: 'manifest:corner-shop', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    seeds: [{ table: 'orders', file: 'seeds/orders.json' }],
    ...over,
  } as unknown as AppManifest;
}

const ordersFile = (rows: unknown[]): Map<string, Uint8Array> => new Map([['seeds/orders.json', Buffer.from(JSON.stringify(rows), 'utf8')]]);
const cleanRows = [
  { id: 1, number: 'A-1001', note: 'Two loaves, one sliced.' },
  { id: 2, number: 'A-1002', note: null },
];

const NO_CHOICES = {} as Pick<SaveChoices, 'clear' | 'leaveOut' | 'keep'>;

// ── the id gate ──────────────────────────────────────────────────────────────

describe('the id gate', () => {
  const CONNECTION = 'conn_01JABCDEFGHJKMNPQRSTVWXYZ0';

  it('passes a file that names everything by key, and the rows\' own ids', () => {
    expect(idProblems(readContent(shop(), ordersFile(cleanRows)), CONNECTION)).toEqual([]);
  });

  it('finds a row id inside a sentence, a generated page id inside a filter, the connection and a connectionId key', () => {
    const manifest = shop({
      description: { key: 'corner-shop.description', fallback: 'Copied from view_01JABCDEFGHJKMNPQRSTVWXYZ1 last week.' },
      pages: [
        {
          ref: 'orders',
          template: 'page-crud',
          title: { key: 'shop.orders', fallback: 'Orders' },
          views: [{ name: 'Open', kind: 'filters', v: 1, config: { filters: [{ column: 'note', op: 'contains', value: 'see /p/page_0a1b2c3d_orders-open' }] } }],
        },
      ],
      automations: [{ key: 'notify', trigger: { connectionId: 'x' } }],
    });
    const files = ordersFile([{ id: 1, number: 'A-1', note: `moved from ${CONNECTION}` }]);
    const problems = idProblems(readContent(manifest, files), CONNECTION);
    const paths = problems.map((problem) => problem.path);
    expect(problems.every((problem) => problem.code === 'INSTANCE_ID_LEFT')).toBe(true);
    expect(paths).toContain('manifest.json description.fallback');
    expect(paths).toContain('manifest.json pages[0].views[0].config.filters[0].value');
    expect(paths).toContain('manifest.json automations[0].trigger.connectionId');
    expect(paths).toContain('seeds/orders.json [0].note');
  });

  it('reads a text file as text', () => {
    const files = new Map([['emails/receipt.html', Buffer.from('<p>Ref: tpl_01JABCDEFGHJKMNPQRSTVWXYZ2</p>', 'utf8')]]);
    expect(idProblems(readContent(shop(), files), CONNECTION).map((problem) => problem.path)).toEqual(['emails/receipt.html']);
  });
});

// ── the secret scan ──────────────────────────────────────────────────────────

/** The fake secrets this store keeps, each sealed by its own feature. */
const SECRETS = {
  dbPassword: 'fake-db-pass-Q7x9m2Lk4',
  smtpPassword: 'fake"smtp\\pass-W3n8vR',
  addOnKey: 'fake-addon-key-H5t2v9Rq1',
  hookUrl: 'https://hooks.example.test/in/fake-hook-path-K8d3',
  hookHeader: 'fake-header-value-P2s7',
  storageSecret: 'fake/storage+secret=9Kq7',
  llmKey: 'fake-llm-key-not-real-1234',
  envValue: 'fake-env-signing-value-77',
  figma: 'fake-figma-token-abc123',
  totp: 'JBSWY3DPEHPK3PXPJBSWY3DP',
  stopAddress: 'stopped.person@example.test',
  signInAddress: 'asking.person@example.test',
  webhookSecret: 'fake-webhook-signing-5521',
} as const;

describe('the secret scan', () => {
  let meta: MetaDb;
  let dir: string;
  let envFile: string;
  let connectionId: string;
  let secrets: KnownSecret[];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'save-gates-'));
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const user = await usersRepo(meta).create({ email: 'owner@example.test', name: 'Owner' });

    const connection = await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({
      name: 'Shop',
      engine: 'postgres',
      dataDsn: `postgres://shopkeeper:${SECRETS.dbPassword}@db-7.internal.example:5432/shop`,
      introspectDsn: `postgres://postgres:${SECRETS.dbPassword}@localhost:5432/shop`,
    });
    connectionId = connection.id;

    await destinationsRepo(meta, storageCryptoFromSecret(TEST_SECRET)).create({
      name: 'Shared drive',
      driver: 'webdav',
      config: { url: 'https://dav.example.test/files' },
      secret: { username: 'dav-user-shop', password: SECRETS.storageSecret },
    });

    const installed = await manifestsRepo(meta, addOnCredentialCryptoFromSecret(TEST_SECRET)).install({ manifestKey: 'courier', version: '1.0.0', kind: 'add-on', source: 'file', document: {} });
    await manifestsRepo(meta, addOnCredentialCryptoFromSecret(TEST_SECRET)).setCredential(installed.row.id, { kind: 'api-key', secret: { apiKey: SECRETS.addOnKey } });

    await settingsRepo(meta).set('email.smtp', {
      host: 'smtp.mail-host.example',
      port: 587,
      user: 'mailer-account-shop',
      passEncrypted: encryptSecret(SECRETS.smtpPassword, emailSecretKey(TEST_SECRET)),
      from: 'orders@shop.example',
      secure: false,
    });
    await settingsRepo(meta).set('llm.apiKey', llmKeyCryptoFromSecret(TEST_SECRET, { deriveKey, encryptSecret, decryptSecret }).encrypt(SECRETS.llmKey));

    const graph = {
      version: 1,
      nodes: [
        { id: 'n1', kind: 'trigger', title: 'When an order comes in' },
        {
          id: 'n2',
          kind: 'action',
          title: 'Tell the courier',
          onError: false,
          action: { kind: 'webhook', url: SECRETS.hookUrl, method: 'POST', bodyKind: 'json', body: null, headerName: 'X-Courier-Token', headerValueEncrypted: null, headerValue: SECRETS.hookHeader },
        },
      ],
    } as unknown as AutomationGraph;
    await automationsRepo(meta).create({
      connectionId,
      name: 'Courier',
      trigger: { kind: 'record', event: 'created', connectionId, table: 'orders', watch: true } as never,
      graph: sealWebhookSecrets(graph, null, TEST_SECRET),
    });

    await createFigmaTokens({ meta, secret: TEST_SECRET }).save(user.id, SECRETS.figma, { id: 'figma-1', handle: 'owner' });
    await meta.db.updateTable('adminium_users').set({ totpSecretEncrypted: encryptTotpSecret(SECRETS.totp, totpEncryptionKey(TEST_SECRET)) }).where('id', '=', user.id).execute();
    await createDkimKeys({ meta, secret: TEST_SECRET }).make('shop.example');
    const ring = addressKeyRing(meta, TEST_SECRET);
    await stopListRepo(meta).add({
      address: await ring.hashForWrite(SECRETS.stopAddress),
      addressEncrypted: encryptSecret(SECRETS.stopAddress, stopListAddressKey(TEST_SECRET)),
      reason: 'link',
      addedAt: Date.now(),
    });
    await jobsRepo(meta).enqueue({ kind: SIGN_IN_LINK_JOB_KIND, payload: startPayload(dsnCryptoFromSecret(TEST_SECRET), 'pbk_x', SECRETS.signInAddress, 'en') as unknown as Record<string, unknown> });
    await meta.db
      .insertInto('adminium_webhooks')
      .values({ id: 'wh_01JABCDEFGHJKMNPQRSTVWXYZ3', name: 'Old hook', url: 'https://old-hooks.example.test/receive/abc', secretEncrypted: dsnCryptoFromSecret(TEST_SECRET).encrypt(SECRETS.webhookSecret), events: '[]', enabled: 1, createdAt: 1, updatedAt: 1 } as never)
      .execute();

    envFile = join(dir, '.env');
    await writeFile(envFile, `ADMINIUM_PORT=4600\nSHOP_SIGNING_KEY=${SECRETS.envValue}\nNODE_ENV=production\n`);
    secrets = await collectKnownSecrets(meta, TEST_SECRET, envFile);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const scan = (manifest: AppManifest, files: Map<string, Uint8Array>, choices = NO_CHOICES): CheckItem[] => scanForSecrets(readContent(manifest, files), secrets, choices);
  const has = (value: string) => secrets.some((secret) => secret.value === value);

  it('opens every sealed value with its own feature\'s key', () => {
    for (const value of [SECRETS.dbPassword, SECRETS.addOnKey, SECRETS.hookUrl, SECRETS.hookHeader, SECRETS.storageSecret, SECRETS.llmKey, SECRETS.envValue, SECRETS.figma, SECRETS.totp, SECRETS.stopAddress, SECRETS.signInAddress, SECRETS.webhookSecret, TEST_SECRET]) {
      expect(has(value), value).toBe(true);
    }
    expect(has(SECRETS.smtpPassword)).toBe(true);
    // Each part of a database address on its own; the common ones (postgres, localhost) are not looked for.
    expect(has('shopkeeper')).toBe(true);
    expect(has('db-7.internal.example')).toBe(true);
    expect(has('postgres')).toBe(false);
    expect(has('localhost')).toBe(false);
    // The SMTP user and host, the storage user, the DKIM key's body, an address key.
    expect(has('mailer-account-shop')).toBe(true);
    expect(has('smtp.mail-host.example')).toBe(true);
    expect(has('dav-user-shop')).toBe(true);
    expect(secrets.some((secret) => secret.label === 'a sending domain\'s private key' && secret.value.length > 200)).toBe(true);
    expect(secrets.some((secret) => secret.label === 'a key email addresses are kept under')).toBe(true);
    // .env: the port and NODE_ENV mean nothing.
    expect(has('4600')).toBe(false);
    expect(has('production')).toBe(false);
  });

  it('passes a clean file', () => {
    expect(scan(shop(), ordersFile(cleanRows))).toEqual([]);
  });

  it('finds a database password in base64 inside a page\'s text, at any alignment', () => {
    for (const lead of ['', 'x', 'xy']) {
      const text = `Backup notes: ${Buffer.from(`${lead}pw=${SECRETS.dbPassword};`).toString('base64')}`;
      const found = scan(shop({ pages: [{ ...shop().pages[0], title: { key: 'shop.orders', fallback: text } }] }), ordersFile(cleanRows));
      expect(found, lead).toHaveLength(1);
      expect(found[0]).toMatchObject({ group: 'choice', code: 'SECRET_FOUND', kind: 'page', item: 'orders', field: 'title.fallback', answer: { choices: ['clear', 'leave-out'], target: 'page:orders:title.fallback', targets: { 'leave-out': 'page:orders' } } });
    }
  });

  it('finds an SMTP password split across a JSON escape, in a JSON file and in a text file', () => {
    const inJson = scan(shop(), ordersFile([{ id: 1, number: 'A-1', note: `pass is ${SECRETS.smtpPassword}` }]));
    expect(inJson.map((item) => item.answer?.target)).toEqual(['rows:orders:seeds/orders.json#[0].note']);
    const escaped = JSON.stringify(SECRETS.smtpPassword).slice(1, -1);
    const inText = scan(shop(), new Map([['emails/receipt.html', Buffer.from(`<script>const p = "${escaped}";</script>`, 'utf8')]]));
    expect(inText.map((item) => item.answer?.target)).toEqual(['file:emails/receipt.html:']);
    // Half of it is enough.
    const half = scan(shop({ description: { key: 'd', fallback: `x${SECRETS.smtpPassword.slice(0, 13)}x` } }), new Map());
    expect(half.map((item) => item.kind)).toEqual(['app']);
  });

  it('finds an add-on credential\'s key, URL-encoded and in hex', () => {
    const encoded = scan(shop({ navLinks: [{ label: 'Courier', href: `https://courier.example.test/?k=${encodeURIComponent(SECRETS.addOnKey)}` }] }), new Map());
    expect(encoded.map((item) => item.answer?.target)).toEqual(['nav:0:href']);
    const hex = scan(shop(), ordersFile([{ id: 1, number: 'A-1', note: Buffer.from(SECRETS.addOnKey).toString('hex') }]));
    expect(hex).toHaveLength(1);
  });

  it('finds a rule\'s webhook address and its header value, and the storage secret in base64url', () => {
    const hook = scan(shop({ emailTemplates: [{ key: 'corner-shop-receipt', name: 'Receipt', locales: { en: { subject: 'Thanks', blocks: [{ block: 'text', data: { text: `Posted to ${SECRETS.hookUrl}` } }] } } }] }), new Map());
    expect(hook.map((item) => item.answer?.target)).toEqual(['email:corner-shop-receipt:locales.en.blocks[0].data.text']);
    const header = scan(shop(), ordersFile([{ id: 1, number: 'A-1', note: SECRETS.hookHeader }]));
    expect(header).toHaveLength(1);
    const storage = scan(shop(), ordersFile([{ id: 1, number: 'A-1', note: Buffer.from(SECRETS.storageSecret).toString('base64url') }]));
    expect(storage).toHaveLength(1);
  });

  it('finds the .env value, the AI key and the server\'s own secret', () => {
    for (const value of [SECRETS.envValue, SECRETS.llmKey, TEST_SECRET]) {
      expect(scan(shop(), ordersFile([{ id: 1, number: 'A-1', note: value }])), value).toHaveLength(1);
    }
  });

  it('never holds the value it found', () => {
    const found = scan(shop({ description: { key: 'd', fallback: SECRETS.dbPassword } }), ordersFile([{ id: 1, number: 'A-1', note: SECRETS.addOnKey }]));
    expect(found).toHaveLength(2);
    const said = JSON.stringify(found);
    for (const value of Object.values(SECRETS)) expect(said).not.toContain(value);
  });

  it('names a secret held as an object key by its parent, never by the key', () => {
    const found = scan(shop({ optionLists: { codes: { label: 'Codes', values: [{ value: 'a', label: 'A' }], extra: { [SECRETS.addOnKey]: true } } } }), new Map());
    expect(found).toHaveLength(1);
    expect(JSON.stringify(found)).not.toContain(SECRETS.addOnKey);
    expect(found[0]?.answer?.target).toBe('option-list:codes:extra{key}');
  });

  it('leaves out a place already answered', () => {
    const manifest = shop({ description: { key: 'd', fallback: SECRETS.dbPassword } });
    const files = ordersFile([{ id: 1, number: 'A-1', note: SECRETS.addOnKey }]);
    expect(scan(manifest, files)).toHaveLength(2);
    expect(scan(manifest, files, { clear: ['app:corner-shop:description.fallback'] }).map((item) => item.kind)).toEqual(['rows']);
    expect(scan(manifest, files, { leaveOut: ['rows:orders'] }).map((item) => item.kind)).toEqual(['app']);
  });

  it('does not take a common database part for a secret', () => {
    expect(scan(shop({ description: { key: 'd', fallback: 'Runs on postgres at localhost.' } }), new Map())).toEqual([]);
  });

  it('reads a database address\'s parts in both forms', () => {
    expect(databaseAddressParts('mysql://ana:p%40ss@db.example:3306/x')).toEqual({ user: 'ana', password: 'p@ss', host: 'db.example' });
    expect(databaseAddressParts("host=db.example user=ana password='a b c' dbname=x")).toEqual({ user: 'ana', password: 'a b c', host: 'db.example' });
    expect(databaseAddressParts('https://example.test/path')).toBeNull();
  });

  describe('through runSaveGates', () => {
    const source = (dialect: SaveDialect = 'sqlite'): SaveSource => ({ meta, connectionId, dialect, model: { tables: [], defaultSchema: null } as never, adminiumVersion: '0.3.49' });
    const choices = (over: Partial<SaveChoices> = {}): SaveChoices => ({ key: 'corner-shop', name: 'Corner shop', version: '1.0.0', label: 'Home', lineage: 'lin', savedAt: '2026-11-06T00:00:00.000Z', ...over });

    it('passes a clean file', async () => {
      const result = await runSaveGates({ manifest: shop(), files: ordersFile(cleanRows), source: source(), choices: choices() }, { masterSecret: TEST_SECRET, projectEnvFile: envFile });
      expect(result).toEqual({ choices: [], problems: [] });
    });

    it('asks about a secret and refuses a leftover id', async () => {
      const files = ordersFile([{ id: 1, number: 'A-1', note: `${SECRETS.dbPassword} from ${connectionId}` }]);
      const result = await runSaveGates({ manifest: shop(), files, source: source(), choices: choices() }, { masterSecret: TEST_SECRET, projectEnvFile: envFile });
      expect(result.choices.map((item) => [item.code, item.answer?.target])).toEqual([['SECRET_FOUND', 'rows:orders:seeds/orders.json#[0].note']]);
      expect(result.problems.map((problem) => problem.code)).toEqual(['INSTANCE_ID_LEFT']);
      const answered = await runSaveGates({ manifest: shop(), files, source: source(), choices: choices({ clear: ['rows:orders:seeds/orders.json#[0].note'] }) }, { masterSecret: TEST_SECRET });
      expect(answered.choices).toEqual([]);
    });
  });
});

// ── the warning layer ────────────────────────────────────────────────────────

describe('the warning layer', () => {
  // Built at run time: a literal of this shape in source is what a push protection refuses.
  const randomKey = ['Zq8', 'Lm3', 'Xv7', 'Rt2', 'Nb9', 'Wk4', 'Hs6', 'Pd1'].join('');
  const privateKey = `-----BEGIN ${'PRIVATE'} KEY-----\nnot-a-real-key\n-----END ${'PRIVATE'} KEY-----`;
  const paymentKey = ['sk', 'live', 'x'.repeat(24)].join('_');

  const warn = (manifest: AppManifest, files: Map<string, Uint8Array>, choices = NO_CHOICES) => secretWarnings(readContent(manifest, files), choices, new Set());
  const mail = (text: string): Doc => ({ emailTemplates: [{ key: 'corner-shop-receipt', name: 'Receipt', locales: { en: { subject: 'Thanks', blocks: [{ block: 'text', data: { text } }] } } }] });

  it('passes a clean file, with hashes, ULIDs and ids it carries on purpose', () => {
    const rows = [
      { id: 1, number: 'A-1', note: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
      { id: 2, number: 'A-2', note: '01JABCDEFGHJKMNPQRSTVWXYZ4' },
      { id: 3, number: 'A-3', note: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' },
      { id: 4, number: 'A-4', note: 'Delivered to the back door around 10:30, signed by Ana.' },
    ];
    expect(warn(shop(mail('Thanks for your order 2026-11-06, see seeds/order-lines.json.')), ordersFile(rows))).toEqual([]);
  });

  it('warns about a high-randomness string in an email', () => {
    expect(shannonEntropy(randomKey)).toBeGreaterThanOrEqual(4);
    const found = warn(shop(mail(`Your access code: ${randomKey}`)), new Map());
    expect(found).toEqual([
      expect.objectContaining({ group: 'choice', code: 'SECRET_LIKELY', kind: 'email', item: 'corner-shop-receipt', answer: { choices: ['clear', 'keep'], target: 'email:corner-shop-receipt:locales.en.blocks[0].data.text' } }),
    ]);
    expect(JSON.stringify(found)).not.toContain(randomKey);
  });

  it('warns about a provider\'s shape in a row and a private key in a file', () => {
    expect(secretLooking(paymentKey)).toBe('a payment provider\'s secret key');
    expect(warn(shop(), ordersFile([{ id: 1, number: 'A-1', note: paymentKey }])).map((item) => item.answer?.target)).toEqual(['rows:orders:seeds/orders.json#[0].note']);
    expect(warn(shop(), new Map([['emails/key.txt', Buffer.from(privateKey)]])).map((item) => item.answer?.target)).toEqual(['file:emails/key.txt:']);
  });

  it('leaves out a place the person kept or cleared, and one the secret scan named', () => {
    const manifest = shop(mail(`Your access code: ${randomKey}`));
    const target = 'email:corner-shop-receipt:locales.en.blocks[0].data.text';
    expect(warn(manifest, new Map(), { keep: [target] })).toEqual([]);
    expect(warn(manifest, new Map(), { clear: [target] })).toEqual([]);
    expect(secretWarnings(readContent(manifest, new Map()), NO_CHOICES, new Set([target]))).toEqual([]);
  });

  it('reads only the places a person types: a role\'s key is not text', () => {
    expect(warn(shop({ roles: [{ key: 'clerk', name: `Clerk ${randomKey}` }] }), new Map())).toEqual([]);
  });
});

// ── validation, the dry plan and the trial pack ─────────────────────────────

describe('validation and the dry plan', () => {
  const codes = (problems: GateProblem[]) => problems.map((problem) => problem.code);
  const withTable = (ref: string) => shop({ requiredSchema: { tables: [{ ref, columns: [{ ref: 'id', type: 'int', role: 'pk' }] }] }, pages: [{ ...shop().pages[0], bindings: { main: ref } }], seeds: undefined });

  it('refuses an invalid manifest, issue by issue', () => {
    const { problems, manifest } = manifestProblems({ ...shop(), pages: [], surprise: true });
    expect(manifest).toBeNull();
    expect(problems.length).toBeGreaterThanOrEqual(1);
    expect(new Set(codes(problems))).toEqual(new Set(['MANIFEST_INVALID']));
  });

  for (const dialect of ['sqlite', 'postgres', 'mysql'] as const) {
    it(`plans a valid file on a blank ${dialect} database`, () => {
      const { manifest, problems } = manifestProblems(shop());
      expect(problems).toEqual([]);
      expect(planProblems(manifest!, ordersFile(cleanRows), dialect)).toEqual([]);
    });

    it(`refuses a table in Adminium's own namespace on ${dialect}`, () => {
      const { manifest, problems } = manifestProblems(withTable('adminium_orders'));
      expect(problems).toEqual([]);
      expect(planProblems(manifest!, new Map(), dialect)).toEqual([expect.objectContaining({ code: 'PLAN_REFUSED', path: 'requiredSchema.tables adminium_orders' })]);
    });
  }

  it('plans against the engine saved from: a 64-byte table name fits MySQL alone', () => {
    const name = `orders_${'x'.repeat(57)}`;
    const { manifest } = manifestProblems(withTable(name));
    expect(codes(planProblems(manifest!, new Map(), 'postgres'))).toEqual(['PLAN_REFUSED']);
    expect(codes(planProblems(manifest!, new Map(), 'sqlite'))).toEqual(['PLAN_REFUSED']);
    expect(planProblems(manifest!, new Map(), 'mysql')).toEqual([]);
  });

  it('refuses an email that carries a file the package does not hold', () => {
    // Checked on its own: a template the plan reads, not one the validator would also need an outbox for.
    const doc = shop({ emailTemplates: [{ key: 'corner-shop-receipt', name: 'Receipt', attachments: [{ file: 'emails/terms.pdf' }], locales: { 'en-US': { subject: 'Thanks', blocks: [{ block: 'email.text', data: { text: 'Hello' } }] } } }] });
    const messages = planProblems(doc, new Map(), 'sqlite').map((problem) => problem.message);
    expect(messages).toContainEqual(expect.stringContaining('emails/terms.pdf'));
  });

  it('packs a clean file and reads it back as an upload does', async () => {
    expect(await trialPackProblems(shop(), ordersFile(cleanRows))).toEqual([]);
  });

  it('refuses a package file the upload\'s archive reader refuses', async () => {
    const tooLong = `seeds/${'a'.repeat(220)}.json`;
    expect(codes(await trialPackProblems(shop(), new Map([[tooLong, Buffer.from('[]')]])))).toEqual(['PLAN_REFUSED']);
    expect(codes(await trialPackProblems(shop(), new Map([['../escape.json', Buffer.from('[]')]])))).toEqual(['PLAN_REFUSED']);
    expect(codes(await trialPackProblems(shop(), new Map([['manifest.json', Buffer.from('{}')]])))).toEqual(['PLAN_REFUSED']);
  });

  it('a target names its place by kind, item and field', () => {
    expect(targetOf({ kind: 'page', item: 'orders', field: 'title.fallback' })).toBe('page:orders:title.fallback');
  });
});
