// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's private icon vocabulary, resolved through a LOCAL map of
 * static imports (the rule `gen-icon-core.mjs` documents, and the email and
 * invoice surfaces' `icons.ts`).
 *
 * WHY NOT `lucideByName`. Every `icon:` literal a shared resolver sees lands
 * in the ENTRY chunk's core icon set — or, worse, fetches lucide's whole
 * catalogue on the first open. This surface is behind a `lazy()` import from
 * three lazy routes, so its glyphs belong in its own chunk. The files that
 * hold the literals are listed in `SWEEP_IGNORE` so the generator skips them.
 *
 * WHY A NAME CAN COME FROM THE MODEL. A step row's icon is whatever the model
 * put on it. It is decoration, and a name nobody drew is not worth a refusal —
 * so {@link stepIcon} falls back to `search` rather than rendering nothing or
 * throwing. The closed list below is what the model is offered; anything else
 * simply lands on the fallback.
 *
 * WHAT IS *NOT* HERE, AND WHY. The shell's own glyphs — the sparkle on the
 * bubble, the lock on a disabled action, the arrow on the send button — are
 * imported DIRECTLY by the component that draws them, because nothing ever
 * names them at runtime. This map is for names that arrive as data: the
 * model's step icons, and the per-page chips, actions and page glyph in
 * `contexts.ts`. A glyph in both places would be a lucide import in this
 * chunk that no code path can reach.
 */
import {
  AlarmClock,
  BarChart3,
  Bell,
  Building2,
  Calculator,
  Clock,
  CreditCard,
  Database,
  Euro,
  Eye,
  FilePlus,
  FileSearch,
  FileText,
  GitBranch,
  Hourglass,
  Landmark,
  Languages,
  Layers,
  LayoutTemplate,
  Mail,
  Palette,
  PenLine,
  PenTool,
  Play,
  Receipt,
  Save,
  Search,
  Send,
  Shapes,
  ShieldCheck,
  Table2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';

/**
 * Every glyph this surface can draw FROM A NAME — 32 of them. The shell's own
 * glyphs are not here: see the note at the top of the file.
 */
export const ASSISTANT_ICONS: Readonly<Record<string, LucideIcon>> = {
  // the step icons the model may name
  database: Database,
  'file-search': FileSearch,
  shapes: Shapes,
  'pen-line': PenLine,
  'shield-check': ShieldCheck,
  landmark: Landmark,
  'layout-template': LayoutTemplate,
  'building-2': Building2,
  clock: Clock,
  layers: Layers,
  'git-branch': GitBranch,
  'table-2': Table2,
  search: Search,
  calculator: Calculator,
  // the page a session was opened from
  mail: Mail,
  'file-text': FileText,
  receipt: Receipt,
  'bar-chart-3': BarChart3,
  // the suggestion chips
  'credit-card': CreditCard,
  hourglass: Hourglass,
  languages: Languages,
  euro: Euro,
  'alarm-clock': AlarmClock,
  palette: Palette,
  'file-plus': FilePlus,
  bell: Bell,
  'wand-2': Wand2,
  // the result card's actions
  send: Send,
  'pen-tool': PenTool,
  save: Save,
  eye: Eye,
  play: Play,
};

/**
 * The closed list a step row may draw. The model is shown these names; one
 * outside the list is decoration nobody drew, so it lands on the fallback.
 */
export const ASSISTANT_STEP_ICONS: readonly string[] = [
  'file-search',
  'shapes',
  'pen-line',
  'shield-check',
  'landmark',
  'layout-template',
  'building-2',
  'clock',
  'layers',
  'database',
  'git-branch',
  'table-2',
  'search',
  'calculator',
];

const FALLBACK: LucideIcon = Search;

/** A glyph by name, or `null` — for slots where drawing nothing is correct. */
export function assistantIcon(name: string | null | undefined): LucideIcon | null {
  if (name === null || name === undefined) return null;
  return ASSISTANT_ICONS[name] ?? null;
}

/** A step row's glyph: the model's name, or `search` when it named one nobody drew. */
export function stepIcon(name: string): LucideIcon {
  return ASSISTANT_ICONS[name] ?? FALLBACK;
}
