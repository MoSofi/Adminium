// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A command the Designer starts: an app's tests, a package install a person
 * approved.
 *
 * It runs as this server's user, so it is given as little of this server as
 * a command can work without. Its environment is this process's minus every
 * secret: the instance secret, the model keys, anything whose name says it
 * is a token, a key or a password, and `NODE_OPTIONS` (which would let a file
 * be loaded into it before it starts). It is stopped when the turn stops, and
 * killed when it runs too long. What it prints is kept, up to a limit.
 */
import { spawn } from 'node:child_process';

/** The most output kept from a command. */
const MAX_OUTPUT = 200_000;

/** Whether an environment variable must not reach a command the Designer starts. */
export function isSecretName(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    upper === 'ADMINIUM_SECRET' ||
    upper === 'NODE_OPTIONS' ||
    upper.startsWith('ADMINIUM_AI_') ||
    upper === 'ADMINIUM_BOOT_TOKEN' ||
    /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL/.test(upper) ||
    upper === 'DATABASE_URL' ||
    upper.endsWith('_DATABASE_URL') ||
    upper === 'ADMINIUM_META_URL' ||
    upper === 'ADMINIUM_STORAGE_URL'
  );
}

export function scrubbedEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !isSecretName(name)) out[name] = value;
  }
  return out;
}

export interface ChildResult {
  /** The exit code, or null when it was stopped or killed. */
  code: number | null;
  output: string;
  timedOut: boolean;
  stopped: boolean;
}

export function runChild(
  command: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
): Promise<ChildResult> {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let stopped = false;
    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      env: scrubbedEnvironment(opts.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    const keep = (chunk: Buffer): void => {
      if (output.length < MAX_OUTPUT) output += chunk.toString('utf8').slice(0, MAX_OUTPUT - output.length);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    const onStop = (): void => {
      stopped = true;
      child.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onStop, { once: true });
    const finish = (code: number | null): void => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onStop);
      resolve({ code: timedOut || stopped ? null : code, output, timedOut, stopped });
    };
    child.on('error', (error) => {
      output += `\n${error.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

/** A program that keeps running until it is stopped: Expo's bundler, while a phone looks at an app. */
export interface LongChild {
  /** Ends it, and what it started. Safe to call twice. */
  stop: () => void;
  /** Settles when it has ended, with its exit code (null when it was stopped or could not start). */
  ended: Promise<number | null>;
  /** The end of what it printed so far. */
  output: () => string;
}

/**
 * What stands between this server and a long-running program: it starts the
 * program (the arguments after `--`), and ends it the moment its own input
 * closes. This server holds that input open, so the program cannot outlive
 * the server: stopped, crashed or killed, the pipe closes and the program
 * goes with it. It is given to Node as text and reads nothing else.
 */
const KEEPER = [
  "const { spawn } = require('node:child_process');",
  "const child = spawn(process.execPath, process.argv.slice(1), { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });",
  "const end = () => { try { child.kill('SIGKILL'); } catch {} };",
  "process.stdin.on('end', end); process.stdin.on('close', end); process.stdin.on('error', end); process.stdin.resume();",
  "process.on('SIGTERM', () => { end(); process.exit(143); });",
  "child.on('exit', (code) => process.exit(code === null ? 1 : code));",
  "child.on('error', () => process.exit(1));",
].join('\n');

/**
 * Start a Node program that runs until stopped. `command` is the Node to run
 * it with (the resolver's), `args` the program and its arguments. Its
 * environment is scrubbed like any command's here.
 */
export function startLongChild(command: string, args: readonly string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): LongChild {
  let output = '';
  let stopped = false;
  const child = spawn(command, ['-e', KEEPER, '--', ...args], {
    cwd: opts.cwd,
    env: scrubbedEnvironment(opts.env),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  const keep = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-20_000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  // A broken pipe on the way down is the keeper going, not a fault of this server's.
  child.stdin?.on('error', () => undefined);
  const ended = new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      output += `\n${error.message}`;
      resolve(null);
    });
    child.on('close', (code) => resolve(stopped ? null : code));
  });
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      // Closing its input is the keeper's word to end the program; the kill is for a keeper that did not hear it.
      child.stdin?.end();
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
    },
    ended,
    output: () => output,
  };
}
