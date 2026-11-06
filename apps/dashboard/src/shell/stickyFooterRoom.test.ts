// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A bar stuck to the page's foot keeps the assistant's corner free.
 *
 * The bubble is fixed in the bottom inline-end corner, over the page, and every
 * wizard's footer puts its primary button in that same corner. In Arabic the
 * install wizard's Install was narrow enough for its middle to be under the
 * bubble, so a press landed on the bubble instead. No layout runs in a unit
 * test, so this holds the two ends of the fix to each other in the source:
 *
 * - the stylesheet's clearance is at least the bubble's inset, its size and a
 *   gap, all read from the bubble's own classes, and it is logical (inline-end);
 * - every bar fixed or stuck to the foot of a page carries the mark the rule
 *   keys on, unless it lives in a dialog, whose scrim is drawn over the bubble.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) out.push(path);
  }
  return out;
}

/** Bars at a foot that need no mark, each with its reason. */
const UNMARKED: Record<string, string> = {
  'studio/apps/QuickSaveDialog.tsx': 'in a dialog: its scrim is over the bubble',
  'designer/parts/pictures/PictureDialog.tsx': 'in a dialog: its scrim is over the bubble',
  'assistant/dock/PanelView.tsx': 'the assistant panel itself, drawn as a sheet while the bubble is gone',
};

/** A class list that fixes or sticks its element to the bottom edge. */
const AT_THE_FOOT = /['"`][^'"`]*\b(?:sticky|fixed)\b[^'"`]*\bbottom-0\b[^'"`]*['"`]/g;

const spacing = (classes: string, prefix: string): number => {
  const match = new RegExp(`(?:^|\\s)${prefix}-(\\d+(?:\\.\\d+)?)(?=\\s|$)`).exec(classes);
  if (match === null) throw new Error(`the bubble has no ${prefix}-* class`);
  return Number(match[1]);
};

describe('the assistant`s corner', () => {
  it('is kept free by at least the bubble`s inset, its size and a gap, on the inline end', () => {
    const bubble = readFileSync(join(SRC, 'shell', 'AssistantBubble.tsx'), 'utf8');
    const classes = /data-testid="assistant-bubble"[\s\S]*?className="([^"]+)"/.exec(bubble)?.[1] ?? '';
    expect(classes).toMatch(/\bfixed\b/);
    const inset = spacing(classes, 'end');
    expect(spacing(classes, 'bottom')).toBe(inset);
    const size = spacing(classes, 'size');

    const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
    const room = /--assistant-bubble-room:\s*calc\(var\(--spacing\)\s*\*\s*\(([\d.\s+]+)\)\);/.exec(css)?.[1];
    expect(room, 'the clearance is spacing units').toBeDefined();
    const units = room!.split('+').reduce((sum, part) => sum + Number(part.trim()), 0);
    // A gap of at least 8 px (2 units) between the button and the bubble.
    expect(units).toBeGreaterThanOrEqual(inset + size + 2);

    const rule = /:root\[data-assistant-bubble\]\s+\[data-sticky-footer\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/padding-inline-end:\s*var\(--assistant-bubble-room\)/);
    expect(rule).not.toMatch(/padding-(?:right|left)/);
    // Unlayered, so it wins over the bar's own px-*: the rule sits in no @layer block.
    expect(css.slice(0, css.indexOf(':root[data-assistant-bubble]'))).not.toMatch(/@layer\b[^;]*\{/);
  });

  it('is kept free by every bar at the foot of a page', () => {
    const offenders: string[] = [];
    const seen: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(AT_THE_FOOT)) {
        seen.push(rel);
        if (rel in UNMARKED) continue;
        // The mark is in the same opening tag, before the class list.
        const tag = text.slice(text.lastIndexOf('<', match.index), match.index);
        if (!tag.includes('data-sticky-footer')) offenders.push(`${rel}: ${match[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
    // The scan found the wizards' footers at all (a pattern that matched nothing would pass).
    for (const footer of ['studio/connect/ConnectWizard.tsx', 'studio/apps/SaveAppWizard.tsx', 'studio/apps/InstallAppWizard.tsx', 'studio/apps/workspaceFiles/WorkspaceFileInstall.tsx', 'add-ons/data-kit/layout.tsx']) {
      expect(seen).toContain(footer);
    }
    for (const rel of Object.keys(UNMARKED)) expect(seen, `${rel} is still a bar at a foot`).toContain(rel);
  });
});
