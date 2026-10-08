// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sides of an app as a menu offers them: one row each, with its icon and
 * a tick on the one being shown. Used by the side's own menu button and by
 * "More".
 */
import type { ReactNode } from 'react';
import { DropdownMenuRadioItem } from '@adminium/ui';

export interface SideChoice {
  value: string;
  label: string;
  icon: ReactNode;
}

export const RADIO_ROW = 'items-center gap-[9px] rounded-[8px] px-2.5 py-2 text-[13px] font-bold [&_svg]:size-[15px]';

/** `roomy`: the rows of "More", a pixel taller than a menu button's own. */
export function SideRows({ sides, roomy = false }: { sides: readonly SideChoice[]; roomy?: boolean }): ReactNode {
  return sides.map((entry) => (
    <DropdownMenuRadioItem key={entry.value} value={entry.value} className={roomy ? `${RADIO_ROW} py-[9px]` : RADIO_ROW}>
      <span className="flex items-center gap-[9px]">
        <span aria-hidden="true" className="flex text-fg-muted">
          {entry.icon}
        </span>
        {entry.label}
      </span>
    </DropdownMenuRadioItem>
  ));
}
