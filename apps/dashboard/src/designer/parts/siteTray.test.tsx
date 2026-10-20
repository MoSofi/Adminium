// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A site template in the Designer's message box:
 *
 *  1. On the build page a zip goes up at once: its chip shows the percent and Cancel, then the site's
 *     counts and what was left out (each with why); Send waits for it and says so.
 *  2. A second site asks first (the safe choice focused, Escape keeps the first); one sent with an
 *     earlier message is named by the server, and replaced only on the person's word.
 *  3. A refusal is the server's one sentence, dismissed by its own button; a cancelled upload and a
 *     removed site each say so, and a removed one comes off the session.
 *  4. On Home the zip is held, and goes up first when the message is sent.
 *  5. A dropped folder is packed as a stored zip; too many entries or bytes are refused at once.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../app/api.js';
import { AppToastProvider } from '../../pages/toasts.js';
import { installTestI18n } from '../../i18n/testing.js';
import type { DesignerAttachment } from '../api.js';

type Upload = { sessionId: string; filename: string; replace?: string; progress?: (fraction: number) => void; signal?: AbortSignal; resolve: (value: DesignerAttachment) => void; reject: (error: unknown) => void };
const uploads: Upload[] = [];
const removed: string[] = [];
vi.mock('../api.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api.js')>();
  return {
    ...real,
    designerApi: {
      ...real.designerApi,
      uploadSite: (sessionId: string, _zip: Blob, filename: string, opts: { replace?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}) =>
        new Promise<DesignerAttachment>((resolve, reject) => {
          const upload: Upload = { sessionId, filename, resolve, reject, ...(opts.replace === undefined ? {} : { replace: opts.replace }), ...(opts.onProgress === undefined ? {} : { progress: opts.onProgress }), ...(opts.signal === undefined ? {} : { signal: opts.signal }) };
          opts.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
          uploads.push(upload);
        }),
      removeAttachment: async (_sessionId: string, id: string) => {
        removed.push(id);
      },
    },
  };
});

const { AttachMenu, AttachTray, attachHandlers, SentFiles, useAttach } = await import('./attach.js');
const { BuildComposer } = await import('./BuildComposer.js');
const { crc32, packZip, readFolder, PackRefusal } = await import('./packSite.js');

beforeAll(() => installTestI18n());
beforeEach(() => {
  uploads.length = 0;
  removed.length = 0;
});

const SESSION = 'ds_000000000000000000000001';
const zip = (name: string, size = 10): File => new File([new Uint8Array(size)], name, { type: 'application/zip' });
const site = (over: Partial<DesignerAttachment> = {}): DesignerAttachment => ({
  id: 'att_00000000000000000001',
  label: 'harbor-bakery',
  kind: 'site',
  mediaType: 'application/zip',
  bytes: 1,
  pages: 9,
  files: 64,
  leftOut: [
    { file: 'shop.php', reason: 'php' },
    { file: 'intro.mp4', reason: 'video' },
  ],
  leftOutCount: 2,
  ...over,
});

function setup(sessionId?: string) {
  const said: string[] = [];
  const hook = renderHook(() => useAttach({ ...(sessionId === undefined ? {} : { sessionId }), notify: (title) => said.push(title) }));
  const view = render(<AttachTray state={hook.result.current} modelName={null} readsImages={null} />);
  const redraw = (): void => view.rerender(<AttachTray state={hook.result.current} modelName={null} readsImages={null} />);
  return { hook, said, redraw };
}

