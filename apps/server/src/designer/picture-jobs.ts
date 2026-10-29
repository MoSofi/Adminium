// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MAKING PICTURES WITH AI, as jobs.
 *
 * A Make is a job: the request checks, finds room, takes the pictures from
 * the day's allowances, writes the job's file, and answers at once; the job
 * then calls the service line by line and says how it goes as session events
 * (`picture-make`). One HTTP request could not carry a batch: twelve calls of
 * up to three minutes each, cut by any proxy after a minute.
 *
 * WHO PAYS. The service is a setting chosen by someone who may set up AI
 * (`designer.pictures.maker`), tied to the key it was chosen with (`keyHash`):
 * a key swapped behind the same connection is `changed`, and nothing is made
 *.
 *
 * WHAT IS COUNTED. Every picture asked is taken before the call, in one
 * check-and-add (`pictureUseRepo.take`). It is given back only when the answer
 * proves nothing was made (a turned-down key, no route, no model, no credit, a
 * rate limit, a 400 that is not a refusal), or when the line was never sent.
 * A refusal, a timeout or a failure stays counted: the service may have made
 * and charged for it.
 *
 * WHERE IT LIVES. `sessions/<id>/made/`: each picture as `<shelf>.<pic>.<ext>`
 * with its `.json` beside it, and each job as `job_<id>.json`, written before
 * the first call so a restart leaves it `lost`, counted. A made picture is
 * found from disk by its ids, never only from memory. Pictures made for a
 * spot or a row are pinned; the others go after a day.
 *
 * WHAT IS NEVER KEPT. The service's own words; the words in the audit or
 * the log. The words are kept only in the picture's own file, for "make
 * again", and in the app's credit line, which the side never draws.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { knownPicturePrice, PictureError, PICTURE_MODEL_ID, type PictureMaker, type PictureShape } from '@adminium/llm';
import { assistantUseDay, assistantUseResetsAt, pictureUseRepo, type MetaDb, type SettingsRepo } from '@adminium/meta';

import type { AiConnections, PictureMakerId, PictureMakerInfo } from '../llm/connections.js';
import type { FoundPicture } from './pictures.js';
import { DESIGNER_DIR } from './session-store.js';
import { writeWhole } from './spots.js';
import { plainWords } from './untrusted.js';

// ─── limits ──────────────────────────────────────────────────────────────────

/** The most lines one job makes. */
export const MAKE_LINES_MAX = 12;
/** The most pictures one line asks for (a single target); a batch asks one a line. */
export const MAKE_PER_LINE_MAX = 4;
/** The longest words sent. */
export const MAKE_WORDS_MAX = 600;
/** Made pictures one session keeps, and their bytes. */
export const MADE_FILES_MAX = 40;
export const MADE_BYTES_MAX = 100 * 1024 * 1024;
/** Made pictures the whole server keeps. */
export const MADE_SERVER_BYTES_MAX = 2 * 1024 * 1024 * 1024;
/** What one picture may weigh: room is found for this much before anything is asked. */
const PICTURE_ROOM = 5 * 1024 * 1024;
/** How long a made picture nobody used, and a job's file, are kept. */
export const MADE_KEEP_MS = 24 * 60 * 60_000;
/** How long a pinned one is kept: it waits for an Apply. */
export const MADE_PINNED_KEEP_MS = 7 * 24 * 60 * 60_000;
/** How long the services' model lists are kept. */
const MODELS_KEEP_MS = 10 * 60_000;

const SESSION = /^ds_[0-9a-z]{24}$/;
const SHELF = /^shelf_[0-9a-f]{16}$/;
const PICTURE = /^pic_[0-9a-f]{12}$/;
const JOB = /^job_[0-9a-f]{16}$/;
export const MAKE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Where a picture is made for: a spot, a sample row, or every row of a table that holds one value (a group). */
export type MakeTarget = { spot: string } | { table: string; row: number } | { table: string; column: string; value: string };

/** The service's terms page, for a made picture's credit. */
const TERMS: Readonly<Record<string, string>> = {
  openai: 'https://openai.com/policies/usage-policies/',
  google: 'https://ai.google.dev/gemini-api/terms',
};

// ─── what a page is told ─────────────────────────────────────────────────────

/** A made picture as a page sees it: our ids, the target's name, the service's label and model, the words. Never a path. */
export interface MadePublic {
  id: string;
  shelf: string;
  title: string;
  creator: string;
  source: 'AI';
  licence: { code: 'made'; name: string };
  page: '';
  made: { label: string; model: string; words: string };
  target: MakeTarget | null;
  pinned: boolean;
  at: number;
}

