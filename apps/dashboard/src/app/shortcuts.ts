/**
 * Global keyboard manager (09-generated-app.md §5.3): components register
 * shortcut definitions; the shortcuts panel renders from the live
 * registration set — never a hardcoded list.
 *
 * - Vocabulary format: display keys like `['⌘','K']`, `['G','then','O']`,
 *   `['?']`, `['⌘','⇧','L']`. `⌘` binds (and renders) as `Ctrl` on non-mac
 *   platforms — the mapping is centralized here.
 * - G-chords are data-driven (`gChordTargets`): the first ≤8 nav items whose
 *   labels yield unique first letters (collision → next distinct letter).
 *   Chord window 1200 ms with a pending indicator callback ("G…").
 * - Typing-context suppression (comp keeper): inside
 *   `input/textarea/select/[contenteditable]` or during IME composition only
 *   the allowlist passes (`Esc`, `⌘Enter`, `⌘S`); browser-native combos in
 *   fields (`⌘A`/`⌘C`) are never intercepted.
 */

export const SHORTCUT_GROUPS = ['General', 'Navigation', 'Actions', 'View', 'Editing', 'Data'] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export interface ShortcutDef {
  /** Unique id, e.g. `palette`, `go-orders`. */
  id: string;
  group: ShortcutGroup;
  /** Already-translated label (t() at the registration site). */
  label: string;
  /** Display keys; `'then'` marks a chord separator. */
  keys: readonly string[];
  /** Extra gate evaluated at fire time. */
  when?: (() => boolean) | undefined;
  /**
   * Absent = display-only entry (bound elsewhere, e.g. `useCommandK`, Radix
   * Esc) that should still appear in the panel.
   */
  handler?: ((event: KeyboardEvent) => void) | undefined;
}

export const CHORD_WINDOW_MS = 1_200;

/** Keys allowed to fire while typing (comp keeper). */
const TYPING_ALLOWLIST = new Set(['escape', 'mod+enter', 'mod+s']);

export function isTypingContext(event: KeyboardEvent): boolean {
  if (event.isComposing) return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.closest('[contenteditable="true"]') !== null;
}

export function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform ?? '');
}

/** Localizes a display key for the current platform (`⌘` → `Ctrl`, …). */
export function displayKey(key: string, isMac: boolean): string {
  if (isMac) return key;
  if (key === '⌘') return 'Ctrl';
  if (key === '⌥') return 'Alt';
  if (key === '⇧') return 'Shift';
  return key;
}

interface ParsedShortcut {
  kind: 'combo' | 'chord';
  /** Normalized signature: `mod+shift+l`, `?`, or chord steps `['g','o']`. */
  signature: string;
  steps: readonly string[];
}

function normalizeKeyName(key: string): string {
  const lower = key.toLowerCase();
  if (lower === 'esc') return 'escape';
  if (lower === '⌫') return 'backspace';
  if (lower === '↵' || lower === 'enter') return 'enter';
  return lower;
}

/** Parses display keys into a matchable signature. Exported for tests. */
export function parseKeys(keys: readonly string[]): ParsedShortcut {
  if (keys.includes('then')) {
    const steps = keys.filter((key) => key !== 'then').map(normalizeKeyName);
    return { kind: 'chord', signature: steps.join(' '), steps };
  }
  const mods: string[] = [];
  let main = '';
  for (const key of keys) {
    if (key === '⌘') mods.push('mod');
    else if (key === '⇧') mods.push('shift');
    else if (key === '⌥') mods.push('alt');
    else main = normalizeKeyName(key);
  }
  const signature = [...mods, main].join('+');
  return { kind: 'combo', signature, steps: [signature] };
}

/** Normalized signature of a live KeyboardEvent (platform-mapped `mod`). */
export function eventSignature(event: KeyboardEvent, isMac: boolean): string {
  const mods: string[] = [];
  const primary = isMac ? event.metaKey : event.ctrlKey;
  if (primary) mods.push('mod');
  // `?` arrives as shift+/ — the event.key already carries the shifted char,
  // so shift only counts as a modifier for non-printable/letter keys.
  if (event.shiftKey && event.key.length > 1) mods.push('shift');
  if (event.shiftKey && /^[a-z]$/i.test(event.key)) mods.push('shift');
  if (event.altKey) mods.push('alt');
  return [...mods, normalizeKeyName(event.key)].join('+');
}

