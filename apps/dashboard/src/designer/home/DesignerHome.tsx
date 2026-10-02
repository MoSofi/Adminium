// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Designer Home (D1). Built in full by the next task; this is its frame.
 */
import type { ReactNode } from 'react';

import { t } from '../../i18n/t.js';

export function DesignerHome(): ReactNode {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg p-6 text-fg">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('designer:brand', 'Adminium Designer')}</h1>
    </main>
  );
}
