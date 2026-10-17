// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The glyph per issue severity (annex `validation-issues-list`). Apart from
 * `forms-icons.tsx`, whose other tables name some twenty icons: the issues
 * list is drawn by the import wizard on an app's own screen too, and should
 * bring three.
 */
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import type { IssueSeverity } from './forms-lib.js';

const SEVERITY_ICON: Record<IssueSeverity, ReactNode> = {
  info: <Info />,
  warn: <TriangleAlert />,
  error: <CircleAlert />,
};

export function severityIcon(severity: IssueSeverity): ReactNode {
  return SEVERITY_ICON[severity];
}
