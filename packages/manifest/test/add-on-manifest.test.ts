// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `kind: "add-on"` branch and — just as important — the proof that adding
 * it broke nothing: a manifest written before wave 4 carries no `kind` field
 * at all and must still validate, with `manifestVersion` still 1 (acceptance
 * criterion 9).
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
  frontends: [{ side: 'customer', kind: 'spa' }],
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

  it('makes it IMPOSSIBLE for an add-on to declare pages or a frontend', () => {
    expect(addOnManifestSchema.safeParse({ ...DHL, pages: [] }).success).toBe(false);
    expect(
      addOnManifestSchema.safeParse({ ...DHL, frontends: [{ side: 'customer', kind: 'spa' }] }).success,
    ).toBe(false);
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

describe('the cross-block rules', () => {
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

  it('refuses `dashboard`, which is the stock deployment\'s own host key', () => {
    // Not a route collision like the others — `dashboard` is what an add-on
    // declaring `attaches: [{app: '*'}]` is attached UNDER on a deployment
    // with no host app, so the consent dialog has something to enable. An app
    // also called `dashboard` would make that attachment ambiguous.
    expect(validateManifest({ ...DHL, key: 'dashboard' }).ok).toBe(false);
  });

  it('accepts a setting that carries help under the field, and still refuses an unknown one', () => {
    // Every settings variant is `.strict()`, so before this rode the release
    // a manifest writing `help` was REJECTED rather than ignored — which is
    // why it lands with `RESERVED_KEYS` and not with the form that renders it.
    const withHelp = {
      ...DHL,
      settings: [
        {
          key: 'paper',
          type: 'enum',
          enum: ['a4', 'letter'],
          label: { key: 'x.paper', fallback: 'Paper' },
          help: { key: 'x.paper.help', fallback: 'The size the document is drawn for.' },
        },
      ],
    };
    expect(validateManifest(withHelp).ok, JSON.stringify(validateManifest(withHelp))).toBe(true);

    const withNonsense = {
      ...withHelp,
      settings: [{ ...withHelp.settings[0], hint: 'not a field' }],
    };
    expect(validateManifest(withNonsense).ok).toBe(false);
  });
});

/**
 * 51a — an add-on may own dashboard pages. These run through the whole
 * envelope, not just the `addOn` block, because that is where the promise
 * lives: the branch is `.strict()`, so a field the union does not know about is
 * a refusal rather than a shrug.
 */
describe('add-on pages (51a)', () => {
  const INVOICES = {
    ...DHL,
    addOn: {
      ...DHL.addOn,
      hostApi: 1,
      pages: [
        {
          ref: 'documents',
          title: { key: 'addon.invoices.nav', fallback: 'Invoices' },
          icon: 'file-text',
          client: 'dist/pages/invoices.js',
          nav: { group: 'library', order: 20, adminOnly: true },
          detail: true,
        },
      ],
    },
  };

  it('validates a manifest whose add-on declares a page', () => {
    const result = validateManifest(INVOICES);
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it('still refuses a top-level `pages` row on the add-on branch', () => {
    // An add-on's pages are CODE, under `addOn.pages`. A generated page —
    // `template` + `bindings` — remains something only an app can install, and
    // the strict branch is what keeps the two from blurring.
    const result = validateManifest({
      ...INVOICES,
      pages: [{ ref: 'x', template: 'table', title: DESCRIPTION, nav: { group: 'library', icon: 'x', order: 1 } }],
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a page naming a group that is neither built in nor declared', () => {
    const result = validateManifest({
      ...INVOICES,
      addOn: {
        ...INVOICES.addOn,
        pages: [{ ...INVOICES.addOn.pages[0], nav: { group: 'documents', order: 1 } }],
      },
    });
    // The refusal comes from the block schema, so it arrives as a schema issue
    // carrying the sentence rather than a code — see the note where the
    // cross-block rules deliberately do NOT re-check this.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((i) => i.message.includes('neither built in nor declared')),
        JSON.stringify(result.issues),
      ).toBe(true);
    }
  });

  it('validates the same page once the add-on declares the group it names', () => {
    const result = validateManifest({
      ...INVOICES,
      addOn: {
        ...INVOICES.addOn,
        pages: [{ ...INVOICES.addOn.pages[0], nav: { group: 'documents', order: 1 } }],
        navGroups: [
          { key: 'documents', label: { key: 'addon.invoices.group', fallback: 'Documents' }, order: 10 },
        ],
      },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});
