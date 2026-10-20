// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A link to a frame in Figma, read strictly.
 *
 * The person pastes what Figma's "Copy link" gives: figma.com/design/<key>/<name>?node-id=1-2 (or
 * /file/, or the same inside /branch/<branch key>/, whose key is then the file's). Anything else is
 * refused with a sentence that says what to paste instead: a FigJam board, a Slides deck and a
 * prototype are Figma links that hold no design frame, and a link with no node-id names a file, not
 * a frame. The key and the node id are held to their own shapes, so nothing the person pasted ever
 * reaches a request to Figma except those two, each encoded on its own.
 */

/** Why a link was refused. */
export type FigmaLinkRefusal = 'not-figma' | 'no-frame' | 'figjam' | 'slides' | 'prototype';

export interface FigmaLink {
  /** The file's key (a branch's own key, for a link inside a branch). */
  fileKey: string;
  /** The frame's node id as the REST API writes it: "1:2", or an instance's "I1:2;3:4". */
  nodeId: string;
}

const HOSTS = new Set(['figma.com', 'www.figma.com']);
const HTTPS = 'https://';
const KEY = /^[A-Za-z0-9]{10,128}$/;
/** A node id as a link writes it ("1-2" or "1:2"), or an instance's ("I1-2;3-4"). */
const NODE = /^(?:\d+[-:]\d+|I\d+[-:]\d+(?:;\d+[-:]\d+)+)$/;

/** The sentence a person reads for each refusal (the dashboard says it in their language). */
export const FIGMA_LINK_WORDS: Record<FigmaLinkRefusal, string> = {
  'not-figma': 'That is not a Figma link.',
  'no-frame': 'Pick a frame in Figma and copy its link.',
  figjam: 'That is a FigJam board. Paste a link to a design frame.',
  slides: 'That is a Slides deck. Paste a link to a design frame.',
  prototype: 'That is a prototype link. Paste a link to a design frame.',
};

/** The frame a pasted link names, or why it names none. */
export function parseFigmaLink(raw: string): { ok: true; link: FigmaLink } | { ok: false; reason: FigmaLinkRefusal } {
  const text = raw.trim();
  if (text.length === 0 || text.length > 2048) return { ok: false, reason: 'not-figma' };
  let url: URL;
  try {
    // "figma.com/design/…", copied without its scheme, is the same link.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : HTTPS + text);
  } catch {
    return { ok: false, reason: 'not-figma' };
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || (url.port !== '' && url.port !== '443') || !HOSTS.has(url.hostname.toLowerCase())) return { ok: false, reason: 'not-figma' };
  const parts = url.pathname.split('/').filter((part) => part !== '');
  const kind = parts[0]?.toLowerCase();
  if (kind === 'board') return { ok: false, reason: 'figjam' };
  if (kind === 'slides' || kind === 'deck') return { ok: false, reason: 'slides' };
  if (kind === 'proto') return { ok: false, reason: 'prototype' };
  if (kind !== 'design' && kind !== 'file') return { ok: false, reason: 'not-figma' };
  // A branch's link: /design/<file key>/branch/<branch key>/<name>. The branch has a key of its own, and is read by it.
  const fileKey = parts[2]?.toLowerCase() === 'branch' ? parts[3] : parts[1];
  if (fileKey === undefined || !KEY.test(fileKey)) return { ok: false, reason: 'not-figma' };
  if (parts[2]?.toLowerCase() === 'branch' && (parts[1] === undefined || !KEY.test(parts[1]))) return { ok: false, reason: 'not-figma' };
  const node = url.searchParams.get('node-id');
  if (node === null || node.trim() === '') return { ok: false, reason: 'no-frame' };
  if (!NODE.test(node.trim())) return { ok: false, reason: 'no-frame' };
  return { ok: true, link: { fileKey, nodeId: node.trim().replace(/-/g, ':') } };
}

/** Whether a node id is one this server asks Figma about: what a link gives, written as the API writes it. */
export const isNodeId = (value: string): boolean => /^(?:\d+:\d+|I\d+:\d+(?:;\d+:\d+)+)$/.test(value);
