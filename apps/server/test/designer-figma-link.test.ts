// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A pasted Figma link, read strictly: the frames Figma's "Copy link" gives are taken, and every other
 * link is refused with the sentence that says what to paste instead.
 */
import { describe, expect, it } from 'vitest';

import { FIGMA_LINK_WORDS, isNodeId, parseFigmaLink } from '../src/designer/figma/link.js';

const KEY = 'AbCdEf0123456789';

describe('a Figma link', () => {
  it('takes a design or file link to a frame, and writes its node id as the API does', () => {
    expect(parseFigmaLink(`https://www.figma.com/design/${KEY}/Crispy-Bites?node-id=12-345&t=x1`)).toEqual({ ok: true, link: { fileKey: KEY, nodeId: '12:345' } });
    expect(parseFigmaLink(`https://figma.com/file/${KEY}/Shop?type=design&node-id=1-2&mode=design`)).toEqual({ ok: true, link: { fileKey: KEY, nodeId: '1:2' } });
    expect(parseFigmaLink(`  figma.com/design/${KEY}/Shop?node-id=1:2  `)).toEqual({ ok: true, link: { fileKey: KEY, nodeId: '1:2' } });
    // An instance inside a component, as Figma writes it in a link.
    expect(parseFigmaLink(`https://www.figma.com/design/${KEY}/Shop?node-id=I1-2%3B3-4`)).toEqual({ ok: true, link: { fileKey: KEY, nodeId: 'I1:2;3:4' } });
  });

  it('reads a branch link by the branch’s own key', () => {
    expect(parseFigmaLink(`https://www.figma.com/design/${KEY}/branch/BrAnCh0123456/Shop?node-id=4-5`)).toEqual({ ok: true, link: { fileKey: 'BrAnCh0123456', nodeId: '4:5' } });
  });

  it('refuses what is not a frame of a design, each with its own sentence', () => {
    const refused = (link: string) => {
      const parsed = parseFigmaLink(link);
      return parsed.ok ? null : parsed.reason;
    };
    expect(refused(`https://www.figma.com/design/${KEY}/Shop`)).toBe('no-frame');
    expect(refused(`https://www.figma.com/design/${KEY}/Shop?node-id=`)).toBe('no-frame');
    expect(refused(`https://www.figma.com/design/${KEY}/Shop?node-id=header`)).toBe('no-frame');
    expect(refused(`https://www.figma.com/board/${KEY}/Crispy-Bites-Planning?node-id=0-1`)).toBe('figjam');
    expect(refused(`https://www.figma.com/slides/${KEY}/Pitch?node-id=1-2`)).toBe('slides');
    expect(refused(`https://www.figma.com/proto/${KEY}/Shop?node-id=1-2`)).toBe('prototype');
    expect(refused('https://www.figma.com.evil.example/design/AbCdEf0123456789/x?node-id=1-2')).toBe('not-figma');
    expect(refused('https://evil.example/www.figma.com/design/AbCdEf0123456789/x?node-id=1-2')).toBe('not-figma');
    expect(refused('http://www.figma.com/design/AbCdEf0123456789/x?node-id=1-2')).toBe('not-figma');
    expect(refused('https://user:pass@www.figma.com/design/AbCdEf0123456789/x?node-id=1-2')).toBe('not-figma');
    expect(refused('https://www.figma.com:8443/design/AbCdEf0123456789/x?node-id=1-2')).toBe('not-figma');
    expect(refused('https://www.figma.com/community/file/123')).toBe('not-figma');
    // A key of another shape never reaches a request: too short, or with a character a key has none of.
    expect(refused('https://www.figma.com/design/short/x?node-id=1-2')).toBe('not-figma');
    expect(refused('https://www.figma.com/design/AbCdEf01234%2F..%2F/x?node-id=1-2')).toBe('not-figma');
    expect(refused('javascript:alert(1)')).toBe('not-figma');
    expect(refused('')).toBe('not-figma');
    expect(refused(`https://www.figma.com/design/${KEY}/x?node-id=${'1'.repeat(3000)}-2`)).toBe('not-figma');
    for (const reason of ['not-figma', 'no-frame', 'figjam', 'slides', 'prototype'] as const) expect(FIGMA_LINK_WORDS[reason]).toMatch(/\.$/);
  });

  it('knows a node id by its shape', () => {
    expect(isNodeId('1:2')).toBe(true);
    expect(isNodeId('I1:2;3:4')).toBe(true);
    expect(isNodeId('1-2')).toBe(false);
    expect(isNodeId('1:2/../x')).toBe(false);
  });
});
