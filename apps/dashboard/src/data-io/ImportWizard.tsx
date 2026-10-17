// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The import wizard itself — the four-step flow on the `page-wizard` shell:
 * Upload (the host's own choice of table, then `upload-dropzone`, or rows
 * pasted from a spreadsheet) → Map columns (`column-mapping-table`,
 * auto-match, "Don't import", and the column lines are matched on) → Validate
 * (`validation-issues-list`, NON-BLOCKING: invalid rows are counted as
 * rows-to-skip, never a wall; and the server's preview of each line: new,
 * already here, or refused) → Import & review (the job's progress, asked for
 * every second and at once when the host hears of a change, then the review
 * numbers).
 *
 * ONE WIZARD, MORE THAN ONE HOST. Nothing here knows the dashboard: not its
 * session, its query cache, its router, its live stream or its catalogue of
 * words. The host hands over a `client` (the import doors of the server, by
 * whatever means it reaches them), a `t` (its words), the table chosen and,
 * where the person chooses it, the picker to draw. The dashboard's page is
 * one host (`ImportWizardPage.tsx`); a part mounted on an app's own screen is
 * to be another, which is why no import here may reach a module of the
 * dashboard's first paint.
 *
 * NUMBER CONSISTENCY IS AN INVARIANT: imported = created + updated + skipped
 * — asserted here in the component; a mismatch renders the inconsistency
 * warning instead of silently pretty-printing wrong math.
 *
 * Once the lines have been looked at (and all of them were), the step's
 * summary and its Run button speak from that look and the chosen mode: the
 * type check alone counts a line that is already here as one "ready to
 * import", and would contradict the preview beside it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Alert, Badge, Button, Checkbox, ProgressBar, Select, Spinner, Textarea } from '@adminium/ui';
import { DEFAULT_MAPPING_TARGETS, IssuesList, MappingTable, PageWizard, SKIP_TARGET, UploadDropzone, mappingRowsFor, type ValidationIssue } from '@adminium/widgets/kit-import';

import type {
  ImportDto,
  ImportMapping,
  ImportOptions,
  ImportPreviewDto,
  ImportPreviewLineDto,
  JobDto,
  UploadPreview,
  ValidationReportDto,
} from './api.js';

/** The host's words: a key, the English beside it, and what is put in. */
export type ImportWords = (key: string, fallback: string, args?: Record<string, unknown>) => string;

/**
 * The server's import doors, as the host reaches them. The shapes are the
 * dashboard's own client's (`dataIoApi`), so that client is one as it stands.
 * A refusal is thrown as an `Error` whose `message` is the server's sentence,
 * with the server's `code` and `details` on it when it sent them.
 */
export interface ImportClient {
  uploadImportFile(file: File, opts?: { header?: 'first-row' | 'none' }): Promise<UploadPreview>;
  createImport(input: { fileId: string; connectionId: string; table: string; mapping: ImportMapping; options?: ImportOptions }): Promise<{ data: { import: ImportDto; report: ValidationReportDto } }>;
  previewImport(id: string, page?: { offset?: number; limit?: number }): Promise<ImportPreviewDto>;
  runImport(id: string): Promise<{ data: { import: ImportDto; jobId: string } }>;
  getImport(id: string): Promise<ImportDto>;
  getJob(jobId: string): Promise<JobDto>;
  errorReportHref(id: string): string;
  /**
   * Hears of a running job from the server (a live stream) and calls
   * `changed` when something moved; answers the way to stop listening. Left
   * out, the wizard asks every second and nothing is lost but a moment.
   */
  watchJob?: ((jobId: string, changed: () => void) => () => void) | undefined;
}

export interface ImportTarget {
  connectionId: string;
  table: string;
  /** Destination field catalog (from the page's `config.columns[]`). */
  columns: { key: string; label?: string }[];
}

export interface ImportWizardProps {
  client: ImportClient;
  t: ImportWords;
  /** The table rows go into; null until the person has chosen one. */
  target: ImportTarget | null;
  /** What the table is called in sentences (a refusal names it). */
  targetName: string;
  /** Drawn at the head of the first step: the host's own way of choosing the table, and what it has to say of the choice. */
  targetPicker?: ReactNode | undefined;
  /** The target column lines are matched on, chosen already (the kit's `matchOn`); the person may still change it. */
  matchOn?: string | undefined;
  /**
   * The only target columns lines may be matched on (the ones the host knows
   * no two rows share). Left out, any column the mapping brings in.
   */
  matchColumns?: readonly string[] | undefined;
  /**
   * What may be done with a line that is already here, the first being the
   * one chosen to begin with. Left out, both, leaving them first. With one,
   * the person is not asked.
   */
  modes?: readonly ('skip' | 'upsert')[] | undefined;
  /** Whether a file is dropped, rows are pasted, or either. Left out, both. */
  sources?: readonly ('file' | 'paste')[] | undefined;
  /** Called once for each import that has run, with what it did. */
  onDone?: ((result: ImportOutcome) => void) | undefined;
  /** Gives the last step a "Close" button, and is called by it. */
  onClose?: (() => void) | undefined;
}