export type LineState = 'waiting' | 'making' | 'done' | 'gone';

export interface JobLine {
  target: MakeTarget | null;
  /** The target's name, as the dialog shows it. */
  name: string;
  asked: number;
  made: number;
  refused: number;
  failed: number;
  state: LineState;
  /** Why it ended with nothing: a code, never the service's words. */
  code?: string;
  pictures: MadePublic[];
}

export type JobState = 'running' | 'done' | 'stopped' | 'lost';

export interface JobView {
  job: string;
  state: JobState;
  /** Why a stopped job stopped: a wrong key, no credit, a rate limit, the model gone, or the person. */
  stoppedBy?: string;
  label: string;
  model: string;
  lines: JobLine[];
  left: { mine: number; all: number };
}

/** The states the tab and the chat say in their own words */
export type MakerState = 'ok' | 'none' | 'changed' | 'model-gone' | 'not-here' | 'off' | 'switched-off';

export interface MakersView {
  /** Only for someone who may choose (`llm.run`): the services and their picture models. */
  makers: (PictureMakerInfo & { models: string[]; listed: 'ok' | 'unreachable' })[];
  chosen: { id: string; label: string; model: string; local: boolean } | null;
  state: MakerState;
  /** About what one picture costs at the chosen model, in US dollars; null when not known. */
  usd: number | null;
  left: { mine: number; all: number };
  limits: { mine: number; all: number };
  resetsAt: number;
  chat: boolean;
  canChoose: boolean;
}

export type StartAnswer =
  | { state: 'accepted'; job: JobView }
  | { state: 'allowance'; left: { mine: number; all: number }; resetsAt: number }
  | { state: 'busy'; job: string | null }
  | { state: 'full' }
  | { state: Exclude<MakerState, 'ok'> };

export interface StartInput {
  id: string;
  lines: { words: string; target?: MakeTarget | undefined }[];
  shape: PictureShape;
  count: number;
}

// ─── the files ───────────────────────────────────────────────────────────────

interface MadeMeta {
  ext: 'jpg' | 'png' | 'webp';
  sha256: string;
  bytes: number;
  maker: string;
  label: string;
  model: string;
  provider: string;
  words: string;
  target: MakeTarget | null;
  name: string;
  job: string;
  at: number;
  pinned: boolean;
}

interface JobFile {
  job: string;
  requestId: string;
  bodyHash: string;
  userId: string;
  sessionId: string;
  day: string;
  maker: string;
  provider: string;
  label: string;
  model: string;
  shape: PictureShape;
  shelf: string;
  state: JobState;
  stoppedBy?: string;
  at: number;
  /** `sent`: its call went out (it may be charged); `back`: its count was given back. Neither: never asked, given back at the end. */
  lines: (Omit<JobLine, 'pictures'> & { words: string; pictures: string[]; sent?: boolean; back?: boolean })[];
}

const EXT: Readonly<Record<string, MadeMeta['ext']>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME: Readonly<Record<MadeMeta['ext'], string>> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

/** A target as it was sent, checked and kept small. */
export function cleanTarget(value: unknown): MakeTarget | null | 'bad' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return 'bad';
  const raw = value as Record<string, unknown>;
  if (typeof raw['spot'] === 'string') return /^[a-z0-9-]{1,40}$/.test(raw['spot']) ? { spot: raw['spot'] } : 'bad';
  if (typeof raw['table'] !== 'string' || raw['table'].length > 120) return 'bad';
  if (typeof raw['row'] === 'number') return Number.isInteger(raw['row']) && raw['row'] >= 1 && raw['row'] <= 10_000 ? { table: raw['table'], row: raw['row'] } : 'bad';
  if (typeof raw['column'] === 'string' && typeof raw['value'] === 'string' && raw['column'].length <= 120 && raw['value'].length <= 80) {
    return { table: raw['table'], column: raw['column'], value: raw['value'] };
  }
  return 'bad';
}

// ─── the service ─────────────────────────────────────────────────────────────

export interface PictureJobsDeps {
  root: string;
  meta: MetaDb;
  settings: SettingsRepo;
  connections: AiConnections;
  /** Whether this server may call outside services now. */
  networkFeatures: () => boolean;
  /** Whether a target is still in the app, and its name; null when it is gone. */
  target: (sessionId: string, target: MakeTarget) => { name: string } | null;
  /** A session's event, of no turn. */
  emit: (sessionId: string, body: { kind: 'picture-make'; job: JobView }) => void;
  audit: (action: string, actor: { id: string | null; label: string }, detail: Record<string, unknown>) => Promise<void>;
  now?: () => number;
}

