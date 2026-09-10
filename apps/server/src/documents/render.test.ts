// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The render pipeline (34-invoices-add-on.md §7.3, D8/D11; 34-T11).
 *
 * Every case here is about the ORDER of the seven steps, because the order is
 * the design and every one of them has a plausible wrong version:
 *
 *  - the provider is chosen by the profile's add-on key, not by
 *    `resolveProvider`'s lowest-key choice (§0.3 trap 11) — the test installs
 *    TWO providers to make that a real choice rather than a lookup;
 *  - the register row exists BEFORE the bytes, so a crash leaves a record of
 *    an attempt rather than silence;
 *  - the number is claimed AFTER a successful render, so a failure burns none
 *    (D11);
 *  - a disabled profile, a vanished provider and a deleted row are SKIPS with
 *    reasons, not failures — none of the three is anybody's error.
 */
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  connectionsRepo,
  createSqliteMetaDb,
  documentProfilesRepo,
  documentSequencesRepo,
  documentsRepo,
  filesRepo,
  initMetaDb,
  type DocumentProfile,
  type DsnCrypto,
  type MetaDb,
  type RecordRef,
} from '@adminium/meta';

import type { AddOnRuntimeState } from '../add-ons/runtime.js';
import type { FileStore } from '../files/store.js';
import { renderDocument, type RenderDeps, type SourceRead } from './render.js';

const T0 = 1_750_000_000_000;

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace('enc:', ''),
};

const ENTITY: RecordRef = {
  connectionId: 'conn_1',
  table: 'public.orders',
  pk: { id: 4118 },
  label: 'Order 4118',
};

/** A provider that draws one line and records what it was asked for. */
function makeProvider(key: string, over: { refuse?: unknown; throws?: string } = {}) {
  const calls: unknown[] = [];
  return {
    calls,
    // The add-on key travels on the ENTRY, not inside the module — that is
    // what `providerByKey` matches on, and leaving it off made every case in
    // this file skip with `provider-missing` on the first run.
    key,
    module: {
      key,
      kinds: () => [{ id: 'invoice', formats: ['html'] as const, paper: ['a4'] }],
      describe: () => ({
        slots: [
          { id: 'customerName', type: 'text' as const, required: true },
          { id: 'total', type: 'money' as const, required: false },
        ],
      }),
      render: (input: unknown) => {
        calls.push(input);
        if (over.throws !== undefined) throw new Error(over.throws);
        if (over.refuse !== undefined) return Promise.resolve(over.refuse);
        return Promise.resolve([
          {
            format: 'html' as const,
            filename: 'invoice.html',
            mediaType: 'text/html; charset=utf-8',
            bytes: new TextEncoder().encode(`<p>${key}</p>`),
            locale: 'en-US',
            warnings: [],
          },
        ]);
      },
    },
  };
}

function runtimeWith(...providers: { module: unknown; key: string }[]): AddOnRuntimeState {
  return {
    providers: new Map([
      [
        'document-render@1',
        providers.map((p) => ({
          addOnKey: p.key,
          contract: 'document-render',
          version: 1,
          module: p.module,
        })),
      ],
    ]),
    slots: new Map(),
    conflicts: [],
    problems: [],
  } as unknown as AddOnRuntimeState;
}

/** A file store that keeps bytes in memory and reports what it was given. */
function makeStore() {
  const written: { id: string; kind: string; filename: string; bytes: Buffer }[] = [];
  const store = {
    defaultDestinationId: () => Promise.resolve(null),
    write: (input: { id: string; kind: string; filename: string; mime: string; bytes: Buffer | string }) => {
      const bytes = Buffer.from(input.bytes);
      written.push({ id: input.id, kind: input.kind, filename: input.filename, bytes });
      return Promise.resolve({
        sizeBytes: bytes.byteLength,
        sha256: 'sha-test',
        storageKey: `documents/${input.id}`,
        destinationId: null,
        storage: 'local',
      });
    },
  } as unknown as FileStore;
  return { store, written };
}

