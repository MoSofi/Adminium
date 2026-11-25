// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A box for texts on a table whose person link may be empty (a stay booked
 * for a guest with no account), on the whole server over SQLite, Postgres
 * and MySQL source databases:
 *
 *  - An anonymous booking with nobody linked and the box ticked keeps its
 *    yes on the stay itself.
 *  - A staff change of that box through the record page is then recorded on
 *    the same stay, as its first tick was: unticked, a no; ticked again, a
 *    yes in the box's declared words. A change that leaves the box alone
 *    records nothing.
 *  - A stay linked to a guest records against the guest, as it always has.
 *  - A stay whose guest was unlinked later records the box's change on the
 *    stay, never on the guest it no longer names; the number's own no
 *    stands all the same.
 */
import { publicKeysRepo } from '@adminium/meta';
import { SMS_WORDS_FLOOR } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { publicEntryRefs, servedPublicEntries } from '../src/apps/manifest-public.js';
import { createTextConsentService, type TextConsentService } from '../src/sms/consent/index.js';
import { TEST_SECRET } from './helpers.js';
import type { InvoicingHarness } from './invoicing-install.helpers.js';
import { guest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));

const ANNA = '+4915123456791';
const GITA = '+4915123456792';
const HAL = '+4915123456793';
const WORDS = 'Text me about my stay.';

