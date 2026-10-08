// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Start with an app": a published app copied into the project and made the
 * person's own, as a job with three steps a page can show.
 *
 *   get     the app's source, at its release, from its own repository
 *   make    the copy under the new key (`project/apps/copy-app.ts`), written
 *           to `apps/<key>/`, its build command approved by the person
 *   build   its packages installed, its screens built, the app applied
 *
 * The job is this process's own and is not kept across a restart: a copy that
 * was written and not built is finished by starting it again under the same
 * key ("Try again"), which goes straight to the last step.
 *
 * Nothing here is reachable by a model: it is the person's action, taken from
 * the sheet, and the build command it approves is the one the sheet showed.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';
import { copyBuildFor, planCopy } from '../project/apps/copy-app.js';
import { approveBuild, buildFingerprint, readAppBuild, type AppBuildFile } from '../project/apps/own-build.js';
import { APPS_DIR } from '../project/apps/read-app.js';
import { appKeyProblem } from '../project/apps/scaffold-app.js';
import { SourceArchiveError, fetchSourceArchive, readSourceArchive, sourceArchiveUrl } from '../project/apps/source-archive.js';

export type StartStepId = 'get' | 'make' | 'build';
export interface StartStep {
  id: StartStepId;
  state: 'waiting' | 'running' | 'done' | 'failed';
  /** Why it failed, in a sentence or a few lines. */
  detail?: string;
}
export interface StartJob {
  id: string;
  /** The app copied, and the key and name of the copy. */
  key: string;
  newKey: string;
  name: string;
  state: 'running' | 'done' | 'failed';
  steps: StartStep[];
  /** The Designer session opened on the copy, once it is applied. */
  sessionId: string | null;
}

/** An app of the list that can be copied. */
export interface CopyableApp {
  key: string;
  version: string;
  name: string;
  repo: string;
}

export interface StarterHost {
  root: string;
  /** The app of the adminium.dev list by key, or null (not listed, the list switched off, or it names no source). */
  listed(key: string): Promise<CopyableApp | null>;
  /** The keys of every app installed on this server. */
  installedKeys(): Promise<string[]>;
  /** Build the project's apps and apply them: the problems of `key`, or none. */
  buildAndApply(key: string, signal?: AbortSignal): Promise<string[]>;
  /**
   * Take the project folder for the copy, or throw: a turn, a hand save, a
   * style change and going back write the same folder, and none of them runs
   * beside a copy. Absent in a harness with nothing else that writes.
   */
  hold?(): { signal: AbortSignal; release(): void };
  /** Open a session on an app that is in the folder. */
  openSession(appKey: string, input: StartInput): Promise<string>;
  audit(action: string, by: { id: string | null; label: string }, detail: Record<string, unknown>): Promise<void>;
  fetch?: typeof fetch;
  log: (message: string, error?: unknown) => void;
}

export interface StartInput {
  key: string;
  newKey: string;
  name: string;
  /** The fingerprint of the build the person read and approved. */
  approve: string;
  /** The model the session on the copy starts with, and who asked. */
  connectionId: string;
  model: string;
  by: { id: string | null; label: string };
}

export interface Starter {
  /** Why `newKey` cannot be a copy's key, or null. */
  keyProblem(newKey: string): Promise<string | null>;
  /** The build a copy under `newKey` would be given, for the person to read. */
  buildFor(newKey: string): AppBuildFile & { fingerprint: string };
  start(input: StartInput): Promise<StartJob>;
  job(id: string): StartJob;
}

const KEY_MAX = 40;

