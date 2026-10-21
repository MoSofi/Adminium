// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The door the add-on host API publishes for a designer invoice's Payment
 * panel. The panel, its dialogs and its words load the first time one
 * mounts (the record page's own panel chunk), so a page that never shows one
 * never pays for it.
 */
import { lazy, Suspense, type ReactNode } from 'react';

import type { DocumentPaymentPanelProps } from './PaymentPanel.js';

const Panel = lazy(async () => ({ default: (await import('./PaymentPanel.js')).DocumentPaymentPanel }));

export function DocumentPaymentPanel(props: DocumentPaymentPanelProps): ReactNode {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}
