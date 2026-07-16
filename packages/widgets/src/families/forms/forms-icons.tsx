import {
  Bell,
  CircleAlert,
  Database,
  FileText,
  Info,
  Mail,
  Shield,
  Table,
  TriangleAlert,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { DEFAULT_SEVERITY_TONE, ISSUE_SEVERITIES } from './forms-lib.js';
import type { IssueSeverity } from './forms-lib.js';

/**
 * The `forms` family's CLOSED glyph vocabulary (annex §10). Separated from
 * `forms-lib.ts` so that module stays JSX-free and the registry-metadata graph
 * (`forms-config.ts`) never pulls `lucide-react` into the eager chunk (04 §2.3).
 *
 * WHY A CLOSED MAP: option cards, toggle rows and issue rows carry an icon NAME
 * from config or from a payload row. Resolving through a fixed map means neither
 * can make the app render an arbitrary icon.
 */

const FORM_ICONS: Record<string, ReactNode> = {
  database: <Database />,
  file: <FileText />,
  upload: <Upload />,
  table: <Table />,
  users: <Users />,
  mail: <Mail />,
  bell: <Bell />,
  zap: <Zap />,
  shield: <Shield />,
  info: <Info />,
  warning: <TriangleAlert />,
  alert: <CircleAlert />,
};

/** Resolve a config/payload icon name to a glyph; unknown/absent names render nothing. */
export function formIcon(name: string | undefined): ReactNode | undefined {
  if (name === undefined) return undefined;
  return FORM_ICONS[name];
}

/** The default glyph per issue severity (annex §10 `validation-issues-list`). */
const SEVERITY_ICON: Record<IssueSeverity, ReactNode> = {
  info: <Info />,
  warn: <TriangleAlert />,
  error: <CircleAlert />,
};

export function severityIcon(severity: IssueSeverity): ReactNode {
  return SEVERITY_ICON[severity];
}

/** Every id the closed vocabulary accepts — used by the family's tests. */
export const FORM_ICON_NAMES: readonly string[] = Object.keys(FORM_ICONS);

export { DEFAULT_SEVERITY_TONE, ISSUE_SEVERITIES };