export interface PictureJobs {
  /** The services, the choice and its state, and what is left today. */
  view(userId: string | null, canChoose: boolean): Promise<MakersView>;
  /** Choose the service and model (`llm.run` only: the route checks), and whether the chat may make pictures. */
  choose(input: { id: string; model: string; chat?: boolean | undefined } | { chat: boolean }, by: { id: string | null; label: string }): Promise<MakersView>;
  /** `quiet`: the job says nothing as it goes (the chat's tool says it once, in its turn). */
  start(session: { id: string }, by: { id: string | null; label: string }, input: StartInput, opts?: { quiet?: boolean }): Promise<StartAnswer>;
  /** Stop the lines not sent yet (they are given back); the call under way finishes and is kept. */
  stop(sessionId: string, job: string, userId: string | null): boolean;
  get(sessionId: string, job: string): Promise<JobView | null>;
  /** The session's made pictures, newest first, and the job still running, if any. */
  list(sessionId: string): { pictures: MadePublic[]; running: string | null };
  /** A made picture as the apply path reads a pick: its credit fields and its bytes, sha-checked. Null when it is not one. */
  found(sessionId: string, shelf: string, picture: string): { picture: FoundPicture; bytes: Buffer; ext: MadeMeta['ext']; sha256: string } | null;
  /** The bytes and type, for a tile. */
  file(sessionId: string, shelf: string, picture: string): { bytes: Buffer; mime: string } | null;
  pin(sessionId: string, shelf: string, picture: string): boolean;
  /** At start and then hourly: half-written files, old ones, and a job that was running when the server stopped. */
  sweep(): void;
  /** For a test: wait for the job's run to end. */
  settled(job: string): Promise<void>;
}

