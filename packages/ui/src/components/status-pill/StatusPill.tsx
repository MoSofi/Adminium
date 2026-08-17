// SPDX-License-Identifier: AGPL-3.0-only
import type * as React from 'react';

import { Badge } from '../badge/Badge.js';
import type { BadgeProps, Tone } from '../badge/Badge.js';
import { statusTone } from '../../lib/tones.js';

// The status→tone registry lives in lib/tones.ts (03-component-library.md
// §7.6) — ONE registry instance package-wide, so a `registerStatusTones`
// caller and every consumer resolve through the same map. Re-exported here
// because this module was the barrel's historical source.
export { DEFAULT_STATUS_TONES, registerStatusTones, statusTone } from '../../lib/tones.js';

export interface StatusPillProps extends Omit<BadgeProps, 'tone' | 'dot' | 'asChild'> {
  /** Status key resolved through the status→tone registry (`statusTone`). */
  status: string;
  /** Explicit tone override — skips the registry lookup. */
  tone?: Tone;
  /** Tone used when the status is not in the registry. Default `neutral`. */
  fallbackTone?: Tone;
  /** Localized label. Defaults to the raw status key (developer fallback). */
  children?: React.ReactNode;
}

/**
 * Badge preset with a status dot; tone driven by the semantic status→tone
 * registry (research/design-system.md §3 Tier 1).
 */
export function StatusPill({ status, tone, fallbackTone = 'neutral', children, ...props }: StatusPillProps) {
  return (
    <Badge tone={tone ?? statusTone(status, fallbackTone)} dot data-status={status} {...props}>
      {children ?? status}
    </Badge>
  );
}
