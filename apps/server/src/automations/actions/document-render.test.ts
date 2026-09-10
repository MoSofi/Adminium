// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `document.render` automation step (34-invoices-add-on.md §7.2 as ruled
 * by D55; 34-T10).
 *
 * The pipeline itself is tested in `documents/render.test.ts`, so what is
 * pinned here is what belongs to the STEP: how each of the pipeline's three
 * outcomes reaches a run, and what the dry run does and does not do.
 *
 * The pipeline is mocked rather than stubbed through a test-only parameter.
 * An injectable `render` on `RenderDeps` would be production API that exists
 * for a test, and it would let the step and the pipeline drift apart in
 * exactly the way `renderDocument`'s two entry points were built to prevent.
 */
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyMigrations,
  connectionsRepo,
  createSqliteMetaDb,
  documentProfilesRepo,
  initMetaDb,
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';

import { TRACE_EN } from '../trace.js';
import { ActionFailure, type ActionContext } from './types.js';

const renderDocument = vi.hoisted(() => vi.fn());
vi.mock('../../documents/render.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../documents/render.js')>()),
  renderDocument,
}));

const { dryRunDocumentRenderAction, runDocumentRenderAction } = await import(
  './document-render.js'
);

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace('enc:', ''),
};

/** A pipeline deps object with a runtime that has the named providers in it. */
function deps(addOnKeys: readonly string[] = ['invoices'], meta?: MetaDb) {
  return {
    meta: meta ?? ({} as MetaDb),
    storage: {} as never,
    runtime: () =>
      ({
        providers: new Map([
          [
            'document-render@1',
            addOnKeys.map((addOnKey) => ({
              addOnKey,
              contract: 'document-render',
              version: 1,
              module: {},
            })),
          ],
        ]),
      }) as never,
    readSource: () => Promise.resolve(null),
    settingsFor: () => Promise.resolve({}),
    business: () => Promise.resolve({ name: '', lines: [] }),
  };
}

function context(over: Record<string, unknown> = {}): ActionContext {
  return {
    meta: {} as never,
    manager: {} as never,
    rule: { createdBy: 'usr_1' } as never,
    runId: 'arun_1',
    hops: 0,
    now: 1_750_000_000_000,
    source: {
      connectionId: 'conn_1',
      record: { connectionId: 'conn_1', table: 'public.orders', pk: { id: 4118 }, label: 'Order' },
    } as never,
    tokens: {} as never,
    text: TRACE_EN,
    secret: 'secret',
    documents: deps(),
    ...over,
  } as unknown as ActionContext;
}

const ACTION = { kind: 'document.render' as const, profileId: 'dpf_1' };

beforeEach(() => {
  renderDocument.mockReset();
});

describe('what the step refuses before it renders anything', () => {
  it('refuses a step with no mapping chosen', async () => {
    await expect(
      runDocumentRenderAction({ kind: 'document.render', profileId: null }, context()),
    ).rejects.toBeInstanceOf(ActionFailure);
    expect(renderDocument).not.toHaveBeenCalled();
  });

  it('refuses a rule that ran on a SCHEDULE, because a document is about a record', async () => {
    await expect(
      runDocumentRenderAction(ACTION, context({ source: null })),
    ).rejects.toThrow(/needs a record/);
    expect(renderDocument).not.toHaveBeenCalled();
  });

  it('refuses when no document pipeline is wired at all', async () => {
    // A test topology, or a deployment composed without file storage. Saying
    // so beats a stack trace from inside the renderer.
    await expect(runDocumentRenderAction(ACTION, context({ documents: undefined }))).rejects.toThrow(
      /no document pipeline/,
    );
  });
});

