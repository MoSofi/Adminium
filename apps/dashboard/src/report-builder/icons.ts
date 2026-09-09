// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report builder's private icon vocabulary, resolved through a LOCAL map
 * of static imports (the rule `gen-icon-core.mjs` documents, and the invoice
 * surface's `icons.ts`): the 25 block glyphs, the twelve starters, the
 * manager's tab and empty-state glyphs and the editor's chrome all name their
 * glyphs, and every route here is behind `React.lazy`. Resolving those names
 * through `lucideByName` would put them in the ENTRY chunk's core set or
 * fetch lucide's whole catalogue on the first editor open. This map keeps the
 * modules in the report-builder chunks and lets the generator skip the
 * `icon:` literals in the files listed under SWEEP_IGNORE.
 *
 * THREE OF THE COMP'S NAMES NO LONGER EXIST UNDER THOSE NAMES (43 §0.1.7).
 * lucide-react 0.525 renamed `bar-chart-3` → `ChartColumn`, `line-chart` →
 * `ChartLine` and `file-bar-chart-2` → `FileChartColumn`. The SLUGS stay the
 * comp's — they are data on a row (a starter's `icon`) and in
 * `BLOCK_KIND_META` — and the rename lives here, in the one place that maps
 * a slug to a component. Same glyphs, not a departure.
 */
import {
  AlarmClock,
  AlignLeft,
  ArrowLeft,
  Award,
  BadgeCheck,
  Briefcase,
  CalendarDays,
  ChartColumn,
  ChartLine,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Clock,
  Coins,
  Copy,
  FileChartColumn,
  FilePlus2,
  Files,
  FileText,
  Gauge,
  Gavel,
  GripVertical,
  Heading,
  HeartPulse,
  History,
  Image,
  Landmark,
  LayoutGrid,
  LayoutTemplate,
  LifeBuoy,
  List,
  Loader2,
  Mail,
  Megaphone,
  Minus,
  MousePointerClick,
  Paperclip,
  Pencil,
  PenLine,
  Percent,
  Phone,
  Plus,
  Presentation,
  QrCode,
  Redo2,
  Repeat,
  Rocket,
  RotateCcw,
  Save,
  Scale,
  ScrollText,
  Search,
  Send,
  ShieldAlert,
  SquareCheckBig,
  Table2,
  TextCursorInput,
  TicketPercent,
  Trash2,
  TrendingUp,
  Truck,
  Undo2,
  Upload,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';

import { lucideByName } from '../lib/lucide.js';

export const REPORT_ICONS: Readonly<Record<string, LucideIcon>> = {
  // the 25 block glyphs (model/blocks.ts BLOCK_KIND_META)
  heading: Heading,
  'align-left': AlignLeft,
  'layout-grid': LayoutGrid,
  // renamed in lucide 0.525 — the comp's slug, the current component.
  'bar-chart-3': ChartColumn,
  'trending-up': TrendingUp,
  'table-2': Table2,
  'pen-line': PenLine,
  'square-check-big': SquareCheckBig,
  paperclip: Paperclip,
  'badge-check': BadgeCheck,
  'qr-code': QrCode,
  'alarm-clock': AlarmClock,
  'scroll-text': ScrollText,
  coins: Coins,
  repeat: Repeat,
  'ticket-percent': TicketPercent,
  percent: Percent,
  history: History,
  scale: Scale,
  'rotate-ccw': RotateCcw,
  'life-buoy': LifeBuoy,
  award: Award,
  truck: Truck,
  image: Image,
  minus: Minus,
  // the twelve starters (apps/server/src/report-documents/starters.ts)
  briefcase: Briefcase,
  'calendar-days': CalendarDays,
  presentation: Presentation,
  megaphone: Megaphone,
  landmark: Landmark,
  // renamed in lucide 0.525.
  'line-chart': ChartLine,
  'heart-pulse': HeartPulse,
  rocket: Rocket,
  gavel: Gavel,
  'shield-alert': ShieldAlert,
  gauge: Gauge,
  // the blank document's fallback (comp `createBlank` 554, `starterIconFor` 697)
  'file-text': FileText,
  // renamed in lucide 0.525 — the editor's Report kind pill (679).
  'file-bar-chart-2': FileChartColumn,
  // the manager's tabs, empty states and modals
  'layout-template': LayoutTemplate,
  files: Files,
  'file-plus-2': FilePlus2,
  search: Search,
  list: List,
  // the block bodies' own glyphs (approval 326, contact 337, delivery 339)
  clock: Clock,
  'circle-x': CircleX,
  'user-round': UserRound,
  mail: Mail,
  phone: Phone,
  check: Check,
  // the editor's chrome (249-271, 305-313, 351)
  'arrow-left': ArrowLeft,
  'undo-2': Undo2,
  'redo-2': Redo2,
  save: Save,
  send: Send,
  'loader-2': Loader2,
  'circle-dot': CircleDot,
  'check-circle-2': CircleCheckBig,
  'grip-vertical': GripVertical,
  'chevron-up': ChevronUp,
  'chevron-down': ChevronDown,
  'trash-2': Trash2,
  pencil: Pencil,
  copy: Copy,
  'text-cursor-input': TextCursorInput,
  plus: Plus,
  upload: Upload,
  x: X,
  'mouse-pointer-click': MousePointerClick,
};

/** The report vocabulary first; anything else through the core set and lucide's lazy catalogue. */
export function reportIcon(name: string): LucideIcon {
  return REPORT_ICONS[name] ?? lucideByName(name);
}
