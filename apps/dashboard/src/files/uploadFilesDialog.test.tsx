// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The Upload dialog (38-files-library-and-attachments.md D4, D17; 38-T10).
 *
 * The four claims worth pinning, all of which are about the WIRE or about what
 * survives a failure:
 *
 *  1. a queued file is not sent until the operator says so — the comp's whole
 *     reason for a two-phase flow;
 *  2. the request names a connection and NO table, which is what makes it a
 *     library upload rather than an unattached create-form one;
 *  3. one refusal is one row's problem: a 413 in the middle of a batch must
 *     not end it;
 *  4. the page refetches ONCE, after the batch, not per file.
 *
 * `XMLHttpRequest` is stubbed rather than `fetch` because `uploadFile` uses
 * XHR — it is the only browser API that reports upload progress — so a fetch
 * stub would see nothing at all. Same reasoning, and the same stub shape, as
 * `filesUpload.test.ts`.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import { UploadFilesDialog } from './UploadFilesDialog.js';

class UploadStub extends EventTarget {}

let requests: XhrStub[] = [];

/** The subset of `XMLHttpRequest` the transport touches. */
class XhrStub extends EventTarget {
  readonly upload = new UploadStub();
  readonly headers = new Map<string, string>();
  method = '';
  url = '';
  withCredentials = false;
  body: unknown = null;
  status = 0;
  responseText = '';
  aborted = false;

