// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Add-on event handlers as job kinds (26-T10, §5.3).
 *
 * What these actually have to establish: that an add-on's server half is run
 * through the SAME worker substrate as everything else (so it gets retries,
 * cancellation and `jobs:<jobId>` progress for free), that it cannot shadow a
 * first-party kind, that the payload cannot be hand-crafted through the generic
 * jobs route, and — the one that matters most — that the only outbound client
 * it is handed is the guarded one.
 */

import { describe, expect, it, vi } from 'vitest';

import { createAddOnHttpClient, type AddOnHttpClient } from '../src/add-ons/egress.js';
import {
  addOnEventKind,
  isEventModule,
  registerAddOnEventHandlers,
  type AddOnEventContext,
  type AddOnEventModule,
  type RegisterableAddOnEvent,
} from '../src/jobs/add-on-events.js';
import { createJobRegistry, type JobHandlerContext } from '../src/jobs/registry.js';

/** A job context standing in for the worker's. */
function context(over: Partial<JobHandlerContext> = {}): JobHandlerContext & {
  steps: Array<{ pct: number; step?: string | undefined }>;
} {
  const steps: Array<{ pct: number; step?: string | undefined }> = [];
  return {
    jobId: 'job_test',
    kind: 'add-on:x:y',
    attempt: 1,
    maxAttempts: 3,
    signal: new AbortController().signal,
    progress: (pct, info) => steps.push({ pct, step: info?.step }),
    log: () => {},
    steps,
    ...over,
  } as JobHandlerContext & { steps: typeof steps };
}

const noopHttp: AddOnHttpClient = async () => new Response('{}', { status: 200 });

function event(over: Partial<RegisterableAddOnEvent> = {}): RegisterableAddOnEvent {
  return {
    addOnKey: 'shipping-dhl',
    event: 'order.dispatched',
    module: { handle: () => ({ booked: true }) },
    http: noopHttp,
    credential: async () => null,
    ...over,
  };
}

