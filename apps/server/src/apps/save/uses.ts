// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What one part of a save tells a later one: the add-ons the parts it wrote
 * use. The documents and payments parts note each add-on their entries name;
 * the add-ons part reads the notes and writes `addOns` from them. Kept per
 * save (by its context), so two saves never share notes.
 */
import type { ConvertContext } from './types.js';

export interface AddOnUse {
  key: string;
  /** Only an optional part needs it: a document, a way to pay, a settings grant. */
  optional: boolean;
  /** What uses it, in plain words, for the reason the file gives. */
  what: string;
}

const notes = new WeakMap<ConvertContext, AddOnUse[]>();

export function noteAddOnUse(ctx: ConvertContext, use: AddOnUse): void {
  const list = notes.get(ctx) ?? [];
  list.push(use);
  notes.set(ctx, list);
}

export function addOnUsesOf(ctx: ConvertContext): readonly AddOnUse[] {
  return notes.get(ctx) ?? [];
}

/** A column's name as a ref, or null when it is not snake_case (the tables part names it otherwise). */
export function columnRef(name: unknown): string | null {
  return typeof name === 'string' && /^[a-z][a-z0-9_]*$/.test(name) ? name : null;
}

/** A source table id (`public.orders`) or real name → its ref in the file, or null. */
export function tableRefOf(ctx: ConvertContext, table: unknown): string | null {
  if (typeof table !== 'string' || table === '') return null;
  return ctx.refs.table(table) ?? ctx.refs.tableByName(table);
}
