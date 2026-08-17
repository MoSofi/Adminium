// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `kind: "add-on"` branch (24 §5.2, §5.3) and — just as important — the
 * proof that adding it broke nothing: a manifest written before wave 4 carries
 * no `kind` field at all and must still validate, with `manifestVersion` still
 * 1 (acceptance criterion 9).
 */
import { describe, expect, it } from 'vitest';

import {
  MANIFEST_VERSION,
  addOnManifestSchema,
  appManifestSchema,
  isAddOnManifest,
  manifestSchema,
  validateManifest,
} from '../src/index.js';

const PUBLISHER = { id: 'adminium', name: 'Adminium' };
const DESCRIPTION = { key: 'x.description', fallback: 'A thing.' };

/** A pre-wave-4 app manifest: note the complete absence of `kind`. */
const LEGACY_APP = {
  manifestVersion: 1,
  key: 'printing',
  name: 'Print Shop',
  version: '1.0.0',
  publisher: PUBLISHER,
  license: 'MIT',
  description: DESCRIPTION,
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '1.0.0' },
  requiredSchema: { tables: [{ ref: 'jobs', columns: [{ ref: 'id', type: 'id', role: 'pk' }] }] },
  pages: [
    {
      ref: 'jobs',
      template: 'table',
      title: { key: 'x.jobs', fallback: 'Jobs' },
      nav: { group: 'Works', icon: 'printer', order: 1 },
    },
  ],
  frontend: { kind: 'spa' },
};

const DHL = {
  kind: 'add-on',
  manifestVersion: 1,
  key: 'shipping-dhl',
  name: 'DHL Shipping',
  version: '1.0.0',
  publisher: PUBLISHER,
  license: 'MIT',
  description: { key: 'x.dhl', fallback: 'Book a collection with a carrier.' },
  categories: ['delivery'],
  compatibility: { minAdminiumVersion: '1.0.0' },
  capabilities: ['outbound-http', 'file-storage'],
  settings: [
    { key: 'api_key', type: 'string', secret: true },
    { key: 'account_number', type: 'string', secret: true },
    { key: 'demo_transport', type: 'boolean', default: true },
    { key: 'collection_cutoff', type: 'string', default: '15:00' },
  ],
  requiredSchema: {
    tables: [{ ref: 'shipments', columns: [{ ref: 'id', type: 'id', role: 'pk' }] }],
  },
  addOn: {
    attaches: [{ app: 'printing', range: '^1.0.0' }],
    provides: [{ contract: 'shipping-carrier', version: 1, server: 'server/carrier.js' }],
    slots: [
      { slot: 'order.dispatch.actions', client: 'client/dispatch.js', order: 10 },
      { slot: 'checkout.delivery.methods', client: 'client/methods.js', order: 10 },
      { slot: 'order.dispatch.panel', client: 'client/panel.js', order: 10 },
    ],
    connect: { kind: 'api-key' },
    scopes: ['records:jobs:read', 'records:shipments:write', 'files:write'],
    network: { allow: ['api.example-carrier.test'] },
    publicSettings: ['demo_transport', 'collection_cutoff'],
    demoTransport: 'server/demo-carrier.js',
  },
};