function hotel(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'hotelx',
    name: 'Stays',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Stays.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR, engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'guests',
          keyField: 'name',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'email', type: 'text', maxLength: 254, nullable: true, unique: true, rules: { normalize: 'email', validation: { format: 'email' } } },
            { ref: 'phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
          ],
        },
        {
          ref: 'stays',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            // Empty for a guest with no account: a stay booked by phone, or online by somebody not signed in.
            { ref: 'guest_id', type: 'fk', references: 'guests', nullable: true },
            { ref: 'mobile', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
            { ref: 'note', type: 'text', maxLength: 80, nullable: true },
            { ref: 'texts_ok', type: 'bool', default: false },
          ],
        },
      ],
    },
    people: [{ table: 'guests', kind: 'people', name: 'name', email: 'email', phone: 'phone' }],
    publicAccess: [
      { table: 'guests', methods: ['GET'], select: ['name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
      {
        table: 'stays',
        methods: ['POST'],
        humanCheck: true,
        level: 'verified',
        select: ['id'],
        writable: ['mobile', 'texts_ok'],
        claimedBy: { table: 'guests', column: 'guest_id', optional: true },
        anonymous: { perValue: { columns: ['mobile'], n: 5 } },
        textConsent: { column: 'texts_ok', phone: 'mobile', class: 'service', wording: { version: 1, text: { 'en-US': WORDS } } },
      },
    ],
    roles: [{ key: 'desk', name: 'Desk', permissions: ['table:@guests:read', 'table:@stays:read', 'table:@stays:create', 'table:@stays:update'] }],
    pages: [{ ref: 'hotelx-stays', template: 'page-crud', title: { key: 't', fallback: 'Stays' }, nav: { group: 'stays', icon: 'home', order: 1 }, bindings: { rows: 'stays' } }],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html' },
      { side: 'customer', kind: 'spa', entry: 'index.html' },
    ],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a box for texts on a stay with no guest linked, on ${dialect}`, () => {
    let s: WholeServer;
    let shop: Served;
    let g: ReturnType<typeof guest>;
    let texts: TextConsentService;
    let staysRef = '';
    const table = () => s.t('stays').split('.').pop()!;
    const stayOf = (id: unknown) => ({ connectionId: s.connectionId, table: s.t('stays'), key: String(id) });
    const guestOf = (id: number) => ({ connectionId: s.connectionId, table: s.t('guests'), key: String(id) });
    const events = (phone: string) => texts.history({ phone, country: 'DE' });

    beforeAll(async () => {
      const manifest = hotel();
      s = await wholeServer(dialect, manifest, { people: { dana: ['desk'] } });
      await s.rows(`insert into ${s.t('guests').split('.').pop()!} (id, name, email, phone) values (1, 'Gita', 'gita@fieldmail.io', '${GITA}'), (2, 'Hal', 'hal@fieldmail.io', '${HAL}')`);
      const key = (await publicKeysRepo(s.meta).listManagedBy('hotelx')).find((one) => one.purpose === 'customer')!;
      // The public side over the same meta store and connections: it reads nothing else of a harness.
      const harness = { meta: s.meta, manager: s.manager } as unknown as InvoicingHarness;
      shop = await servePublic(harness, key.id);
      g = guest(shop, harness);
      const served = servedPublicEntries(manifest as never);
      const names = { guests: s.t('guests').split('.').pop()!, stays: table() };
      staysRef = publicEntryRefs(served, names)[served.findIndex((entry) => entry.table === 'stays')]!;
      texts = createTextConsentService({ meta: s.meta, secret: TEST_SECRET });
    }, 240_000);

    afterAll(async () => {
      await shop?.close();
      await s?.close();
    });

    it('an anonymous booking with nobody linked keeps its tick on the stay; a staff untick then records a no there, a re-tick a yes, in the box\'s words; another change nothing', async () => {
      const made = await g.request('POST', `/records/${staysRef}`, { payload: { values: { mobile: ANNA, texts_ok: true } }, proof: 'write' });
      expect(made.statusCode, made.body).toBe(201);
      const stay = (await s.rows(`select id, guest_id from ${table()} where mobile = '${ANNA}'`))[0]!;
      expect(stay['guest_id']).toBeNull();
      const first = await events(ANNA);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ state: 'yes', source: 'form', person: stayOf(stay['id']), wording: WORDS, wordingVersion: 'v1 en-US' });

      // A change that leaves the box alone says nothing.
      expect(said(await s.change('dana', 'stays', stay['id'], { note: 'Arrives late' }))).toBe('ok');
      expect(await events(ANNA)).toHaveLength(1);

      // Unticked by the desk: their no, on the same stay.
      expect(said(await s.change('dana', 'stays', stay['id'], { texts_ok: false }))).toBe('ok');
      const unticked = await events(ANNA);
      expect(unticked).toHaveLength(2);
      expect(unticked[0]).toMatchObject({ state: 'no', source: 'staff', staffLabel: 'Dana', person: stayOf(stay['id']) });
      expect((await texts.standing({ phone: ANNA, country: 'DE', person: stayOf(stay['id']) }, 'text-service')).state).toBe('no');

      // Ticked again: their yes, in the box's declared words.
      expect(said(await s.change('dana', 'stays', stay['id'], { texts_ok: true }))).toBe('ok');
      const reticked = await events(ANNA);
      expect(reticked).toHaveLength(3);
      expect(reticked[0]).toMatchObject({ state: 'yes', source: 'staff', staffLabel: 'Dana', person: stayOf(stay['id']), wording: WORDS, wordingVersion: 'v1 en-US' });
      expect((await texts.standing({ phone: ANNA, country: 'DE', person: stayOf(stay['id']) }, 'text-service')).state).toBe('yes');
    });

    it('a stay linked to a guest records the box against the guest, as before', async () => {
      const made = await s.make('dana', 'stays', { guest_id: 1, mobile: GITA, texts_ok: true });
      expect(said(made), made.body).toBe('ok');
      const stay = (await s.rows(`select id from ${table()} where mobile = '${GITA}'`))[0]!;
      expect((await events(GITA))[0]).toMatchObject({ state: 'yes', source: 'staff', person: guestOf(1), wording: WORDS, wordingVersion: 'v1 en-US' });
      expect(said(await s.change('dana', 'stays', stay['id'], { texts_ok: false }))).toBe('ok');
      const after = await events(GITA);
      expect(after).toHaveLength(2);
      expect(after[0]).toMatchObject({ state: 'no', source: 'staff', person: guestOf(1) });
      expect(after.some((event) => event.person?.table === s.t('stays'))).toBe(false);
    });

    it('a guest unlinked later: the box\'s change is the stay\'s own, never the guest it no longer names, and the number\'s no stands', async () => {
      const made = await s.make('dana', 'stays', { guest_id: 2, mobile: HAL, texts_ok: true });
      expect(said(made), made.body).toBe('ok');
      const stay = (await s.rows(`select id from ${table()} where mobile = '${HAL}'`))[0]!;
      expect(await events(HAL)).toHaveLength(1);
      expect((await events(HAL))[0]).toMatchObject({ state: 'yes', person: guestOf(2) });
      // Unlinking alone leaves the box as it was: nothing is said.
      expect(said(await s.change('dana', 'stays', stay['id'], { guest_id: null }))).toBe('ok');
      expect(await events(HAL)).toHaveLength(1);
      expect(said(await s.change('dana', 'stays', stay['id'], { texts_ok: false }))).toBe('ok');
      const after = await events(HAL);
      expect(after).toHaveLength(2);
      expect(after[0]).toMatchObject({ state: 'no', source: 'staff', staffLabel: 'Dana', person: stayOf(stay['id']) });
      // The number stops for Hal too: a text to it reads the number's own latest answer.
      expect((await texts.standing({ phone: HAL, country: 'DE', person: guestOf(2) }, 'text-service')).state).toBe('no');
    });
  });
}
