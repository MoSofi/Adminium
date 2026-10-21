// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The refund dialog's transport, apart from `paymentPanelApi.ts`: the record
 * page imports that file to learn whether a record has a Payment panel, and
 * this only ever loads with the panel or the dialog.
 */
import { api } from '../app/api.js';
import type { PanelRefund } from './paymentPanelApi.js';

/** What the refund dialog needs: what may still be refunded, where it goes back to, or why it cannot be now. */
export interface RefundPreview {
  label: string;
  provider: string;
  test: boolean;
  taken: string;
  currency: string;
  refundable: string;
  paidWith: string | null;
  refusal: { code: string; message: string } | null;
}

export const REFUND_REASONS = ['requested_by_customer', 'duplicate', 'fraudulent', 'other'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export interface RefundInput {
  attemptId: string;
  amount: string;
  reason: RefundReason;
  note: string | null;
  /** Minted at the confirm step: the same key again is the same refund. */
  key: string;
}

export async function fetchRefundPreview(attemptId: string): Promise<RefundPreview> {
  return (await api.get<{ data: RefundPreview }>(`/api/v1/payments/attempts/${encodeURIComponent(attemptId)}/refund`)).data;
}

export async function requestRefund(input: RefundInput): Promise<{ refund: PanelRefund; fresh: boolean }> {
  return (await api.post<{ data: { refund: PanelRefund; fresh: boolean } }>('/api/v1/payments/refunds', input)).data;
}