describe('the render pipeline', () => {
  let meta: MetaDb;
  let profiles: ReturnType<typeof documentProfilesRepo>;
  let documents: ReturnType<typeof documentsRepo>;
  let sequences: ReturnType<typeof documentSequencesRepo>;
  let connectionId: string;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await applyMigrations(meta.db, { dialect: meta.dialect });
    profiles = documentProfilesRepo(meta);
    documents = documentsRepo(meta);
    sequences = documentSequencesRepo(meta);
    connectionId = (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;
  });

  const makeProfile = async (over: Partial<DocumentProfile> = {}) =>
    await profiles.create(
      {
        addOnKey: over.addOnKey ?? 'invoices',
        kind: 'invoice',
        name: 'Invoice',
        connectionId,
        table: 'public.orders',
        mapping: { customerName: { column: 'customer' }, total: { column: 'amount' } },
        options: { prefix: 'INV-', formats: ['html'], paper: 'a4' },
        ...(over.enabled === undefined ? {} : { enabled: over.enabled }),
      },
      T0,
    );

  const SOURCE: SourceRead = {
    row: { customer: 'Acme Corporation', amount: '1234.50' },
    collections: {},
    lookups: {},
    entity: ENTITY,
    currency: 'EUR',
    timezone: 'Europe/Lisbon',
  };

  function deps(over: Partial<RenderDeps> = {}): RenderDeps {
    const { store } = makeStore();
    return {
      meta,
      storage: store,
      runtime: () => runtimeWith(makeProvider('invoices')),
      readSource: () => Promise.resolve(SOURCE),
      settingsFor: () => Promise.resolve({}),
      business: () => Promise.resolve({ name: 'Northwind', lines: [] }),
      now: () => T0,
      ...over,
    };
  }

  it('renders, stores bytes, and claims a number in that order', async () => {
    const { store, written } = makeStore();
    const profile = await makeProfile();
    const outcome = await renderDocument(deps({ storage: store }), {
      profileId: profile.id,
      pk: { id: 4118 },
    });

    expect(outcome.status).toBe('rendered');
    if (outcome.status !== 'rendered') return;
    expect(outcome.document.number).toBe('INV-1');
    expect(outcome.document.status).toBe('rendered');
    expect(written).toHaveLength(1);
    expect(written[0]?.kind).toBe('document');
    expect(written[0]?.bytes.toString()).toContain('invoices');

    // The bytes are a real file row, attached to the source record.
    const file = await filesRepo(meta).findById(outcome.document.htmlFileId!);
    expect(file?.kind).toBe('document');
  });

  it('FREEZES the subject into the row, coerced to the wire law', async () => {
    const profile = await makeProfile();
    const outcome = await renderDocument(deps(), { profileId: profile.id, pk: { id: 4118 } });
    if (outcome.status !== 'rendered') throw new Error(outcome.status);

    const subject = outcome.document.subject as Record<string, unknown>;
    const fields = subject.fields as Record<string, unknown>;
    expect(fields.customerName).toBe('Acme Corporation');
    // `1234.50` reached the provider as integer minor units, never as a float.
    expect(fields.total).toBe(123_450);
    expect((subject.now as { timezone: string }).timezone).toBe('Europe/Lisbon');
  });

  it('picks the provider the PROFILE names, not the one that sorts first', async () => {
    /*
     * §0.3 trap 11, and the reason `providerByKey` exists beside
     * `resolveProvider`. `barcode-labels` sorts before `invoices`, so a
     * pipeline using the lowest-key choice would render this invoice through
     * a barcode add-on — silently, and catastrophically.
     */
    const barcode = makeProvider('barcode-labels');
    const invoices = makeProvider('invoices');
    const profile = await makeProfile();

    const outcome = await renderDocument(
      deps({ runtime: () => runtimeWith(barcode, invoices) }),
      { profileId: profile.id, pk: { id: 4118 } },
    );

    expect(outcome.status).toBe('rendered');
    expect(invoices.calls).toHaveLength(1);
    expect(barcode.calls, 'the wrong provider was asked to draw an invoice').toHaveLength(0);
  });

  it('SKIPS a disabled profile without failing anything', async () => {
    const profile = await makeProfile({ enabled: false } as Partial<DocumentProfile>);
    const outcome = await renderDocument(deps(), { profileId: profile.id, pk: { id: 4118 } });
    expect(outcome).toEqual({ status: 'skipped', reason: 'profile-disabled' });
    // No row, because an operator turning a profile off has not caused an
    // attempt that needs recording.
    expect(await documents.list({ profileId: profile.id })).toHaveLength(0);
  });

  it('SKIPS when the add-on is gone, and says so in the audit', async () => {
    const profile = await makeProfile();
    const outcome = await renderDocument(deps({ runtime: () => runtimeWith() }), {
      profileId: profile.id,
      pk: { id: 4118 },
    });
    expect(outcome).toEqual({ status: 'skipped', reason: 'provider-missing' });
  });

  it('SKIPS when the row was deleted between the trigger and the job', async () => {
    // The undo window's ordinary outcome.
    const profile = await makeProfile();
    const outcome = await renderDocument(deps({ readSource: () => Promise.resolve(null) }), {
      profileId: profile.id,
      pk: { id: 4118 },
    });
    expect(outcome).toEqual({ status: 'skipped', reason: 'row-gone' });
  });

  it('BURNS NO NUMBER when the provider refuses (D11)', async () => {
    const profile = await makeProfile();
    const outcome = await renderDocument(
      deps({
        runtime: () =>
          runtimeWith(
            makeProvider('invoices', {
              refuse: { code: 'LATIN_ONLY', detail: 'base-14 fonts', dropped: ['株'] },
            }),
          ),
      }),
      { profileId: profile.id, pk: { id: 4118 } },
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.document?.number).toBeNull();
    expect(outcome.error).toContain('LATIN_ONLY');
    expect(outcome.error).toContain('株');
    // The sequence never moved: the next successful render gets number one.
    expect(await sequences.peek(profile.id)).toBe(1);
  });

  it('records a row for a FAILED render rather than leaving silence', async () => {
    const profile = await makeProfile();
    await renderDocument(
      deps({ runtime: () => runtimeWith(makeProvider('invoices', { throws: 'writer exploded' })) }),
      { profileId: profile.id, pk: { id: 4118 } },
    );
    const rows = await documents.list({ profileId: profile.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.error).toContain('writer exploded');
    // The subject is still frozen on it — a failed attempt is diagnosable.
    expect(rows[0]?.subject).not.toBeNull();
  });

  it('fails with the SLOT NAMES when the mapping does not cover a required one', async () => {
    const profile = await profiles.create(
      {
        addOnKey: 'invoices',
        kind: 'invoice',
        name: 'Half-mapped',
        connectionId,
        table: 'public.orders',
        mapping: { total: { column: 'amount' } },
        options: { prefix: 'INV-', formats: ['html'] },
      },
      T0,
    );
    const outcome = await renderDocument(deps(), { profileId: profile.id, pk: { id: 4118 } });
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    // The operator is the one who can fix it, so the row names the slot.
    expect(outcome.error).toContain('customerName');
    expect(await sequences.peek(profile.id)).toBe(1);
  });

  it('numbers consecutively across renders of one profile', async () => {
    const profile = await makeProfile();
    const one = await renderDocument(deps(), { profileId: profile.id, pk: { id: 1 } });
    const two = await renderDocument(deps(), { profileId: profile.id, pk: { id: 2 } });
    expect(one.status === 'rendered' && one.document.number).toBe('INV-1');
    expect(two.status === 'rendered' && two.document.number).toBe('INV-2');
  });

  it('hands the provider its own settings and nothing else', async () => {
    const provider = makeProvider('invoices');
    const profile = await makeProfile();
    await renderDocument(
      deps({
        runtime: () => runtimeWith(provider),
        settingsFor: (key) => Promise.resolve({ tax_label: 'VAT', asked: key }),
      }),
      { profileId: profile.id, pk: { id: 4118 } },
    );
    const input = provider.calls[0] as { settings: Record<string, unknown> };
    expect(input.settings).toEqual({ tax_label: 'VAT', asked: 'invoices' });
  });

  it('gives the provider no database handle, no connection and no clock', async () => {
    // The subject is the only door (31 A.1's rule, applied to a contract).
    const provider = makeProvider('invoices');
    const profile = await makeProfile();
    await renderDocument(deps({ runtime: () => runtimeWith(provider) }), {
      profileId: profile.id,
      pk: { id: 4118 },
    });
    const input = provider.calls[0] as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(['formats', 'kind', 'paper', 'settings', 'subject']);
  });
});
