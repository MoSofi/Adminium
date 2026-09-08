// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The registries are CLOSED (24 §5.4, §5.5). These tests are the thing that
 * makes "closed" mean something: adding a slot or a contract without also
 * moving the count here is a failing build, not a quiet widening.
 */
import { describe, expect, it } from 'vitest';

import {
  ADD_ON_CATEGORIES,
  CONTRACT_IDS,
  CONTRACT_REGISTRY,
  SLOT_IDS,
  SLOT_REGISTRY,
  addOnBlockSchema,
  hasContractVersion,
  isContractId,
  isSlotId,
  slotDefinition,
} from '../src/index.js';

describe('slot registry', () => {
  it('holds exactly thirteen slots', () => {
    // Eleven from wave 4, plus `record.actions` bought on 2026-08-28 (31 O1)
    // and `shell.overlay` bought on 2026-09-01 (33 O1 → D17). Moving this
    // number is the deliberate act; a slot appearing without it is the
    // accident the ratchet exists to catch.
    expect(SLOT_REGISTRY).toHaveLength(13);
    expect(SLOT_IDS).toHaveLength(13);
  });

  it('has no duplicate ids', () => {
    expect(new Set(SLOT_IDS).size).toBe(SLOT_IDS.length);
  });

  it('carries the two slots bought since wave 4, and nothing else new', () => {
    /*
     * Named rather than counted, because a count alone would let a DIFFERENT
     * thirteenth slide in behind the same number. The purchases were for these
     * two ids.
     */
    const waveFour = [
      'artwork.sources',
      'cart.line.preview',
      'checkout.delivery.methods',
      'nav.add-on.routes',
      'order.dispatch.actions',
      'order.dispatch.panel',
      'order.line.actions',
      'product.admin.panel',
      'product.options.personalize',
      'record.editor.panel',
      'settings.add-on.panel',
    ];
    expect([...SLOT_IDS].sort()).toEqual(
      [...waveFour, 'record.actions', 'shell.overlay'].sort(),
    );
  });

  it('rules record.actions `both`, so a customer-facing render moment can mount it', () => {
    /*
     * Two of the dossier's seven exhibits are the reader's OWN record — a
     * student's certificate sheet and a ticket-holder's pass — so a `staff`
     * ruling would have excluded the two moments the purchase is most wanted
     * for. Asserted rather than left to the literal, because the surface is the
     * half of this entry a later edit is most likely to "tidy".
     */
    expect(slotDefinition('record.actions').surface).toBe('both');
    expect(slotDefinition('record.actions').fill).toBe('multi');
  });

  it('rules shell.overlay `customer`, and `multi` so two overlays can coexist', () => {
    /*
     * `customer` is the half of this entry most likely to be "tidied" to
     * `both` on the reasoning that a staff app could hang a panel in its
     * corner too. None does; ruling it `both` would buy a second surface on
     * zero exhibits, which is what the entry's own comment refuses at length.
     *
     * `multi` is asserted beside it because the two answers are connected: a
     * corner is a place two add-ons can stand in at once, and `single` would
     * make the second one lose silently.
     */
    expect(slotDefinition('shell.overlay').surface).toBe('customer');
    expect(slotDefinition('shell.overlay').fill).toBe('multi');
  });

  it('still refuses the twelfth an earlier draft guessed at', () => {
    // Buying two slots on real exhibits does not reopen the registry to ideas.
    expect(isSlotId('job.timeline.entries')).toBe(false);
  });

  it('carries the renamed dispatch-actions id, not the print-shop-specific one', () => {
    // D21: the id names a surface so a second host can fill it.
    expect(isSlotId('order.dispatch.actions')).toBe(true);
    expect(isSlotId('job.dispatch.actions')).toBe(false);
  });

  it('does not carry the twelfth slot an earlier draft had', () => {
    // A slot nobody fills is a guess about a future add-on.
    expect(isSlotId('job.timeline.entries')).toBe(false);
  });

  it('describes every slot with a payload and what it renders', () => {
    for (const slot of SLOT_REGISTRY) {
      expect(slot.payload.length).toBeGreaterThan(0);
      expect(slot.renders.length).toBeGreaterThan(0);
      expect(slotDefinition(slot.id).id).toBe(slot.id);
    }
  });
});

