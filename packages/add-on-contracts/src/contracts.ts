// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Provider contract registry v1 — CLOSED (24-marketplace-wave-4.md §5.5).
 *
 * Four, not eight. A contract that has no implementation is a guess about a
 * future add-on; the only way a contract gets in is alongside the add-on that
 * implements it. The fourth was bought on a seven-exhibit dossier
 * (34-invoices-add-on.md Appendix A), not on a shape somebody liked.
 */

import { z } from 'zod';

export interface ContractDefinition {
  readonly id: string;
  readonly version: 1;
  readonly summary: string;
  /** How many add-ons implement it in wave 4 — the evidence the shape is real. */
  readonly implementations: number;
}

export const CONTRACT_REGISTRY = [
  {
    id: 'artwork-source',
    version: 1,
    summary:
      'A way for a customer to supply artwork that is not an upload. The host runs the checks on what comes back, so no implementation marks its own homework.',
    implementations: 2,
  },
  {
    id: 'shipping-carrier',
    version: 1,
    summary:
      'One delivery company: rates, booking, tracking, labels. Implemented so the second one is a copy.',
    implementations: 1,
  },
  {
    id: 'product-personalizer',
    version: 1,
    summary:
      'Personalization spanning three surfaces — shopper, staff, dashboard — which is why it is a contract rather than a screen.',
    implementations: 1,
  },
  {
    /*
     * THE FOURTH, BOUGHT 2026-09-10 (34-invoices-add-on.md O1/O11). 25 §5 drew
     * this interface twice and never built it; zero occurrences in either repo
     * until now. Its dossier is 34 Appendix A — seven exhibits, two
     * implementers in the same sub-wave (invoices; barcode-labels wrapping
     * renderLabelSheet), which meets 25 D4's count — and, by 34 O11's ruling,
     * relaxes its "different means" clause for a contract Adminium ITSELF
     * consumes. It PROVIDES kinds of document an add-on can describe and
     * render, as an outline of slots (labels in all eight locales) and bytes
     * (each kind declares its own formats and glyph coverage); it is CONSUMED
     * BY the engine document pipeline (profiles, triggers, the document.render
     * job, the /documents routes) — the first production read of
     * runtime.providers, selected by add-on key, never by resolveProvider's
     * lowest-key choice. "Add-ons compose" runs for real here.
     */
    id: 'document-render',
    version: 1,
    summary:
      'Kinds of document an add-on can describe (an outline of slots, labelled in eight locales) and render to bytes (html, pdf — per kind). Consumed by the engine document pipeline; the first contract Adminium itself resolves at runtime.',
    implementations: 2,
  },
] as const satisfies readonly ContractDefinition[];

export type ContractId = (typeof CONTRACT_REGISTRY)[number]['id'];

export const CONTRACT_IDS = CONTRACT_REGISTRY.map((c) => c.id) as readonly ContractId[];

export const contractIdSchema = z.enum(
  CONTRACT_IDS as unknown as [ContractId, ...ContractId[]],
);

const BY_ID = new Map<string, ContractDefinition>(CONTRACT_REGISTRY.map((c) => [c.id, c]));

export function isContractId(v: unknown): v is ContractId {
  return typeof v === 'string' && BY_ID.has(v);
}

/** True when the registry carries this contract AT the declared version. */
export function hasContractVersion(id: string, version: number): boolean {
  const found = BY_ID.get(id);
  return found !== undefined && found.version === version;
}
