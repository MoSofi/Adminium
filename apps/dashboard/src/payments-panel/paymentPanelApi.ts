// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's Payment panel, as the server answers it.
 *
 * Small on purpose: the record page imports this file to learn whether a
 * record has a Payment panel at all, and the panel itself (with its words)
 * loads only when it does.
 */
import { api } from '../app/api.js';

export interface PanelRecord {
  connectionId: string;
  table: string;
  recordId: string;
}

/** An invoice made on the Invoices page, whose payments Adminium keeps. */
export interface PanelDocument {
  documentId: string;
}

/** What a Payment panel is for: a table's record or a designer invoice. */
export type PanelTarget = PanelRecord | PanelDocument;

export interface PanelPayableRef {
  kind: 'shape' | 'profile' | 'document';
  /** Null for a designer invoice. */
  connectionId: string | null;
  tableName: string | null;
  rowKey: string;
}

export interface PanelPayment {
  id: string;
  number: string | null;
  amount: string;
  currency: string;
  refunded: string;
  way: string;
  wayLabel: string | null;
  provider: string | null;
  test: boolean;
  paidOn: string;
  recordedBy: string | null;
  cardLast4: string | null;
  /** The online payment behind it, which a refund is asked against; null when recorded by hand. */
  attemptId: string | null;
  /** What may still be refunded online, and why nothing may now. */
  refundable: string;
  refundRefusal: { code: string; message: string } | null;
  refunds: PanelRefund[];
  /** A dispute the service told of; its deadline and outcome are read in the service's dashboard. */
  dispute: { state: 'open' | 'closed'; at: number; closedAt: number | null } | null;
}

export type RefundState = 'requested' | 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled';

export interface PanelRefund {
  id: string;
  attemptId: string | null;
  amount: string;
  currency: string;
  state: RefundState;
  /** `staff`: asked in Adminium; `provider`: made in the service's own dashboard. */
  source: 'staff' | 'provider';
  /** The service's own words, when it failed. */
  failureMessage: string | null;
  createdAt: number;
  settledAt: number | null;
}

export interface PanelWaiting {
  id: string;
  provider: string;
  wayLabel: string | null;
  startedAt: number;
  test: boolean;
}

export interface PaymentPanelView {
  payable: PanelPayableRef;
  label: string;
  currency: string;
  total: string;
  due: string;
  paid: string;
  refusal: { code: string; message: string } | null;
  links: { on: boolean; reason: string | null };
  mayChange: boolean;
  mayRecord: boolean;
  /** May refund online payments (the refund permission, signed in). */
  mayRefund: boolean;
  waiting: PanelWaiting[];
  payments: PanelPayment[];
}

export interface PayLink {
  id: string;
  url: string;
  mode: 'test' | 'live';
  expiresAt: number;
  createdAt: number;
}

export const HAND_WAYS = ['bank-transfer', 'cash', 'card', 'cheque', 'other'] as const;
export type HandWay = (typeof HAND_WAYS)[number];

export type RecordPaymentInput = PanelTarget & {
  amount: string;
  way: HandWay;
  paidOn: string;
  note: string | null;
  approvalCode: string | null;
  last4: string | null;
  key: string;
};

/** Every Payment panel query hangs off this key; one invalidate refreshes them. */
export const paymentPanelKey = ['payment-panel'] as const;

export function panelQueryKey(record: PanelTarget) {
  return 'documentId' in record ? ([...paymentPanelKey, 'document', record.documentId] as const) : ([...paymentPanelKey, record.connectionId, record.table, record.recordId] as const);
}

export async function fetchPaymentPanel(record: PanelTarget): Promise<PaymentPanelView | null> {
  return (await api.post<{ data: PaymentPanelView | null }>('/api/v1/payments/panel', record)).data;
}

export async function recordPayment(input: RecordPaymentInput): Promise<{ key: string; already: boolean; due: string }> {
  return (await api.post<{ data: { key: string; already: boolean; due: string } }>('/api/v1/payments/record-payment', input)).data;
}

export async function fetchCurrentLink(payable: PanelPayableRef): Promise<PayLink | null> {
  return (await api.post<{ data: PayLink | null }>('/api/v1/payments/links/current', payable)).data;
}

export async function makeLink(payable: PanelPayableRef): Promise<{ link: PayLink; replaced: boolean }> {
  return (await api.post<{ data: { link: PayLink; replaced: boolean } }>('/api/v1/payments/links', payable)).data;
}

/** Emails a live pay link to the record's customer; answers where it went (queued, not yet delivered). */
export async function emailLink(id: string): Promise<{ to: string }> {
  return (await api.post<{ data: { queued: true; to: string } }>(`/api/v1/payments/links/${encodeURIComponent(id)}/email`)).data;
}

export async function revokeLink(id: string): Promise<void> {
  await api.post(`/api/v1/payments/links/${encodeURIComponent(id)}/revoke`);
}

