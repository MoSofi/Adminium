// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BYO enrichment side-effects (06-llm-assist.md §10.2 step 4).
 *
 * BYO is the telemetry-free path (§9): the user copies a prompt into their own
 * model and brings the answer back. So the property this suite pins is a
 * NEGATIVE one — neither helper touches the network — plus the two degraded
 * environments they have to survive: a browser with no clipboard permission
 * (every non-secure context) and one with no `createObjectURL`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText, downloadTextFile } from './enrichIo.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // NOT `innerHTML = ''`. @adminium/llm's injection suite scans this tree for
  // raw-HTML sinks because it manufactures the untrusted strings these surfaces
  // render, and it matches the assignment itself — an empty string here still
  // trips it, and a real gate that has to special-case its own repo stops being
  // one. `replaceChildren()` clears the body without naming a sink.
  document.body.replaceChildren();
});

describe('copyText', () => {
  it('writes to the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('# Prompt')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('# Prompt');
  });

  it('reports false when the browser exposes no clipboard at all', async () => {
    // Every non-secure context — the caller shows the manual-copy fallback.
    vi.stubGlobal('navigator', {});
    expect(await copyText('# Prompt')).toBe(false);
  });

  it('reports false when the write is refused, rather than rejecting', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException('NotAllowedError')) },
    });
    await expect(copyText('# Prompt')).resolves.toBe(false);
  });

  it('never reaches the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    await copyText('# Prompt');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('downloadTextFile', () => {
  /** Record the anchor the helper builds, since it removes it again. */
  function captureAnchor() {
    const anchor = document.createElement('a');
    const click = vi.fn();
    anchor.click = click;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    return { anchor, click };
  }

  it('clicks a named object-URL anchor and cleans it up again', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const { anchor, click } = captureAnchor();

    downloadTextFile('adminium-enrichment.md', '# Prompt');

    expect(anchor.download).toBe('adminium-enrichment.md');
    expect(anchor.getAttribute('href')).toBe('blob:mock');
    expect(click).toHaveBeenCalledTimes(1);
    // The URL is revoked and the anchor is not left in the document.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    expect(document.body.querySelector('a')).toBeNull();
    // The blob carries the text as markdown by default.
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('text/markdown;charset=utf-8');
  });

  it('honours an explicit mime type', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    captureAnchor();
    downloadTextFile('schema.json', '{}', 'application/json');
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('application/json;charset=utf-8');
  });

  it('does nothing at all where object URLs are unavailable', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: undefined });
    const createElement = vi.spyOn(document, 'createElement');
    expect(() => {
      downloadTextFile('adminium-enrichment.md', '# Prompt');
    }).not.toThrow();
    expect(createElement).not.toHaveBeenCalled();
  });

  it('never reaches the network', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:mock'), revokeObjectURL: vi.fn() });
    captureAnchor();
    downloadTextFile('adminium-enrichment.md', '# Prompt');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