/** What an import did. `failed` are the lines the server refused; they are among `skipped`. */
export interface ImportOutcome {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

/** A refusal's `code` and `details`, read off whatever the client threw: the dashboard's `ApiError` carries them, and so may any other host's. */
function refusalOf(error: unknown): { code: unknown; status: unknown; permission: string | null; message: string | null } {
  const thrown = error as { code?: unknown; status?: unknown; details?: unknown } | null | undefined;
  const permission = (thrown?.details as { permission?: unknown } | null | undefined)?.permission;
  return {
    code: thrown?.code,
    status: thrown?.status,
    permission: thrown?.code === 'TABLE_FORBIDDEN' && typeof permission === 'string' ? permission : null,
    message: error instanceof Error && error.message !== '' ? error.message : null,
  };
}

/** How many lines of the preview are asked for at a time. */
const PREVIEW_PAGE = 100;

/**
 * The footer's buttons. The assistant's button floats over the page's bottom
 * end corner, where they are: while it is drawn the shell sets `--toast-lift`
 * (its 48 px and a gap — what lifts the toasts clear of it), and the buttons
 * keep that much room at the end side; without it, none. From 1440 px up the
 * page's column ends short of the button, and no room is needed.
 */
const FOOTER_ACTIONS = 'flex min-w-0 flex-wrap items-center justify-end gap-2 max-[1439px]:pe-[var(--toast-lift,0px)]';

type StepId = 'upload' | 'map' | 'validate' | 'run';

const STEP_IDS: readonly StepId[] = ['upload', 'map', 'validate', 'run'];

/** One group of the type check's issues: its title in words, and a line of the file as its example. */
function issueWords(t: ImportWords, issue: { row: number; column: string; code: string; message: string; value: string }, column: string): { title: string; desc: string } {
  const title =
    issue.code === 'REQUIRED'
      ? t('dataio:import.issueRequired', '{column}: empty, and a value is needed', { column })
      : issue.code === 'BAD_NUMBER'
        ? t('dataio:import.issueBadNumber', '{column}: not a number', { column })
        : issue.code === 'BAD_BOOLEAN'
          ? t('dataio:import.issueBadBoolean', '{column}: not a yes or a no', { column })
          : issue.code === 'BAD_DATE'
            ? t('dataio:import.issueBadDate', '{column}: not a date', { column })
            : issue.code === 'BAD_JSON'
              ? t('dataio:import.issueBadJson', '{column}: not valid JSON', { column })
              : // A code this screen has no sentence for: what the server said of it.
                t('dataio:import.issueOther', '{column}: {message}', { column, message: issue.message });
  const desc =
    issue.value.trim() === ''
      ? t('dataio:import.issueExampleLine', 'For example on line {row}.', { row: issue.row })
      : t('dataio:import.issueExample', 'For example “{value}”, on line {row}.', { value: issue.value, row: issue.row });
  return { title, desc };
}

/** The wizard invariant — exported for tests. */
export function statsConsistent(stats: {
  total: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
}): boolean {
  return stats.total === (stats.inserted ?? 0) + (stats.updated ?? 0) + (stats.skipped ?? 0);
}

/** How often a running job and its import are asked after. */
const POLL_MS = 1_000;

/**
 * One call to the server and where it stands: what a button reads while it
 * waits, and what went wrong. `mutate` starts it; the callbacks are the
 * newest ones given, and nothing is written once the wizard is gone.
 */
function useAction<Arg, Result>(
  run: (arg: Arg) => Promise<Result>,
  on: { start?: () => void; success?: (result: Result) => void; error?: (error: unknown) => void } = {},
): { mutate: (arg: Arg) => void; isPending: boolean; isError: boolean; error: unknown } {
  const [state, setState] = useState<{ isPending: boolean; isError: boolean; error: unknown }>({ isPending: false, isError: false, error: null });
  const latest = useRef({ run, on });
  latest.current = { run, on };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const mutate = useCallback((arg: Arg) => {
    latest.current.on.start?.();
    setState({ isPending: true, isError: false, error: null });
    latest.current.run(arg).then(
      (result) => {
        if (!alive.current) return;
        setState({ isPending: false, isError: false, error: null });
        latest.current.on.success?.(result);
      },
      (error: unknown) => {
        if (!alive.current) return;
        setState({ isPending: false, isError: true, error });
        latest.current.on.error?.(error);
      },
    );
  }, []);
  return { ...state, mutate };
}

/**
 * Something of the server's asked for now and again while `again` says there
 * is more to come: a job that is still running. `key` null asks nothing. An
 * answer that fails leaves the last one standing and is asked again like any
 * other. `poke` asks at once (the host heard of a change).
 */
function usePolled<T>(key: string | null, read: (key: string) => Promise<T>, again: (data: T | undefined) => boolean): { data: T | undefined; poke: () => void } {
  const [held, setHeld] = useState<{ key: string; data: T } | null>(null);
  const latest = useRef({ read, again });
  latest.current = { read, again };
  const poke = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (key === null) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: T | undefined;
    const ask = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      latest.current
        .read(key)
        .then(
          (data) => {
            if (stopped) return;
            last = data;
            setHeld({ key, data });
          },
          () => undefined,
        )
        .then(() => {
          if (stopped || timer !== undefined || !latest.current.again(last)) return;
          timer = setTimeout(ask, POLL_MS);
        });
    };
    poke.current = ask;
    ask();
    return () => {
      stopped = true;
      poke.current = () => undefined;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [key]);
  return { data: held !== null && held.key === key ? held.data : undefined, poke: useCallback(() => poke.current(), []) };
}

