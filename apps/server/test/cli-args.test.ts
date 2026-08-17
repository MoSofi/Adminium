// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CLI argument parsing, `--help`, and `--version` (M10-T01).
 *
 * These assert the SHAPE of the front door: which flags exist, how repeatable
 * and CSV list flags collapse, and that help is derived from the same specs the
 * parser enforces (so a documented flag always exists and vice versa).
 */
import { describe, expect, it } from 'vitest';

import {
  boolFlag,
  numberFlag,
  parseFlags,
  splitList,
  stringFlag,
  type FlagSpecs,
} from '../src/cli/args.js';
import { renderCommandHelp, renderRootHelp } from '../src/cli/command.js';
import { CliUsageError } from '../src/cli/exit.js';
import { COMMANDS, findCommand, runCli } from '../src/cli/run.js';
import { fakeIo } from './cli-helpers.js';

const SPECS: FlagSpecs = {
  connection: { type: 'string', short: 'c', describe: 'Connection id' },
  sections: { type: 'string', multiple: true, describe: 'Sections' },
  sampling: { type: 'boolean', describe: 'Sampling' },
};

describe('parseFlags', () => {
  it('parses long flags, --flag=value, and short aliases identically', () => {
    expect(stringFlag(parseFlags(['--connection', 'conn_1'], SPECS).values.connection)).toBe('conn_1');
    expect(stringFlag(parseFlags(['--connection=conn_1'], SPECS).values.connection)).toBe('conn_1');
    expect(stringFlag(parseFlags(['-c', 'conn_1'], SPECS).values.connection)).toBe('conn_1');
  });

  it('reads boolean flags by presence', () => {
    expect(boolFlag(parseFlags(['--sampling'], SPECS).values.sampling)).toBe(true);
    expect(boolFlag(parseFlags([], SPECS).values.sampling)).toBe(false);
  });

  it('rejects unknown flags as a usage error rather than a raw Node throw', () => {
    expect(() => parseFlags(['--nope'], SPECS, 'introspect')).toThrow(CliUsageError);
  });

  it('collects positionals', () => {
    expect(parseFlags(['alpha', 'beta'], SPECS).positionals).toEqual(['alpha', 'beta']);
  });
});

describe('splitList — the §10.4 `--sections a,b` / repeated-flag forms', () => {
  it('splits a CSV value', () => {
    expect(splitList(parseFlags(['--sections', 'labels,enums'], SPECS).values.sections)).toEqual([
      'labels',
      'enums',
    ]);
  });

  it('concatenates repeated flags', () => {
    const { values } = parseFlags(['--sections', 'labels', '--sections', 'enums'], SPECS);
    expect(splitList(values.sections)).toEqual(['labels', 'enums']);
  });

  it('mixes both forms and trims whitespace', () => {
    const { values } = parseFlags(['--sections', ' labels , enums ', '--sections', 'relations'], SPECS);
    expect(splitList(values.sections)).toEqual(['labels', 'enums', 'relations']);
  });

  it('is empty when the flag is absent', () => {
    expect(splitList(undefined)).toEqual([]);
  });
});

describe('numberFlag', () => {
  it('coerces a numeric string', () => {
    expect(numberFlag('8080', 'port')).toBe(8080);
  });

  it('rejects a non-number with a usage error naming the flag', () => {
    expect(() => numberFlag('banana', 'port')).toThrow(/--port must be a number/);
  });

  it('is undefined when absent, so the env default survives', () => {
    expect(numberFlag(undefined, 'port')).toBeUndefined();
  });
});

describe('--version', () => {
  it('prints the package version and exits 0', async () => {
    const io = fakeIo();
    await expect(runCli(['--version'], { io, version: '1.2.3' })).resolves.toBe(0);
    expect(io.stdout()).toBe('1.2.3\n');
  });

  it('accepts -v', async () => {
    const io = fakeIo();
    await expect(runCli(['-v'], { io, version: '1.2.3' })).resolves.toBe(0);
    expect(io.stdout()).toBe('1.2.3\n');
  });
});

describe('--help', () => {
  it('lists every registered command and exits 0', async () => {
    const io = fakeIo();
    await expect(runCli(['--help'], { io, version: '1.2.3' })).resolves.toBe(0);
    for (const command of COMMANDS) expect(io.stdout()).toContain(command.name);
  });

  it('documents ADMINIUM_SECRET, the one variable with no default', async () => {
    const io = fakeIo();
    await runCli(['--help'], { io });
    expect(io.stdout()).toContain('ADMINIUM_SECRET');
  });

  it('`adminium <command> --help` prints that command, not the root help', async () => {
    const io = fakeIo();
    await expect(runCli(['introspect', '--help'], { io })).resolves.toBe(0);
    expect(io.stdout()).toContain('adminium introspect');
    expect(io.stdout()).not.toContain('Commands:');
  });

  it('`adminium help <command>` is the same as `<command> --help`', async () => {
    const io = fakeIo();
    await runCli(['help', 'migrate'], { io });
    expect(io.stdout()).toContain('adminium migrate');
  });

  it('an unknown command exits 1 and shows the root help on stderr', async () => {
    const io = fakeIo();
    await expect(runCli(['frobnicate'], { io })).resolves.toBe(1);
    expect(io.stderr()).toContain('Unknown command "frobnicate"');
    expect(io.stderr()).toContain('Commands:');
  });
});

describe('help text is derived from the flag specs', () => {
  it.each(COMMANDS.map((command) => [command.name, command] as const))(
    '%s documents every flag it accepts',
    (_name, command) => {
      const help = renderCommandHelp(command);
      for (const flag of Object.keys(command.flags)) expect(help).toContain(`--${flag}`);
    },
  );

  it('renders the root help without a command missing its summary', () => {
    const help = renderRootHelp(COMMANDS, '9.9.9');
    for (const command of COMMANDS) expect(help).toContain(command.summary);
  });
});

describe('command registry', () => {
  it('exposes exactly the M10-T01 subcommands', () => {
    expect(COMMANDS.map((command) => command.name)).toEqual([
      'init',
      'start',
      'migrate',
      'introspect',
      'generate-prompt',
      'apply-llm-response',
      'export-zip',
      'import-zip',
    ]);
  });

  it('resolves a command by name', () => {
    expect(findCommand('migrate')?.name).toBe('migrate');
    expect(findCommand('nope')).toBeUndefined();
  });
});
