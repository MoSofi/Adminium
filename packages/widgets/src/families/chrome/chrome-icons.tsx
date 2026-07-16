import {
  BarChart3,
  Check,
  Clock,
  Download,
  FileText,
  Home,
  Inbox,
  Layers,
  Plus,
  Search,
  Settings,
  Table,
  Users,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The `chrome` family's CLOSED glyph vocabulary (annex §11). Separated from
 * `chrome-lib.ts` so that module stays JSX-free and the registry-metadata graph
 * (`chrome-config.ts`) never pulls `lucide-react` into the eager chunk (04 §2.3).
 *
 * WHY A CLOSED MAP: nav rows, palette entries and search results carry an icon
 * NAME that came from the DATABASE or from a generated manifest. Resolving it
 * through a fixed map means a row can never make the app render an arbitrary
 * icon, and the family's lucide imports stay statically analysable.
 */

const CHROME_ICONS: Record<string, ReactNode> = {
  home: <Home />,
  table: <Table />,
  users: <Users />,
  settings: <Settings />,
  search: <Search />,
  inbox: <Inbox />,
  clock: <Clock />,
  chart: <BarChart3 />,
  download: <Download />,
  plus: <Plus />,
  file: <FileText />,
  layers: <Layers />,
  check: <Check />,
  zap: <Zap />,
};

/** Resolve a config/payload icon name to a glyph; unknown/absent names render nothing. */
export function chromeIcon(name: string | undefined): ReactNode | undefined {
  if (name === undefined) return undefined;
  return CHROME_ICONS[name];
}

/** Every id the closed vocabulary accepts — used by the family's tests. */
export const CHROME_ICON_NAMES: readonly string[] = Object.keys(CHROME_ICONS);
