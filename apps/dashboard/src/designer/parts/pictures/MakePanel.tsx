// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PICTURE DIALOG'S "MAKE ONE" TAB: a picture made with AI.
 *
 * Built from the dialog's own parts (its messages, its grid, its details,
 * "what changes"), with no comp of its own.
 *
 *  - The service and model, chosen by someone who manages AI settings, and the
 *    line that says where the words go and what a picture costs, before Make.
 *  - The words, filled in by the server's plain code from the spot or the row;
 *    the shape; how many (1–4).
 *  - Make starts a job on the server and the tab follows it: closing the dialog
 *    stops nothing already asked for (it is paid for), and "Made earlier" finds
 *    it again.
 *  - For a sample row: "Make one for each…", a row or a group at a time, every
 *    line's words shown before anything is made; each picture made goes into
 *    "what changes" on its row or rows.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CloudOff, Hourglass, KeyRound, LoaderCircle, Sparkles, Square, TriangleAlert, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { t } from '../../../i18n/t.js';
import { designerApi, designerKeys, type MadePicture, type MakeJob, type MakeReply, type MakersView, type MakeTarget, type PictureShape } from '../../api.js';

/** A spot or a sample row, as the tab needs it. */
export interface MakeTargetInfo {
  key: string;
  name: string;
  shape: PictureShape;
  words: string;
  spot?: string;
  row?: { table: string; row: number };
}

/** A table's rows and groups, for "Make one for each". */
export interface MakeTableInfo {
  table: string;
  label: string;
  people: boolean;
  rows: MakeTargetInfo[];
  groups: { column: string; label: string; values: { value: string; rows: number[]; words: string }[] }[];
}

/** One picture made, and where it goes: the dialog puts it in "what changes". */
export interface MadePut {
  targetKey: string;
  picture: MadePicture;
}

export interface MakePanelProps {
  sessionId: string;
  target: MakeTargetInfo | undefined;
  /** The target's table, when it is a sample row. */
  table: MakeTableInfo | null;
  ids: string;
  /** The made pictures the tab shows as tiles: the dialog draws them with its own grid and details. */
  onShown: (pictures: MadePicture[]) => void;
  /** The dialog's grid, of the pictures `onShown` gave it. */
  grid: (label: string) => ReactNode;
  message: (props: { icon: ReactNode; text: ReactNode; sub?: string; role?: 'alert' | 'status'; actions?: { label: string; onClick: () => void }[] }) => ReactNode;
  onPut: (puts: MadePut[]) => void;
  /** Whether a make runs: closing the dialog says it goes on. */
  onRunning: (running: boolean) => void;
}

/** The most lines one batch makes. */
const BATCH = 12;
const WORDS_MAX = 600;
const SHAPES: readonly PictureShape[] = ['wide', 'square', 'tall'];

const shapeOption = (shape: PictureShape): string =>
  shape === 'wide' ? t('designer:pictureDialog.shapeOption.wide', 'Wide') : shape === 'square' ? t('designer:pictureDialog.shapeOption.square', 'Square') : t('designer:pictureDialog.shapeOption.tall', 'Tall');

const newId = (): string => `make-${Math.random().toString(36).slice(2, 14)}`;

/** The key "what changes" knows a target by. */
export function keysOf(target: MakeTarget | null, table: MakeTableInfo | null): string[] {
  if (target === null) return [];
  if ('spot' in target) return [`spot:${target.spot}`];
  if ('row' in target) return [`row:${target.table}:${String(target.row)}`];
  const rows = table?.table === target.table ? (table.groups.find((group) => group.column === target.column)?.values.find((value) => value.value === target.value)?.rows ?? []) : [];
  return rows.map((row) => `row:${target.table}:${String(row)}`);
}

const money = (usd: number): string => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(usd);

/** Why a line or a job ended with nothing, in the person's words: never the service's own. */
function codeSentence(code: string | undefined, label: string): string {
  switch (code) {
    case 'refused':
      return t('designer:pictureDialog.make.refused', '{service} would not make this picture. Try other words.', { service: label });
    case 'auth':
      return t('designer:pictureDialog.make.auth', '{service} did not accept its key.', { service: label });
    case 'billing':
      return t('designer:pictureDialog.make.billing', 'The {service} account has no credit for pictures.', { service: label });
    case 'rate_limit':
      return t('designer:pictureDialog.make.rateLimit', '{service} is busy. Try again in a minute.', { service: label });
    case 'model_gone':
      return t('designer:pictureDialog.make.modelGone', 'That model is no longer offered. Choose another model.');
    case 'not_found':
      return t('designer:pictureDialog.make.notHere', 'This service does not make pictures. Choose another one.');
    case 'stopped':
      return t('designer:pictureDialog.make.notSent', 'Not made: the make was stopped first.');
    default:
      return t('designer:pictureDialog.make.failed', 'The picture could not be made. Try again.');
  }
}

