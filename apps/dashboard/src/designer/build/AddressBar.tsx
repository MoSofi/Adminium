// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The address of the page the preview is on: the side's key, a rule, and the
 * path, always written left to right. It fills what the work bar has left and
 * is never narrower than 180.
 */
import type { ReactNode } from 'react';

import { t } from '../../i18n/t.js';
import { shownPath } from './pagePath.js';
import type { PreviewSide } from './usePreview.js';

export function addressLabel(side: PreviewSide): string {
  switch (side) {
    case 'dashboard':
      return t('designer:preview.addressDashboard', 'Address on the dashboard side');
    case 'staff':
      return t('designer:preview.addressStaff', 'Address on the staff side');
    case 'customer':
      return t('designer:preview.addressCustomer', 'Address on the customer side');
  }
}

export const ADDRESS_BOX = 'relative flex h-8 min-w-[180px] flex-[1_1_180px] items-center gap-[7px] rounded-[9px] border border-border bg-surface-2 px-2.5 focus-within:border-transparent focus-within:ring-1 focus-within:ring-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]';
export const ADDRESS_INPUT = 'h-full min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px font-mono text-[12.5px] font-medium text-fg outline-none';

export function AddressBar({ side, path, measuring = false }: { side: PreviewSide; path: string; /** The copy that is only measured: a box with no name. */ measuring?: boolean }): ReactNode {
  return (
    <div dir="ltr" className={ADDRESS_BOX}>
      {/* The side's own key, as an address has it: not a word to translate. */}
      <span className="shrink-0 font-mono text-[11px] font-semibold text-fg-subtle">{side}</span>
      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border-strong" />
      <input readOnly tabIndex={measuring ? -1 : undefined} aria-label={measuring ? undefined : addressLabel(side)} value={shownPath(path)} spellCheck={false} autoComplete="off" className={ADDRESS_INPUT} />
    </div>
  );
}
