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

export interface PanelPayableRef {
  kind: 'shape' | 'profile';
  connectionId: string;
  tableName: string;
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

export interface RecordPaymentInput extends PanelRecord {
  amount: string;
  way: HandWay;
  paidOn: string;
  note: string | null;
  approvalCode: string | null;
  last4: string | null;
  key: string;
}

/** Every Payment panel query hangs off this key; one invalidate refreshes them. */
export const paymentPanelKey = ['payment-panel'] as const;

export function panelQueryKey(record: PanelRecord) {
  return [...paymentPanelKey, record.connectionId, record.table, record.recordId] as const;
}

export async function fetchPaymentPanel(record: PanelRecord): Promise<PaymentPanelView | null> {
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
