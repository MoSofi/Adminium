// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The keys page's closed vocabularies, as literal `studio:` keys with their
 * inline fallbacks (the deferred-namespace rule: every key literal, every
 * fallback byte-identical to en-US). One exhaustive map per vocabulary, so a
 * new method or operator cannot be added without its words.
 */
import { ArrowDownToLine, Layers, Pencil, Plus, Repeat, Trash2, type LucideIcon } from 'lucide-react';

import type { Method } from './apiKeysApi.js';

export interface Copy {
  key: string;
  fallback: string;
}

/**
 * Three descriptions say what the verb really does here: one row per POST,
 * PATCH and DELETE by primary key. GET, PUT and BATCH are the comp's words.
 */
export const METHOD_COPY: Readonly<Record<Method, { title: Copy; desc: Copy; icon: LucideIcon }>> = {
  GET: {
    title: { key: 'studio:apiKeys.method.GET.title', fallback: 'Read' },
    desc: { key: 'studio:apiKeys.method.GET.desc', fallback: 'List rows and fetch a single record' },
    icon: ArrowDownToLine,
  },
  POST: {
    title: { key: 'studio:apiKeys.method.POST.title', fallback: 'Create' },
    desc: { key: 'studio:apiKeys.method.POST.desc', fallback: 'Insert a new row' },
    icon: Plus,
  },
  PATCH: {
    title: { key: 'studio:apiKeys.method.PATCH.title', fallback: 'Update' },
    desc: { key: 'studio:apiKeys.method.PATCH.desc', fallback: 'Partial update of a row by primary key' },
    icon: Pencil,
  },
  PUT: {
    title: { key: 'studio:apiKeys.method.PUT.title', fallback: 'Replace' },
    desc: { key: 'studio:apiKeys.method.PUT.desc', fallback: 'Replace a full row by primary key' },
    icon: Repeat,
  },
  DELETE: {
    title: { key: 'studio:apiKeys.method.DELETE.title', fallback: 'Delete' },
    desc: { key: 'studio:apiKeys.method.DELETE.desc', fallback: 'Remove a row by primary key' },
    icon: Trash2,
  },
  BATCH: {
    title: { key: 'studio:apiKeys.method.BATCH.title', fallback: 'Batch' },
    desc: { key: 'studio:apiKeys.method.BATCH.desc', fallback: 'Bulk insert or upsert, up to 500 rows' },
    icon: Layers,
  },
};

/** The filter grammar's operators: the comp's five labels where the operator exists. */
export const OP_COPY: Readonly<Record<string, Copy>> = {
  eq: { key: 'studio:apiKeys.builder.op.eq', fallback: 'equals' },
  neq: { key: 'studio:apiKeys.builder.op.neq', fallback: 'not equals' },
  gt: { key: 'studio:apiKeys.builder.op.gt', fallback: 'greater than' },
  gte: { key: 'studio:apiKeys.builder.op.gte', fallback: 'at least' },
  lt: { key: 'studio:apiKeys.builder.op.lt', fallback: 'less than' },
  lte: { key: 'studio:apiKeys.builder.op.lte', fallback: 'at most' },
  in: { key: 'studio:apiKeys.builder.op.in', fallback: 'in list' },
  like: { key: 'studio:apiKeys.builder.op.like', fallback: 'contains' },
  ilike: { key: 'studio:apiKeys.builder.op.ilike', fallback: 'contains (any case)' },
  is_null: { key: 'studio:apiKeys.builder.op.is_null', fallback: 'is empty' },
  not_null: { key: 'studio:apiKeys.builder.op.not_null', fallback: 'is not empty' },
  between: { key: 'studio:apiKeys.builder.op.between', fallback: 'between' },
};

/**
 * The comp's five, "is" split in two, and any other operator only when the
 * loaded document already uses it.
 */
export const DRAWN_OPS: readonly string[] = ['eq', 'neq', 'gt', 'lt', 'in', 'is_null', 'not_null'];

/** Operators that take no value. */
export const VALUELESS_OPS: ReadonlySet<string> = new Set(['is_null', 'not_null']);

export type AuthRole = 'anon' | 'authenticated' | 'service_role';

/** Verbatim labels; the chips print the raw value. */
export const AUTH_COPY: Readonly<Record<AuthRole, Copy>> = {
  anon: { key: 'studio:apiKeys.builder.auth.anon', fallback: 'Anon' },
  authenticated: { key: 'studio:apiKeys.builder.auth.authenticated', fallback: 'Authenticated' },
  service_role: { key: 'studio:apiKeys.builder.auth.service', fallback: 'Service role' },
};

/** The auth chip's tone per role. */
export const AUTH_TONE: Readonly<Record<AuthRole, string>> = {
  anon: 'bg-pos-soft text-pos',
  authenticated: 'bg-info-soft text-info',
  service_role: 'bg-warn-soft text-warn',
};
