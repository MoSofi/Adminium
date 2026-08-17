// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CapabilityHost — the §12 gate, from the main process's side (11-electron.md §12).
 *
 * This is the main-process half of the pipeline manifest → consent → grant → IPC
 * → provider. The SERVER half (the grant route writing `adminium_settings`) is
 * pinned in `apps/server/test/desktop-capabilities-route.test.ts`; the two are
 * joined by a schema-pinned contract (`host.ts`'s `_CapabilityGrantMatchesServer`
 * and `index.ts`'s reply-schema mirror), and the whole cross-process walk is
 * 11-T20's Playwright `_electron` suite, which a display-less CI machine cannot
 * run here.
 *
 * What this file pins is the gate itself, because the gate is the security
 * boundary: an invoke reaches a provider ONLY through a live grant, the read is
 * fresh on every call (so a revoke bites immediately), and it fails CLOSED when
 * there is no session to read as.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  CAPABILITY_NOT_GRANTED,
  CAPABILITY_STUB,
  createCapabilityHost,
  type CapabilityGrant,
  type CapabilityProvider,
} from './host.js';
import { createEscposPrinterProvider, PRINTER_ESCPOS_ID } from './printer-escpos.js';

const grant = (capabilityId: string): CapabilityGrant => ({
  manifestId: 'com.adminium.pos',
  capabilityId,
  grantedAt: 1_700_000_000_000,
});

/** A provider that records its calls, for asserting the host dispatches to it. */
function spyProvider(id: string): CapabilityProvider & { calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  return {
    calls,
    descriptor: { id, version: 1, status: 'available', methods: ['do'] },
    invoke(method, payload) {
      calls.push([method, payload]);
      return Promise.resolve({ ok: method });
    },
  };
}

describe('list()', () => {
  it('returns the descriptors of every registered provider', () => {
    const host = createCapabilityHost({
      readGrants: () => Promise.resolve([]),
      providers: [createEscposPrinterProvider()],
    });
    expect(host.list()).toEqual([
      { id: PRINTER_ESCPOS_ID, version: 1, status: 'stub', methods: ['listDevices', 'print', 'openDrawer'] },
    ]);
  });

  it('refuses a second provider for one capability id — that is a wiring bug', () => {
    const host = createCapabilityHost({ readGrants: () => Promise.resolve([]) });
    host.register(spyProvider('printer.escpos'));
    expect(() => host.register(spyProvider('printer.escpos'))).toThrow(/already has a provider/);
  });
});

describe('invoke() — the gate (§12)', () => {
  it('reaches the provider when the capability is granted, forwarding method + payload', async () => {
    const provider = spyProvider('printer.escpos');
    const host = createCapabilityHost({
      readGrants: () => Promise.resolve([grant('printer.escpos')]),
      providers: [provider],
    });

    const result = await host.invoke('printer.escpos', 'do', { copies: 2 });
    expect(result).toEqual({ ok: 'do' });
    expect(provider.calls).toEqual([['do', { copies: 2 }]]);
  });

  it('rejects an ungranted call with CAPABILITY_NOT_GRANTED, without touching the provider', async () => {
    const provider = spyProvider('printer.escpos');
    const host = createCapabilityHost({
      readGrants: () => Promise.resolve([]),
      providers: [provider],
    });

    await expect(host.invoke('printer.escpos', 'do', null)).rejects.toThrow(CAPABILITY_NOT_GRANTED);
    expect(provider.calls).toEqual([]);
  });

  it('fails CLOSED when there is no session to read as (reader returns null)', async () => {
    const host = createCapabilityHost({
      readGrants: () => Promise.resolve(null),
      providers: [createEscposPrinterProvider()],
    });
    await expect(host.invoke('printer.escpos', 'listDevices', null)).rejects.toThrow(
      CAPABILITY_NOT_GRANTED,
    );
  });

  it('re-reads the grant table on every call, so a revoke bites the very next invoke', async () => {
    // A mutable table stands in for the server: the consent step adds the grant,
    // the revoke control removes it, and the host must see each state on its next
    // read — never a cached one.
    let grants: CapabilityGrant[] = [];
    const readGrants = vi.fn(() => Promise.resolve(grants));
    const host = createCapabilityHost({
      readGrants,
      providers: [createEscposPrinterProvider()],
    });

    // Ungranted: refused.
    await expect(host.invoke('printer.escpos', 'listDevices', null)).rejects.toThrow(
      CAPABILITY_NOT_GRANTED,
    );

    // Consent: now it reaches the stub, which lists no devices.
    grants = [grant('printer.escpos')];
    await expect(host.invoke('printer.escpos', 'listDevices', null)).resolves.toEqual([]);

    // Revoke: the next call is refused again, with no restart.
    grants = [];
    await expect(host.invoke('printer.escpos', 'listDevices', null)).rejects.toThrow(
      CAPABILITY_NOT_GRANTED,
    );

    expect(readGrants).toHaveBeenCalledTimes(3);
  });

  it('surfaces a provider rejection unchanged — the escpos stub refuses print with CAPABILITY_STUB', async () => {
    const host = createCapabilityHost({
      readGrants: () => Promise.resolve([grant('printer.escpos')]),
      providers: [createEscposPrinterProvider()],
    });
    await expect(host.invoke('printer.escpos', 'print', { text: 'receipt' })).rejects.toThrow(
      CAPABILITY_STUB,
    );
  });

  it('a grant for a capability with no provider is an INTERNAL fault, not a typed §12 code', async () => {
    const host = createCapabilityHost({
      readGrants: () => Promise.resolve([grant('serial')]),
    });
    const err = (await host.invoke('serial', 'open', null).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('no provider in this build');
    expect(err.message).not.toContain(CAPABILITY_NOT_GRANTED);
    expect(err.message).not.toContain(CAPABILITY_STUB);
  });
});

describe('the escpos stub provider (§12 v1)', () => {
  it('lists no devices and refuses every hardware method with CAPABILITY_STUB', async () => {
    const provider = createEscposPrinterProvider();
    expect(provider.descriptor.status).toBe('stub');
    await expect(provider.invoke('listDevices', null)).resolves.toEqual([]);
    for (const method of ['print', 'openDrawer']) {
      await expect(provider.invoke(method, null)).rejects.toThrow(CAPABILITY_STUB);
    }
  });
});
