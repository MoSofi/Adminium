// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoice surfaces' private icon vocabulary, resolved through a LOCAL map
 * of static imports (the rule `gen-icon-core.mjs` documents, and the email
 * surface's `icons.ts`): the block registry, the inspector's section
 * headers, the twelve logo marks, the twelve starters, the five topics and
 * the four custom types all name their glyphs, and every route here is
 * behind `React.lazy`. Resolving those names through `lucideByName` would put
 * them in the ENTRY chunk's core set or fetch lucide's whole catalogue on the
 * first editor open. This map keeps the modules in the invoice chunks and
 * lets the generator skip the `icon:` literals in the files listed under
 * SWEEP_IGNORE.
 */
import {
  AlarmClock,
  AlignLeft,
  Award,
  BadgeCheck,
  Box,
  Briefcase,
  Building2,
  CalendarDays,
  Circle,
  Clock,
  Coins,
  Command,
  FileCheck2,
  FileMinus2,
  FileSignature,
  FileText,
  Files,
  Flag,
  Flame,
  Folder,
  Gem,
  Handshake,
  Heart,
  HeartHandshake,
  Hexagon,
  History,
  Image,
  Images,
  Landmark,
  Languages,
  LayoutTemplate,
  Leaf,
  LifeBuoy,
  List,
  MousePointerClick,
  Palette,
  Paperclip,
  PenLine,
  PencilRuler,
  Percent,
  PiggyBank,
  QrCode,
  Receipt,
  Repeat,
  RotateCcw,
  Scale,
  ScrollText,
  Shapes,
  Ship,
  Square,
  SquareCheckBig,
  Stamp,
  Star,
  StickyNote,
  Table2,
  TicketPercent,
  Triangle,
  Truck,
  UserRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { lucideByName } from '../lib/lucide.js';

export const INVOICE_ICONS: Readonly<Record<string, LucideIcon>> = {
  // the inspector's section headers (model/blocks.ts SECTION_ICONS) + the block glyphs
  'pencil-ruler': PencilRuler,
  palette: Palette,
  'building-2': Building2,
  'user-round': UserRound,
  'calendar-days': CalendarDays,
  list: List,
  percent: Percent,
  landmark: Landmark,
  'sticky-note': StickyNote,
  truck: Truck,
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
  history: History,
  scale: Scale,
  'rotate-ccw': RotateCcw,
  'life-buoy': LifeBuoy,
  award: Award,
  image: Image,
  shapes: Shapes,
  'mouse-pointer-click': MousePointerClick,
  // the four custom types (model/blocks.ts CUSTOM_TYPES)
  'align-left': AlignLeft,
  'table-2': Table2,
  images: Images,
  // the Images panel's slot glyphs (comp 1658)
  stamp: Stamp,
  // the twelve starters (apps/server/src/invoices/starters.ts)
  'file-text': FileText,
  receipt: Receipt,
  'file-check-2': FileCheck2,
  'file-minus-2': FileMinus2,
  'file-signature': FileSignature,
  'piggy-bank': PiggyBank,
  clock: Clock,
  flag: Flag,
  ship: Ship,
  'heart-handshake': HeartHandshake,
  handshake: Handshake,
  // the five topics + the uncategorised fallback (comp 1173-1182)
  briefcase: Briefcase,
  folder: Folder,
  // the manager's group-header and tab glyphs
  languages: Languages,
  'layout-template': LayoutTemplate,
  files: Files,
  // the twelve logo marks (comp 1580)
  hexagon: Hexagon,
  circle: Circle,
  square: Square,
  triangle: Triangle,
  gem: Gem,
  zap: Zap,
  flame: Flame,
  leaf: Leaf,
  star: Star,
  heart: Heart,
  command: Command,
  box: Box,
};

/** The invoice vocabulary first; anything else through the core set and lucide's lazy catalogue. */
export function invoiceIcon(name: string): LucideIcon {
  return INVOICE_ICONS[name] ?? lucideByName(name);
}