describe('back-compatibility (acceptance criterion 9)', () => {
  it('validates a pre-wave-4 manifest that has no kind field', () => {
    const result = manifestSchema.safeParse(LEGACY_APP);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('fills kind in as "app" so downstream code can branch on it', () => {
    const parsed = manifestSchema.parse(LEGACY_APP);
    expect(parsed.kind).toBe('app');
    expect(isAddOnManifest(parsed)).toBe(false);
  });

  it('leaves manifestVersion at 1 — the additive field is not a breaking change', () => {
    expect(MANIFEST_VERSION).toBe(1);
    expect(manifestSchema.parse(LEGACY_APP).manifestVersion).toBe(1);
  });

  it('keeps BOTH pre-existing refinements alive on the app branch', () => {
    const contradictory = {
      ...LEGACY_APP,
      capabilities: ['hosted-only', 'offline-required'],
    };
    expect(manifestSchema.safeParse(contradictory).success).toBe(false);

    const badWindow = {
      ...LEGACY_APP,
      compatibility: { minAdminiumVersion: '2.0.0', maxAdminiumVersion: '1.5.0' },
    };
    expect(manifestSchema.safeParse(badWindow).success).toBe(false);
  });

  it('applies the same two refinements to the add-on branch as well', () => {
    const badWindow = {
      ...DHL,
      compatibility: { minAdminiumVersion: '2.0.0', maxAdminiumVersion: '1.5.0' },
    };
    expect(addOnManifestSchema.safeParse(badWindow).success).toBe(false);
  });
});

describe('the add-on branch', () => {
  it('accepts a well-formed add-on manifest', () => {
    const result = manifestSchema.safeParse(DHL);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('narrows on kind', () => {
    const parsed = manifestSchema.parse(DHL);
    expect(isAddOnManifest(parsed)).toBe(true);
    if (isAddOnManifest(parsed)) expect(parsed.addOn.connect.kind).toBe('api-key');
  });

  it('makes it IMPOSSIBLE for an add-on to declare pages or a frontend (§5.7)', () => {
    expect(addOnManifestSchema.safeParse({ ...DHL, pages: [] }).success).toBe(false);
    expect(addOnManifestSchema.safeParse({ ...DHL, frontend: { kind: 'spa' } }).success).toBe(false);
    expect(addOnManifestSchema.safeParse({ ...DHL, roles: [] }).success).toBe(false);
  });

  it('requires the addOn block', () => {
    const { addOn: _addOn, ...withoutBlock } = DHL;
    expect(addOnManifestSchema.safeParse(withoutBlock).success).toBe(false);
  });

  it('takes the add-on category vocabulary, not the app facet set', () => {
    expect(addOnManifestSchema.safeParse({ ...DHL, categories: ['delivery'] }).success).toBe(true);
    expect(addOnManifestSchema.safeParse({ ...DHL, categories: ['commerce'] }).success).toBe(false);
    // …and the app branch keeps refusing an add-on category.
    expect(appManifestSchema.safeParse({ ...LEGACY_APP, kind: 'app', categories: ['delivery'] }).success).toBe(
      false,
    );
  });
});

describe('the cross-block rules (§5.3)', () => {
  it('NETWORK_ALLOW_REQUIRED — outbound-http with no allow-list fails', () => {
    const { network: _network, ...addOn } = DHL.addOn;
    const result = validateManifest({ ...DHL, addOn });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'NETWORK_ALLOW_REQUIRED')).toBe(true);
    }
  });

  it('CAPABILITY_CONFLICT — an oauth2 connect without oauth-connect fails', () => {
    const result = validateManifest({
      ...DHL,
      capabilities: ['outbound-http', 'file-storage'],
      addOn: {
        ...DHL.addOn,
        connect: {
          kind: 'oauth2',
          authorizeUrl: 'https://vendor.example/authorize',
          tokenUrl: 'https://vendor.example/token',
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'CAPABILITY_CONFLICT')).toBe(true);
  });

  it('FRONTEND_SECRET_LEAK — a secret setting may never be public', () => {
    const result = validateManifest({
      ...DHL,
      addOn: { ...DHL.addOn, publicSettings: ['demo_transport', 'api_key'] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const leak = result.issues.find((i) => i.code === 'FRONTEND_SECRET_LEAK');
      expect(leak?.message).toContain('api_key');
    }
  });

  it('ATTACH_TARGET_UNKNOWN — only when the caller supplies the installed keys', () => {
    expect(validateManifest(DHL, { knownAppKeys: ['printing'] }).ok).toBe(true);

    const result = validateManifest(DHL, { knownAppKeys: ['ordering'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'ATTACH_TARGET_UNKNOWN')).toBe(true);
  });

  it('SCOPE_OUT_OF_RANGE — a scope may reach the host’s tables or its own, nothing else', () => {
    // `jobs` is the host's, `shipments` is the add-on's own.
    expect(validateManifest(DHL, { hostTables: ['jobs', 'materials'] }).ok).toBe(true);

    const overreach = {
      ...DHL,
      addOn: { ...DHL.addOn, scopes: ['records:customers_private:read'] },
    };
    const result = validateManifest(overreach, { hostTables: ['jobs', 'materials'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'SCOPE_OUT_OF_RANGE')).toBe(true);
  });

  it('holds the first-party publisher gate, which matters MORE for an add-on (D13)', () => {
    const stranger = { ...DHL, publisher: { id: 'stranger', name: 'Someone Else' } };
    const result = validateManifest(stranger);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === 'publisher.id')).toBe(true);
  });

  it('refuses a reserved key in the shared namespace (D17)', () => {
    for (const key of ['apps', 'add-ons', 'demo', 'search']) {
      expect(validateManifest({ ...DHL, key }).ok, key).toBe(false);
    }
  });
});