describe('how each outcome reaches the run', () => {
  it('logs the NUMBER when a document was drawn', async () => {
    renderDocument.mockResolvedValue({
      status: 'rendered',
      document: { id: 'doc_1', number: 'INV-1042' },
    });
    const result = await runDocumentRenderAction(ACTION, context());
    expect(result.log).toBe('document drawn · INV-1042');
  });

  it('falls back to the row id when a render somehow produced no number', async () => {
    renderDocument.mockResolvedValue({ status: 'rendered', document: { id: 'doc_1', number: null } });
    expect((await runDocumentRenderAction(ACTION, context())).log).toContain('doc_1');
  });

  it('logs a SKIP and does NOT fail the run', async () => {
    /*
     * The three ordinary reasons. A run marked failed for any of them would
     * put a red row in Workflow Logs that nobody did anything wrong to earn —
     * an operator switching a mapping off has not caused an error.
     */
    for (const reason of ['profile-disabled', 'provider-missing', 'row-gone']) {
      renderDocument.mockResolvedValue({ status: 'skipped', reason });
      const result = await runDocumentRenderAction(ACTION, context());
      expect(result.log).toBe(`no document drawn · ${reason}`);
    }
  });

  it('FAILS the run when the render itself failed', async () => {
    // A refusal from the provider or an unmapped required column IS somebody's
    // to fix, so it is a failed step with the reason on it.
    renderDocument.mockResolvedValue({
      status: 'failed',
      document: null,
      error: 'unmapped or empty: customerName',
    });
    await expect(runDocumentRenderAction(ACTION, context())).rejects.toThrow(/customerName/);
  });

  it('renders as WHOEVER OWNS THE RULE, and passes the run id through', async () => {
    // The source is read with the requester's grants (D16), so the identity
    // has to travel with the request rather than defaulting to ambient.
    renderDocument.mockResolvedValue({ status: 'rendered', document: { id: 'doc_1', number: 'X' } });
    await runDocumentRenderAction(ACTION, context());
    expect(renderDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ profileId: 'dpf_1', requestedBy: 'usr_1', jobId: 'arun_1' }),
    );
  });
});

describe('the dry run stops one line short of every side effect', () => {
  let meta: MetaDb;
  let profileId: string;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await applyMigrations(meta.db, { dialect: meta.dialect });
    const connectionId = (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;
    profileId = (
      await documentProfilesRepo(meta).create({
        addOnKey: 'invoices',
        kind: 'invoice',
        name: 'Invoice',
        connectionId,
        table: 'public.orders',
        mapping: {},
      })
    ).id;
  });

  it('reports what it WOULD draw, having rendered nothing', async () => {
    const result = await dryRunDocumentRenderAction(
      { kind: 'document.render', profileId },
      context({ meta, documents: deps(['invoices'], meta) }),
    );
    expect(result.log).toBe('Would draw invoice · Invoice');
    // The assertion that makes "Test executes nothing" true for a step whose
    // side effect is a numbered business document.
    expect(renderDocument).not.toHaveBeenCalled();
  });

  it('says the mapping is switched off rather than pretending it would draw', async () => {
    await documentProfilesRepo(meta).patch(profileId, { enabled: false });
    const result = await dryRunDocumentRenderAction(
      { kind: 'document.render', profileId },
      context({ meta, documents: deps(['invoices'], meta) }),
    );
    expect(result.log).toBe('mapping is switched off · Invoice');
  });

  it('names the add-on when it is not installed', async () => {
    // The failure a person would otherwise only discover on the first real
    // trigger, hours later, as a skip in a run they were not watching.
    await expect(
      dryRunDocumentRenderAction(
        { kind: 'document.render', profileId },
        context({ meta, documents: deps(['barcode-labels'], meta) }),
      ),
    ).rejects.toThrow(/invoices.*not installed/);
  });

  it('refuses a mapping that has been deleted', async () => {
    await documentProfilesRepo(meta).remove(profileId);
    await expect(
      dryRunDocumentRenderAction(
        { kind: 'document.render', profileId },
        context({ meta, documents: deps(['invoices'], meta) }),
      ),
    ).rejects.toThrow(/no longer exists/);
  });
});
