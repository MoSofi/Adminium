// SPDX-License-Identifier: AGPL-3.0-only
import { t } from '../i18n/t.js';

/** The service's name, as its own mark (never translated). */
export function serviceName(provider: string): string {
  if (provider === 'payments-stripe') return 'Stripe';
  if (provider === 'payments-paypal') return 'PayPal';
  if (provider === 'demo') return t('payments:panel.demoService', 'the demo service');
  return provider.replace(/^payments-/, '');
}
