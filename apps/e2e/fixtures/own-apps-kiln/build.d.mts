// SPDX-License-Identifier: AGPL-3.0-only
/** Types for `buildKiln`, as the specs import it. */
import type { Client } from './client.mjs';

export interface KilnBuilt {
  connectionId: string;
  engine: 'sqlite' | 'postgres' | 'mysql';
  /** Table ids by name (`main.members`, `public.members`, `<db>.members`). */
  tables: Record<'members' | 'classes' | 'firings' | 'pieces' | 'shop_orders', string>;
  rows: Record<string, (string | number | null)[]>;
  optionList: string;
  locale: string;
  endpointRef: string;
  /** Null when the build was asked to leave the add-on out. */
  addOn: { key: string; version: string } | null;
  documentProfileId: string | null;
  payableProfileId: string;
  client: Client;
}

export function buildKiln(options: {
  url: string;
  email: string;
  password: string;
  sessionFile?: string | null;
  setup?: boolean;
  replace?: boolean;
  db?: string;
  dsn?: string | null;
  engine?: string | null;
  /** The connection's name; Kiln Street Pottery when left out. */
  name?: string;
  /** False leaves out the Invoices & Receipts add-on and the document profile it draws (a server with no bundled add-ons). */
  addOn?: boolean;
}): Promise<KilnBuilt>;
