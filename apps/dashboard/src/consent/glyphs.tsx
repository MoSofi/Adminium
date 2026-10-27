// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The consent panel's glyphs, drawn here from lucide's own shapes (lucide,
 * ISC licence: the same 24 px box, 2 px stroke, round caps and joins) rather
 * than imported from lucide-react.
 *
 * Why: the panel is also a part an app's own screen mounts (the kit), built
 * in the same build as the dashboard. Every module the kit's part shares with
 * the dashboard's first load is split out of that load into a chunk of its
 * own, which costs every page a little; lucide-react's own code and several
 * of these glyphs are in that first load. Drawn here, the part shares
 * nothing with it but React and the words.
 */
import type { ReactNode, SVGProps } from 'react';

type Node = [string, Record<string, string>];

const NODES = {
  check: [["path", {"d": "M20 6 9 17l-5-5"}]],
  minus: [["path", {"d": "M5 12h14"}]],
  info: [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "M12 16v-4"}], ["path", {"d": "M12 8h.01"}]],
  mailX: [["path", {"d": "M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9"}], ["path", {"d": "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"}], ["path", {"d": "m17 17 4 4"}], ["path", {"d": "m21 17-4 4"}]],
  mailCheck: [["path", {"d": "M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8"}], ["path", {"d": "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"}], ["path", {"d": "m16 19 2 2 4-4"}]],
  fileCheck: [["path", {"d": "M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"}], ["path", {"d": "M14 2v4a2 2 0 0 0 2 2h4"}], ["path", {"d": "m3 15 2 2 4-4"}]],
  filePen: [["path", {"d": "m18 5-2.414-2.414A2 2 0 0 0 14.172 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2"}], ["path", {"d": "M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"}], ["path", {"d": "M8 18h1"}]],
  squareCheck: [["rect", {"width": "18", "height": "18", "x": "3", "y": "3", "rx": "2"}], ["path", {"d": "m9 12 2 2 4-4"}]],
  reply: [["path", {"d": "M20 18v-2a4 4 0 0 0-4-4H4"}], ["path", {"d": "m9 17-5-5 5-5"}]],
  stamp: [["path", {"d": "M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"}], ["path", {"d": "M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z"}], ["path", {"d": "M5 22h14"}]],
  userX: [["path", {"d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}], ["circle", {"cx": "9", "cy": "7", "r": "4"}], ["line", {"x1": "17", "x2": "22", "y1": "8", "y2": "13"}], ["line", {"x1": "22", "x2": "17", "y1": "8", "y2": "13"}]],
  cog: [["path", {"d": "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"}], ["path", {"d": "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"}], ["path", {"d": "M12 2v2"}], ["path", {"d": "M12 22v-2"}], ["path", {"d": "m17 20.66-1-1.73"}], ["path", {"d": "M11 10.27 7 3.34"}], ["path", {"d": "m20.66 17-1.73-1"}], ["path", {"d": "m3.34 7 1.73 1"}], ["path", {"d": "M14 12h8"}], ["path", {"d": "M2 12h2"}], ["path", {"d": "m20.66 7-1.73 1"}], ["path", {"d": "m3.34 17 1.73-1"}], ["path", {"d": "m17 3.34-1 1.73"}], ["path", {"d": "m11 13.73-4 6.93"}]],
  fileUp: [["path", {"d": "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}], ["path", {"d": "M14 2v4a2 2 0 0 0 2 2h4"}], ["path", {"d": "M12 12v6"}], ["path", {"d": "m15 15-3-3-3 3"}]],
  userCheck: [["path", {"d": "M2 21a8 8 0 0 1 13.292-6"}], ["circle", {"cx": "10", "cy": "8", "r": "5"}], ["path", {"d": "m16 19 2 2 4-4"}]],
} satisfies Record<string, Node[]>;

export type GlyphName = keyof typeof NODES;

/** One glyph, `aria-hidden` unless it is given a name; sized by its `className`. */
export function Glyph({ name, ...props }: SVGProps<SVGSVGElement> & { name: GlyphName }): ReactNode {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {(NODES[name] as Node[]).map(([tag, attrs], index) => {
        const Tag = tag as 'path';
        return <Tag key={index} {...attrs} />;
      })}
    </svg>
  );
}