export interface ShortcutManager {
  /** Register a definition; returns the unregister function. */
  register(def: ShortcutDef): () => void;
  /** Feed a keydown; returns true when a shortcut consumed it. */
  handleKeydown(event: KeyboardEvent): boolean;
  /** Live registration set, grouped in canonical §5.3 order (for the panel). */
  list(): Array<{ group: ShortcutGroup; items: ShortcutDef[] }>;
  /** Chord-pending indicator ("G…"); `null` clears it. */
  onChordPending(listener: (pending: string | null) => void): () => void;
  readonly isMac: boolean;
}

export function createShortcutManager(
  options: { isMac?: boolean | undefined; chordWindowMs?: number | undefined } = {},
): ShortcutManager {
  const isMac = options.isMac ?? detectMac();
  const chordWindowMs = options.chordWindowMs ?? CHORD_WINDOW_MS;
  const defs = new Map<string, { def: ShortcutDef; parsed: ParsedShortcut }>();
  const chordListeners = new Set<(pending: string | null) => void>();

  let pendingChord: string | null = null;
  let chordTimer: ReturnType<typeof setTimeout> | null = null;

  const setPending = (value: string | null): void => {
    pendingChord = value;
    if (chordTimer !== null) {
      clearTimeout(chordTimer);
      chordTimer = null;
    }
    if (value !== null) {
      chordTimer = setTimeout(() => setPending(null), chordWindowMs);
    }
    for (const listener of chordListeners) listener(pendingChord);
  };

  const fire = (entry: { def: ShortcutDef }, event: KeyboardEvent): boolean => {
    if (entry.def.when !== undefined && !entry.def.when()) return false;
    if (entry.def.handler === undefined) return false;
    event.preventDefault();
    entry.def.handler(event);
    return true;
  };

  return {
    isMac,

    register(def) {
      defs.set(def.id, { def, parsed: parseKeys(def.keys) });
      return () => {
        defs.delete(def.id);
      };
    },

    handleKeydown(event) {
      const signature = eventSignature(event, isMac);
      const typing = isTypingContext(event);
      if (typing && !TYPING_ALLOWLIST.has(signature)) {
        setPending(null);
        return false;
      }
      // Never intercept browser-native combos inside fields (⌘A/⌘C/⌘V/⌘X).
      if (typing && /^mod\+[acvx]$/.test(signature)) return false;

      // Chord second step?
      if (pendingChord !== null && !typing) {
        const full = `${pendingChord} ${signature}`;
        setPending(null);
        for (const entry of defs.values()) {
          if (entry.parsed.kind === 'chord' && entry.parsed.signature === full && fire(entry, event)) {
            return true;
          }
        }
        return false;
      }

      // Plain combos.
      for (const entry of defs.values()) {
        if (entry.parsed.kind === 'combo' && entry.parsed.signature === signature && fire(entry, event)) {
          return true;
        }
      }

      // Chord openers (e.g. `g`) only outside typing contexts, unmodified.
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        for (const entry of defs.values()) {
          if (entry.parsed.kind === 'chord' && entry.parsed.steps[0] === signature) {
            event.preventDefault();
            setPending(signature);
            return true;
          }
        }
      }
      return false;
    },

    list() {
      const grouped = new Map<ShortcutGroup, ShortcutDef[]>();
      for (const { def } of defs.values()) {
        const items = grouped.get(def.group) ?? [];
        items.push(def);
        grouped.set(def.group, items);
      }
      return SHORTCUT_GROUPS.flatMap((group) => {
        const items = grouped.get(group);
        return items === undefined || items.length === 0 ? [] : [{ group, items }];
      });
    },

    onChordPending(listener) {
      chordListeners.add(listener);
      return () => {
        chordListeners.delete(listener);
      };
    },
  };
}

/**
 * Data-driven G-chord targets (§5.3): first ≤8 items whose labels yield
 * unique first letters; on collision the item takes its next distinct letter.
 */
export function gChordTargets<T extends { fallback: string }>(
  items: readonly T[],
): Array<{ item: T; letter: string }> {
  const taken = new Set<string>();
  const targets: Array<{ item: T; letter: string }> = [];
  for (const item of items) {
    if (targets.length >= 8) break;
    const letters = item.fallback.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
    let chosen: string | null = null;
    for (const letter of letters) {
      if (!taken.has(letter)) {
        chosen = letter;
        break;
      }
    }
    if (chosen === null) continue;
    taken.add(chosen);
    targets.push({ item, letter: chosen });
  }
  return targets;
}
