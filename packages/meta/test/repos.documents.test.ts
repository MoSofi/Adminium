// SPDX-License-Identifier: AGPL-3.0-only
/**
 * documentProfilesRepo + documentsRepo + addOnSettingsRepo.
 *
 * The behaviours worth pinning are the ones a later change could quietly
 * break, and for this wave they are all about SURVIVAL and DISCLOSURE:
 *
 * - uninstalling an add-on must not take documents or profiles with it (D5)
 *  — there is no FK to `adminium_manifests` anywhere, so the test that
 *  proves it deletes the manifest row and reads the documents back;
 *  - a redacted read is still a row, minus exactly three fields;
 *  - a composite primary key round-trips through `entity_id` on every
 *    dialect, because `jsonb` reorders object keys on PostgreSQL and MySQL;
 *  - a secret setting is refused by the REPO, not by whichever route
 *    remembered.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addOnSettingsRepo,
  applyMigrations,
  connectionsRepo,
  documentProfilesRepo,
  documentsRepo,
  entityKeyOf,
  manifestsRepo,
  SecretSettingRefused,
  type DsnCrypto,
  type RecordRef,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

/** The manifests repo takes its own crypto seam; the shape differs from `DsnCrypto`. */
const testCredentialCrypto = {
  encrypt: (plaintext: string) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (ciphertext: string) =>
    Buffer.from(ciphertext.replace('enc:test:', ''), 'base64').toString('utf8'),
};

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (ciphertext) =>
    Buffer.from(ciphertext.replace('enc:test:', ''), 'base64').toString('utf8'),
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`document register — ${dialect.name}`, () => {
    let db: TestDb;
    let profiles: ReturnType<typeof documentProfilesRepo>;
    let documents: ReturnType<typeof documentsRepo>;
    let settings: ReturnType<typeof addOnSettingsRepo>;
    let connectionId: string;

    beforeEach(async () => {
      db = await dialect.make();
      await applyMigrations(db.meta.db, { dialect: db.meta.dialect });
      profiles = documentProfilesRepo(db.meta);
      documents = documentsRepo(db.meta);
      settings = addOnSettingsRepo(db.meta);
      const connection = await connectionsRepo(db.meta, testCrypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      });
      connectionId = connection.id;
    });

    afterEach(async () => {
      await db.destroy();
    });

    const makeProfile = async (over: Partial<{ name: string; enabled: boolean }> = {}) =>
      await profiles.create(
        {
          addOnKey: 'invoices',
          kind: 'invoice',
          name: over.name ?? 'Invoice',
          connectionId,
          table: 'public.orders',
          mapping: { customerName: { column: 'customer' } },
          options: { paper: 'a4' },
          trigger: { event: 'record.created' },
          deliver: { store: true },
          ...(over.enabled === undefined ? {} : { enabled: over.enabled }),
        },
        T0,
      );

    const ENTITY: RecordRef = {
      connectionId: 'conn_1',
      table: 'public.orders',
      pk: { id: 4118 },
      label: 'Order 4118',
    };

    const makeDocument = async (over: Partial<{ profileId: string | null }> = {}) =>
      await documents.create(
        {
          profileId: over.profileId === undefined ? null : over.profileId,
          addOnKey: 'invoices',
          kind: 'invoice',
          connectionId,
          entity: ENTITY,
          subject: { customerName: 'Acme', total: 1234 },
          locale: 'en-US',
          format: 'pdf',
        },
        T0,
      );

    describe('profiles', () => {
      it('round-trips a mapping without having an opinion about its slot ids', async () => {
        const profile = await makeProfile();
        const read = await profiles.findById(profile.id);
        expect(read?.mapping).toEqual({ customerName: { column: 'customer' } });
        expect(read?.trigger).toEqual({ event: 'record.created' });
      });

      it('lists only enabled profiles that carry a trigger', async () => {
        await makeProfile({ name: 'Triggered' });
        const quiet = await profiles.create(
          {
            addOnKey: 'invoices',
            kind: 'invoice',
            name: 'Manual only',
            connectionId,
            table: 'public.orders',
            mapping: {},
            trigger: null,
          },
          T0,
        );
        const off = await makeProfile({ name: 'Disabled', enabled: false });

        const matched = await profiles.listTriggeredBy(connectionId, 'public.orders');
        const names = matched.map((profile) => profile.name);
        expect(names).toEqual(['Triggered']);
        expect(names).not.toContain(quiet.name);
        expect(names).not.toContain(off.name);
      });

      it('disables an add-on’s profiles without deleting the operator’s work', async () => {
        // Uninstall stops rendering; it does not throw away twenty
        // columns pointed at twenty slots, because reinstalling should not
        // mean doing that again.
        await makeProfile({ name: 'One' });
        await makeProfile({ name: 'Two' });
        expect(await profiles.setEnabledForAddOn('invoices', false, T0)).toBe(2);

        const after = await profiles.list({ addOnKey: 'invoices' });
        expect(after).toHaveLength(2);
        expect(after.every((profile) => !profile.enabled)).toBe(true);
        expect(after[0]?.mapping).toEqual({ customerName: { column: 'customer' } });
      });
    });

    describe('the register', () => {
      it('starts a row as failed, because nothing may look successful before it is', async () => {
        const document = await makeDocument();
        expect(document.status).toBe('failed');
        expect(document.number).toBeNull();
        expect(document.renderedAt).toBeNull();
      });

      it('attaches bytes and a number only when a render succeeded', async () => {
        const document = await makeDocument();
        const done = await documents.markRendered(
          document.id,
          { number: 'INV-1001', fileId: null, htmlFileId: null, format: 'pdf' },
          T0 + 5,
        );
        expect(done?.status).toBe('rendered');
        expect(done?.number).toBe('INV-1001');
        expect(done?.renderedAt).toBe(T0 + 5);
      });

      it('leaves number null when a render failed (D11 — no number is burnt)', async () => {
        const document = await makeDocument();
        const failed = await documents.markFailed(document.id, 'the provider refused');
        expect(failed?.status).toBe('failed');
        expect(failed?.number).toBeNull();
        expect(failed?.error).toContain('refused');
      });

      it('voids without deleting, and keeps the FIRST reason', async () => {
        const document = await makeDocument();
        await documents.markRendered(
          document.id,
          { number: 'INV-1001', fileId: null, htmlFileId: null, format: 'pdf' },
          T0,
        );
        const voided = await documents.markVoided(document.id, 'source-undone', T0 + 1);
        expect(voided?.status).toBe('voided');
        expect(voided?.number).toBe('INV-1001');
        expect(voided?.subject).toEqual({ customerName: 'Acme', total: 1234 });

        // A second void must not overwrite the true story with a later one.
        expect(await documents.markVoided(document.id, 'operator', T0 + 2)).toBeNull();
        expect((await documents.findById(document.id))?.voidReason).toBe('source-undone');
      });

      it('finds every document issued for one source row', async () => {
        await makeDocument();
        await makeDocument();
        const found = await documents.listForEntity({ table: 'public.orders', pk: { id: 4118 } });
        expect(found).toHaveLength(2);
      });

      it('matches a COMPOSITE key whatever order the driver hands it back', async () => {
        /*
         * `jsonb` reorders object keys on PostgreSQL and MySQL. A key built by
         * walking the object as it came back would differ between the write
         * and the read, and the record page would show no documents for a row
         * that has two. `entityKeyOf` sorts, which is why this passes on every
         * dialect rather than on SQLite alone.
         */
        const composite: RecordRef = {
          connectionId: 'conn_1',
          table: 'public.order_lines',
          pk: { order_id: 4118, line_no: 2 },
          label: 'Line 2',
        };
        await documents.create(
          {
            profileId: null,
            addOnKey: 'invoices',
            kind: 'invoice',
            connectionId,
            entity: composite,
            subject: {},
            locale: 'en-US',
            format: 'pdf',
          },
          T0,
        );
        expect(entityKeyOf({ line_no: 2, order_id: 4118 })).toBe(
          entityKeyOf({ order_id: 4118, line_no: 2 }),
        );
        /*
         * And the LITERAL form, because a caller outside this package builds
         * the same key to ask for a row's documents: the dashboard cannot
         * import `@adminium/meta`, so `entityKey` there restates this, and
         * both are pinned to the same string rather than to each other.
         */
        expect(entityKeyOf({ order_id: 4118, line_no: 2 })).toBe('line_no=2|order_id=4118');
        const found = await documents.listForEntity({
          table: 'public.order_lines',
          // Deliberately the other order.
          pk: { line_no: 2, order_id: 4118 },
        });
        expect(found).toHaveLength(1);
      });

      it('redacts exactly three fields and keeps the row', async () => {
        const document = await makeDocument();
        const redacted = await documents.findById(document.id, { redacted: true });
        expect(redacted?.subject).toBeNull();
        expect(redacted?.entity).toBeNull();
        expect(redacted?.claim).toBeNull();
        expect(redacted?.redacted).toBe(true);
        // "Three invoices exist for this order and you may not read them" is
        // useful and true; hiding them would make the record page lie.
        expect(redacted?.id).toBe(document.id);
        expect(redacted?.kind).toBe('invoice');
        expect(redacted?.status).toBe('failed');
      });

      it('lists a public caller’s own claimed rows and nobody else’s', async () => {
        await documents.create(
          {
            profileId: null,
            addOnKey: 'invoices',
            kind: 'invoice',
            connectionId,
            entity: null,
            subject: {},
            locale: 'en-US',
            format: 'html',
            claim: { column: 'email', value: 'a@example.test' },
          },
          T0,
        );
        await documents.create(
          {
            profileId: null,
            addOnKey: 'invoices',
            kind: 'invoice',
            connectionId,
            entity: null,
            subject: {},
            locale: 'en-US',
            format: 'html',
            claim: { column: 'email', value: 'b@example.test' },
          },
          T0,
        );
        const mine = await documents.list({ claim: { column: 'email', value: 'a@example.test' } });
        expect(mine).toHaveLength(1);
        expect(mine[0]?.claim?.value).toBe('a@example.test');
      });

      it('SURVIVES the ADD-ON BEING UNINSTALLED — the whole point of the soft ref', async () => {
        /*
         * The own done-when, and the assertion the schema was shaped around:
         * `add_on_key` is a SOFT string reference with no foreign key to
         * `adminium_manifests`, so deleting the manifest row cannot cascade
         * into anything here.
         *
         * The rule is — uninstall keeps the customer's DATA — and this is the
         * case that makes it concrete: a business that removes the add-on
         * which drew its invoices still has the invoices, and can still hand
         * one to an auditor two years later. A cascade here would destroy
         * business records as a side effect of tidying up an integration.
         */
        const manifests = manifestsRepo(db.meta, testCredentialCrypto);
        const installed = await manifests.install(
          {
            manifestKey: 'invoices',
            version: '1.0.0',
            kind: 'add-on',
            source: 'marketplace',
            document: { key: 'invoices' },
          },
          T0,
        );

        const profile = await makeProfile();
        const document = await makeDocument({ profileId: profile.id });
        await documents.markRendered(
          document.id,
          { number: 'INV-1001', fileId: null, htmlFileId: null, format: 'pdf' },
          T0,
        );
        await settings.patch('invoices', { business_name: 'Northwind' }, [{ key: 'business_name' }], {
          at: T0,
        });

        // `install` answers `{row, document}` — the id is on the row.
        expect(await manifests.uninstall(installed.row.id)).toBe(true);
        expect(await manifests.findByKey('invoices')).toBeNull();

        // The document is untouched, number and frozen subject included.
        const after = await documents.findById(document.id);
        expect(after, 'uninstalling an add-on must not unmake a document').not.toBeNull();
        expect(after?.number).toBe('INV-1001');
        expect(after?.addOnKey).toBe('invoices');
        expect(after?.subject).toEqual({ customerName: 'Acme', total: 1234 });

        // And so is the profile — DISABLES it rather than deleting it,
        // so the operator's mapping survives a reinstall.
        expect(await profiles.findById(profile.id)).not.toBeNull();

        // The add-on's OWN settings are the one thing that goes with it, and
        // going is an explicit call rather than a cascade.
        expect(await settings.valuesFor('invoices')).toEqual({ business_name: 'Northwind' });
        await settings.clear('invoices');
        expect(await settings.valuesFor('invoices')).toEqual({});
      });

      it('SURVIVES the profile being deleted, losing only the pointer', async () => {
        const profile = await makeProfile();
        const document = await makeDocument({ profileId: profile.id });
        await documents.markRendered(
          document.id,
          { number: 'INV-1001', fileId: null, htmlFileId: null, format: 'pdf' },
          T0,
        );

        expect(await profiles.remove(profile.id)).toBe(true);

        const after = await documents.findById(document.id);
        expect(after, 'deleting a profile must not unmake a document').not.toBeNull();
        expect(after?.profileId).toBeNull();
        expect(after?.number).toBe('INV-1001');
        expect(after?.subject).toEqual({ customerName: 'Acme', total: 1234 });
      });
    });

    describe('add-on settings', () => {
      const DECLARED = [{ key: 'business_name' }, { key: 'paper' }, { key: 'token', secret: true }];

      it('merges a partial change rather than replacing the object', async () => {
        await settings.patch('invoices', { business_name: 'Northwind' }, DECLARED, { at: T0 });
        await settings.patch('invoices', { paper: 'letter' }, DECLARED, { at: T0 + 1 });
        expect(await settings.valuesFor('invoices')).toEqual({
          business_name: 'Northwind',
          paper: 'letter',
        });
      });

      it('REFUSES a setting the manifest marked secret', async () => {
        // In the repo, not at a route: there is more than one writer, and a
        // rule enforced at one door is a rule with three doors.
        await expect(
          settings.patch('invoices', { token: 'sk_live_xyz' }, DECLARED, { at: T0 }),
        ).rejects.toBeInstanceOf(SecretSettingRefused);
        expect(await settings.valuesFor('invoices')).toEqual({});
      });

      it('drops a key the manifest does not declare, and keeps the rest', async () => {
        await settings.patch(
          'invoices',
          { business_name: 'Northwind', from_an_older_bundle: 1 },
          DECLARED,
          { at: T0 },
        );
        expect(await settings.valuesFor('invoices')).toEqual({ business_name: 'Northwind' });
      });

      it('answers with an empty object for an add-on nobody configured', async () => {
        expect(await settings.valuesFor('never-installed')).toEqual({});
      });

      it('is cleared by uninstall, unlike the documents', async () => {
        await settings.patch('invoices', { business_name: 'Northwind' }, DECLARED, { at: T0 });
        expect(await settings.clear('invoices')).toBe(true);
        expect(await settings.valuesFor('invoices')).toEqual({});
      });
    });
  });
}
