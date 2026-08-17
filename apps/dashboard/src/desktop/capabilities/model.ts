// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The capability vocabulary and status logic, as the SPA sees it
 * (11-electron.md §12). Pure — no React, no bridge — so the one contract that
 * MUST hold on every runtime is testable without a DOM: "non-desktop runtimes
 * report every capability `unavailable`" (§12).
 *
 * WHY THE SPA OWNS THAT RULE. The dashboard is ONE bundle that runs on desktop,
 * self-host and Cloud. Off-desktop there is no preload bridge to ask, so the
 * answer cannot come from the main process — it comes from here. A manifest page
 * reading a capability's status on self-host must see `unavailable` and degrade
 * (13-marketplace.md SDK surface), never error.
 */

/** `GET /api/v1/system/info`'s `runtime` (08-server-api.md). */
export type Runtime = 'selfhost' | 'desktop' | 'cloud';

/** §12's frozen descriptor status. */
export type CapabilityStatus = 'available' | 'unavailable' | 'stub';

/** §12's frozen descriptor, restated for the SPA (mirrors `@adminium/desktop/api`). */
export interface CapabilityDescriptor {
  id: string;
  version: 1;
  status: CapabilityStatus;
  methods: string[];
}

/**
 * One entry of the closed capability vocabulary the SPA knows how to name and
 * ask consent for. The `*Key`/`*Default` pairs feed `t()` — every user-visible
 * string is translated, and the default is the English source the parity test
 * checks all 8 locales against.
 *
 * v1 ships one: the ESC/POS receipt printer the POS micro-SaaS (13-marketplace.md
 * §10) needs. Kept in lockstep with the server's `KNOWN_CAPABILITY_IDS` and the
 * main process's providers; `model.test.ts` pins the id set so a rename here is a
 * red test, not a silent divergence from the driver.
 */
export interface CapabilityMeta {
  id: string;
  /** The capability's human name, e.g. "Receipt printer (ESC/POS)". */
  nameKey: string;
  nameDefault: string;
  /** The consent scope line, e.g. "Print to receipt printers" (§12's copy). */
  scopeKey: string;
  scopeDefault: string;
  /** Methods this capability exposes, for the descriptor fallback off-desktop. */
  methods: string[];
}

export const CAPABILITY_CATALOG: readonly CapabilityMeta[] = [
  {
    id: 'printer.escpos',
    nameKey: 'capabilities.catalog.printerEscpos.name',
    nameDefault: 'Receipt printer (ESC/POS)',
    scopeKey: 'capabilities.catalog.printerEscpos.scope',
    scopeDefault: 'Print to receipt printers and open a connected cash drawer',
    methods: ['listDevices', 'print', 'openDrawer'],
  },
];

/**
 * The effective descriptor list the UI should render, given the runtime and the
 * bridge's answer.
 *
 *  - On DESKTOP, the bridge's descriptors are the truth — the main process holds
 *    the providers and reports the real status (`stub` for the v1 printer).
 *  - Anywhere else (self-host, Cloud, or desktop before the bridge answers),
 *    every catalogued capability is `unavailable`. This is §12's cross-runtime
 *    rule, made concrete in the one place that runs on every runtime.
 */
export function capabilityStatuses(
  runtime: Runtime,
  bridgeDescriptors: readonly CapabilityDescriptor[] | null,
): CapabilityDescriptor[] {
  if (runtime === 'desktop' && bridgeDescriptors !== null) {
    return [...bridgeDescriptors];
  }
  return CAPABILITY_CATALOG.map((meta) => ({
    id: meta.id,
    version: 1,
    status: 'unavailable',
    methods: meta.methods,
  }));
}