export function createStarter(host: StarterHost): Starter {
  const jobs = new Map<string, StartJob>();
  /** Copies this process wrote and has not yet applied: "Try again" finishes one, by its key. */
  const unfinished = new Map<string, string>();
  /** One copy at a time, held from the first line of `start`: two requests never both pass the checks. */
  let busy = false;

  const folder = (key: string): string => join(host.root, APPS_DIR, key);

  async function keyProblem(newKey: string): Promise<string | null> {
    const shape = appKeyProblem(newKey);
    if (shape !== null) return `A key is ${shape}.`;
    if (newKey.length > KEY_MAX) return `A key is at most ${String(KEY_MAX)} characters.`;
    // A copy left unfinished is finished by "Try again", while its folder is still there.
    if (unfinished.has(newKey)) {
      if (existsSync(folder(newKey))) return null;
      unfinished.delete(newKey);
    }
    if (existsSync(folder(newKey))) return `There is already an app "${newKey}" in this project.`;
    if ((await host.installedKeys()).includes(newKey)) return `An app with the key "${newKey}" is installed here already.`;
    return null;
  }

  const buildFor = (newKey: string): AppBuildFile & { fingerprint: string } => {
    const build = copyBuildFor(newKey);
    return { ...build, fingerprint: buildFingerprint(build) };
  };

  async function run(job: StartJob, app: CopyableApp, input: StartInput): Promise<void> {
    const step = (id: StartStepId): StartStep => job.steps.find((candidate) => candidate.id === id) as StartStep;
    const fail = (id: StartStepId, detail: string): void => {
      step(id).state = 'failed';
      step(id).detail = detail.slice(0, 2000);
      job.state = 'failed';
    };
    const resumed = unfinished.get(job.newKey) === app.key && existsSync(folder(job.newKey));
    let hold: { signal: AbortSignal; release(): void } | undefined;
    /** The folder is taken once the download is over and before the first write: a refusal is this job's own failure. */
    const takeFolder = (id: StartStepId): boolean => {
      try {
        hold = host.hold?.();
        return true;
      } catch (error) {
        fail(id, error instanceof Error ? error.message : String(error));
        return false;
      }
    };
    try {
      if (resumed) {
        // The copy is written: only the last step is left.
        step('get').state = 'done';
        step('make').state = 'done';
        if (!takeFolder('build')) return;
      } else {
        step('get').state = 'running';
        const url = sourceArchiveUrl(app.repo, app.version);
        if (url === null) return fail('get', 'The list does not say where this app’s source is, so it cannot be copied. Install it as it is instead.');
        let source: Map<string, Buffer>;
        try {
          source = readSourceArchive(await fetchSourceArchive(url, { ...(host.fetch === undefined ? {} : { fetch: host.fetch }), signal: AbortSignal.timeout(120_000) }));
        } catch (error) {
          return fail('get', error instanceof SourceArchiveError ? error.message : `The app’s source could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
        }
        step('get').state = 'done';

        step('make').state = 'running';
        if (!takeFolder('make')) return;
        const plan = planCopy(source, { to: job.newKey, name: job.name });
        if (plan.problems.length > 0) return fail('make', plan.problems.slice(0, 4).join('\n'));
        const dir = folder(job.newKey);
        // The folder is made here and must not be there: one that appeared since the key was checked is someone else's app.
        try {
          mkdirSync(dirname(dir), { recursive: true });
          mkdirSync(dir);
        } catch (error) {
          const taken = (error as NodeJS.ErrnoException).code === 'EEXIST';
          return fail('make', taken ? `There is already an app "${job.newKey}" in this project.` : `The copy's folder could not be made: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          for (const [path, bytes] of plan.files) {
            const file = join(dir, path);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, bytes);
          }
        } catch (error) {
          rmSync(dir, { recursive: true, force: true });
          return fail('make', `The copy could not be written: ${error instanceof Error ? error.message : String(error)}`);
        }
        // The person approved the build the sheet showed; it is this one, read back from the file just written.
        const written = readAppBuild(host.root, job.newKey);
        if (written === null || 'problem' in written) {
          rmSync(dir, { recursive: true, force: true });
          return fail('make', 'The copy’s build file could not be read back.');
        }
        // What the person read and approved is what runs: a file that reads otherwise is not approved.
        if (buildFingerprint(written) !== input.approve) {
          rmSync(dir, { recursive: true, force: true });
          return fail('make', 'The copy’s build is not the one that was approved.');
        }
        try {
          approveBuild(host.root, job.newKey, written);
        } catch (error) {
          rmSync(dir, { recursive: true, force: true });
          return fail('make', `The approval could not be kept: ${error instanceof Error ? error.message : String(error)}`);
        }
        unfinished.set(job.newKey, app.key);
        step('make').state = 'done';
      }

      step('build').state = 'running';
      const problems = await host.buildAndApply(job.newKey, hold?.signal);
      if (problems.length > 0) return fail('build', problems.slice(0, 4).join('\n'));
      // The copy is whole once its session is open: until then "Try again" finishes it.
      job.sessionId = await host.openSession(job.newKey, input);
      unfinished.delete(job.newKey);
      step('build').state = 'done';
      job.state = 'done';
      await host.audit('designer.app.copied', input.by, { from: app.key, version: app.version, key: job.newKey }).catch((error: unknown) => {
        host.log('a copy was not recorded in the audit log', error);
      });
    } catch (error) {
      host.log('a "Start with an app" job failed', error);
      const running = job.steps.find((candidate) => candidate.state === 'running');
      fail(running?.id ?? 'build', error instanceof Error ? error.message : String(error));
    } finally {
      hold?.release();
      busy = false;
    }
  }

  return {
    keyProblem,
    buildFor,
    async start(input) {
      if (busy) throw new ConflictError('Another app is being copied. Wait for it to finish.', 'CONFLICT', { reason: 'COPY_RUNNING' });
      busy = true;
      try {
        return await begin(input);
      } catch (error) {
        busy = false;
        throw error;
      }
    },
    job(id) {
      const job = jobs.get(id);
      if (job === undefined) throw new NotFoundError('There is no such copy.', { id });
      return job;
    },
  };

  async function begin(input: StartInput): Promise<StartJob> {
    const name = input.name.trim();
    if (name === '' || name.length > 80) throw new ValidationFailedError('Give the app a name of 1 to 80 characters.', { reason: 'NAME' });
    const problem = await keyProblem(input.newKey);
    if (problem !== null) throw new ConflictError(problem, 'CONFLICT', { reason: 'KEY' });
    // The approval is of the exact build this copy gets: a page that showed another one approved nothing.
    if (input.approve !== buildFor(input.newKey).fingerprint) {
      throw new ValidationFailedError('Approve the build command as it is shown.', { reason: 'BUILD_NOT_APPROVED' });
    }
    const app = await host.listed(input.key);
    if (app === null) throw new NotFoundError(`"${input.key}" is not an app of the list.`, { key: input.key });
    // A copy left unfinished is finished from the app it was made from, and no other.
    const begun = unfinished.get(input.newKey);
    if (begun !== undefined && begun !== app.key) throw new ConflictError(`There is already an app "${input.newKey}" in this project.`, 'CONFLICT', { reason: 'KEY' });
    // Only the last few are kept: a job is read while its sheet is open.
    for (const id of [...jobs.keys()].slice(0, Math.max(0, jobs.size - 20))) jobs.delete(id);
    const job: StartJob = {
      id: `start_${randomBytes(12).toString('hex')}`,
      key: app.key,
      newKey: input.newKey,
      name,
      state: 'running',
      steps: [
        { id: 'get', state: 'waiting' },
        { id: 'make', state: 'waiting' },
        { id: 'build', state: 'waiting' },
      ],
      sessionId: null,
    };
    jobs.set(job.id, job);
    void run(job, app, input);
    return job;
  }
}
