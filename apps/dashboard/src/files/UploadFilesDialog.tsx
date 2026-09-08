// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Uploading files that belong to no record
 * (38-files-library-and-attachments.md D4, D17; 38-T10).
 *
 * ─── The two phases, and why the comp draws them that way ──────────────────
 *
 * `designs/File Manager.dc.html` shows pick → review the queue → **Upload N
 * files**, not a dropzone that starts sending the moment something lands on
 * it. The pause is the point: a person who dropped the wrong folder, or five
 * files where they meant one, gets to see the list and back out before
 * anything leaves the machine.
 *
 * ─── One request per file ──────────────────────────────────────────────────
 *
 * `POST /files` takes one file as its raw body (37 D5), so each row is its own
 * XHR with its own progress and its own Cancel. That is also what makes one
 * bad file survivable: a 413 or a 415 lands on ITS row and the rest of the
 * queue carries on, rather than one refusal ending the batch.
 *
 * They are sent one at a time. Five concurrent 200 MB PUTs compete for the
 * same upstream and show five bars that all crawl; in sequence the first file
 * finishes first, which is also the order the rows resolve in.
 *
 * ─── The connection is required, and is not always a question ──────────────
 *
 * A file always belongs to a connection (D4) — that is what makes it findable
 * afterwards — but with exactly one configured there is nothing to ask, so the
 * picker does not render. With more than one it does, defaulting to whatever
 * the rail was already looking at.
 *
 * ─── What this dialog deliberately cannot do ───────────────────────────────
 *
 * Attach anything to a record. A file uploaded here belongs to the workspace;
 * attaching it to a row is the record page's job, and pretending otherwise
 * would need a table picker, a row picker, and a column — three questions the
 * comp does not ask and the Files page has no business asking either.
 */
import { useRef, useState } from 'react';
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, Select, cn } from '@adminium/ui';
import { Upload, X } from 'lucide-react';

import { t } from '../i18n/t.js';
import { uploadFile, UploadAbortedError } from './api.js';
import { formatBytes, type FilesConnection } from './filesQueries.js';

/** One queued file and whatever has happened to it so far. */
interface QueueRow {
  file: File;
  /** 0–1 while sending; untouched before and after. */
  fraction: number;
  status: 'queued' | 'sending' | 'done' | 'failed' | 'cancelled';
  /** The server's own sentence, when it refused this one. */
  error?: string;
  abort?: AbortController;
}

export interface UploadFilesDialogProps {
  connections: readonly FilesConnection[];
  /** Pre-selected connection — whatever the rail is filtered to. */
  connectionId?: string | undefined;
  onClose: () => void;
  /** At least one file landed; the page refetches its list and usage strip. */
  onUploaded: () => void;
}