export function MakePanel({ sessionId, target, table, ids, onShown, grid, message, onPut, onRunning }: MakePanelProps): ReactNode {
  const queryClient = useQueryClient();
  const makers = useQuery({ queryKey: designerKeys.makers, queryFn: () => designerApi.makers() });
  const earlier = useQuery({ queryKey: designerKeys.made(sessionId), queryFn: () => designerApi.madePictures(sessionId) });
  const view: MakersView | undefined = makers.data;

  const [words, setWords] = useState('');
  const [shape, setShape] = useState<PictureShape>('wide');
  const [count, setCount] = useState(2);
  const [choosing, setChoosing] = useState(false);
  const [refusal, setRefusal] = useState<Exclude<MakeReply['state'], 'accepted'> | 'error' | null>(null);
  /** What an allowance refusal said is left: a make that asks for more than that is refused whole. */
  const [allowanceLeft, setAllowanceLeft] = useState<number | null>(null);
  /** A Make on its way: the button waits for its answer, so a double click asks once. */
  const [asking, setAsking] = useState(false);
  const [job, setJob] = useState<MakeJob | null>(null);
  /** Which job is a batch: its pictures go straight into "what changes". */
  const batch = useRef<string | null>(null);
  const put = useRef(new Set<string>());
  const [forEach, setForEach] = useState<null | { by: 'rows' | string; lines: { key: string; name: string; words: string; target: MakeTarget }[]; from: number }>(null);

  // A target chosen: its own words and shape.
  const targetKey = target?.key;
  useEffect(() => {
    if (target === undefined) return;
    setWords(target.words);
    setShape(target.shape);
    setForEach(null);
    setRefusal(null);
  }, [targetKey]);

  // A make that runs when the tab opens is followed again.
  useEffect(() => {
    const running = earlier.data?.running ?? null;
    if (running !== null && job === null) void designerApi.makeJob(sessionId, running).then(setJob).catch(() => undefined);
  }, [earlier.data?.running]);

  // The job, followed until it ends.
  const jobId = job?.job;
  const jobState = job?.state;
  useEffect(() => {
    onRunning(jobState === 'running');
    if (jobId === undefined || jobState !== 'running') return undefined;
    const timer = window.setInterval(() => {
      void designerApi
        .makeJob(sessionId, jobId)
        .then((next) => setJob(next))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [jobId, jobState]);

  // What a job made: shown as tiles, and a batch's put on its rows as each line ends.
  useEffect(() => {
    if (job === null) return;
    onShown(job.lines.flatMap((line) => line.pictures));
    if (batch.current === job.job) {
      const puts = job.lines.flatMap((line): MadePut[] => {
        const picture = line.pictures[0];
        if (picture === undefined || put.current.has(picture.id)) return [];
        put.current.add(picture.id);
        return keysOf(line.target, table).map((targetKey) => ({ targetKey, picture }));
      });
      if (puts.length > 0) onPut(puts);
    }
    if (job.state !== 'running') {
      void queryClient.invalidateQueries({ queryKey: designerKeys.made(sessionId) });
      void queryClient.invalidateQueries({ queryKey: designerKeys.makers });
    }
  }, [job]);

  const left = view === undefined ? 0 : Math.min(view.left.mine, view.left.all);

  const start = async (lines: { words: string; target?: MakeTarget }[], asBatch: boolean): Promise<void> => {
    if (asking) return;
    setRefusal(null);
    setAsking(true);
    try {
      const reply = await designerApi.makePictures(sessionId, { id: newId(), lines, shape: asBatch ? 'square' : shape, count: asBatch ? 1 : count });
      if (reply.state === 'accepted') {
        batch.current = asBatch ? reply.job.job : null;
        setJob(reply.job);
        return;
      }
      if (reply.state === 'busy' && reply.job !== null) {
        setJob(await designerApi.makeJob(sessionId, reply.job));
        return;
      }
      setAllowanceLeft(reply.state === 'allowance' ? Math.min(reply.left.mine, reply.left.all) : null);
      setRefusal(reply.state);
      void queryClient.invalidateQueries({ queryKey: designerKeys.makers });
    } catch {
      setRefusal('error');
    } finally {
      setAsking(false);
    }
  };

  const stop = (): void => {
    if (job !== null) void designerApi.stopMake(sessionId, job.job).catch(() => undefined);
  };

  // ── the service ───────────────────────────────────────────────────────────
  if (view === undefined) {
    return makers.isError
      ? message({ icon: <CloudOff className="size-[18px]" />, text: t('designer:pictureDialog.make.loadFailed', 'Could not load the picture services.'), role: 'alert' })
      : message({ icon: <LoaderCircle className="size-[18px] animate-spin" />, text: t('designer:pictureDialog.loading', 'Loading pictures') });
  }

  if (choosing && view.canChoose) {
    return (
      <MakerChooser
        view={view}
        ids={ids}
        onDone={(next) => {
          if (next !== null) queryClient.setQueryData(designerKeys.makers, next);
          setChoosing(false);
        }}
        onView={(next) => queryClient.setQueryData(designerKeys.makers, next)}
      />
    );
  }

  const choose = view.canChoose ? [{ label: view.chosen === null ? t('designer:pictureDialog.make.chooseService', 'Choose a service') : t('designer:pictureDialog.make.change', 'Change'), onClick: () => setChoosing(true) }] : undefined;
  const ask = view.canChoose ? undefined : t('designer:pictureDialog.make.ask', 'Ask whoever manages AI settings.');
  const stateLine = (state: Exclude<MakersView['state'], 'ok'>): ReactNode => {
    const texts: Record<typeof state, string> = {
      none: t('designer:pictureDialog.make.none', 'Choose a picture service to make pictures here.'),
      changed: t('designer:pictureDialog.make.changed', 'The picture service changed. Choose it again.'),
      'model-gone': t('designer:pictureDialog.make.modelGone', 'That model is no longer offered. Choose another model.'),
      'not-here': t('designer:pictureDialog.make.notHere', 'This service does not make pictures. Choose another one.'),
      off: t('designer:pictureDialog.make.off', 'Making pictures needs a service outside this server, and this server calls nothing outside.'),
      'switched-off': t('designer:pictureDialog.make.switchedOff', 'Making pictures is switched off here.'),
    };
    return message({ icon: state === 'switched-off' || state === 'off' ? <CloudOff className="size-[18px]" /> : <Wand2 className="size-[18px]" />, text: texts[state], ...(ask === undefined ? {} : { sub: ask }), ...(choose === undefined || state === 'switched-off' ? {} : { actions: choose }) });
  };
  if (view.state !== 'ok') return stateLine(view.state);

  const label = view.chosen?.label ?? '';
  const model = view.chosen?.model ?? '';
  const running = job !== null && job.state === 'running';
  const costLine = (pictures: number): string =>
    view.chosen?.local === true
      ? t('designer:pictureDialog.make.costLocal', 'Made on this computer. It costs nothing. You can make {left} more today.', { left })
      : view.usd === null
        ? t('designer:pictureDialog.make.cost', 'The words are sent to {service}. Each picture is charged to that account. You can make {left} more today.', { service: label, left })
        : t('designer:pictureDialog.make.costKnown', 'The words are sent to {service}. This is charged to that account, about {amount}. You can make {left} more today.', { service: label, amount: money(view.usd * pictures), left });

  const header = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
      <Sparkles aria-hidden="true" className="size-3.5 text-fg-subtle" />
      <span className="text-fg-muted">{t('designer:pictureDialog.make.madeBy', 'Made by')}</span>
      <strong className="font-bold">
        <bdi>
          {label} · {model}
        </bdi>
      </strong>
      {view.canChoose ? (
        <button type="button" onClick={() => setChoosing(true)} className="ms-auto text-body-sm font-bold text-accent hover:underline">
          {t('designer:pictureDialog.make.change', 'Change')}
        </button>
      ) : null}
    </div>
  );

  const refusalLine =
    refusal === null
      ? null
      : refusal === 'error'
        ? message({ icon: <CloudOff className="size-[18px]" />, text: t('designer:pictureDialog.make.error', 'The pictures could not be asked for. Try again.'), role: 'alert' })
        : refusal === 'allowance' && (allowanceLeft ?? 0) > 0
          ? message({ icon: <Hourglass className="size-[18px]" />, text: t('designer:pictureDialog.make.tooMany', 'You can make {left} more today. Ask for fewer.', { left: allowanceLeft ?? 0 }), role: 'alert' })
          : refusal === 'allowance' || left === 0
            ? message({ icon: <Hourglass className="size-[18px]" />, text: t('designer:pictureDialog.make.dayDone', 'You have made today’s pictures. More tomorrow.'), role: 'alert' })
        : refusal === 'busy'
          ? message({ icon: <Hourglass className="size-[18px]" />, text: t('designer:pictureDialog.make.busy', 'A make is already under way.'), role: 'status' })
          : refusal === 'full'
            ? message({ icon: <CircleAlert className="size-[18px]" />, text: t('designer:pictureDialog.make.full', 'This session holds as many made pictures as it can. Pictures you did not keep make way after a day.'), role: 'alert' })
            : stateLine(refusal);

  // ── a batch, for each row or group ────────────────────────────────────────
  if (forEach !== null && table !== null) {
    return (
      <ForEachPanel
        table={table}
        state={forEach}
        job={batch.current !== null && job?.job === batch.current ? job : null}
        ids={ids}
        costLine={costLine}
        left={left}
        onChange={setForEach}
        onStart={(lines) => void start(lines.map((line) => ({ words: line.words, target: line.target })), true)}
        onStop={stop}
        onClose={() => setForEach(null)}
        refusal={refusalLine}
      />
    );
  }

  const one = job !== null && batch.current !== job.job ? job : null;
  const shown = one?.lines.flatMap((line) => line.pictures) ?? [];
  const lineCode = one?.lines[0]?.code;
  const counterId = `${ids}-make-count`;

  return (
    <>
      {header}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (asking || running || words.trim() === '' || left === 0) return;
          const lineTarget: MakeTarget | undefined = target?.spot !== undefined ? { spot: target.spot } : target?.row;
          void start([{ words, ...(lineTarget === undefined ? {} : { target: lineTarget }) }], false);
        }}
        className="flex flex-col gap-2.5"
      >
        <label htmlFor={`${ids}-make-words`} className="text-caption font-bold text-fg-muted">
          {t('designer:pictureDialog.make.wordsLabel', 'What the picture shows')}
        </label>
        <textarea
          id={`${ids}-make-words`}
          dir="auto"
          rows={3}
          maxLength={WORDS_MAX}
          value={words}
          aria-describedby={counterId}
          onChange={(event) => setWords(event.target.value)}
          className="w-full resize-y rounded-[10px] border border-border-strong bg-surface px-3 py-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span id={counterId} className="text-caption text-fg-subtle">
            {t('designer:pictureDialog.make.counter', '{count} of {max}', { count: [...words].length, max: WORDS_MAX })}
          </span>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <select aria-label={t('designer:pictureDialog.shapeLabel', 'Shape')} value={shape} onChange={(event) => setShape(event.target.value as PictureShape)} className="h-[38px] cursor-pointer rounded-[10px] border border-border-strong bg-surface px-3 text-body font-semibold text-fg">
              {SHAPES.map((option) => (
                <option key={option} value={option}>
                  {shapeOption(option)}
                </option>
              ))}
            </select>
            <select aria-label={t('designer:pictureDialog.make.howMany', 'How many')} value={count} onChange={(event) => setCount(Number(event.target.value))} className="h-[38px] cursor-pointer rounded-[10px] border border-border-strong bg-surface px-3 text-body font-semibold text-fg">
              {[1, 2, 3, 4].map((option) => (
                <option key={option} value={option}>
                  {t('designer:pictureDialog.make.pictures', '{count, plural, one {# picture} other {# pictures}}', { count: option })}
                </option>
              ))}
            </select>
            <button
              type="submit"
              aria-disabled={asking || running || words.trim() === '' || left === 0 ? true : undefined}
              className={`nb-btn inline-flex h-[38px] items-center gap-2 rounded-[10px] bg-accent px-4 text-body font-bold text-accent-fg ${asking || running || words.trim() === '' || left === 0 ? 'cursor-not-allowed opacity-45' : ''}`}
            >
              {asking || running ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Sparkles aria-hidden="true" className="size-4" />}
              {t('designer:pictureDialog.make.make', 'Make')}
            </button>
          </div>
        </div>
        <p data-part="make-cost" className="m-0 text-body-sm text-fg-muted">
          {costLine(count)}
        </p>
        {table !== null ? (
          <div role="note" className="flex items-start gap-2 rounded-[10px] bg-warn-soft px-3 py-2 text-body-sm font-semibold text-warn">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="flex-1">
              {t('designer:pictureDialog.make.honest', 'These are made-up pictures. Before you open, replace them with photos of your own {table}.', { table: table.label.toLowerCase() })}
            </span>
          </div>
        ) : null}
        {table !== null && !running ? (
          <button
            type="button"
            onClick={() => setForEach({ by: 'rows', from: 0, lines: table.rows.map((row) => ({ key: row.key, name: row.name, words: row.words, target: row.row as MakeTarget })) })}
            className="nb-ib inline-flex h-[34px] items-center gap-2 self-start rounded-[10px] border border-border-strong bg-surface px-3.5 text-body font-bold text-fg"
          >
            <Wand2 aria-hidden="true" className="size-4" />
            {t('designer:pictureDialog.make.forEach', 'Make one for each…')}
          </button>
        ) : null}
      </form>
      {refusalLine}
      {running && one !== null ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-fg-muted" />
          <span className="flex-1 text-body-sm font-semibold">{t('designer:pictureDialog.make.making', 'Making {count, plural, one {# picture} other {# pictures}}… this can take a minute.', { count: one.lines.reduce((sum, line) => sum + line.asked, 0) })}</span>
          <button type="button" onClick={stop} className="nb-ib inline-flex h-[30px] items-center gap-1.5 rounded-[10px] border border-border-strong bg-surface px-3 text-body-sm font-bold text-fg">
            <Square aria-hidden="true" className="size-3" />
            {t('designer:pictureDialog.make.stop', 'Stop')}
          </button>
        </div>
      ) : null}
      {one !== null && !running && shown.length === 0
        ? message({ icon: lineCode === 'refused' ? <CircleAlert className="size-[18px]" /> : lineCode === 'auth' ? <KeyRound className="size-[18px]" /> : <CloudOff className="size-[18px]" />, text: one.state === 'lost' ? t('designer:pictureDialog.make.lost', 'The server restarted while making these pictures. They were counted.') : codeSentence(lineCode ?? one.stoppedBy, label), role: 'alert' })
        : null}
      {shown.length > 0 ? grid(t('designer:pictureDialog.make.results', 'Pictures made for {spot}', { spot: target?.name ?? '' })) : null}
      <MadeEarlier
        pictures={(earlier.data?.pictures ?? []).filter((picture) => !shown.some((one) => one.id === picture.id))}
        table={table}
        sessionId={sessionId}
        onPut={onPut}
      />
    </>
  );
}

