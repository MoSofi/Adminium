// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Why a payment cannot be refunded now, in the reader's language: the
 * server's refusal codes (`payments/refunds.ts`) and the one the panel knows
 * by itself — a payment recorded by hand goes back by hand.
 */
import { t } from '../i18n/t.js';
import { serviceName } from './serviceName.js';

export function refusalWords(code: string, provider: string | null, fallback: string): string {
  switch (code) {
    case 'BY_HAND':
      return t('payments:panel.why.offline', 'This way to pay cannot be refunded online. Refund the customer by hand.');
    case 'PROCESSING':
      return t('payments:panel.why.pending', 'This payment is still waiting for the bank.');
    case 'FULLY_REFUNDED':
      return t('payments:panel.why.full', 'This payment is fully refunded.');
    case 'DISPUTED':
      return t('payments:panel.why.disputed', 'This payment is disputed. Answer the dispute in the {service} dashboard first.', { service: provider === null ? '' : serviceName(provider) });
    case 'NOT_TAKEN':
      return t('payments:panel.why.notTaken', 'No money was taken for this payment.');
    default:
      return fallback;
  }
}