export function UploadFilesDialog({
  connections,
  connectionId,
  onClose,
  onUploaded,
}: UploadFilesDialogProps) {
  const [target, setTarget] = useState(connectionId ?? connections[0]?.id ?? '');
  const [rows, setRows] = useState<readonly QueueRow[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const queued = rows.filter((row) => row.status === 'queued');
  const landed = rows.some((row) => row.status === 'done');
  const finished = rows.length > 0 && queued.length === 0 && !sending;

  function enqueue(files: readonly File[]): void {
    if (files.length === 0) return;
    setRows((current) => [...current, ...files.map((file) => ({ file, fraction: 0, status: 'queued' as const }))]);
  }

  function update(index: number, patch: Partial<QueueRow>): void {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function send(): Promise<void> {
    setSending(true);
    let any = false;
    for (const [index, row] of rows.entries()) {
      if (row.status !== 'queued') continue;
      const abort = new AbortController();
      update(index, { status: 'sending', abort, fraction: 0 });
      try {
        await uploadFile({
          file: row.file,
          connectionId: target,
          // No `table`: that is what makes this a library upload — authorised
          // by `files.manage` and claimed at creation, so the unattached sweep
          // leaves it alone (D4).
          signal: abort.signal,
          onProgress: (fraction) => update(index, { fraction }),
        });
        update(index, { status: 'done', fraction: 1 });
        any = true;
      } catch (reason) {
        update(
          index,
          reason instanceof UploadAbortedError
            ? { status: 'cancelled' }
            : { status: 'failed', error: reason instanceof Error ? reason.message : String(reason) },
        );
      }
    }
    setSending(false);
    // Once, after the batch — not per file. The list and the usage strip are
    // one invalidation and refetching them five times would show the same
    // table rebuilding under the reader.
    if (any) onUploaded();
  }

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <ModalHeader
        icon={<Upload />}
        title={t('common:files.upload.title', 'Upload files')}
        subtitle={t('common:files.upload.subtitle', 'Add files to this workspace.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4">
        {connections.length > 1 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-body-sm font-medium text-fg">
              {t('common:files.upload.connection', 'Which connection these belong to')}
            </span>
            <Select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={sending}
              data-testid="files-upload-connection"
            >
              {connections.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        {/*
          The comp's dropzone. Not `UploadDropzone` from the widget family:
          that one enforces a client-side `maxSize` it would have to be told,
          and the limit here is the workspace's — which the SERVER owns and
          answers with a 413 naming the number. A second copy of a limit is a
          second thing to get out of step.
        */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            enqueue([...event.dataTransfer.files]);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center',
            dragging ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2',
          )}
          data-testid="files-upload-dropzone"
        >
          <Upload aria-hidden className="size-5 text-fg-subtle" />
          <p className="text-body-sm text-fg">
            {t('common:files.upload.drop', 'Drag files here')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={sending}
            onClick={() => picker.current?.click()}
            data-testid="files-upload-browse"
          >
            {t('common:files.upload.browse', 'Browse your computer')}
          </Button>
          <input
            ref={picker}
            type="file"
            multiple
            className="sr-only"
            aria-label={t('common:files.upload.browse', 'Browse your computer')}
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])];
              // Reset so the same file can be chosen again after a removal.
              event.target.value = '';
              enqueue(chosen);
            }}
          />
        </div>

        {rows.length > 0 ? (
          <ul className="flex flex-col gap-2" data-testid="files-upload-queue">
            {rows.map((row, index) => (
              <li
                key={`${row.file.name}-${String(index)}`}
                className="flex items-center gap-2"
                data-testid="files-upload-row"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-body-sm text-fg">{row.file.name}</span>
                    <span className="shrink-0 text-caption text-fg-muted">
                      {statusLabel(row)}
                    </span>
                  </div>
                  {row.status === 'sending' ? (
                    <div
                      role="progressbar"
                      aria-label={t('common:files.upload.sending', 'Uploading')}
                      aria-valuenow={Math.round(row.fraction * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-1.5 overflow-hidden rounded-full bg-surface-3"
                    >
                      <div
                        className="h-full w-[var(--adm-progress)] bg-accent transition-[width]"
                        style={{ '--adm-progress': `${String(Math.round(row.fraction * 100))}%` }}
                      />
                    </div>
                  ) : null}
                  {row.error === undefined ? null : (
                    // The SERVER's sentence — it already names the limit that
                    // was hit or the type that was refused.
                    <p role="alert" className="text-caption text-danger">
                      {row.error}
                    </p>
                  )}
                </div>
                {row.status === 'sending' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => row.abort?.abort()}
                    aria-label={t('common:files.upload.cancelOne', 'Cancel {name}', {
                      name: row.file.name,
                    })}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                ) : row.status === 'queued' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    aria-label={t('common:files.upload.removeOne', 'Remove {name}', {
                      name: row.file.name,
                    })}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {finished && landed ? (
          <Alert
            tone="pos"
            data-testid="files-upload-done"
            title={t('common:files.upload.complete', 'Upload complete')}
            body={t(
              'common:files.upload.completeBody',
              'These files are now in this workspace and can be attached to a record later.',
            )}
          />
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={sending}>
          {finished
            ? t('common.close', 'Close')
            : t('common.cancel', 'Cancel')}
        </Button>
        <Button
          disabled={queued.length === 0 || sending || target === ''}
          loading={sending}
          onClick={() => void send()}
          data-testid="files-upload-send"
        >
          {/*
            "Upload 0 files" is what a plural template says for an empty queue,
            and it reads as a promise to do nothing. Before anything is picked
            the button is simply the verb.
          */}
          {queued.length === 0
            ? t('common:files.upload.open', 'Upload')
            : t('common:files.upload.send', '{count, plural, one {Upload # file} other {Upload # files}}', {
                count: queued.length,
              })}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function statusLabel(row: QueueRow): string {
  switch (row.status) {
    case 'done':
      return t('common:files.upload.done', 'Done');
    case 'failed':
      return t('common:files.upload.failed', 'Failed');
    case 'cancelled':
      return t('common:files.upload.cancelled', 'Cancelled');
    case 'sending':
      return `${String(Math.round(row.fraction * 100))}%`;
    case 'queued':
      return formatBytes(row.file.size);
  }
}
