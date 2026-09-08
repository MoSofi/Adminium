// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { Button, MonoText } from '@adminium/ui';
import { Paperclip, Upload, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { GridColumnSpec } from '../../families/tables/column-spec.js';
import type { ResolvedFile } from '../../families/tables/cells.js';
import { formatRefList, parseRefList } from '../../page-config/file-refs.js';

/**
 * The `file` field kind's editor (37-files-and-storage.md §3.9, D14, 37-T17).
 *
 * THIS IS THE FIRST ASYNC FIELD IN `RecordForm`, and that is the whole
 * difficulty. Every other field is a value the form already has; this one is a
 * value the SERVER mints, and it has to be minted before Save because Save
 * writes a plain text reference into the customer's own column. So the upload
 * happens on file selection — not on submit — and the field holds the returned
 * reference from then on, exactly like any other text value.
 *
 * WHAT THAT COSTS, STATED PLAINLY: an upload that is never saved leaves a file
 * nothing points at. That is the `attached_at IS NULL` state, and it is what
 * the daily sweep collects after `files.unattachedHours` (D12). The
 * alternative — holding bytes in the browser until Save — cannot show progress
 * for a 200 MB file, cannot validate the type server-side before the user
 * commits, and turns one failure (the upload) into a failure of the record
 * write.
 *
 * WITHOUT AN `upload` ADAPTER THIS RENDERS NOTHING OF ITS OWN. The host owns
 * the transport (there is no fetch in this package), so a widget rendered in
 * Storybook or in a test that passes no adapter falls back to the plain text
 * input the column had before — visible, editable, honest.
 */

export interface FileFieldUpload {
  /** Uploads and resolves to the value to store in the column. */
  (input: {
    file: File;
    column: string;
    signal: AbortSignal;
    onProgress: (fraction: number) => void;
  }): Promise<{ ref: string; file: ResolvedFile }>;
}

export interface FileFieldProps {
  column: GridColumnSpec;
  /**
   * The stored value: one reference, or — on a `multiple` column — the JSON
   * array of them. `''`/null when the column is empty either way.
   */
  value: unknown;
  onChange: (next: string | null) => void;
  /** Absent ⇒ the plain text input (see the header). */
  upload?: FileFieldUpload | undefined;
  /** What the value currently names, when the host already resolved it. */
  resolved?: ResolvedFile | null | undefined;
  /** The workspace cap, so the field can refuse before the request starts. */
  maxBytes?: number | undefined;
  /** `accept` attribute for the picker — a hint, never the security boundary. */
  accept?: string | undefined;
  inputId?: string | undefined;
  /**
   * Everything the host has resolved, keyed by stored reference — the source
   * for a `multiple` column's chips, where `resolved` (one file) cannot say
   * what a list names. Ignored in single mode.
   */
  resolvedByRef?: ReadonlyMap<string, ResolvedFile | null> | undefined;
}

type State =
  | { phase: 'idle' }
  | { phase: 'uploading'; fraction: number; name: string; abort: AbortController }
  | { phase: 'failed'; message: string };

/** One in-flight upload in a `multiple` column's queue. */
interface UploadRow {
  name: string;
  fraction: number;
  abort: AbortController;
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : String(Math.round(size))} ${units[unit] ?? 'TB'}`;
}

/**
 * The accessible name for the hidden `<input type="file">`.
 *
 * IT NEEDS ITS OWN, and this is not belt-and-braces. `FormField` renders a
 * `<label htmlFor={id}>` and injects that `id` into its child through `Slot` —
 * but this component's root is a `<div>`, so the id lands on the div and the
 * label points at something that is not a form control. The input was
 * therefore unlabelled everywhere it has ever rendered.
 *
 * Nothing caught it because nothing drew it: no story rendered a file field
 * until 38-T05, so the a11y sweep had been reporting zero violations for a
 * feature it had never loaded (27-T50, 27-T58).
 */
function pickerLabel(column: GridColumnSpec, t: ReturnType<typeof useMaybeT>): string {
  // The VISIBLE control's own words, rather than a label written twice. The
  // button beside this input already says what activating it does, and a
  // second phrasing for the same action is one more string to translate and
  // one more chance for the two to drift apart.
  return column.file?.multiple === true
    ? (t?.('ui:templates.crud.file.add', 'Add files') ?? 'Add files')
    : (t?.('ui:templates.crud.file.choose', 'Choose a file') ?? 'Choose a file');
}

/**
 * Dispatch only. The upload half is a separate component so `upload` is
 * narrowed at a boundary — narrowing it with an early return does not reach
 * the hoisted handler below it, and casting to silence that would be a lie
 * about the one prop whose absence is a supported mode.
 */
export function FileField(props: FileFieldProps): ReactNode {
  const { upload, inputId, value, onChange, column } = props;
  if (upload === undefined) {
    // No transport: the honest fallback is the input this column had before a
    // `file` block was configured.
    return (
      <input
        id={inputId}
        data-part="file-field-fallback"
        type="url"
        value={stringValue(value)}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-body-sm"
      />
    );
  }
  // A list column and a single column are different controls, not one control
  // with a flag: the list has no "Replace", its picker is `multiple`, and its
  // value is an array. Splitting at the dispatch keeps the single-value path
  // byte-identical to what 37 shipped.
  if (column.file?.multiple === true) return <FileListField {...props} upload={upload} />;
  return <FileUploadField {...props} upload={upload} />;
}

function FileUploadField({
  column,
  value,
  onChange,
  upload,
  resolved,
  maxBytes,
  accept,
  inputId,
}: FileFieldProps & { upload: FileFieldUpload }): ReactNode {
  const t = useMaybeT();
  const [state, setState] = useState<State>({ phase: 'idle' });
  // What THIS field uploaded in this session, so the chip is right immediately
  // rather than after the host's next resolve round-trip.
  const [justUploaded, setJustUploaded] = useState<ResolvedFile | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const current = stringValue(value);
  const shown = justUploaded ?? resolved ?? null;

  async function start(file: File): Promise<void> {
    if (maxBytes !== undefined && file.size > maxBytes) {
      // Refused before a single byte leaves the browser. The server enforces
      // the same cap — this is courtesy, not the boundary.
      setState({
        phase: 'failed',
        message:
          t?.('ui:templates.crud.file.tooLarge', 'That file is larger than the {limit} limit.', {
            limit: formatBytes(maxBytes),
          }) ?? `That file is larger than the ${formatBytes(maxBytes)} limit.`,
      });
      return;
    }
    const abort = new AbortController();
    setState({ phase: 'uploading', fraction: 0, name: file.name, abort });
    try {
      const result = await upload({
        file,
        column: column.name,
        signal: abort.signal,
        onProgress: (fraction) =>
          setState((previous) =>
            previous.phase === 'uploading' ? { ...previous, fraction } : previous,
          ),
      });
      setJustUploaded(result.file);
      onChange(result.ref);
      setState({ phase: 'idle' });
    } catch (error) {
      if (abort.signal.aborted) {
        setState({ phase: 'idle' });
        return;
      }
      setState({
        phase: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const progressWidth =
    state.phase === 'uploading' ? `${String(Math.round(state.fraction * 100))}%` : '0%';

  return (
    <div data-part="file-field" className="flex flex-col gap-2">
      <input
        ref={picker}
        id={inputId}
        type="file"
        className="sr-only"
        aria-label={pickerLabel(column, t)}
        {...(accept === undefined ? {} : { accept })}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so choosing the SAME file twice still fires a change — the
          // retry path after a failed upload depends on it.
          event.target.value = '';
          if (file !== undefined) void start(file);
        }}
      />

      {state.phase === 'uploading' ? (
        <div data-part="file-field-progress" className="flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={t?.('ui:templates.crud.file.uploading', 'Uploading') ?? 'Uploading'}
            aria-valuenow={Math.round(state.fraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
          >
            {/* The one inline value the design system allows: a string-literal
                CSS custom property, consumed by a token-backed utility. A raw
                `width` would be a second, unthemed progress treatment. */}
            <div
              className="h-full w-[var(--adm-progress)] bg-accent transition-[width]"
              style={{ '--adm-progress': progressWidth }}
            />
          </div>
          <span className="truncate text-body-sm text-fg-muted">{state.name}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => state.abort.abort()}
            aria-label={t?.('ui:templates.crud.file.cancel', 'Cancel upload') ?? 'Cancel upload'}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      ) : current !== '' ? (
        <div data-part="file-field-value" className="flex items-center gap-2">
          <Paperclip aria-hidden className="size-4 shrink-0 text-fg-muted" />
          {shown === null ? (
            // A value with nothing resolved behind it: a foreign URL, or a
            // reference this reader cannot see. Shown verbatim rather than
            // hidden — the column's value is the truth.
            <MonoText className="min-w-0 flex-1 truncate text-body-sm">{current}</MonoText>
          ) : (
            <a
              href={shown.contentPath}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-body-sm font-medium text-accent underline decoration-accent/40 underline-offset-2"
            >
              {shown.filename} <span className="text-fg-subtle">{formatBytes(shown.sizeBytes)}</span>
            </a>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => picker.current?.click()}>
            {t?.('ui:templates.crud.file.replace', 'Replace') ?? 'Replace'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setJustUploaded(null);
              onChange(null);
            }}
            aria-label={t?.('ui:templates.crud.file.remove', 'Remove file') ?? 'Remove file'}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="secondary" onClick={() => picker.current?.click()}>
          <Upload aria-hidden className="size-4" />
          {t?.('ui:templates.crud.file.choose', 'Choose a file') ?? 'Choose a file'}
        </Button>
      )}

      {state.phase === 'failed' ? (
        <p data-part="file-field-error" role="alert" className="text-body-sm text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The `multiple` column's editor (38-files-library-and-attachments.md D19).
 *
 * WHAT IS DIFFERENT FROM THE SINGLE FIELD, AND WHY EACH DIFFERENCE EXISTS:
 *
 *  - the picker is `multiple`, and each pick is its OWN upload request. The
 *    transport takes one file per call (`FileFieldUpload`), which is what lets
 *    every file have its own progress row and its own failure — one bad file
 *    in a selection of five must not lose the other four.
 *  - uploads run in SEQUENCE, not in parallel. Five concurrent 200 MB PUTs
 *    would compete for the same upstream and report five progress bars that
 *    all crawl; one at a time finishes the first file first, which is also the
 *    order the chips appear in.
 *  - there is no "Replace". Replacing an item in a list is removing one and
 *    adding another, and the list makes both directly.
 *  - the value is the JSON array (`formatRefList`), and `null` when the list
 *    is emptied — never `'[]'`.
 *
 * `maxCount` disables the control at the cap and says so. That is courtesy:
 * the server enforces the same number at write time, because it is the only
 * place a per-record count is knowable.
 */
function FileListField({
  column,
  value,
  onChange,
  upload,
  resolvedByRef,
  maxBytes,
  accept,
  inputId,
}: FileFieldProps & { upload: FileFieldUpload }): ReactNode {
  const t = useMaybeT();
  const [uploads, setUploads] = useState<readonly UploadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * What THIS field uploaded in this session, so a chip is right immediately
   * rather than after the host's next resolve round-trip — the same reason the
   * single field keeps `justUploaded`.
   */
  const [minted, setMinted] = useState<ReadonlyMap<string, ResolvedFile>>(() => new Map());
  const picker = useRef<HTMLInputElement>(null);

  const refs = useMemo(() => parseRefList(value), [value]);
  const maxCount = column.file?.maxCount;
  const full = maxCount !== undefined && refs.length >= maxCount;

  async function addFiles(chosen: readonly File[]): Promise<void> {
    setError(null);
    // Slice to the cap before uploading anything: refusing after the bytes
    // have landed would leave files nothing points at.
    const room = maxCount === undefined ? chosen.length : Math.max(0, maxCount - refs.length);
    const accepted = chosen.slice(0, room);
    if (accepted.length < chosen.length && maxCount !== undefined) {
      setError(
        t?.(
          'ui:templates.crud.file.capReached',
          'This record accepts at most {count, plural, one {# file} other {# files}}.',
          { count: maxCount },
        ) ?? `This record accepts at most ${String(maxCount)} file(s).`,
      );
    }

    const added: string[] = [];
    for (const file of accepted) {
      if (maxBytes !== undefined && file.size > maxBytes) {
        // Refused before a byte leaves the browser. The server enforces the
        // same cap — this is courtesy, not the boundary.
        setError(
          t?.('ui:templates.crud.file.tooLarge', 'That file is larger than the {limit} limit.', {
            limit: formatBytes(maxBytes),
          }) ?? `That file is larger than the ${formatBytes(maxBytes)} limit.`,
        );
        continue;
      }
      const abort = new AbortController();
      const row: UploadRow = { name: file.name, fraction: 0, abort };
      setUploads((current) => [...current, row]);
      try {
        const result = await upload({
          file,
          column: column.name,
          signal: abort.signal,
          onProgress: (fraction) =>
            setUploads((current) => current.map((r) => (r === row ? { ...r, fraction } : r))),
        });
        added.push(result.ref);
        setMinted((current) => new Map(current).set(result.ref, result.file));
      } catch (reason) {
        if (!abort.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        setUploads((current) => current.filter((r) => r !== row));
      }
    }

    // ONE `onChange` for the whole selection, computed from the refs this
    // function started with: calling it per file would race the parent's
    // state, and the second call would be built on a `value` prop that had not
    // re-rendered yet.
    if (added.length > 0) onChange(formatRefList([...refs, ...added]));
  }

  function removeAt(index: number): void {
    onChange(formatRefList(refs.filter((_, i) => i !== index)));
  }

  return (
    <div data-part="file-list-field" className="flex flex-col gap-2">
      <input
        ref={picker}
        id={inputId}
        type="file"
        multiple
        className="sr-only"
        aria-label={pickerLabel(column, t)}
        {...(accept === undefined ? {} : { accept })}
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          // Reset so choosing the SAME file again still fires a change.
          event.target.value = '';
          if (chosen.length > 0) void addFiles(chosen);
        }}
      />

      {refs.length > 0 ? (
        <ul data-part="file-list-items" className="flex flex-col gap-1">
          {refs.map((ref, index) => {
            const file = minted.get(ref) ?? resolvedByRef?.get(ref) ?? null;
            return (
              <li key={`${ref}-${String(index)}`} className="flex items-center gap-2">
                <Paperclip aria-hidden className="size-4 shrink-0 text-fg-muted" />
                {file === null ? (
                  // A value with nothing resolved behind it: a foreign URL, or
                  // a reference this reader cannot see. Shown verbatim — the
                  // column's value is the truth.
                  <MonoText className="min-w-0 flex-1 truncate text-body-sm">{ref}</MonoText>
                ) : (
                  <a
                    href={file.contentPath}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-body-sm font-medium text-accent underline decoration-accent/40 underline-offset-2"
                  >
                    {file.filename} <span className="text-fg-subtle">{formatBytes(file.sizeBytes)}</span>
                  </a>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeAt(index)}
                  aria-label={
                    t?.('ui:templates.crud.file.removeNamed', 'Remove {name}', {
                      name: file?.filename ?? ref,
                    }) ?? `Remove ${file?.filename ?? ref}`
                  }
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {uploads.map((row, index) => (
        <div
          key={`${row.name}-${String(index)}`}
          data-part="file-list-progress"
          className="flex items-center gap-2"
        >
          <div
            role="progressbar"
            aria-label={t?.('ui:templates.crud.file.uploading', 'Uploading') ?? 'Uploading'}
            aria-valuenow={Math.round(row.fraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
          >
            <div
              className="h-full w-[var(--adm-progress)] bg-accent transition-[width]"
              style={{ '--adm-progress': `${String(Math.round(row.fraction * 100))}%` }}
            />
          </div>
          <span className="truncate text-body-sm text-fg-muted">{row.name}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => row.abort.abort()}
            aria-label={t?.('ui:templates.crud.file.cancel', 'Cancel upload') ?? 'Cancel upload'}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      ))}

      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={full}
          onClick={() => picker.current?.click()}
          data-part="file-list-add"
        >
          <Upload aria-hidden className="size-4" />
          {t?.('ui:templates.crud.file.add', 'Add files') ?? 'Add files'}
        </Button>
      </div>

      {full ? (
        <p data-part="file-list-full" className="text-caption text-fg-muted">
          {t?.(
            'ui:templates.crud.file.capReached',
            'This record accepts at most {count, plural, one {# file} other {# files}}.',
            { count: maxCount },
          ) ?? `This record accepts at most ${String(maxCount ?? 0)} file(s).`}
        </p>
      ) : null}

      {error !== null ? (
        <p data-part="file-list-error" role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
