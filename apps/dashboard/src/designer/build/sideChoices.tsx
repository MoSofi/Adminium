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

export const RADIO_ROW = 'items-center gap-[9px] rounded-[8px] px-2.5 py-2 text-[13px] [&_svg]:size-[15px]';

export function SideRows({ sides }: { sides: readonly SideChoice[] }): ReactNode {
  return sides.map((entry) => (
    <DropdownMenuRadioItem key={entry.value} value={entry.value} className={RADIO_ROW}>
      <span className="flex items-center gap-[9px]">
        <span aria-hidden="true" className="flex text-fg-muted">
          {entry.icon}
        </span>
        {entry.label}
      </span>
    </DropdownMenuRadioItem>
  ));
}
