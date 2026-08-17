// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `printer.escpos` — the v1 STUB provider (11-electron.md §12).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STUB in both senses. **11-T17 owns this file.** 11-T01 created it so the │
 * │ §3 tree exists and the scaffold builds.                                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Note that "stub" here is the SHIPPING BEHAVIOUR, not a placeholder to be
 * removed in M11: §12 specifies `status: "stub"`, `listDevices` returning `[]`
 * and `print` rejecting with `CAPABILITY_STUB`, precisely so the manifest →
 * consent → grant → IPC → provider pipeline is exercisable end-to-end now while
 * the concrete escpos/USB driver work stays out of scope (§1) until the POS
 * micro-SaaS plan. 11-T17 implements this contract; the POS plan replaces the
 * internals and nothing above it changes.
 */

import { CAPABILITY_STUB, type CapabilityProvider } from './host.js';

export const PRINTER_ESCPOS_ID = 'printer.escpos';

export function createEscposPrinterProvider(): CapabilityProvider {
  return {
    descriptor: {
      id: PRINTER_ESCPOS_ID,
      version: 1,
      status: 'stub',
      methods: ['listDevices', 'print', 'openDrawer'],
    },
    invoke(method: string): Promise<unknown> {
      if (method === 'listDevices') return Promise.resolve([]);
      return Promise.reject(
        new Error(`${CAPABILITY_STUB}: ${PRINTER_ESCPOS_ID}.${method} has no driver in this build.`),
      );
    },
  };
}