export function createPictureJobs(deps: PictureJobsDeps): PictureJobs {
  const now = deps.now ?? (() => Date.now());
  const sessionsDir = join(deps.root, DESIGNER_DIR, 'sessions');
  const madeDir = (sessionId: string): string => join(sessionsDir, sessionId, 'made');
  /** One job under way per person, and its stop switch. */
  const running = new Map<string, { job: string; sessionId: string; stop: boolean; done: Promise<void> }>();
  const runs = new Map<string, Promise<void>>();
  /** Makes still being answered, by person, session and request id: a retry before the job exists gets the same answer. */
  const pending = new Map<string, { hash: string; answer: Promise<StartAnswer> }>();
  /** Connections found to have no picture route, and models found gone: kept while the process runs. */
  const noRoute = new Set<string>();
  const modelGone = new Set<string>();
  const modelLists = new Map<string, { at: number; models: string[] }>();

  const limitsNow = async (): Promise<{ mine: number; all: number }> => ({ mine: await deps.settings.get('designer.pictures.perDay'), all: await deps.settings.get('designer.pictures.perDayAll') });
  const leftFor = async (userId: string | null, day: string): Promise<{ mine: number; all: number }> => {
    const limits = await limitsNow();
    const use = userId === null ? { mine: limits.mine, all: 0 } : await pictureUseRepo(deps.meta).use(userId, day);
    return { mine: Math.max(0, limits.mine - use.mine), all: Math.max(0, limits.all - use.all) };
  };

  const readMeta = (sessionId: string, shelf: string, picture: string): MadeMeta | null => {
    if (!SESSION.test(sessionId) || !SHELF.test(shelf) || !PICTURE.test(picture)) return null;
    return readJson<MadeMeta>(join(madeDir(sessionId), `${shelf}.${picture}.json`));
  };
  const publicOf = (shelf: string, picture: string, meta: MadeMeta): MadePublic => ({
    id: picture,
    shelf,
    title: meta.name,
    creator: `${meta.label} · ${meta.model}`,
    source: 'AI',
    licence: { code: 'made', name: 'Made with AI' },
    page: '',
    made: { label: meta.label, model: meta.model, words: meta.words },
    target: meta.target,
    pinned: meta.pinned,
    at: meta.at,
  });
  const readJob = (sessionId: string, job: string): JobFile | null => (SESSION.test(sessionId) && JOB.test(job) ? readJson<JobFile>(join(madeDir(sessionId), `${job}.json`)) : null);
  const writeJob = (file: JobFile): void => writeWhole(join(madeDir(file.sessionId), `${file.job}.json`), JSON.stringify(file));
  const viewOf = async (file: JobFile): Promise<JobView> => ({
    job: file.job,
    state: file.state,
    ...(file.stoppedBy === undefined ? {} : { stoppedBy: file.stoppedBy }),
    label: file.label,
    model: file.model,
    lines: file.lines.map(({ words: _words, pictures, sent: _sent, back: _back, ...line }) => ({
      ...line,
      pictures: pictures.flatMap((picture) => {
        const meta = readMeta(file.sessionId, file.shelf, picture);
        return meta === null ? [] : [publicOf(file.shelf, picture, meta)];
      }),
    })),
    left: await leftFor(file.userId, assistantUseDay(now())),
  });

  /** What the session's made folder holds: its pictures (with their weight) and its jobs. */
  const holdings = (sessionId: string): { pictures: { shelf: string; picture: string; meta: MadeMeta; size: number }[]; jobs: string[] } => {
    const dir = madeDir(sessionId);
    if (!existsSync(dir)) return { pictures: [], jobs: [] };
    const pictures: { shelf: string; picture: string; meta: MadeMeta; size: number }[] = [];
    const jobs: string[] = [];
    for (const name of readdirSync(dir)) {
      const job = /^(job_[0-9a-f]{16})\.json$/.exec(name);
      if (job !== null) {
        jobs.push(job[1] as string);
        continue;
      }
      const made = /^(shelf_[0-9a-f]{16})\.(pic_[0-9a-f]{12})\.json$/.exec(name);
      if (made === null) continue;
      const meta = readJson<MadeMeta>(join(dir, name));
      if (meta !== null) pictures.push({ shelf: made[1] as string, picture: made[2] as string, meta, size: meta.bytes });
    }
    return { pictures, jobs };
  };
  const removePicture = (sessionId: string, shelf: string, picture: string, ext: string): void => {
    rmSync(join(madeDir(sessionId), `${shelf}.${picture}.${ext}`), { force: true });
    rmSync(join(madeDir(sessionId), `${shelf}.${picture}.json`), { force: true });
  };
  const serverBytes = (): number => {
    if (!existsSync(sessionsDir)) return 0;
    let total = 0;
    for (const session of readdirSync(sessionsDir)) {
      if (!SESSION.test(session)) continue;
      for (const one of holdings(session).pictures) total += one.size;
    }
    return total;
  };
  /**
   * Room for `count` more pictures: what would have to go for it, the oldest first, or null when even that is not
   * enough. A picture nobody put in "what changes" goes first; one that was, once it is a day old (it waited for an
   * Apply that did not come). Nothing is taken away here: the caller does, once the pictures are paid for.
   */
  const roomFor = (sessionId: string, count: number): { remove: () => void } | null => {
    const at = now();
    const held = holdings(sessionId).pictures.sort((a, b) => Number(a.meta.pinned) - Number(b.meta.pinned) || a.meta.at - b.meta.at);
    let files = held.length;
    let bytes = held.reduce((sum, one) => sum + one.size, 0);
    const needBytes = count * PICTURE_ROOM;
    const free: typeof held = [];
    for (const one of held) {
      if (files + count <= MADE_FILES_MAX && bytes + needBytes <= MADE_BYTES_MAX) break;
      if (one.meta.pinned && at - one.meta.at < MADE_KEEP_MS) continue;
      free.push(one);
      files -= 1;
      bytes -= one.size;
    }
    if (files + count > MADE_FILES_MAX || bytes + needBytes > MADE_BYTES_MAX) return null;
    if (serverBytes() - free.reduce((sum, one) => sum + one.size, 0) + needBytes > MADE_SERVER_BYTES_MAX) return null;
    return {
      remove: () => {
        for (const one of free) removePicture(sessionId, one.shelf, one.picture, one.meta.ext);
      },
    };
  };

  /** The chosen service as it stands now: usable, or why not. */
  const resolve = async (): Promise<
    | { state: 'ok'; maker: PictureMaker; info: PictureMakerInfo; model: string; provider: string }
    | { state: Exclude<MakerState, 'ok' | 'switched-off'>; chosen: { id: string; model: string } | null }
  > => {
    const chosen = await deps.settings.get('designer.pictures.maker');
    if (chosen === null) return { state: 'none', chosen: null };
    const available = await deps.connections.pictureMakers();
    if (!available.some((one) => one.id === chosen.id)) {
      // Not offered now: a cloud service while this server calls nothing outside, or a connection taken away or changed.
      return { state: !deps.networkFeatures() && chosen.provider !== 'ollama' ? 'off' : 'changed', chosen };
    }
    let resolved: Awaited<ReturnType<AiConnections['pictureMaker']>>;
    try {
      resolved = await deps.connections.pictureMaker(chosen.id as PictureMakerId, chosen.model);
    } catch {
      return { state: 'off', chosen };
    }
    // Another key, address or provider behind the same connection: nobody chose to pay with it.
    if (resolved.keyHash !== chosen.keyHash) return { state: 'changed', chosen };
    if (noRoute.has(chosen.id)) return { state: 'not-here', chosen };
    if (modelGone.has(`${chosen.id}\u0000${chosen.model}`)) return { state: 'model-gone', chosen };
    return { state: 'ok', maker: resolved.maker, info: resolved.info, model: chosen.model, provider: chosen.provider };
  };

  const modelsOf = async (id: PictureMakerId): Promise<{ models: string[]; listed: 'ok' | 'unreachable' }> => {
    const kept = modelLists.get(id);
    if (kept !== undefined && now() - kept.at < MODELS_KEEP_MS) return { models: kept.models, listed: 'ok' };
    try {
      const { maker } = await deps.connections.pictureMaker(id);
      const models = await maker.listModels(AbortSignal.timeout(20_000));
      modelLists.set(id, { at: now(), models });
      return { models, listed: 'ok' };
    } catch {
      return { models: [], listed: 'unreachable' };
    }
  };

  const view = async (userId: string | null, canChoose: boolean): Promise<MakersView> => {
    const at = now();
    const day = assistantUseDay(at);
    const limits = await limitsNow();
    const resolved = await resolve();
    const chosen = await deps.settings.get('designer.pictures.maker');
    const info = resolved.state === 'ok' ? resolved.info : null;
    const switchedOff = limits.mine === 0 || limits.all === 0;
    const state: MakerState = switchedOff ? 'switched-off' : resolved.state;
    const makers = canChoose ? await Promise.all((await deps.connections.pictureMakers()).map(async (maker) => ({ ...maker, ...(await modelsOf(maker.id)) }))) : [];
    return {
      makers,
      chosen: chosen === null ? null : { id: chosen.id, label: info?.label ?? makers.find((one) => one.id === chosen.id)?.label ?? chosen.provider, model: chosen.model, local: info?.local ?? false },
      state,
      usd: info === null || chosen === null ? null : knownPicturePrice(info.kind, chosen.model),
      left: await leftFor(userId, day),
      limits,
      resetsAt: assistantUseResetsAt(at),
      chat: await deps.settings.get('designer.pictures.chat'),
      canChoose,
    };
  };


  /** The run of one job: line by line, saying each step; counted as the header says. */
  const run = async (file: JobFile, maker: PictureMaker, by: { id: string | null; label: string }, quiet: boolean): Promise<void> => {
    const handle = running.get(file.userId);
    const repo = pictureUseRepo(deps.meta);
    let skipped = false;
    // The job's own file and its event: a page that cannot be told (a session gone) stops nothing, and is not paid for.
    const save = async (): Promise<void> => {
      writeJob(file);
      if (quiet) return;
      try {
        deps.emit(file.sessionId, { kind: 'picture-make', job: await viewOf(file) });
      } catch {
        // Nobody to tell: the job's file says it.
      }
    };
    try {
      for (const line of file.lines) {
        if (handle?.stop === true || file.state === 'stopped') {
          skipped = true;
          line.state = 'done';
          line.code ??= 'stopped';
          continue;
        }
        // A spot, a row or a group that went while the job ran: nothing is asked for it.
        if (line.target !== null && deps.target(file.sessionId, line.target) === null) {
          line.state = 'gone';
          await save();
          continue;
        }
        line.state = 'making';
        await save();
        try {
          // From here the service may charge for it, whatever happens to this job's own files.
          line.sent = true;
          const made = await maker.make({ prompt: line.words, model: file.model, shape: file.shape, count: line.asked });
          for (const picture of made.pictures) {
            const id = `pic_${randomBytes(6).toString('hex')}`;
            const ext = EXT[picture.type] ?? 'png';
            const bytes = Buffer.from(picture.bytes.buffer, picture.bytes.byteOffset, picture.bytes.byteLength);
            try {
              writeWhole(join(madeDir(file.sessionId), `${file.shelf}.${id}.${ext}`), bytes);
              const meta: MadeMeta = {
                ext,
                sha256: sha(bytes),
                bytes: bytes.length,
                maker: file.maker,
                label: file.label,
                model: file.model,
                provider: file.provider,
                words: line.words,
                target: line.target,
                name: line.name,
                job: file.job,
                at: now(),
                // Kept for an Apply only once it is put in "what changes" (pin): of four made, the three not chosen may go.
                pinned: false,
              };
              writeWhole(join(madeDir(file.sessionId), `${file.shelf}.${id}.json`), JSON.stringify(meta));
              line.pictures.push(id);
              line.made += 1;
            } catch {
              // The disk would not take it, after the service made it: counted, and said.
              line.failed += 1;
            }
          }
          line.refused += made.refused;
          line.failed += made.dropped - made.refused;
        } catch (error) {
          const known = error instanceof PictureError ? error : new PictureError('server', 'the call failed');
          line.code = known.code;
          if (known.code === 'refused') line.refused = line.asked;
          else line.failed = line.asked;
          if (!known.maybeCharged) line.back = true;
          if (known.code === 'not_found') noRoute.add(file.maker);
          if (known.code === 'model_gone') modelGone.add(`${file.maker}\u0000${file.model}`);
          // The key, the account, the route or the model is wrong: the other lines would fail the same way.
          if (['auth', 'billing', 'rate_limit', 'config', 'not_found', 'model_gone'].includes(known.code)) {
            file.state = 'stopped';
            file.stoppedBy = known.code;
          }
        }
        line.state = 'done';
        await save();
      }
      // Stopped only when a line was left unasked: a Stop pressed during the last call stopped nothing.
      if (file.state === 'running') file.state = skipped ? 'stopped' : 'done';
      if (file.state === 'stopped' && file.stoppedBy === undefined) file.stoppedBy = 'person';
    } catch {
      file.state = 'stopped';
      file.stoppedBy ??= 'failed';
    }
    // Back to the day it was taken from: every line never sent, and every one the answer proves was not made.
    let givenBack = 0;
    for (const line of file.lines) {
      if (line.sent !== true || line.back === true) {
        givenBack += line.asked;
        line.back = true;
      }
    }
    if (givenBack > 0) await repo.giveBack(file.userId, file.day, givenBack).catch(() => undefined);
    if (running.get(file.userId) === handle) running.delete(file.userId);
    try {
      await save();
    } catch {
      // The job's file could not be written: its pictures are on disk all the same.
    }
    const asked = file.lines.reduce((sum, line) => sum + line.asked, 0);
    const made = file.lines.reduce((sum, line) => sum + line.made, 0);
    const refused = file.lines.reduce((sum, line) => sum + line.refused, 0);
    // Who, which service, how many: never the words, the bytes or the key.
    await deps
      .audit('designer.picture.made', by, { sessionId: file.sessionId, maker: file.maker, model: file.model, asked, made, refused, givenBack, outcome: file.stoppedBy ?? file.state })
      .catch(() => undefined);
  };

  /** A Make, past the guards: checks, room, the day's count, the job's file, and the run started. */
  const begin = async (
    session: { id: string },
    by: { id: string | null; label: string },
    userId: string,
    input: StartInput,
    bodyHash: string,
    handle: { job: string; sessionId: string; stop: boolean; done: Promise<void> },
    opts: { quiet?: boolean },
  ): Promise<StartAnswer> => {
    const at = now();
    const day = assistantUseDay(at);
    const limits = await limitsNow();
    if (limits.mine === 0 || limits.all === 0) return { state: 'switched-off' };
    const resolved = await resolve();
    if (resolved.state !== 'ok') return { state: resolved.state };

    const lines: JobFile['lines'] = [];
    for (const line of input.lines) {
      const target = cleanTarget(line.target);
      if (target === 'bad') throw new PictureError('config', 'a target is not one');
      const words = plainWords(line.words, MAKE_WORDS_MAX);
      if (words === '') throw new PictureError('config', 'a line has no words');
      const named = target === null ? { name: plainWords(words, 60) } : deps.target(session.id, target);
      if (named === null) throw new PictureError('config', 'a target is not in this app');
      lines.push({ target, name: named.name, words, asked: input.lines.length > 1 ? 1 : input.count, made: 0, refused: 0, failed: 0, state: 'waiting', pictures: [] });
    }
    const asked = lines.reduce((sum, line) => sum + line.asked, 0);
    const room = roomFor(session.id, asked);
    if (room === null) return { state: 'full' };

    const repo = pictureUseRepo(deps.meta);
    const taken = await repo.take(userId, day, asked, limits);
    if (!taken.ok) return { state: 'allowance', left: { mine: Math.max(0, limits.mine - taken.use.mine), all: Math.max(0, limits.all - taken.use.all) }, resetsAt: assistantUseResetsAt(at) };

    const file: JobFile = {
      job: `job_${randomBytes(8).toString('hex')}`,
      requestId: input.id,
      bodyHash,
      userId,
      sessionId: session.id,
      day,
      maker: resolved.info.id,
      provider: resolved.provider,
      label: resolved.info.label,
      model: resolved.model,
      shape: input.shape,
      shelf: `shelf_${randomBytes(8).toString('hex')}`,
      state: 'running',
      at,
      lines,
    };
    try {
      // Paid for: the oldest pictures nobody kept make way now, not before.
      room.remove();
      mkdirSync(madeDir(session.id), { recursive: true });
      // Written before the first call: a restart finds it running and says it was lost, counted.
      writeJob(file);
    } catch (error) {
      // Nothing was asked of the service: the day gets its pictures back.
      await repo.giveBack(userId, day, asked).catch(() => undefined);
      throw error;
    }
    handle.job = file.job;
    const done = run(file, resolved.maker, by, opts.quiet === true);
    handle.done = done;
    runs.set(file.job, done);
    void done.finally(() => runs.delete(file.job));
    return { state: 'accepted', job: await viewOf(file) };
  };

  return {
    view,

    async choose(input, by) {
      if ('id' in input) {
        const available = await deps.connections.pictureMakers();
        const info = available.find((one) => one.id === input.id);
        if (info === undefined) throw new PictureError('config', 'that service cannot make pictures here');
        if (!PICTURE_MODEL_ID.test(input.model)) throw new PictureError('config', 'that is not a model id');
        // OpenAI's and Gemini's models come from their own lists; a compatible server's list may be empty, and its model is typed.
        if (info.kind !== 'openai-compatible') {
          const { models, listed } = await modelsOf(info.id);
          if (listed === 'ok' && models.length > 0 && !models.includes(input.model)) throw new PictureError('config', 'that model does not make pictures here');
        }
        const { keyHash } = await deps.connections.pictureMaker(info.id, input.model);
        const provider = info.id === 'env:ollama' ? 'ollama' : info.kind;
        await deps.settings.set('designer.pictures.maker', { id: info.id, provider, keyHash, model: input.model }, { updatedBy: by.id, at: now() });
        noRoute.delete(info.id);
        modelGone.delete(`${info.id}\u0000${input.model}`);
        await deps.audit('designer.picture-maker.chosen', by, { id: info.id, model: input.model }).catch(() => undefined);
      }
      if (input.chat !== undefined) {
        await deps.settings.set('designer.pictures.chat', input.chat, { updatedBy: by.id, at: now() });
        await deps.audit('designer.picture-maker.chat', by, { chat: input.chat }).catch(() => undefined);
      }
      return view(by.id, true);
    },

    async start(session, by, input, opts = {}) {
      // Every count is by person: a request with no person has nobody to count.
      if (by.id === null) return { state: 'none' };
      const userId = by.id;
      const bodyHash = sha(JSON.stringify({ lines: input.lines, shape: input.shape, count: input.count }));
      // The same request again joins its job; the same id with other words is a mistake.
      for (const job of holdings(session.id).jobs) {
        const file = readJob(session.id, job);
        if (file === null || file.requestId !== input.id || file.userId !== userId) continue;
        if (file.bodyHash !== bodyHash) throw new PictureError('config', 'that request id was used for other words');
        return { state: 'accepted', job: await viewOf(file) };
      }
      // The same request still being answered (a retry before its job's file exists): the same answer.
      const key = `${userId}\u0000${session.id}\u0000${input.id}`;
      const inflight = pending.get(key);
      if (inflight !== undefined) {
        if (inflight.hash !== bodyHash) throw new PictureError('config', 'that request id was used for other words');
        return inflight.answer;
      }
      const under = running.get(userId);
      if (under !== undefined) return { state: 'busy', job: under.sessionId === session.id && under.job !== '' ? under.job : null };
      // Held at once, before anything is awaited: a second Make at the same moment is busy, not a second charge.
      const handle = { job: '', sessionId: session.id, stop: false, done: Promise.resolve() };
      running.set(userId, handle);
      const answer = (async (): Promise<StartAnswer> => {
        let started = false;
        try {
          const result = await begin(session, by, userId, input, bodyHash, handle, opts);
          started = result.state === 'accepted';
          return result;
        } finally {
          if (!started && running.get(userId) === handle) running.delete(userId);
        }
      })();
      pending.set(key, { hash: bodyHash, answer });
      try {
        return await answer;
      } finally {
        pending.delete(key);
      }
    },

    stop(sessionId, job, userId) {
      if (userId === null) return false;
      const handle = running.get(userId);
      if (handle === undefined || handle.job !== job || handle.sessionId !== sessionId) return false;
      handle.stop = true;
      return true;
    },
    async get(sessionId, job) {
      const file = readJob(sessionId, job);
      return file === null ? null : viewOf(file);
    },

    list(sessionId) {
      if (!SESSION.test(sessionId)) return { pictures: [], running: null };
      const held = holdings(sessionId);
      const pictures = held.pictures.sort((a, b) => b.meta.at - a.meta.at).map((one) => publicOf(one.shelf, one.picture, one.meta));
      const live = [...running.values()].find((one) => one.sessionId === sessionId);
      return { pictures, running: live?.job ?? null };
    },

    found(sessionId, shelf, picture) {
      const meta = readMeta(sessionId, shelf, picture);
      if (meta === null) return null;
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(madeDir(sessionId), `${shelf}.${picture}.${meta.ext}`));
      } catch {
        return null;
      }
      // What was kept is what is read: a file changed under it is no picture of ours.
      if (sha(bytes) !== meta.sha256) return null;
      const found: FoundPicture = {
        id: picture,
        thumb: '',
        files: [],
        title: meta.name,
        creator: `${meta.label} · ${meta.model}`,
        creatorUrl: '',
        licence: 'Made with AI',
        licenceCode: 'made',
        licenceUrl: TERMS[meta.provider] ?? '',
        source: 'AI',
        page: '',
        made: { label: meta.label, model: meta.model, words: meta.words },
      };
      return { picture: found, bytes, ext: meta.ext, sha256: meta.sha256 };
    },

    file(sessionId, shelf, picture) {
      const meta = readMeta(sessionId, shelf, picture);
      if (meta === null) return null;
      try {
        const bytes = readFileSync(join(madeDir(sessionId), `${shelf}.${picture}.${meta.ext}`));
        return sha(bytes) === meta.sha256 ? { bytes, mime: MIME[meta.ext] } : null;
      } catch {
        return null;
      }
    },

    pin(sessionId, shelf, picture) {
      const meta = readMeta(sessionId, shelf, picture);
      if (meta === null) return false;
      if (!meta.pinned) writeWhole(join(madeDir(sessionId), `${shelf}.${picture}.json`), JSON.stringify({ ...meta, pinned: true }));
      return true;
    },

    sweep() {
      if (!existsSync(sessionsDir)) return;
      const at = now();
      for (const session of readdirSync(sessionsDir)) {
        if (!SESSION.test(session)) continue;
        const dir = madeDir(session);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
          const file = join(dir, name);
          if (name.endsWith('.tmp')) {
            // Half of a write that never finished; one younger than a minute may be a write under way now.
            try {
              if (at - statSync(file).mtimeMs > 60_000) rmSync(file, { force: true });
            } catch {
              // Gone already.
            }
            continue;
          }
          const job = /^(job_[0-9a-f]{16})\.json$/.exec(name);
          if (job !== null) {
            const kept = readJson<JobFile>(file);
            if (kept === null || at - kept.at > MADE_KEEP_MS) rmSync(file, { force: true });
            // Running in a process that is gone: lost, counted. One this process runs is left alone.
            else if (kept.state === 'running' && ![...running.values()].some((handle) => handle.job === kept.job)) writeWhole(file, JSON.stringify({ ...kept, state: 'lost' }));
          }
        }
        for (const one of holdings(session).pictures) {
          const keep = one.meta.pinned ? MADE_PINNED_KEEP_MS : MADE_KEEP_MS;
          if (at - one.meta.at > keep) removePicture(session, one.shelf, one.picture, one.meta.ext);
        }
        // A picture file with no sidecar: half of a write that never finished.
        for (const name of readdirSync(dir)) {
          const bare = /^(shelf_[0-9a-f]{16}\.pic_[0-9a-f]{12})\.(jpg|png|webp)$/.exec(name);
          if (bare !== null && !existsSync(join(dir, `${bare[1] as string}.json`))) {
            try {
              if (at - statSync(join(dir, name)).mtimeMs > 60_000) rmSync(join(dir, name), { force: true });
            } catch {
              // Gone already.
            }
          }
        }
      }
    },

    settled: async (job) => {
      await runs.get(job)?.catch(() => undefined);
    },
  };
}
