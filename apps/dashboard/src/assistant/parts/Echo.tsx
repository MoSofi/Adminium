// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What happened after a button was pressed, in one line.
 *
 * It is the only confirmation an action gets, so it names the THING — the
 * document that now exists, the address a test went to — rather than saying
 * "done". A person who pressed Save and saw "done" would still have to go and
 * look.
 *
 * `role="status"` because it appears after an action somebody took: a screen
 * reader should hear it without being moved to it.
 */
import { CheckCircle2 } from 'lucide-react';

export interface EchoProps {
  text: string;
}

export function Echo({ text }: EchoProps) {
  return (
    <div data-testid="assistant-echo" className="flex items-center gap-[11px] ps-[39px]">
      <span
        role="status"
        className="flex items-center gap-2 rounded-[11px] bg-pos-soft px-[13px] py-[9px] text-[12px] font-bold text-pos"
      >
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        {text}
      </span>
    </div>
  );
}
