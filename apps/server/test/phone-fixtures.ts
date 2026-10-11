// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the phone side's tests share: a project whose app has the real phone
 * starter, and a stand-in for the two programs a phone side starts (npm and
 * Expo). No test installs a package or runs Expo: the stand-in leaves on disk
 * what the real programs would, and remembers what it was asked to start.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ChildResult } from '../src/designer/child.js';
import { buildPhone, installPhone, type PhoneBuild, type PhoneRunner } from '../src/project/apps/phone-build.js';
import { approvePhone, phoneDir } from '../src/project/apps/phone.js';
import type { Launch } from '../src/project/programs.js';
import { scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';

/** One program the stand-in was asked to start. */
export interface Started {
  kind: 'install' | 'export' | 'other';
  launch: Launch;
  cwd: string;
  timeoutMs: number;
  env: Record<string, string>;
}

export interface StandIn {
  run: PhoneRunner;
  started: Started[];
  installs: () => Started[];
  exports: () => Started[];
  /** What the install ends with; anything but 0 leaves nothing on disk. */
  installCode: number;
  /** What the export ends with. */
  exportCode: number;
  /** False: the export ends well and leaves no index.html. */
  exportWrites: boolean;
  /** What a program that fails printed. */
  output: string;
  /** How long an export takes, so two at once would be seen. */
  exportMs: number;
  /** Called as an export starts, with how many it has started so far. */
  onExport: ((count: number, cwd: string) => void) | null;
  /** The most exports that ran at one moment. */
  mostAtOnce: number;
}

const argAfter = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

/** A stand-in for npm and Expo: it writes what they would, and starts nothing. */
export function standIn(): StandIn {
  let running = 0;
  const fake: StandIn = {
    started: [],
    installs: () => fake.started.filter((entry) => entry.kind === 'install'),
    exports: () => fake.started.filter((entry) => entry.kind === 'export'),
    installCode: 0,
    exportCode: 0,
    exportWrites: true,
    output: '',
    exportMs: 0,
    onExport: null,
    mostAtOnce: 0,
    run: async (launch, opts): Promise<ChildResult> => {
      const { args } = launch;
      const kind: Started['kind'] = args.includes('export') ? 'export' : args.includes('install') || args.includes('ci') ? 'install' : 'other';
      fake.started.push({ kind, launch, cwd: opts.cwd, timeoutMs: opts.timeoutMs, env: { ...opts.env } });
      const ended = (code: number): ChildResult => ({ code, output: code === 0 ? '' : fake.output, timedOut: false, stopped: false });
      if (kind === 'install') {
        if (fake.installCode !== 0) return ended(fake.installCode);
        mkdirSync(join(opts.cwd, 'node_modules', 'expo', 'bin'), { recursive: true });
        writeFileSync(join(opts.cwd, 'node_modules', 'expo', 'bin', 'cli'), '#!/usr/bin/env node\n');
        writeFileSync(join(opts.cwd, 'node_modules', 'expo', 'package.json'), '{"name":"expo","version":"57.0.27"}\n');
        writeFileSync(join(opts.cwd, 'package-lock.json'), '{"lockfileVersion":3}\n');
        return ended(0);
      }
      if (kind === 'export') {
        running += 1;
        fake.mostAtOnce = Math.max(fake.mostAtOnce, running);
        try {
          fake.onExport?.(fake.exports().length, opts.cwd);
          if (fake.exportMs > 0) await new Promise((resolve) => setTimeout(resolve, fake.exportMs));
          if (fake.exportCode !== 0) return ended(fake.exportCode);
          const to = argAfter(args, '--output-dir');
          if (to !== undefined && fake.exportWrites) {
            mkdirSync(join(to, '_expo', 'static'), { recursive: true });
            writeFileSync(join(to, 'index.html'), `<!doctype html><title>Phone ${String(fake.exports().length)}</title>`);
            writeFileSync(join(to, '_expo', 'static', 'app.js'), 'console.log("phone")');
          }
          return ended(0);
        } finally {
          running -= 1;
        }
      }
      return ended(0);
    },
  };
  return fake;
}

/** A project with one app that has the real phone starter and no web side. Remove it in afterEach. */
export function phoneProject(prefix: string, key = 'shop', name = 'Shop'): string {
  // Its real name: a temp folder is a link on a Mac, and the Designer's jail goes by where a file really is.
  const root = realpathSync(tempProject(prefix));
  scaffoldApp({ root, key, name, sides: [], version: APP_VERSION, phone: true });
  return root;
}

/** Write a file of the phone side (or, with `..`, of the app). */
export function putPhone(root: string, key: string, file: string, content: string | Record<string, unknown>): void {
  const target = join(phoneDir(root, key), file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
}

/** Approve, install and build the phone side through the stand-in. */
export async function buildFixturePhone(root: string, key: string, fake: StandIn): Promise<PhoneBuild> {
  approvePhone(root, key);
  const installed = await installPhone(root, key, { run: fake.run });
  if (!installed.ok) throw new Error(installed.words);
  return buildPhone(root, key, { run: fake.run });
}