describe('26-T10: registering add-on events as job kinds', () => {
  it('namespaces the kind so an add-on cannot shadow a first-party one', () => {
    // Job kinds are one flat string space shared with export-run, import-run
    // and the rest. An add-on called `export` declaring an event `run` must not
    // be able to take over the exporter.
    expect(addOnEventKind('export', 'run')).toBe('add-on:export:run');
    expect(addOnEventKind('shipping-dhl', 'order.dispatched')).toBe(
      'add-on:shipping-dhl:order.dispatched',
    );
  });

  it('registers a kind the worker can resolve, and runs the module', async () => {
    const registry = createJobRegistry();
    const handle = vi.fn(() => ({ tracking: 'JD01' }));
    const result = registerAddOnEventHandlers(registry, [event({ module: { handle } })]);

    expect(result.registered).toEqual(['add-on:shipping-dhl:order.dispatched']);
    expect(result.refused).toEqual([]);

    const entry = registry.get('add-on:shipping-dhl:order.dispatched');
    const ctx = context();
    const out = await entry!.run(
      { addOnKey: 'shipping-dhl', event: 'order.dispatched', data: { orderId: 'o1' } },
      ctx,
    );

    expect(out).toEqual({ tracking: 'JD01' });
    expect(handle).toHaveBeenCalledWith({ orderId: 'o1' }, expect.anything());
    // Progress rides the existing topic unchanged (§5.3) — nothing new to build
    // for an add-on progress UI.
    expect(ctx.steps.map((s) => s.step)).toEqual(['start', 'done']);
    expect(ctx.steps.at(-1)?.pct).toBe(100);
  });

  it('is INTERNAL, so POST /jobs cannot hand-craft the payload', () => {
    // The payload reaches an add-on's server half, which runs in this process
    // (O1). A jobs.manage holder able to author it would be feeding arbitrary
    // input straight to that code, past whatever the emitter would have checked.
    const registry = createJobRegistry();
    registerAddOnEventHandlers(registry, [event()]);
    expect(registry.get('add-on:shipping-dhl:order.dispatched')?.internal).toBe(true);
  });

  it('hands the add-on the GUARDED client and nothing else', async () => {
    // The call site the egress work exists for. What the handler receives must
    // be the allow-listed client, not the global fetch.
    const guarded = createAddOnHttpClient({
      key: 'shipping-dhl',
      allow: ['express.api.dhl.com'],
      hasOutboundHttp: true,
      fetchImpl: (() => Promise.resolve(new Response('{}'))) as unknown as typeof globalThis.fetch,
    });
    let received: AddOnEventContext | undefined;
    const registry = createJobRegistry();
    registerAddOnEventHandlers(registry, [
      event({
        http: guarded,
        module: {
          handle: (_data, ctx) => {
            received = ctx;
            return null;
          },
        } satisfies AddOnEventModule,
      }),
    ]);

    await registry
      .get('add-on:shipping-dhl:order.dispatched')!
      .run({ addOnKey: 'shipping-dhl', event: 'order.dispatched', data: {} }, context());

    expect(received?.http).toBe(guarded);
    // And it really is guarded: an undeclared host is refused from inside the
    // handler, not merely in a unit test of the client.
    await expect(received!.http('https://evil.example/x')).rejects.toMatchObject({
      reason: 'HOST_NOT_ALLOWED',
    });
  });

  it('resolves the credential at RUN time, never at registration', async () => {
    // A credential rotated or disconnected between boot and now must be the one
    // the handler sees — capturing it at registration would close over a secret
    // that may since have been deleted.
    const credential = vi
      .fn<() => Promise<Record<string, unknown> | null>>()
      .mockResolvedValueOnce({ apiKey: 'first' })
      .mockResolvedValueOnce(null);
    const seen: Array<Record<string, unknown> | null> = [];
    const registry = createJobRegistry();
    registerAddOnEventHandlers(registry, [
      event({
        credential,
        module: {
          handle: (_d, ctx) => {
            seen.push(ctx.credential);
            return null;
          },
        } satisfies AddOnEventModule,
      }),
    ]);

    const entry = registry.get('add-on:shipping-dhl:order.dispatched')!;
    const payload = { addOnKey: 'shipping-dhl', event: 'order.dispatched', data: {} };
    await entry.run(payload, context());
    await entry.run(payload, context());

    expect(seen).toEqual([{ apiKey: 'first' }, null]);
    expect(credential).toHaveBeenCalledTimes(2);
  });

  it('passes cancellation through, so a long handler can be stopped', async () => {
    const aborted = new AbortController();
    aborted.abort();
    let sawAborted: boolean | undefined;
    const registry = createJobRegistry();
    registerAddOnEventHandlers(registry, [
      event({
        module: {
          handle: (_d, ctx) => {
            sawAborted = ctx.signal.aborted;
            return null;
          },
        } satisfies AddOnEventModule,
      }),
    ]);
    await registry
      .get('add-on:shipping-dhl:order.dispatched')!
      .run(
        { addOnKey: 'shipping-dhl', event: 'order.dispatched', data: {} },
        context({ signal: aborted.signal }),
      );
    expect(sawAborted).toBe(true);
  });
});

describe('26-T10: a module that does not implement the contract', () => {
  it('is refused and NAMED, never registered as a kind that cannot run', () => {
    // A registered kind whose handler cannot run is worse than no kind: the job
    // is enqueued, retried three times, and fails with a message about a
    // missing function rather than about a broken add-on.
    const registry = createJobRegistry();
    const result = registerAddOnEventHandlers(registry, [
      event({ module: { notHandle: () => {} } }),
      event({ addOnKey: 'import-canva', module: null }),
      event({ addOnKey: 'design-studio', module: { handle: 'not a function' } }),
    ]);

    expect(result.registered).toEqual([]);
    expect(result.refused.map((r) => r.addOnKey)).toEqual([
      'shipping-dhl',
      'import-canva',
      'design-studio',
    ]);
    expect(result.refused.every((r) => r.reason === 'NOT_AN_EVENT_MODULE')).toBe(true);
    expect(registry.get('add-on:shipping-dhl:order.dispatched')).toBeUndefined();
  });

  it('registers the healthy events beside a refused one', () => {
    const registry = createJobRegistry();
    const result = registerAddOnEventHandlers(registry, [
      event({ addOnKey: 'broken', module: {} }),
      event({ addOnKey: 'working' }),
    ]);
    expect(result.registered).toEqual(['add-on:working:order.dispatched']);
    expect(result.refused).toHaveLength(1);
  });

  it('recognises the contract by shape, not by name', () => {
    expect(isEventModule({ handle: () => {} })).toBe(true);
    expect(isEventModule({})).toBe(false);
    expect(isEventModule(null)).toBe(false);
    expect(isEventModule('handle')).toBe(false);
  });
});
