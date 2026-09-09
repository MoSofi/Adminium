// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The status pill every card and row carries (comp 208, 227; `statusMeta`
 * 563). One pill, not the invoice manager's two — this comp has no language
 * chip because it has no language variations (43 §5 item 3).
 */
import { Badge } from '@adminium/ui';

import type { ReportStatus } from '../api.js';
import { STATUS_TONE, statusLabel } from './model.js';

export function DocumentStatusPill({ status }: { status: ReportStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-testid="report-status" data-status={status} className="shrink-0 px-[9px] text-[10px]">
      {statusLabel(status)}
    </Badge>
  );
}
