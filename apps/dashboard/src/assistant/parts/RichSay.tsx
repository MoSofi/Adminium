// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the assistant said, with the little Markdown a model writes whatever
 * it is told: `**bold**`, `` `code` `` and `[a place](/its/path)`.
 *
 * NOTHING ELSE IS READ, and nothing is ever handed to the browser as markup:
 * every piece is a string React escapes. A heading, a list or a table stays
 * the characters it was typed as.
 *
 * A LINK IS A PLACE IN THIS APP OR IT IS NOT A LINK. Its target must be a
 * path of this app (one leading slash; no scheme, no `//host`, no backslash,
 * no control character) AND one the app's own router has a screen for. Then
 * it is drawn as a link that the router follows, so it cannot leave the app.
 * Anything else (an outside address, a path nothing answers) is drawn as its
 * label alone: a model cannot put an address of its choosing in front of a
 * person. Where the app's router is not there at all (an app's staff screen
 * has a router with one route), no path matches and every link is its label.
 */
import { cn } from '@adminium/ui';
import { useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export type SayPiece =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; to: string };

/** One pass, left to right: the first of the three that starts earliest wins; nothing nests. */
const MARK = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]*)\)/g;

/** Split what was said into plain text and the three things drawn differently. */
export function sayPieces(say: string): SayPiece[] {
  const pieces: SayPiece[] = [];
  let at = 0;
  for (const match of say.matchAll(MARK)) {
    const start = match.index;
    if (start > at) pieces.push({ kind: 'text', text: say.slice(at, start) });
    if (match[1] !== undefined) pieces.push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined) pieces.push({ kind: 'bold', text: match[2] });
    else pieces.push({ kind: 'link', text: match[3] ?? '', to: match[4] ?? '' });
    at = start + match[0].length;
  }
  if (at < say.length) pieces.push({ kind: 'text', text: say.slice(at) });
  return pieces;
}

/** What was said with its marks taken off: for reading aloud, where an asterisk is a noise. */
export function plainSay(say: string): string {
  return sayPieces(say)
    .map((piece) => piece.text)
    .join('');
}

/**
 * Whether a link's target is written as a path of this app. Shape only: one
 * leading slash, nothing that names another host or scheme, nothing a browser
 * reads as one (a backslash is a slash to it), no control character or space.
 */
export function isAppPath(target: string): boolean {
  if (target.length < 1 || target.length > 512) return false;
  if (!target.startsWith('/') || target.startsWith('//')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(target)) return false;
  // Decoded too: `/%2F%2Fhost` and `/%5Chost` are the same tricks spelled out.
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  return !decoded.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(decoded) && !decoded.includes('://');
}

/** The path part of a target: what the router is asked about. */
function pathOf(target: string): string {
  const cut = target.search(/[?#]/);
  return cut === -1 ? target : target.slice(0, cut);
}

/** The router's own answer to "which route is this path": a tuple in the version in use, an object in others. */
type Matched = readonly [unknown, Record<string, unknown> | undefined, { id?: string } | undefined] | { routeParams?: Record<string, unknown>; foundRoute?: { id?: string } | undefined };

interface RouteFinder {
  getMatchedRoutes: (pathname: string) => Matched;
}

/**
 * Whether this app's router has a screen at the path. Asked of the router
 * itself, so a renamed screen stops being a link the day it is renamed. A
 * path only a catch-all takes (`**`) is not a screen anybody named; a router
 * that cannot say (another version's shape, no router) is taken as "no".
 */
export function routerKnows(router: unknown, target: string): boolean {
  try {
    const matched = (router as RouteFinder).getMatchedRoutes(pathOf(target));
    const found = Array.isArray(matched) ? matched[2] : (matched as { foundRoute?: { id?: string } }).foundRoute;
    const params = Array.isArray(matched) ? matched[1] : (matched as { routeParams?: Record<string, unknown> }).routeParams;
    if (found === undefined || found === null || found.id === undefined || found.id === '__root__') return false;
    return params === undefined || params === null || !('**' in params);
  } catch {
    return false;
  }
}

export interface RichSayProps {
  say: string;
  className?: string;
}

export function RichSay({ say, className }: RichSayProps): ReactNode {
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | undefined;
  return (
    <p className={className}>
      {sayPieces(say).map((piece, index) => {
        const key = `${String(index)}:${piece.kind}`;
        if (piece.kind === 'text') return <span key={key}>{piece.text}</span>;
        if (piece.kind === 'bold') return <strong key={key} className="font-bold">{piece.text}</strong>;
        if (piece.kind === 'code') {
          return (
            <code key={key} className="rounded-[5px] bg-surface-2 px-[5px] py-px font-mono text-[12.5px] text-fg">
              {piece.text}
            </code>
          );
        }
        const to = piece.to;
        if (router === undefined || !isAppPath(to) || !routerKnows(router, to)) return <span key={key}>{piece.text}</span>;
        return (
          <a
            key={key}
            href={to}
            data-testid="assistant-say-link"
            onClick={(event) => {
              // A plain click stays in the app, by the router; a modified one (new tab) is the browser's, to the same in-app path.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              void router.navigate({ to });
            }}
            className={cn('font-semibold text-accent underline underline-offset-2 hover:no-underline', 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent')}
          >
            {piece.text}
          </a>
        );
      })}
    </p>
  );
}
