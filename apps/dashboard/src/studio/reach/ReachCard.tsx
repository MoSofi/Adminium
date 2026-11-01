// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE REACH CARD: one card, two pages. "Can customers reach this server?"
 * on Payments and "Can visitors reach your public pages?" on Privacy & public
 * pages both answer from the server's one reachability check
 * (`apps/server/src/payments/reachability.ts`), so they share one shell: a
 * tone tile, the question, an optional "Checked …" line, the state's badge,
 * and the page's own sentences below. Each page keeps its own words; only
 * the shape is shared.
 *
 * Also the one-line strip the privacy tabs show while visitors can reach the
 * server: a check, "reachable at {origin}", and the badge.
 */
import { CircleCheckBig } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Card, CardBody, CardHeader, IconTile } from '@adminium/ui';

import type { ReachabilityState } from '../payments/paymentsApi.js';

export type ReachTone = 'pos' | 'warn' | 'danger' | 'neutral';

/** The tone of a state, the same on both pages: reachable is good; no address or a proxy is a warning. */
export function reachToneOf(state: ReachabilityState): ReachTone {
  if (state === 'reachable') return 'pos';
  if (state === 'network-off') return 'neutral';
  if (state === 'not-set' || state === 'proxy-hidden') return 'warn';
  return 'danger';
}

export interface ReachCardProps {
  state: ReachabilityState;
  tone: ReachTone;
  /** The tile's icon (Lucide, stroke 2). */
  icon: ReactNode;
  heading: string;
  /** "Checked just now", under the heading; none on a page that does not say. */
  caption?: string | undefined;
  badge: string;
  testId: string;
  /** The page's own sentences, buttons and notes. */
  children: ReactNode;
}

export function ReachCard({ state, tone, icon, heading, caption, badge, testId, children }: ReachCardProps): ReactNode {
  return (
    <Card data-testid={testId} data-state={state}>
      {/* With a "Checked …" line under the question, the tile and badge sit at its top (the privacy comp); without, centred (Payments). */}
      <CardHeader className={caption === undefined ? 'flex flex-wrap items-center gap-3' : 'flex flex-wrap items-start gap-3'}>
        <IconTile icon={icon} tone={tone} />
        <div className={caption === undefined ? 'min-w-0 flex-1' : 'min-w-[180px] flex-1'}>
          <h2 className="text-[14.5px] font-bold">{heading}</h2>
          {caption === undefined ? null : <p className="mt-0.5 text-[11.5px] text-fg-subtle">{caption}</p>}
        </div>
        <Badge tone={tone}>{badge}</Badge>
      </CardHeader>
      <CardBody className="flex flex-col gap-3 text-[13px]">{children}</CardBody>
    </Card>
  );
}

/** What a sentence's `{origin}` is given, so the origin can be set apart (mono, left to right) wherever a language puts it. */
export const ORIGIN_MARK = '\u0001';

/**
 * Reachable, in one line: what the privacy tabs show above their content
 * while nothing needs fixing. `sentence` holds {@link ORIGIN_MARK} where the
 * origin goes.
 */
export function ReachStrip({ heading, sentence, origin, badge, testId }: { heading: string; sentence: string; origin: string; badge: string; testId: string }): ReactNode {
  const at = sentence.indexOf(ORIGIN_MARK);
  const before = at < 0 ? sentence : sentence.slice(0, at);
  const after = at < 0 ? '' : sentence.slice(at + ORIGIN_MARK.length);
  return (
    <section aria-label={heading} data-testid={testId} data-state="reachable" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-[var(--card-pad)] py-3.5 shadow-sm">
      <CircleCheckBig aria-hidden className="size-[18px] shrink-0 text-pos" />
      <p className="min-w-[200px] flex-1 text-[13px] font-bold">
        {before}
        <span dir="ltr" className="font-mono text-[12.5px] font-bold">
          {origin}
        </span>
        {after}
      </p>
      <Badge tone="pos">{badge}</Badge>
    </section>
  );
}