/** Pictures made in this session and not used yet, by what they were made for. */
function MadeEarlier({ pictures, table, sessionId, onPut }: { pictures: MadePicture[]; table: MakeTableInfo | null; sessionId: string; onPut: (puts: MadePut[]) => void }): ReactNode {
  const groups = useMemo(() => {
    const byName = new Map<string, MadePicture[]>();
    for (const picture of pictures) byName.set(picture.title, [...(byName.get(picture.title) ?? []), picture]);
    return [...byName.entries()];
  }, [pictures]);
  if (pictures.length === 0) return null;
  const putAll = (): void => {
    const seen = new Set<string>();
    onPut(
      pictures.flatMap((picture) =>
        keysOf(picture.target, table).flatMap((targetKey) => {
          if (seen.has(targetKey)) return [];
          seen.add(targetKey);
          return [{ targetKey, picture }];
        }),
      ),
    );
  };
  return (
    <section aria-labelledby={`made-earlier-${sessionId}`} className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center gap-2">
        <h4 id={`made-earlier-${sessionId}`} className="m-0 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
          {t('designer:pictureDialog.make.earlier', 'Made earlier')}
        </h4>
        <button type="button" onClick={putAll} className="ms-auto text-body-sm font-bold text-accent hover:underline">
          {t('designer:pictureDialog.make.putAll', 'Put all back in what changes')}
        </button>
      </div>
      {groups.map(([name, list]) => (
        <div key={name} className="flex flex-wrap items-center gap-2">
          <span className="min-w-[120px] text-body-sm font-bold">
            <bdi>{name}</bdi>
          </span>
          {list.map((picture) => (
            <img key={picture.id} src={designerApi.pictureThumbUrl(sessionId, picture.shelf, picture.id)} alt="" loading="lazy" className="block h-8 w-12 rounded-[6px] object-cover" />
          ))}
          {list[0]?.target === null || list[0] === undefined ? null : (
            <button type="button" onClick={() => onPut(keysOf((list[0] as MadePicture).target, table).map((targetKey) => ({ targetKey, picture: list[0] as MadePicture })))} className="text-body-sm font-bold text-accent hover:underline">
              {t('designer:pictureDialog.make.putOn', 'Put on {name}', { name })}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function ForEachPanel({
  table,
  state,
  job,
  ids,
  costLine,
  left,
  onChange,
  onStart,
  onStop,
  onClose,
  refusal,
}: {
  table: MakeTableInfo;
  state: { by: 'rows' | string; lines: { key: string; name: string; words: string; target: MakeTarget }[]; from: number };
  job: MakeJob | null;
  ids: string;
  costLine: (pictures: number) => string;
  left: number;
  onChange: (next: { by: 'rows' | string; lines: { key: string; name: string; words: string; target: MakeTarget }[]; from: number } | null) => void;
  onStart: (lines: { words: string; target: MakeTarget }[]) => void;
  onStop: () => void;
  onClose: () => void;
  refusal: ReactNode;
}): ReactNode {
  const linesFor = (by: string): { key: string; name: string; words: string; target: MakeTarget }[] => {
    if (by === 'rows') return table.rows.map((row) => ({ key: row.key, name: row.name, words: row.words, target: row.row as MakeTarget }));
    const group = table.groups.find((one) => one.column === by);
    return (group?.values ?? []).map((value) => ({ key: `group:${by}:${value.value}`, name: value.value, words: value.words, target: { table: table.table, column: by, value: value.value } }));
  };
  const batch = state.lines.slice(state.from, state.from + BATCH);
  const blocked = batch.length === 0 || batch.length > left || batch.some((line) => line.words.trim() === '');
  const running = job?.state === 'running';
  const made = job?.lines.reduce((sum, line) => sum + line.made, 0) ?? 0;
  const done = job !== null && !running;
  const refused = job?.lines.filter((line) => line.state === 'done' && line.made === 0 && line.code === 'refused').length ?? 0;
  const lineState = (index: number): string => {
    const line = job?.lines[index];
    if (line === undefined) return '';
    if (line.state === 'waiting') return t('designer:pictureDialog.make.lineWaiting', 'waiting');
    if (line.state === 'making') return t('designer:pictureDialog.make.lineMaking', 'making');
    if (line.state === 'gone') return t('designer:pictureDialog.make.lineGone', 'this row changed; make it again');
    if (line.made > 0) return t('designer:pictureDialog.make.lineMade', 'made');
    return line.code === 'refused' ? t('designer:pictureDialog.make.lineRefused', 'refused') : t('designer:pictureDialog.make.lineFailed', 'failed');
  };
  const groupId = `${ids}-for-each`;
  return (
    <div role="region" aria-labelledby={`${groupId}-heading`} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h4 id={`${groupId}-heading`} className="m-0 text-body font-bold">
          {t('designer:pictureDialog.make.forEachTitle', 'Make one for each of {table}', { table: table.label })}
        </h4>
        {running ? null : (
          <button type="button" onClick={onClose} className="ms-auto text-body-sm font-bold text-accent hover:underline">
            {t('designer:pictureDialog.make.back', 'Back')}
          </button>
        )}
      </div>
      {job === null ? (
        <div role="radiogroup" aria-label={t('designer:pictureDialog.make.forEachBy', 'One picture for each')} className="flex flex-col gap-1.5">
          {[{ by: 'rows', text: t('designer:pictureDialog.make.eachRow', 'One for each row ({count})', { count: table.rows.length }) }, ...table.groups.map((group) => ({ by: group.column, text: t('designer:pictureDialog.make.eachGroup', 'One for each {group} ({count})', { group: group.label.toLowerCase(), count: group.values.length }) }))].map((option) => (
            <label key={option.by} className="flex cursor-pointer items-center gap-2 text-body-sm font-semibold">
              <input type="radio" name={groupId} checked={state.by === option.by} onChange={() => onChange({ by: option.by, from: 0, lines: linesFor(option.by) })} className="size-4 accent-[var(--color-accent)]" />
              {option.text}
            </label>
          ))}
        </div>
      ) : null}
      {table.people ? <p className="m-0 text-body-sm text-fg-muted">{t('designer:pictureDialog.make.people', 'This table holds people: their names are not sent, so each picture is of no one in particular.')}</p> : null}
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {batch.map((line, index) => (
          <li key={line.key} className="flex flex-wrap items-center gap-2">
            <span className="min-w-[120px] text-body-sm font-bold">
              <bdi>{line.name}</bdi>
            </span>
            <input
              type="text"
              dir="auto"
              maxLength={WORDS_MAX}
              disabled={job !== null}
              aria-label={t('designer:pictureDialog.make.lineWords', 'Words for {name}', { name: line.name })}
              value={line.words}
              onChange={(event) => onChange({ ...state, lines: state.lines.map((one) => (one.key === line.key ? { ...one, words: event.target.value } : one)) })}
              className="h-8 min-w-0 flex-[1_1_220px] rounded-[10px] border border-border-strong bg-surface px-2.5 text-body-sm text-fg disabled:bg-surface-3 disabled:text-fg-muted"
            />
            {job === null ? null : <span className="w-[120px] text-caption font-semibold text-fg-muted">{lineState(index)}</span>}
          </li>
        ))}
      </ol>
      {job === null ? (
        <>
          <p className="m-0 text-body-sm text-fg-muted">
            {t('designer:pictureDialog.make.total', 'This makes {count, plural, one {# picture} other {# pictures}}.', { count: batch.length })} {costLine(batch.length)}
          </p>
          <button
            type="button"
            aria-disabled={blocked ? true : undefined}
            onClick={() => {
              // Every line as shown, in its order: a line's status below is read by its place.
              if (!blocked) onStart(batch);
            }}
            className={`nb-btn inline-flex h-9 items-center gap-2 self-start rounded-[10px] bg-accent px-4 text-body font-bold text-accent-fg ${blocked ? 'cursor-not-allowed opacity-45' : ''}`}
          >
            <Sparkles aria-hidden="true" className="size-4" />
            {t('designer:pictureDialog.make.makeThem', 'Make them')}
          </button>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" aria-live="polite" className="m-0 flex-1 text-body-sm font-semibold">
            {done
              ? refused > 0
                ? t('designer:pictureDialog.make.doneRefused', '{made} of {count} made. {refused, plural, one {# was refused: change its words and try again.} other {# were refused: change their words and try again.}}', { made, count: job.lines.length, refused })
                : t('designer:pictureDialog.make.done', '{made} of {count} made. They are in what changes.', { made, count: job.lines.length })
              : t('designer:pictureDialog.make.progress', '{made} of {count} made', { made, count: job.lines.length })}
          </p>
          {running ? (
            <button type="button" onClick={onStop} className="nb-ib inline-flex h-[30px] items-center gap-1.5 rounded-[10px] border border-border-strong bg-surface px-3 text-body-sm font-bold text-fg">
              <Square aria-hidden="true" className="size-3" />
              {t('designer:pictureDialog.make.stop', 'Stop')}
            </button>
          ) : state.from + BATCH < state.lines.length ? (
            <button type="button" onClick={() => onChange({ ...state, from: state.from + BATCH })} className="text-body-sm font-bold text-accent hover:underline">
              {t('designer:pictureDialog.make.next', 'The next {count}', { count: Math.min(BATCH, state.lines.length - state.from - BATCH) })}
            </button>
          ) : null}
        </div>
      )}
      {refusal}
    </div>
  );
}

/** The chooser: which service makes pictures, its model, the chat's switch, and a key for pictures only. Shown to `llm.run`. */
function MakerChooser({ view, ids, onDone, onView }: { view: MakersView; ids: string; onDone: (next: MakersView | null) => void; onView: (next: MakersView) => void }): ReactNode {
  const [id, setId] = useState(view.chosen?.id ?? view.makers[0]?.id ?? '');
  const maker = view.makers.find((one) => one.id === id);
  const [model, setModel] = useState(view.chosen?.model ?? maker?.models[0] ?? '');
  const [chat, setChat] = useState(view.chat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyFor, setKeyFor] = useState<'openai' | 'google'>('openai');
  const [key, setKey] = useState('');
  const canSave = !saving && (id === '' || model.trim() !== '');
  const canAdd = !saving && key.trim().length >= 20;
  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      onDone(await designerApi.chooseMaker(id === '' ? { chat } : { id, model, chat }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };
  const addKey = async (): Promise<void> => {
    if (!canAdd) return;
    setSaving(true);
    setError(null);
    try {
      const next = await designerApi.savePictureMakerKey(keyFor, key.trim());
      setKey('');
      // The new service is in the list at once, with its models.
      onView(next);
      const added = next.makers.find((one) => (keyFor === 'google' ? one.id === 'google' : one.kind === 'openai'));
      if (added !== undefined) {
        setId(added.id);
        setModel(added.models[0] ?? '');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div role="region" aria-labelledby={`${ids}-maker-heading`} className="flex flex-col gap-3">
      <h4 id={`${ids}-maker-heading`} className="m-0 text-body font-bold">
        {t('designer:pictureDialog.make.chooserTitle', 'Which service makes pictures')}
      </h4>
      {view.makers.length === 0 ? (
        <p className="m-0 text-body-sm text-fg-muted">{t('designer:pictureDialog.make.noMakers', 'No connected service makes pictures. Add an OpenAI or Google key below.')}</p>
      ) : (
        <div role="radiogroup" aria-labelledby={`${ids}-maker-heading`} className="flex flex-col gap-1.5">
          {view.makers.map((one) => (
            <label key={one.id} className="flex cursor-pointer items-center gap-2 text-body-sm font-semibold">
              <input
                type="radio"
                name={`${ids}-maker`}
                checked={id === one.id}
                onChange={() => {
                  setId(one.id);
                  setModel(one.models[0] ?? '');
                }}
                className="size-4 accent-[var(--color-accent)]"
              />
              <bdi>{one.label}</bdi>
              {one.local ? <span className="text-caption text-fg-muted">{t('designer:pictureDialog.make.onThisComputer', 'on this computer')}</span> : null}
              {one.kind === 'openai-compatible' && !one.local ? <span className="text-caption text-fg-muted">{t('designer:pictureDialog.make.noFilter', 'may have no content filter')}</span> : null}
            </label>
          ))}
        </div>
      )}
      {maker === undefined ? null : maker.models.length > 0 ? (
        <label className="flex flex-col gap-1 text-caption font-bold text-fg-muted">
          {t('designer:pictureDialog.make.model', 'Model')}
          <select value={model} onChange={(event) => setModel(event.target.value)} className="h-[38px] rounded-[10px] border border-border-strong bg-surface px-3 text-body font-semibold text-fg">
            {maker.models.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {maker.kind === 'openai-compatible' ? <span className="font-normal">{t('designer:pictureDialog.make.ownList', 'This server’s own list: pick a picture model.')}</span> : null}
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-caption font-bold text-fg-muted">
          {t('designer:pictureDialog.make.modelTyped', 'Picture model, as the service names it')}
          <input type="text" dir="ltr" value={model} onChange={(event) => setModel(event.target.value)} className="h-[38px] rounded-[10px] border border-border-strong bg-surface px-3 font-mono text-body text-fg" />
        </label>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-body-sm font-semibold">
        <input type="checkbox" checked={chat} onChange={() => setChat(!chat)} className="size-[18px] accent-[var(--color-accent)]" />
        {t('designer:pictureDialog.make.chat', 'Let the Designer make pictures in the chat')}
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-disabled={canSave ? undefined : true} onClick={() => void save()} className={`nb-btn h-9 rounded-[10px] bg-accent px-4 text-body font-bold text-accent-fg ${canSave ? '' : 'cursor-not-allowed opacity-45'}`}>
          {t('designer:pictureDialog.make.save', 'Save')}
        </button>
        <button type="button" onClick={() => onDone(null)} className="nb-ib h-9 rounded-[10px] border border-border bg-surface px-4 text-body font-bold text-fg-muted">
          {t('designer:pictureDialog.cancel', 'Cancel')}
        </button>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-caption font-bold text-fg-muted">{t('designer:pictureDialog.make.addService', 'Add a service for pictures only')}</span>
        <div className="flex flex-wrap gap-2">
          <select aria-label={t('designer:pictureDialog.make.service', 'Service')} value={keyFor} onChange={(event) => setKeyFor(event.target.value as 'openai' | 'google')} className="h-[38px] rounded-[10px] border border-border-strong bg-surface px-3 text-body font-semibold text-fg">
            <option value="openai">OpenAI</option>
            <option value="google">Google Gemini</option>
          </select>
          <input type="password" autoComplete="off" dir="ltr" aria-label={t('designer:pictureDialog.make.key', 'Key')} value={key} onChange={(event) => setKey(event.target.value)} className="h-[38px] min-w-0 flex-[1_1_200px] rounded-[10px] border border-border-strong bg-surface px-3 font-mono text-body text-fg" />
          <button type="button" aria-disabled={canAdd ? undefined : true} onClick={() => void addKey()} className={`nb-ib h-[38px] rounded-[10px] border border-border-strong bg-surface px-3.5 text-body font-bold text-fg ${canAdd ? '' : 'cursor-not-allowed opacity-45'}`}>
            {t('designer:pictureDialog.make.addKey', 'Add')}
          </button>
        </div>
        <p className="m-0 text-caption text-fg-muted">{t('designer:pictureDialog.make.keyNote', 'Kept where this server keeps its keys. It is used for pictures only and changes no chat model.')}</p>
      </div>
      {error === null ? null : (
        <p role="alert" className="m-0 rounded-[10px] bg-danger-soft px-3 py-2 text-body-sm font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