describe('a site template on the build page', () => {
  it('goes up at once, with its percent, then shows its counts and what was left out', async () => {
    const { hook, redraw } = setup(SESSION);
    act(() => hook.result.current.add([zip('harbor-bakery.zip')]));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ sessionId: SESSION, filename: 'harbor-bakery.zip' });
    act(() => uploads[0]?.progress?.(0.64));
    redraw();
    expect(screen.getByRole('status').textContent).toBe('harbor-bakery: uploading 64%');
    expect(screen.getByRole('button', { name: 'Cancel the upload' })).toBeTruthy();
    expect(hook.result.current.site.uploading).toBe(true);
    await act(async () => uploads[0]?.resolve(site()));
    redraw();
    const chip = document.querySelector('[data-part="site-chip"]') as HTMLElement;
    expect(chip.textContent).toBe('harbor-bakery · 9 pages · 64 files2 left out');
    await userEvent.click(within(chip).getByRole('button', { name: '2 left out' }));
    const list = await screen.findByRole('dialog', { name: 'Left out of harbor-bakery' });
    expect(within(list).getByText('Left out')).toBeTruthy();
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['shop.php: PHP is not used', 'intro.mp4: videos are not kept']);
    // Sent with the message: the site's id first.
    expect(await hook.result.current.upload(SESSION)).toEqual(['att_00000000000000000001']);
  });

  it('makes Send wait while it goes up, and say why', () => {
    const { hook } = setup(SESSION);
    act(() => hook.result.current.add([zip('harbor-bakery.zip')]));
    const sent = vi.fn();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppToastProvider>
          <BuildComposer value="Make this my bakery." onChange={() => undefined} onSend={sent} onStop={() => undefined} working={false} canSend placeholder="" model={null} attach={hook.result.current} />
        </AppToastProvider>
      </QueryClientProvider>,
    );
    const send = screen.getByRole('button', { name: 'Send. Wait for the upload to finish.' });
    expect(send.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(send);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(sent).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('asks before a second site replaces the first: the safe choice focused, Escape keeps it', async () => {
    const { hook, said, redraw } = setup(SESSION);
    act(() => hook.result.current.add([zip('harbor-bakery.zip')]));
    await act(async () => uploads[0]?.resolve(site()));
    act(() => hook.result.current.add([zip('corner-cafe.zip')]));
    redraw();
    const ask = screen.getByRole('alertdialog');
    expect(ask.textContent).toContain('corner-cafe.zip dropped');
    expect(ask.textContent).toContain('This replaces harbor-bakery. What was already built from it stays.');
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Keep harbor-bakery' }));
    expect(uploads).toHaveLength(1);
    fireEvent.keyDown(ask, { key: 'Escape' });
    redraw();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    act(() => hook.result.current.add([zip('corner-cafe.zip')]));
    redraw();
    await userEvent.click(screen.getByRole('button', { name: 'Replace it' }));
    expect(uploads[1]).toMatchObject({ filename: 'corner-cafe.zip', replace: 'att_00000000000000000001' });
    expect(said).toEqual(['corner-cafe is in the tray.']);
  });

  it('asks too when the session holds a site sent with an earlier message, as the server names it', async () => {
    const { hook, redraw } = setup(SESSION);
    act(() => hook.result.current.add([zip('corner-cafe.zip')]));
    await act(async () => uploads[0]?.reject(new ApiError(409, 'CONFLICT', 'This replaces harbor-bakery.', null, { reason: 'SITE_REPLACES', site: { id: 'att_00000000000000000009', label: 'harbor-bakery' } })));
    redraw();
    expect(screen.getByRole('alertdialog').textContent).toContain('This replaces harbor-bakery.');
    await userEvent.click(screen.getByRole('button', { name: 'Replace it' }));
    expect(uploads[1]).toMatchObject({ filename: 'corner-cafe.zip', replace: 'att_00000000000000000009' });
  });

  it('says a refusal in the server’s sentence until it is dismissed; a cancel and a removal each say so', async () => {
    const { hook, said, redraw } = setup(SESSION);
    act(() => hook.result.current.add([zip('menu.zip')]));
    await act(async () => uploads[0]?.reject(new ApiError(422, 'VALIDATION_FAILED', 'menu.zip is locked with a password, so it cannot be read.', null, { reason: 'ZIP_ENCRYPTED' })));
    redraw();
    expect(screen.getByRole('alert').textContent).toBe('menu.zip is locked with a password, so it cannot be read.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    redraw();
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => hook.result.current.add([zip('harbor-bakery.zip')]));
    redraw();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the upload' }));
    expect(uploads[1]?.signal?.aborted).toBe(true);
    expect(said).toEqual(['Upload cancelled.']);

    act(() => hook.result.current.add([zip('harbor-bakery.zip')]));
    await act(async () => uploads[2]?.resolve(site()));
    redraw();
    await userEvent.click(screen.getByRole('button', { name: 'Remove harbor-bakery' }));
    expect(removed).toEqual(['att_00000000000000000001']);
    expect(said).toEqual(['Upload cancelled.', 'harbor-bakery is off this message.']);
  });

  it('refuses a zip over 25 MB before anything goes up', () => {
    const { hook, redraw } = setup(SESSION);
    const big = zip('huge.zip');
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 });
    act(() => hook.result.current.add([big]));
    redraw();
    expect(uploads).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toBe('huge.zip is over 25 MB.');
  });
});