describe('contract registry', () => {
  it('holds exactly three contracts, all at version 1', () => {
    expect(CONTRACT_REGISTRY).toHaveLength(3);
    expect(CONTRACT_REGISTRY.every((c) => c.version === 1)).toBe(true);
  });

  it('carries the three wave-4 contracts and nothing else', () => {
    expect([...CONTRACT_IDS].sort()).toEqual([
      'artwork-source',
      'product-personalizer',
      'shipping-carrier',
    ]);
  });

  it('every registered contract has at least one implementation in the wave', () => {
    expect(CONTRACT_REGISTRY.every((c) => c.implementations >= 1)).toBe(true);
  });

  it('matches on id AND version, so a v2 claim against a v1 registry fails', () => {
    expect(hasContractVersion('shipping-carrier', 1)).toBe(true);
    expect(hasContractVersion('shipping-carrier', 2)).toBe(false);
    expect(isContractId('shipping-fedex')).toBe(false);
  });
});

describe('add-on categories', () => {
  it('are their own closed vocabulary, not the app facet set', () => {
    expect([...ADD_ON_CATEGORIES]).toEqual(['artwork', 'delivery', 'payments', 'email', 'data']);
    // An add-on is not a vertical: forcing a carrier into `commerce` is the
    // mistake this vocabulary exists to prevent.
    expect(ADD_ON_CATEGORIES as readonly string[]).not.toContain('commerce');
  });
});

const DHL_BLOCK = {
  attaches: [{ app: 'printing', range: '^1.0.0' }],
  provides: [{ contract: 'shipping-carrier', version: 1, server: 'server/carrier.js' }],
  slots: [{ slot: 'order.dispatch.actions', client: 'client/dispatch.js', order: 10 }],
  connect: { kind: 'api-key' },
  scopes: ['records:jobs:read', 'records:shipments:write', 'files:write'],
  network: { allow: ['api.example-carrier.test'] },
  publicSettings: ['demo_transport', 'collection_cutoff'],
  demoTransport: 'server/demo-carrier.js',
};

describe('addOn block schema', () => {
  it('accepts a well-formed block', () => {
    expect(addOnBlockSchema.safeParse(DHL_BLOCK).success).toBe(true);
  });

  it('accepts a block that fills a slot and provides no contract at all', () => {
    /*
     * The commonest add-on shape there is: it hangs an action off a record and
     * implements nothing. Both contract checks read `b.provides ?? []` and
     * `b.consumes ?? []`, so an add-on declaring neither must sail through both
     * refinements rather than fail an `.every()` over `undefined`.
     */
    const { provides: _provides, ...slotOnly } = DHL_BLOCK;
    const result = addOnBlockSchema.safeParse({
      ...slotOnly,
      slots: [{ slot: 'record.actions', client: 'client/actions.js', order: 20 }],
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('refuses a slot id outside the closed registry', () => {
    const bad = { ...DHL_BLOCK, slots: [{ slot: 'job.timeline.entries', client: 'c.js', order: 1 }] };
    expect(addOnBlockSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses a contract at a version the registry does not carry', () => {
    const bad = {
      ...DHL_BLOCK,
      provides: [{ contract: 'shipping-carrier', version: 2, server: 'server/carrier.js' }],
    };
    const result = addOnBlockSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('CONTRACT_UNKNOWN');
  });

  it('refuses a wildcard hostname — the allow-list is exact hostnames only (D14)', () => {
    for (const host of ['*.example-carrier.test', '203.0.113.10', 'https://api.example.test']) {
      const bad = { ...DHL_BLOCK, network: { allow: [host] } };
      expect(addOnBlockSchema.safeParse(bad).success, host).toBe(false);
    }
  });

  it('requires an oauth2 connect to say where it authorizes', () => {
    const bare = { ...DHL_BLOCK, connect: { kind: 'oauth2' } };
    expect(addOnBlockSchema.safeParse(bare).success).toBe(false);

    const full = {
      ...DHL_BLOCK,
      connect: {
        kind: 'oauth2',
        authorizeUrl: 'https://vendor.example/authorize',
        tokenUrl: 'https://vendor.example/token',
        scopes: ['design:meta:read', 'design:content:read'],
      },
    };
    expect(addOnBlockSchema.safeParse(full).success).toBe(true);
  });

  it('requires at least one attach target — an add-on never stands alone', () => {
    const bad = { ...DHL_BLOCK, attaches: [] };
    expect(addOnBlockSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown keys, so a typo is a build failure rather than a no-op', () => {
    const bad = { ...DHL_BLOCK, pages: [{ ref: 'nope' }] };
    expect(addOnBlockSchema.safeParse(bad).success).toBe(false);
  });
});
