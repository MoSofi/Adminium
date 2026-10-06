// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small add-on that keeps codes of three kinds, for the look-up: gift cards
 * whose code is stored with its `GC-` prefix, vouchers and packs kept in one
 * table whose code is stored bare (`VC-` and `PK-` only say which is meant),
 * and discount words typed in by an owner. A card may also be found by its
 * owner's address.
 */
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

export const VAULT_LOOK_UP = {
  kinds: [
    { id: 'gift-card', table: 'gift_cards', code: 'code', prefix: 'GC-', show: ['kind', 'status', 'balance', 'recipient_name', 'owner_email'], rows: { table: 'card_ledger', via: 'card_id', columns: ['kind', 'amount'] } },
    { id: 'pack', table: 'vouchers', code: 'code', prefix: 'PK-', where: [{ column: 'worth', eq: 'pack' }], show: ['worth', 'status', 'uses_left'], rows: { table: 'redemptions', via: 'voucher_id', columns: ['amount'] } },
    { id: 'voucher', table: 'vouchers', code: 'code', prefix: 'VC-', where: [{ column: 'worth', in: ['amount', 'percent'] }], show: ['worth', 'status'], rows: { table: 'redemptions', via: 'voucher_id', columns: ['amount'] } },
    { id: 'code', table: 'codes', code: 'code', show: ['active', 'max_uses'] },
  ],
  address: { table: 'gift_cards', column: 'owner_email', show: ['kind', 'status', 'balance', 'owner_email'] },
} as const;

export function vaultKitManifest(): Record<string, unknown> {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'vault',
    name: 'Vault kit',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'vault.description', fallback: 'Keeps codes.' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.3.18' },
    addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, hostApi: 1, lookUp: VAULT_LOOK_UP },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'gift_cards',
          columns: [
            pk,
            { ref: 'code', type: 'text', maxLength: 16, rules: { code: { length: 12, prefix: 'GC-' } } },
            { ref: 'kind', type: 'enum', enum: ['gift', 'credit'], default: 'gift' },
            { ref: 'status', type: 'enum', enum: ['active', 'spent'], default: 'active' },
            { ref: 'balance', type: 'decimal', scale: 2, default: 0 },
            { ref: 'recipient_name', type: 'text', maxLength: 80, nullable: true },
            { ref: 'owner_email', type: 'text', maxLength: 200, nullable: true, rules: { normalize: 'email' } },
          ],
        },
        { ref: 'card_ledger', columns: [pk, { ref: 'card_id', type: 'fk', references: 'gift_cards' }, { ref: 'kind', type: 'text', maxLength: 20 }, { ref: 'amount', type: 'decimal', scale: 2, default: 0 }] },
        {
          ref: 'vouchers',
          columns: [
            pk,
            { ref: 'code', type: 'text', maxLength: 16, rules: { code: { length: 12 } } },
            { ref: 'worth', type: 'enum', enum: ['amount', 'percent', 'pack'], default: 'amount' },
            { ref: 'status', type: 'enum', enum: ['active', 'used'], default: 'active' },
            { ref: 'uses_left', type: 'int', default: 1 },
          ],
        },
        { ref: 'redemptions', columns: [pk, { ref: 'voucher_id', type: 'fk', references: 'vouchers' }, { ref: 'amount', type: 'decimal', scale: 2, default: 0 }] },
        { ref: 'codes', columns: [pk, { ref: 'code', type: 'text', maxLength: 40, unique: true }, { ref: 'active', type: 'bool', default: true }, { ref: 'max_uses', type: 'int', nullable: true }] },
      ],
    },
  };
}