  constructor() {
    super();
    requests.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  send(body: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.dispatchEvent(new Event('abort'));
  }

  succeed(): void {
    this.status = 201;
    this.responseText = JSON.stringify({ data: { id: 'file_new' } });
    this.dispatchEvent(new Event('load'));
  }

  refuse(status: number, message: string): void {
    this.status = status;
    this.responseText = JSON.stringify({ error: { code: 'FILE_TOO_LARGE', message, requestId: 'r' } });
    this.dispatchEvent(new Event('load'));
  }
}

const CONNECTIONS = [
  { id: 'conn_1', name: 'Production' },
  { id: 'conn_2', name: 'Warehouse' },
];

const fileOf = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' });

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

beforeEach(() => {
  requests = [];
  vi.stubGlobal('XMLHttpRequest', XhrStub);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderDialog(over: Partial<Parameters<typeof UploadFilesDialog>[0]> = {}) {
  const onUploaded = vi.fn();
  const onClose = vi.fn();
  render(
    <UploadFilesDialog
      connections={CONNECTIONS}
      onClose={onClose}
      onUploaded={onUploaded}
      {...over}
    />,
  );
  return { onUploaded, onClose };
}

/** Put files in the queue through the real picker. */
async function pick(user: ReturnType<typeof userEvent.setup>, names: string[]): Promise<void> {
  await user.upload(
    document.querySelector('input[type="file"]') as HTMLInputElement,
    names.map(fileOf),
  );
}

describe('the Upload dialog', () => {
  it('queues without sending, and sends only when asked', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pick(user, ['one.pdf', 'two.pdf']);
    expect(screen.getAllByTestId('files-upload-row')).toHaveLength(2);
    // The pause is the point: a person who dropped the wrong folder gets to
    // see the list and back out before anything leaves the machine.
    expect(requests).toHaveLength(0);

    await user.click(screen.getByTestId('files-upload-send'));
    await waitFor(() => expect(requests).toHaveLength(1));
  });

  it('names the connection and NO table — what makes it a library upload', async () => {
    const user = userEvent.setup();
    renderDialog({ connectionId: 'conn_2' });

    await pick(user, ['one.pdf']);
    await user.click(screen.getByTestId('files-upload-send'));
    await waitFor(() => expect(requests).toHaveLength(1));

    const url = new URL(requests[0]!.url, 'https://x.test');
    expect(requests[0]!.method).toBe('POST');
    expect(url.pathname).toBe('/api/v1/files');
    // Pre-set from the rail's filter.
    expect(url.searchParams.get('connectionId')).toBe('conn_2');
    // No table ⇒ authorised by `files.manage` and claimed at creation, so the
    // unattached sweep leaves it (D4). A table here would make it a
    // create-form upload the sweep collects a day later.
    expect(url.searchParams.get('table')).toBeNull();
    expect(url.searchParams.get('recordId')).toBeNull();
    expect(url.searchParams.get('filename')).toBe('one.pdf');
  });

  it('sends one at a time, and one refusal does not end the batch', async () => {
    const user = userEvent.setup();
    const { onUploaded } = renderDialog();

    await pick(user, ['one.pdf', 'two.pdf', 'three.pdf']);
    await user.click(screen.getByTestId('files-upload-send'));

    // Sequential: the second request does not exist until the first settles.
    await waitFor(() => expect(requests).toHaveLength(1));
    requests[0]!.succeed();

    await waitFor(() => expect(requests).toHaveLength(2));
    requests[1]!.refuse(413, 'That file is larger than the 200-byte limit.');

    // The third still goes — a refusal is one row's problem.
    await waitFor(() => expect(requests).toHaveLength(3));
    requests[2]!.succeed();

    await waitFor(() => {
      expect(screen.getByText(/larger than the 200-byte limit/)).toBeTruthy();
    });
    const rows = screen.getAllByTestId('files-upload-row');
    expect(within(rows[0]!).getByText('Done')).toBeTruthy();
    expect(within(rows[1]!).getByText('Failed')).toBeTruthy();
    expect(within(rows[2]!).getByText('Done')).toBeTruthy();

    // ONCE, after the batch — refetching per file would rebuild the table
    // under the reader three times.
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
  });

  it('cancels one in flight and keeps going', async () => {
    const user = userEvent.setup();
    renderDialog();

    await pick(user, ['one.pdf', 'two.pdf']);
    await user.click(screen.getByTestId('files-upload-send'));
    await waitFor(() => expect(requests).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /cancel one\.pdf/i }));
    expect(requests[0]!.aborted).toBe(true);

    await waitFor(() => expect(requests).toHaveLength(2));
    requests[1]!.succeed();
    await waitFor(() => {
      expect(within(screen.getAllByTestId('files-upload-row')[0]!).getByText('Cancelled')).toBeTruthy();
    });
  });

  it('does not report an upload when every file was cancelled', async () => {
    const user = userEvent.setup();
    const { onUploaded } = renderDialog();

    await pick(user, ['one.pdf']);
    await user.click(screen.getByTestId('files-upload-send'));
    await waitFor(() => expect(requests).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /cancel one\.pdf/i }));

    await waitFor(() => {
      expect(screen.getByText('Cancelled')).toBeTruthy();
    });
    // Nothing landed, so there is nothing for the page to refetch.
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('asks which connection only when there is a choice', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    expect(screen.getByTestId('files-upload-connection')).toBeTruthy();
    cleanup();

    renderDialog({ connections: [CONNECTIONS[0]!] });
    // One connection is not a question.
    expect(screen.queryByTestId('files-upload-connection')).toBeNull();

    await pick(user, ['one.pdf']);
    await user.click(screen.getByTestId('files-upload-send'));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new URL(requests[0]!.url, 'https://x.test').searchParams.get('connectionId')).toBe('conn_1');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses to send with nothing queued', async () => {
    renderDialog();
    expect(screen.getByTestId('files-upload-send').hasAttribute('disabled')).toBe(true);
  });

  /**
   * Accessibility, asserted HERE because nothing else can see this screen.
   *
   * The axe sweep (`packages/ui/scripts/a11y-sweep.mjs`) runs over the
   * workspace Storybook, whose globs are `packages/ui`, `packages/charts` and
   * `packages/widgets` — no `apps/dashboard` surface has ever been in it. So
   * for a dashboard screen the roles and names have to be pinned by its own
   * tests or they are pinned by nothing. These are the four axe would check.
   */
  it('names every control and its progress', async () => {
    const user = userEvent.setup();
    renderDialog();

    // The modal itself is named, so a screen reader announces what opened.
    expect(screen.getByRole('dialog', { name: /upload files/i })).toBeTruthy();
    // The file input is visually hidden; without its own label it would be an
    // unnamed form control — the exact defect 38b found in `FileField`.
    expect(screen.getByLabelText(/browse your computer/i)).toBeTruthy();

    await pick(user, ['one.pdf']);
    await user.click(screen.getByTestId('files-upload-send'));
    await waitFor(() => expect(requests).toHaveLength(1));

    // A bar with no name and no value is decoration, not progress.
    const bar = await screen.findByRole('progressbar', { name: /uploading/i });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');

    // Each row's Cancel says WHICH file it cancels — "Cancel" three times over
    // is three identical names for three different actions.
    expect(screen.getByRole('button', { name: /cancel one\.pdf/i })).toBeTruthy();
  });
});
