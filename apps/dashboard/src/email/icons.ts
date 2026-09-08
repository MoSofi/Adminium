// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email surfaces' private icon vocabulary, resolved through a LOCAL map of
 * static imports (the same rule `gen-icon-core.mjs` documents for the
 * page-builder's `BLOCK_ICONS`): the block registry, the inspector's section
 * headers, the twelve brand marks, the twelve starters and the social-chip
 * defaults all name their glyphs, and every route here is behind `React.lazy`.
 * Resolving those names through `lucideByName` would put them in the ENTRY
 * chunk's core set (measured: +0.7 KiB gz on every cold boot) or, for the 28
 * names the core does not carry, fetch lucide's whole catalogue on the first
 * editor open. This map keeps the modules in the email chunks and lets the
 * generator skip the `icon:` literals in the files listed under SWEEP_IGNORE.
 *
 * A name outside the map (a social chip whose icon a person typed) still
 * resolves through `lucideByName` and its lazy catalogue — the right cost for
 * a hand-picked glyph, never for boot.
 */
import {
  AlignLeft,
  AtSign,
  Award,
  Box,
  CalendarRange,
  CalendarX,
  ChartColumn,
  Circle,
  Code,
  Coins,
  Columns2,
  Command,
  CreditCard,
  Flame,
  Gem,
  Globe,
  Heading,
  Heart,
  Hexagon,
  History,
  Image,
  Leaf,
  LifeBuoy,
  List,
  Mail,
  MailCheck,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Minus,
  MousePointerClick,
  MoveVertical,
  Package,
  PanelBottom,
  Paperclip,
  PartyPopper,
  PencilRuler,
  Percent,
  Quote,
  Receipt,
  Repeat,
  RotateCcw,
  Scale,
  ScrollText,
  Share2,
  Sparkles,
  Square,
  SquareDashedBottomCode,
  Star,
  TicketPercent,
  Timer,
  Triangle,
  Truck,
  Type,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { lucideByName } from '../lib/lucide.js';

export const EMAIL_ICONS: Readonly<Record<string, LucideIcon>> = {
  // block registry (model/blocks.ts) + the unknown-kind glyph
  heading: Heading,
  'align-left': AlignLeft,
  'mouse-pointer-click': MousePointerClick,
  minus: Minus,
  'move-vertical': MoveVertical,
  'panel-bottom': PanelBottom,
  image: Image,
  'columns-2': Columns2,
  list: List,
  quote: Quote,
  'share-2': Share2,
  code: Code,
  'square-dashed-bottom-code': SquareDashedBottomCode,
  'chart-column': ChartColumn,
  package: Package,
  coins: Coins,
  percent: Percent,
  'ticket-percent': TicketPercent,
  history: History,
  repeat: Repeat,
  award: Award,
  truck: Truck,
  'scroll-text': ScrollText,
  scale: Scale,
  'rotate-ccw': RotateCcw,
  'life-buoy': LifeBuoy,
  square: Square,
  // the inspector's section headers (Editor.tsx)
  mail: Mail,
  type: Type,
  paperclip: Paperclip,
  'pencil-ruler': PencilRuler,
  // social-chip defaults
  globe: Globe,
  'message-circle': MessageCircle,
  'at-sign': AtSign,
  // the twelve starters (apps/server/src/email/starters.ts)
  'party-popper': PartyPopper,
  receipt: Receipt,
  timer: Timer,
  megaphone: Megaphone,
  'message-square': MessageSquare,
  'calendar-x': CalendarX,
  'calendar-range': CalendarRange,
  'mail-check': MailCheck,
  'credit-card': CreditCard,
  sparkles: Sparkles,
  // the twelve brand marks (BrandingPanel MARKS, the server's EMAIL_MARKS)
  hexagon: Hexagon,
  circle: Circle,
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

/** The email vocabulary first; anything else through the core set and lucide's lazy catalogue. */
export function emailIcon(name: string): LucideIcon {
  return EMAIL_ICONS[name] ?? lucideByName(name);
}