describe('a site template on Home', () => {
  it('is held, then goes up first when the message is sent, right after the session is made', async () => {
    const { hook, redraw } = setup();
    act(() => hook.result.current.add([zip('harbor-bakery.zip')]));
    redraw();
    expect(uploads).toHaveLength(0);
    expect((document.querySelector('[data-part="site-chip"]') as HTMLElement).textContent).toBe('harbor-bakery · site template');
    const ids = hook.result.current.upload(SESSION);
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    uploads[0]?.resolve(site());
    expect(await ids).toEqual(['att_00000000000000000001']);
  });
});

describe('a sent message', () => {
  it('shows its site as a chip with its counts', () => {
    render(<SentFiles sessionId={SESSION} files={[{ id: 'att_00000000000000000001', label: 'harbor-bakery', kind: 'site', pages: 1, files: 3 }]} />);
    expect(screen.getByRole('listitem').textContent).toBe('harbor-bakery· 1 page · 3 files');
  });
});

describe('a dropped folder', () => {
  /** A folder the browser would hand over: entries read a batch at a time. */
  const folder = (name: string, tree: Record<string, string | Record<string, string>>): FileSystemDirectoryEntry =>
    ({
      name,
      isDirectory: true,
      isFile: false,
      createReader: () => {
        let done = false;
        return {
          readEntries: (ok: (entries: FileSystemEntry[]) => void) => {
            if (done) return ok([]);
            done = true;
            ok(
              Object.entries(tree).map(([child, value]) =>
                typeof value === 'string'
                  ? ({ name: child, isDirectory: false, isFile: true, file: (give: (file: File) => void) => give(new File([value], child)) } as unknown as FileSystemEntry)
                  : (folder(child, value) as unknown as FileSystemEntry),
              ),
            );
          },
        };
      },
    }) as unknown as FileSystemDirectoryEntry;

  it('is read whole and packed as a stored zip, names in UTF-8', async () => {
    const files = await readFolder(folder('harbor', { 'index.html': '<html></html>', css: { 'site.css': 'a{}' }, 'café.txt': 'x' }));
    expect(files.map((file) => file.path)).toEqual(['index.html', 'css/site.css', 'café.txt']);
    const bytes = new Uint8Array(await (await packZip(files)).arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // Stored, with bit 11 (UTF-8 names), and the CRC of the file's bytes.
    expect(view.getUint16(6, true)).toBe(0x800);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('<html></html>')));
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(3);
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
  });

  it('dropped on the box is packed and sent as one site, under the folder’s name', async () => {
    const { hook } = setup(SESSION);
    const handlers = attachHandlers(hook.result.current);
    const entry = folder('harbor', { 'index.html': '<html></html>' });
    const prevent = vi.fn();
    act(() =>
      handlers.onDrop({
        preventDefault: prevent,
        dataTransfer: { files: [new File([''], 'harbor')], items: [{ kind: 'file', webkitGetAsEntry: () => entry }] },
      } as unknown as Parameters<typeof handlers.onDrop>[0]),
    );
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    expect(prevent).toHaveBeenCalled();
    expect(uploads[0]).toMatchObject({ sessionId: SESSION, filename: 'harbor' });
    expect(hook.result.current.files).toEqual([]);
  });

  it('picked with "A folder…" is packed from its files’ paths and sent under the folder’s name', async () => {
    const { hook } = setup(SESSION);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"templates":[],"more":0,"note":null}', { status: 200, headers: { 'content-type': 'application/json' } }))));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AttachMenu state={hook.result.current} figma={undefined} onFigma={() => undefined} />
      </QueryClientProvider>,
    );
    const input = document.querySelector('[data-part="attach-folder-input"]') as HTMLInputElement;
    const inFolder = (path: string, text: string): File => {
      const file = new File([text], path.split('/').pop() ?? path);
      Object.defineProperty(file, 'webkitRelativePath', { value: path });
      return file;
    };
    Object.defineProperty(input, 'files', { value: [inFolder('harbor/index.html', '<html></html>'), inFolder('harbor/css/site.css', 'a{}')], configurable: true });
    fireEvent.change(input);
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toMatchObject({ sessionId: SESSION, filename: 'harbor' });
    vi.unstubAllGlobals();
  });

  it('is refused at once with more than 1,000 entries', async () => {
    const many = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`p${String(index)}.html`, 'x']));
    await expect(readFolder(folder('big', many))).rejects.toBeInstanceOf(PackRefusal);
  });
});
