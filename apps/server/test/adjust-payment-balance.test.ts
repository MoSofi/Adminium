// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO IS TOLD WHAT A PAYMENT LEFT BEHIND — through the real door. A save in
 * which Adminium decided an amount answers what it took and what is still due
 * to whoever made it; the balance left on the account it was taken from is
 * told only to somebody who may read the rows the ledger wrote for it.
 */
import { permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { ledgerKitDecidesManifest, ledgerKitFiles } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

const PAY = {
  id: 'pay',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'pay' },
  map: { account: 'account_id', due: 'due', amount: 'amount', balance_after: 'balance_after' },
  post: { on: { create: true } },
  reverse: { on: { column: 'status', in: ['void'] } },
};

/** The kit whose `pay` also decides a balance, never above what the account holds. */
function kit(): Doc {
  const manifest = ledgerKitDecidesManifest() as Doc & { addOn: { ledgers: [{ actions: { pay: { inputs: Doc; decides: Doc[] } } }] } };
  const pay = manifest.addOn.ledgers[0].actions.pay;
  pay.inputs = { ...pay.inputs, balance_after: 'decimal' };
  pay.decides = [...pay.decides, { input: 'balance_after', min: '0', max: { read: 'accounts', column: 'balance' } }];
  return manifest;
}

/** The kit's own code, saying after each amount what the account then holds. */
function files(manifest: Doc): Record<string, string> {
  const own = ledgerKitFiles(manifest);
  const amount = "input: wrong === 'decide-undeclared' ? 'due' : 'amount', value: decimal(amount) });";
  const code = own['dist/server.js']!;
  expect(code.split(amount)).toHaveLength(2);
  return { ...own, 'dist/server.js': code.replace(amount, `${amount}\n    out.decides.push({ line: line.line, input: 'balance_after', value: decimal(has - amount) });`) };
}

describe.each(LEGS)('the balance a payment left is told to a reader of the ledger — %s', (dialect, available) => {
  let w: LedgerWorld;
  let served: Served;
  const cookies = new Map<string, string>();
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const tableId = (name: string) => encodeURIComponent(w.target(name).table.id);
  const pay = (who: string, values: Doc) =>
    served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${w.h.connectionId}/${tableId('pays')}`, headers: { cookie: cookies.get(who)! }, payload: { values } });

  async function person(name: string, grants: 'super-admin' | Record<string, Doc>): Promise<void> {
    const user = await usersRepo(w.h.meta).create({ email: `${name}@pay.example`, name, passwordHash: await adminPasswordHash(), status: 'active' });
    const roles = rolesRepo(w.h.meta);
    if (grants === 'super-admin') await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
    else {
      const role = await roles.create({ slug: `${name}-role`, name } as never);
      for (const [table, actions] of Object.entries(grants)) {
        await permissionsRepo(w.h.meta).grant(role.id, 'table', `${w.h.connectionId}/${w.target(table).table.id}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      }
      await roles.assignToUser(user.id, role.id);
    }
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.4.0.${String(cookies.size + 1)}`, payload: { email: `${name}@pay.example`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
  }

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(
      dialect,
      { pays: { columns: 'account_id INT NULL, due DECIMAL(12,3) NULL, amount DECIMAL(12,3) NULL, balance_after DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [PAY] } },
      kit(),
      undefined,
      files(kit()),
    );
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Card', 10, 0, 10, ${w.flag(false)}, 0)`);
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'ledger-kit';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    await person('boss', 'super-admin');
    await person('till', { pays: { read: true, create: true } });
    await person('books', { pays: { read: true, create: true }, ledger_kit_entries: { read: true } });
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await served?.close();
    if (available) await w.close();
  });

  it.skipIf(!available)('told to who reads the ledger\'s rows, kept from who only takes the payment', async () => {
    const whole = await pay('boss', { account_id: 1, due: '3' });
    expect(whole.statusCode, whole.body).toBe(201);
    const told = (whole.json() as { payment?: Doc }).payment;
    expect(told).toMatchObject({ amount: '3.00', due: '3.00' });
    expect(told?.['balanceAfter']).toBe('7.00');

    // The till takes a payment and hears what it took, and nothing of the account behind it.
    const till = await pay('till', { account_id: 1, due: '2' });
    expect(till.statusCode, till.body).toBe(201);
    expect((till.json() as { payment?: Doc }).payment).toEqual({ amount: '2.00', due: '2.00' });

    // The same save by somebody who reads the ledger's rows says the balance too.
    const books = await pay('books', { account_id: 1, due: '1' });
    expect(books.statusCode, books.body).toBe(201);
    const heard = (books.json() as { payment?: Doc }).payment;
    expect(heard).toMatchObject({ amount: '1.00', due: '1.00' });
    expect(heard?.['balanceAfter']).toBe('4.00');
    // What was decided is the row's own: it is stored for everybody who reads the payment.
    expect(Number((till.json() as { data: Doc }).data['balance_after'])).toBe(5);
  });
});
