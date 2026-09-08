// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card's thumbnail (comp 372-382): an accent banner with the mark tile
 * and a skeleton pill, the first heading, two skeleton lines and a mini CTA
 * in the document's accent. The mail body is ALWAYS LIGHT — literal white,
 * `#ececef`, `#17171c` — because it stands for the email as a mailbox shows
 * it, not for the dashboard's theme (39 Appendix A §M4).
 *
 * The accent is DATA, so it rides the sanctioned `--adm-email-accent` custom
 * property (D15) and the classes read it back; there is no `style` colour.
 */
import { Hexagon } from 'lucide-react';

import { emailIcon } from '../icons.js';

export interface MiniPreviewProps {
  accent: string;
  heading: string;
  dir: 'ltr' | 'rtl';
  /** A shipped mark name; `logo` (the workspace's own) falls back to the comp's hexagon here. */
  mark: string;
}

export function MiniPreview({ accent, heading, dir, mark }: MiniPreviewProps) {
  const Mark = mark === 'logo' || mark === '' ? Hexagon : emailIcon(mark);
  return (
    <div
      data-testid="email-mini-preview"
      className="overflow-hidden rounded-t-[9px] border border-[#ececef] bg-white"
      style={{ '--adm-email-accent': accent }}
    >
      <div className="flex h-[30px] items-center gap-[7px] bg-[linear-gradient(120deg,var(--adm-email-accent),color-mix(in_srgb,var(--adm-email-accent)_72%,transparent))] px-3">
        <div className="flex size-4 items-center justify-center rounded-[5px] bg-white/[.28] text-white">
          <Mark className="size-2.5" aria-hidden="true" />
        </div>
        <div className="h-[5px] w-11 rounded-[3px] bg-white/[.55]" />
      </div>
      <div dir={dir} className="flex flex-col gap-1.5 px-[13px] pb-[15px] pt-3">
        <div className="text-[11px] font-extrabold leading-[1.25] text-[#17171c]">{heading}</div>
        <div className="h-[3.5px] w-full rounded-sm bg-[#ececef]" />
        <div className="h-[3.5px] w-[82%] rounded-sm bg-[#ececef]" />
        <div className="mt-[5px] h-[13px] w-[54px] rounded-[4px] bg-[var(--adm-email-accent)]" />
      </div>
    </div>
  );
}
