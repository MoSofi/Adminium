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
