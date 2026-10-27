// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's e-mail consent over the dashboard's own session
 * (`app/api.ts`): the panel, "Record consent", "Replied" and "They said no".
 *
 * Small on purpose: the record page imports this file to learn whether a
 * record's table holds people at all, and the panel itself (with its words)
 * loads only when it does.
 */
import { api } from '../app/api.js';
import type { ConsentClient, ConsentEventView, ConsentPanelView, ConsentRecordRef } from './consentTypes.js';

export type { ConsentClient, ConsentPanelView, ConsentRecordRef } from './consentTypes.js';

export const consentPanelKey = ['consent-panel'] as const;

export function consentQueryKey(record: ConsentRecordRef) {
  return [...consentPanelKey, record.connectionId, record.table, record.recordId] as const;
}

/** The dashboard's client: its own session, CSRF and error envelope (`app/api.ts`). */
export const dashboardConsentClient: ConsentClient = {
  panel: async (record) => (await api.post<{ data: ConsentPanelView }>('/api/v1/consent/panel', record)).data,
  recordConsent: async (record, input) => (await api.post<{ data: { event: ConsentEventView } }>('/api/v1/consent/record-consent', { ...record, ...input })).data.event,
  replied: async (record) => (await api.post<{ data: { event: ConsentEventView } }>('/api/v1/consent/replied', record)).data.event,
  saidNo: async (record) => (await api.post<{ data: { added: boolean } }>('/api/v1/consent/said-no', record)).data,
};