export function ImportWizard({ client, t, target, targetName, targetPicker, matchOn: initialMatchOn, matchColumns, modes, sources, onDone, onClose }: ImportWizardProps) {
  const [step, setStep] = useState<StepId>('upload');
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // from → to; SKIP_TARGET = explicit "Don't import"; absent = undecided.
  const mappingRef = useRef<Record<string, string>>({});
  // The target columns the mapping brings in now: what a line can be matched on.
  const [mappedTargets, setMappedTargets] = useState<string[]>([]);
  const [pasted, setPasted] = useState('');
  const [firstRowNames, setFirstRowNames] = useState(true);
  const [matchOn, setMatchOn] = useState(initialMatchOn ?? '');
  // What the host allows for a line already here; with nothing said, either, leaving it first.
  const allowedModes: readonly ('skip' | 'upsert')[] = modes !== undefined && modes.length > 0 ? modes : ['skip', 'upsert'];
  const [chosenMode, setWhenHere] = useState<'skip' | 'upsert'>(allowedModes[0] ?? 'skip');
  // A choice the host has since taken away is not kept.
  const whenHere = allowedModes.includes(chosenMode) ? chosenMode : (allowedModes[0] ?? 'skip');
  const offersFile = sources === undefined || sources.length === 0 || sources.includes('file');
  const offersPaste = sources === undefined || sources.length === 0 || sources.includes('paste');
  const [linePreview, setLinePreview] = useState<ImportPreviewDto | null>(null);
  const [previewLines, setPreviewLines] = useState<ImportPreviewLineDto[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importRow, setImportRow] = useState<ImportDto | null>(null);
  const [report, setReport] = useState<ValidationReportDto | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // The import on screen, readable by an answer that arrives late: "Show more" for one the person went back from is dropped.
  const importIdRef = useRef<string | null>(null);
  importIdRef.current = importRow?.id ?? null;

  // --- upload -------------------------------------------------------------------

  const uploadMutation = useAction((upload: { file: File; header?: 'first-row' | 'none' }) => client.uploadImportFile(upload.file, upload.header === 'none' ? { header: 'none' } : {}), {
    success: (data) => {
      setPreview(data);
      setUploadError(null);
      mappingRef.current = {};
      setStep('map');
    },
    error: (error: unknown) => {
      const refusal = refusalOf(error);
      // More than the door takes, in the reader's words; anything else as the server said it.
      setUploadError(refusal.code === 'PAYLOAD_TOO_LARGE' || refusal.status === 413 ? t('dataio:import.tooLarge', 'This is more than an import takes: 32 MB at most.') : (refusal.message ?? String(error)));
    },
  });

  // --- mapping --------------------------------------------------------------------

  // What a column of the file can go to: the table's columns, as the host named them.
  const mappingTargets = useMemo(() => (target === null ? null : target.columns.length > 0 ? target.columns : DEFAULT_MAPPING_TARGETS), [target]);

  // The file's columns, each with the first line's value as its sample, and matched to a target by its name.
  const mappingRows = useMemo(
    () =>
      preview === null || mappingTargets === null
        ? null
        : mappingRowsFor(preview.columns.map((column, index) => ({ column, sample: preview.sampleRows[0]?.[index] ?? '' })), mappingTargets, true),
    [preview, mappingTargets],
  );

  // The table shows its own matches before anyone opens a picker, but tells
  // us about a mapping only when one changes. Start from what it shows, or a
  // file whose headers already match would import no columns.
  const targetsOf = (mapping: Record<string, string>): string[] => [
    ...new Set(Object.values(mapping).filter((to) => to !== '' && to !== SKIP_TARGET)),
  ];
  useEffect(() => {
    if (step !== 'map' || mappingRows === null) return;
    mappingRef.current = Object.fromEntries(mappingRows.filter((row) => row.target !== '').map((row) => [row.column, row.target]));
    setMappedTargets(targetsOf(mappingRef.current));
  }, [step, mappingRows]);

  const onMapping = useCallback((mapping: Record<string, string>) => {
    mappingRef.current = mapping;
    setMappedTargets(targetsOf(mapping));
  }, []);

  // A match column is one the mapping brings in. One it does not bring in (a page named it and no
  // column of the file is mapped to it, or its mapping was taken away) cannot be matched on — and
  // is not quietly read as "every line is new": the step says so, and waits for the person to map
  // it or to choose something else to match on.
  // What a line may be matched on: a column the mapping brings in and, where the host named them, one of those only.
  const matchable = matchColumns === undefined ? mappedTargets : mappedTargets.filter((key) => matchColumns.includes(key));
  const matchUnmapped = matchOn !== '' && !mappedTargets.includes(matchOn);
  const matchColumn = matchUnmapped ? '' : matchOn;
  const matchLabel = target?.columns.find((column) => column.key === matchOn)?.label ?? matchOn;

  // --- validate ---------------------------------------------------------------------

  const validateMutation = useAction(
    async () => {
      if (target === null || preview === null) throw new Error('wizard state out of order');
      const columns = preview.columns.map((from) => {
        const to = mappingRef.current[from];
        return { from, to: to === undefined || to === '' || to === SKIP_TARGET ? null : to };
      });
      const reply = await client.createImport({
        fileId: preview.fileId,
        connectionId: target.connectionId,
        table: target.table,
        mapping: { columns },
        options: matchColumn === '' ? { mode: 'insert', skipInvalid: true } : { mode: whenHere, matchColumn, skipInvalid: true },
      });
      // What the import would do with each line, asked before anything is written. The import stands without it.
      try {
        return { reply, lines: await client.previewImport(reply.data.import.id, { offset: 0, limit: PREVIEW_PAGE }), failed: null };
      } catch (error) {
        return { reply, lines: null, failed: error instanceof Error ? error.message : String(error) };
      }
    },
    {
      success: ({ reply, lines, failed }) => {
        setImportRow(reply.data.import);
        setReport(reply.data.report);
        setLinePreview(lines);
        setPreviewLines(lines?.lines ?? []);
        setPreviewError(failed);
        setStep('validate');
      },
    },
  );

  // A refusal of the table's rights, in the reader's words and by the table's name; null for anything else.
  const rightRefused = (error: unknown): string | null => {
    const { permission } = refusalOf(error);
    if (permission === null) return null;
    if (permission.endsWith(':import')) return t('dataio:import.noImportRight', 'You do not hold the right to import into {table}. Ask an administrator for it.', { table: targetName });
    if (permission.endsWith(':read')) {
      return t(
        'dataio:import.noReadToMatch',
        'Matching lines against the rows already there needs the right to read {table}. Match on nothing, or ask an administrator for it.',
        { table: targetName },
      );
    }
    if (permission.endsWith(':update')) {
      return t('dataio:import.noUpdateRight', 'You do not hold the right to change rows of {table}. Leave the lines already here as they are, or ask an administrator for it.', { table: targetName });
    }
    return null;
  };
  const validateError = !validateMutation.isError
    ? null
    : (rightRefused(validateMutation.error) ?? refusalOf(validateMutation.error).message ?? t('dataio:import.validateFailed', 'Validation failed.'));

  const moreLines = useAction(
    async () => {
      if (importRow === null) throw new Error('nothing to preview');
      const id = importRow.id;
      return { id, page: await client.previewImport(id, { offset: previewLines.length, limit: PREVIEW_PAGE }) };
    },
    {
      start: () => setPreviewError(null),
      success: ({ id, page }) => {
        // An answer for an import the person has gone back from: its lines are not this import's.
        if (importIdRef.current !== id) return;
        setLinePreview(page);
        setPreviewLines((shown) => [...shown, ...page.lines.filter((line) => !shown.some((had) => had.row === line.row))]);
      },
      error: (error: unknown) => {
        // Said in the same warning as a first look that failed; the lines already shown stay.
        setPreviewError(error instanceof Error ? error.message : String(error));
      },
    },
  );

  // Whether running would write anything at all: no row passed validation, or every line that was
  // looked at is refused or is already here and left as it is. Not known when the lines could not
  // be looked at, or when only the first of them were: the run is then offered as before.
  const nothingToBring =
    report !== null &&
    (report.valid === 0 ||
      (linePreview !== null &&
        !linePreview.capped &&
        linePreview.counts.new === 0 &&
        (importRow?.options.mode !== 'upsert' || linePreview.counts.here === 0)));

  // What the lines' look says the run would do, when every line was looked at: the only whole-file figures that
  // know a line is already here. Null when the look failed or covered the first lines only — the type check's
  // figures then stand, being the only ones of the whole file.
  const judged = linePreview !== null && !linePreview.capped ? linePreview.counts : null;
  const updates = importRow?.options.mode === 'upsert';
  const judgedSummary =
    judged === null
      ? null
      : updates && judged.here > 0
        ? judged.new > 0
          ? t(
              'dataio:import.summaryNewAndUpdate',
              '{created, plural, one {# new line will be brought in} other {# new lines will be brought in}}, and {updated, plural, one {# line already here updated.} other {# lines already here updated.}}',
              { created: judged.new, updated: judged.here },
            )
          : t('dataio:import.summaryUpdateOnly', '{count, plural, one {# line already here will be updated.} other {# lines already here will be updated.}}', { count: judged.here })
        : judged.new > 0
          ? t('dataio:import.summaryNew', '{count, plural, one {# new line will be brought in.} other {# new lines will be brought in.}}', { count: judged.new })
          : '';
  // What happens to the lines the run does not write.
  const judgedRest =
    judged === null
      ? ''
      : [
          !updates && judged.here > 0 ? t('dataio:import.restHere', '{count} already here will be left as they are', { count: judged.here }) : '',
          judged.refused > 0 ? t('dataio:import.restRefused', '{count} refused', { count: judged.refused }) : '',
        ]
          .filter((part) => part !== '')
          .join(' · ');
  const runLabel = ((): string => {
    if (judged !== null && !nothingToBring) {
      if (updates && judged.here > 0) {
        return judged.new > 0
          ? t('dataio:import.runNewAndUpdate', 'Bring in {created, plural, one {# new line} other {# new lines}} and update {updated}', { created: judged.new, updated: judged.here })
          : t('dataio:import.runUpdateOnly', '{count, plural, one {Update # line} other {Update # lines}}', { count: judged.here });
      }
      return t('dataio:import.runNew', '{count, plural, one {Bring in # new line} other {Bring in # new lines}}', { count: judged.new });
    }
    return judged === null && report !== null && report.invalid > 0
      ? t('dataio:import.runSkipping', 'Import {valid} rows (skip {invalid})', { valid: report.valid, invalid: report.invalid })
      : t('dataio:import.run', 'Run import');
  })();

  const targetColumns = target?.columns;
  const issues = useMemo<ValidationIssue[]>(() => {
    if (report === null) return [];
    // Aggregate row-level issues into (column, code) triage lines.
    const grouped = new Map<string, { title: string; desc: string; count: number }>();
    for (const issue of report.issues) {
      const key = `${issue.column}:${issue.code}`;
      const existing = grouped.get(key);
      if (existing !== undefined) existing.count += 1;
      else grouped.set(key, { ...issueWords(t, issue, targetColumns?.find((column) => column.key === issue.column)?.label ?? issue.column), count: 1 });
    }
    const rows: Omit<ValidationIssue, 'key'>[] = [...grouped.values()].map((row) => ({ severity: 'warn', ...row }));
    if (report.invalid === 0) {
      rows.push({
        severity: 'info',
        title: t('dataio:import.allValid', 'All rows passed validation'),
        desc: '',
        count: report.total,
      });
    }
    return rows.map((row, index) => ({ key: `${row.title}-${String(index)}`, ...row }));
  }, [report, targetColumns, t]);

  // --- run ----------------------------------------------------------------------------

  const runMutation = useAction(
    async () => {
      if (importRow === null) throw new Error('nothing to run');
      return client.runImport(importRow.id);
    },
    {
      success: (reply) => {
        setJobId(reply.data.jobId);
        setStep('run');
      },
    },
  );

  const job = usePolled(jobId, (id) => client.getJob(id), (data) => data === undefined || data.status === 'pending' || data.status === 'running');
  const importPoll = usePolled(
    importRow !== null && step === 'run' ? importRow.id : null,
    (id) => client.getImport(id),
    (data) => data !== undefined && (data.status === 'running' || data.status === 'ready'),
  );
  const finished = importPoll.data ?? importRow;
  // Still running until the import itself says it is over, or its job says it will never be. The two are asked
  // apart and answer in any order: a job last heard of as running, beside an import that has since finished, is
  // old news, and an import not yet heard of at all is not one that failed.
  const over = finished?.status === 'succeeded' || finished?.status === 'failed' || finished?.status === 'cancelled';
  const running = jobId !== null && !over && job.data?.status !== 'failed' && job.data?.status !== 'cancelled';

  // Where the host can hear of the job from the server, what it hears only hurries the asking:
  // a host with no live stream loses nothing but a moment.
  const { watchJob } = client;
  const pokeJob = job.poke;
  const pokeImport = importPoll.poke;
  useEffect(() => {
    if (jobId === null || watchJob === undefined) return undefined;
    return watchJob(jobId, () => {
      pokeJob();
      pokeImport();
    });
  }, [jobId, watchJob, pokeJob, pokeImport]);

  // The host is told once of each import that has run, with what it did.
  const toldOf = useRef<string | null>(null);
  const done = finished !== null && !running && finished.stats !== null && (finished.status === 'succeeded' || finished.status === 'failed') ? finished : null;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (done === null || done.stats === null || step !== 'run' || toldOf.current === done.id) return;
    toldOf.current = done.id;
    const skipped = done.stats.skipped ?? 0;
    onDoneRef.current?.({ created: done.stats.inserted ?? 0, updated: done.stats.updated ?? 0, skipped, failed: Math.max(0, skipped - (done.stats.alreadyHere ?? 0)) });
  }, [done, step]);

  // --- render -------------------------------------------------------------------------

  const steps = [
    { id: 'upload', label: t('dataio:import.stepUpload', 'Upload') },
    { id: 'map', label: t('dataio:import.stepMap', 'Map columns') },
    { id: 'validate', label: t('dataio:import.stepValidate', 'Validate') },
    { id: 'run', label: t('dataio:import.stepRun', 'Import & review') },
  ];

  const stats = finished?.stats ?? null;
  const consistent = stats === null || statsConsistent(stats);

  const body = ((): ReactElement => {
    switch (step) {
      case 'upload':
        return (
          <div className="flex flex-col gap-4">
            {targetPicker}
            {uploadError !== null ? <Alert tone="danger" title={uploadError} /> : null}
            {offersFile ? (
              <UploadDropzone
                accept=".csv,text/csv"
                multiple={false}
                disabled={target === null || uploadMutation.isPending}
                dropTitle={t('dataio:import.dropTitle', 'Drop a CSV file to import')}
                hint={t('dataio:import.dropHint', 'CSV up to 32 MB — the first row must be the header')}
                onFiles={(files) => {
                  const file = files[0];
                  if (file !== undefined) uploadMutation.mutate({ file });
                }}
                testId="import-upload"
              />
            ) : null}
            {offersPaste ? (
              <div className="flex min-w-0 flex-col gap-2" data-testid="import-paste">
                <label className="flex flex-col gap-1.5">
                  <span className="text-body-sm font-medium text-fg">
                    {t('dataio:import.pasteLabel', 'Or paste rows copied from a spreadsheet')}
                  </span>
                  <Textarea
                    value={pasted}
                    rows={4}
                    disabled={target === null || uploadMutation.isPending}
                    onChange={(event) => setPasted(event.target.value)}
                  />
                </label>
                <label className="flex items-start gap-2 text-body-sm text-fg">
                  <Checkbox className="mt-0.5" checked={firstRowNames} onCheckedChange={(next) => setFirstRowNames(next === true)} />
                  <span>{t('dataio:import.pasteFirstRow', 'The first row holds the column names')}</span>
                </label>
                <div>
                  <Button
                    variant="secondary"
                    disabled={target === null || uploadMutation.isPending || pasted.trim() === ''}
                    onClick={() =>
                      uploadMutation.mutate({
                        file: new File([pasted], 'pasted.csv', { type: 'text/csv' }),
                        header: firstRowNames ? 'first-row' : 'none',
                      })
                    }
                    data-testid="import-paste-use"
                  >
                    {t('dataio:import.pasteUse', 'Use these rows')}
                  </Button>
                </div>
              </div>
            ) : null}
            {uploadMutation.isPending ? <Spinner size="sm" /> : null}
          </div>
        );
      case 'map':
        return preview === null || mappingRows === null || mappingTargets === null ? (
          <Spinner size="md" />
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <p className="text-body-sm text-fg-muted">
              {t('dataio:import.mapHint', '{count} data rows in {file} — choose a target for each column.', {
                count: preview.totalRows,
                file: preview.filename,
              })}
            </p>
            <MappingTable rows={mappingRows} targets={mappingTargets} skipLabel={t('dataio:import.skipTarget', 'Don’t import')} onMapping={onMapping} />
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
              <label className="flex min-w-0 max-w-md flex-1 flex-col gap-1.5">
                <span className="text-body-sm font-medium text-fg">{t('dataio:import.matchLabel', 'Match on')}</span>
                <Select value={matchUnmapped ? matchOn : matchColumn} onChange={(event) => setMatchOn(event.currentTarget.value)} data-testid="import-match-on">
                  <option value="">{t('dataio:import.matchNone', 'Nothing: every line is new')}</option>
                  {/* The choice as it stands, though nothing is mapped to it: shown, so it can be seen and changed. */}
                  {matchUnmapped ? <option value={matchOn}>{matchLabel}</option> : null}
                  {matchable.map((key) => (
                    <option key={key} value={key}>
                      {target?.columns.find((column) => column.key === key)?.label ?? key}
                    </option>
                  ))}
                </Select>
                {matchColumn !== '' ? (
                  <span className="text-caption text-fg-muted">
                    {t(
                      'dataio:import.matchHint',
                      'A line whose value in this column is already in the table is not added a second time.',
                    )}
                  </span>
                ) : null}
              </label>
              {matchColumn !== '' && allowedModes.length > 1 ? (
                <label className="flex min-w-0 max-w-md flex-1 flex-col gap-1.5">
                  <span className="text-body-sm font-medium text-fg">
                    {t('dataio:import.whenHereLabel', 'Lines already here')}
                  </span>
                  <Select
                    value={whenHere}
                    onChange={(event) => setWhenHere(event.currentTarget.value === 'upsert' ? 'upsert' : 'skip')}
                    data-testid="import-when-here"
                  >
                    <option value="skip">{t('dataio:import.whenHereSkip', 'Leave them as they are')}</option>
                    <option value="upsert">{t('dataio:import.whenHereUpdate', 'Update them')}</option>
                  </Select>
                </label>
              ) : null}
            </div>
            {matchUnmapped ? (
              <Alert
                tone="warn"
                data-testid="import-match-unmapped"
                title={t('dataio:import.matchUnmapped', 'Lines cannot be matched on {column}: no column of the file is mapped to it.', { column: matchLabel })}
              />
            ) : null}
            {validateError !== null ? <Alert tone="danger" title={validateError} /> : null}
          </div>
        );
      case 'validate':
        return report === null ? (
          <Spinner size="md" />
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            {judgedSummary === null ? (
              <p className="text-body-sm text-fg" data-testid="validation-summary">
                {t(
                  'dataio:import.validationSummary',
                  '{valid} of {total} rows ready to import — {invalid} will be skipped.',
                  { valid: report.valid, total: report.total, invalid: report.invalid },
                )}
              </p>
            ) : (
              // Every line was looked at: what the run would do, in the look's own figures.
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-body-sm font-medium text-fg" data-testid="validation-summary">
                  {judgedSummary === '' ? (
                    // No line would be written: that is the summary.
                    <span data-testid="import-nothing">{t('dataio:import.nothingToBring', 'Nothing here would be brought in.')}</span>
                  ) : (
                    judgedSummary
                  )}
                </p>
                {judgedRest === '' ? null : (
                  <p className="text-body-sm text-fg-muted [overflow-wrap:anywhere]" data-testid="validation-rest">
                    {judgedRest}
                  </p>
                )}
              </div>
            )}
            <IssuesList issues={issues} />
            {runMutation.isError ? (
              // A run the server refused (the right to update is checked again when it runs): said here, where the button is.
              <Alert
                tone="danger"
                data-testid="import-run-refused"
                title={rightRefused(runMutation.error) ?? t('dataio:import.runFailed', 'The import failed.')}
                {...(rightRefused(runMutation.error) === null && refusalOf(runMutation.error).message !== null ? { body: refusalOf(runMutation.error).message ?? '' } : {})}
              />
            ) : null}
            {previewError !== null ? (
              <Alert
                tone="warn"
                title={t('dataio:import.previewFailed', 'The lines could not be looked at before the import.')}
                body={previewError}
              />
            ) : null}
            {nothingToBring && judgedSummary !== '' ? (
              <p className="text-body-sm font-medium text-fg" data-testid="import-nothing">
                {t('dataio:import.nothingToBring', 'Nothing here would be brought in.')}
              </p>
            ) : null}
            {linePreview !== null ? (
              <div className="flex min-w-0 flex-col gap-3" data-testid="import-preview">
                <div className={`grid gap-3 ${importRow?.options.matchColumn ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {(
                    [
                      ['new', t('dataio:import.previewNew', 'New'), linePreview.counts.new],
                      // With nothing to match on, no line can be here already.
                      ...(importRow?.options.matchColumn
                        ? ([['here', t('dataio:import.previewHere', 'Already here'), linePreview.counts.here]] as const)
                        : []),
                      ['refused', t('dataio:import.previewRefused', 'Refused'), linePreview.counts.refused],
                    ] as const
                  ).map(([kind, label, value]) => (
                    <div key={kind} className="min-w-0 rounded-lg border border-border bg-surface p-3" data-count={kind}>
                      <div className="text-caption font-bold uppercase tracking-wide text-fg-subtle [overflow-wrap:anywhere]">
                        {label}
                      </div>
                      <div className="font-mono text-title text-fg tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>
                {linePreview.capped ? (
                  <p className="text-body-sm text-fg-muted">
                    {t(
                      'dataio:import.previewCapped',
                      'Only the first {judged} of {total} lines were looked at. The rest are judged when the import runs.',
                      { judged: linePreview.judged, total: linePreview.total },
                    )}
                  </p>
                ) : null}
                {linePreview.hooksNotRun ? (
                  <p className="text-body-sm text-fg-muted">
                    {t(
                      'dataio:import.previewHooksNotRun',
                      'This project’s own code also checks rows of this table. It runs only when the import runs, so it may still refuse a line shown here.',
                    )}
                  </p>
                ) : null}
                <ul className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border">
                  {previewLines.map((line) => (
                    <li
                      key={line.row}
                      className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-body-sm"
                      data-line={line.row}
                      data-status={line.status}
                    >
                      <span className="font-mono text-fg-muted tabular-nums">
                        {t('dataio:import.previewLine', 'Line {row}', { row: line.row })}
                      </span>
                      <Badge tone={line.status === 'new' ? 'pos' : line.status === 'here' ? 'neutral' : 'danger'}>
                        {line.status === 'new'
                          ? t('dataio:import.previewNew', 'New')
                          : line.status === 'here'
                            ? t('dataio:import.previewHere', 'Already here')
                            : t('dataio:import.previewRefused', 'Refused')}
                      </Badge>
                      {/* Which row of the file this is, in the file's own words: on a narrow screen it takes the line under the mark. */}
                      {line.label === undefined || line.label === '' ? null : (
                        <span data-part="line-label" title={line.label} dir="auto" className="min-w-0 max-w-full basis-full truncate font-medium text-fg sm:max-w-[40%] sm:basis-auto">
                          {line.label}
                        </span>
                      )}
                      {line.status === 'refused' ? (
                        <span className="min-w-0 text-fg [overflow-wrap:anywhere]">
                          {line.column !== undefined && line.message?.startsWith(`${line.column}:`) !== true
                            ? `${line.column}: ${line.message ?? line.code ?? ''}`
                            : (line.message ?? line.code ?? '')}
                        </span>
                      ) : line.earlierLine !== undefined ? (
                        <span className="min-w-0 text-fg-muted">
                          {t('dataio:import.previewEarlier', 'Same as line {line}', { line: line.earlierLine })}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {previewLines.length < linePreview.judged ? (
                  <div>
                    <Button
                      variant="ghost"
                      onClick={() => moreLines.mutate(undefined)}
                      disabled={moreLines.isPending}
                      data-testid="import-preview-more"
                    >
                      {t('dataio:import.previewShowMore', 'Show more')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      case 'run': {
        const pct = job.data?.progress?.pct ?? (finished?.status === 'succeeded' ? 100 : 0);
        return (
          <div className="flex flex-col gap-4">
            <ProgressBar
              value={pct}
              label={t('dataio:import.progressLabel', 'Import progress')}
              tone={finished?.status === 'failed' ? 'danger' : 'accent'}
            />
            {running || finished === null ? (
              <p className="text-body-sm text-fg-muted">
                {job.data?.progress?.message ?? t('dataio:import.running', 'Importing…')}
              </p>
            ) : stats !== null ? (
              <div className="flex flex-col gap-3" data-testid="import-review">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      [t('dataio:import.kpiTotal', 'Rows in file'), stats.total],
                      [t('dataio:import.kpiCreated', 'Created'), stats.inserted ?? 0],
                      [t('dataio:import.kpiUpdated', 'Updated'), stats.updated ?? 0],
                      [t('dataio:import.kpiSkipped', 'Skipped'), stats.skipped ?? 0],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-border bg-surface p-3">
                      <div className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
                        {label}
                      </div>
                      <div className="font-mono text-title text-fg tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>
                {(stats.alreadyHere ?? 0) > 0 ? (
                  <p className="text-body-sm text-fg-muted" data-testid="import-already-here">
                    {t('dataio:import.reviewAlreadyHere', 'Already here, left as they were: {count}', {
                      count: stats.alreadyHere ?? 0,
                    })}
                  </p>
                ) : null}
                {!consistent ? (
                  <Alert
                    tone="danger"
                    title={t(
                      'dataio:import.inconsistent',
                      'Import numbers are inconsistent — total must equal created + updated + skipped.',
                    )}
                  />
                ) : null}
                {finished !== null && finished.errorReportFileId !== null ? (
                  <a
                    className="text-body-sm text-accent underline underline-offset-2"
                    href={client.errorReportHref(finished.id)}
                  >
                    {t('dataio:import.downloadErrors', 'Download the skipped-rows report (CSV)')}
                  </a>
                ) : null}
              </div>
            ) : (
              <Alert
                tone="danger"
                title={t('dataio:import.runFailed', 'The import failed.')}
                body={job.data?.lastError ?? undefined}
              />
            )}
          </div>
        );
      }
    }
  })();

  const footer = ((): ReactElement | null => {
    switch (step) {
      case 'upload':
        return null; // uploading advances automatically
      case 'map':
        return (
          <div data-part="wizard-actions" className={FOOTER_ACTIONS}>
            <Button variant="ghost" onClick={() => setStep('upload')}>
              {t('dataio:back', 'Back')}
            </Button>
            <Button
              onClick={() => validateMutation.mutate(undefined)}
              disabled={validateMutation.isPending || matchUnmapped}
              data-testid="wizard-validate"
            >
              {validateMutation.isPending
                ? t('dataio:import.validating', 'Validating…')
                : t('dataio:import.toValidate', 'Validate')}
            </Button>
          </div>
        );
      case 'validate':
        return (
          <div data-part="wizard-actions" className={FOOTER_ACTIONS}>
            <Button variant="ghost" onClick={() => setStep('map')}>
              {t('dataio:back', 'Back')}
            </Button>
            <Button
              onClick={() => runMutation.mutate(undefined)}
              disabled={runMutation.isPending || importRow === null || nothingToBring}
              data-testid="wizard-run"
            >
              {runLabel}
            </Button>
          </div>
        );
      case 'run':
        // A host that can put the wizard away (a part on a screen of its own) gets the way to, once nothing is running.
        return onClose === undefined || running || finished === null ? null : (
          <div data-part="wizard-actions" className={FOOTER_ACTIONS}>
            <Button onClick={onClose} data-testid="wizard-close">
              {t('ui:action.close', 'Close')}
            </Button>
          </div>
        );
    }
  })();

  return (
    // No gutter of its own: the host's page, or the element a part is mounted in, owns it.
    <div className="flex h-full min-h-0 flex-col">
      <PageWizard
        steps={steps}
        activeStepId={step}
        stepStates={finished?.status === 'failed' ? { run: 'error' } : undefined}
        onSelectStep={(id) => {
          // Revisiting resets everything downstream of the step returned to.
          if (STEP_IDS.indexOf(id as StepId) < STEP_IDS.indexOf(step)) setStep(id as StepId);
        }}
        footer={footer ?? undefined}
        testId="import-wizard"
      >
        {body}
      </PageWizard>
    </div>
  );
}
