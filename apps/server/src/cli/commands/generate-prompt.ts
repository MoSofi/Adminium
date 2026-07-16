/**
 * `adminium generate-prompt` — 06-llm-assist.md §10.4, verbatim:
 *
 *   npx adminium generate-prompt --connection <id> [--sections labels,enums,…]
 *       [--locales en_US,de_DE] [--sampling] [--out ./prompt.md]
 *          → writes prompt file(s), prints runId + token estimate
 *
 * Runs through `promptService.createRunForConnection` — the SAME call
 * `POST /api/v1/llm/runs` makes — so the prompt text a CLI user pastes into a
 * chat window is byte-identical to the one the Studio BYO screen shows, and the
 * run is a first-class row either way. It never touches the HTTP API.
 *
 * Chunked runs (§4.5) write one file per chunk: `--out ./prompt.md` with three
 * chunks yields `prompt.1.md`, `prompt.2.md`, `prompt.3.md` — hence "file(s)".
 */

import { writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import type { LocaleCode, RequestedSection, Sampling } from '@adminium/llm';

import { boolFlag, parseFlags, splitList, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK } from '../exit.js';
import type { CliRuntime } from '../runtime.js';
import { loadCliEnv } from '../runtime.js';

/**
 * Per-column sample cap when `--sampling` is passed. Mirrors the Studio wizard's
 * `SAMPLING_MAX_VALUES` (06 §4.2) — the two front doors must opt in to the same
 * amount of data, or "the same prompt" would be a lie.
 */
export const SAMPLING_MAX_VALUES = 20;

/** `./prompt.md` + chunk 2 of 3 → `./prompt.2.md`; single-chunk keeps the name. */
export function chunkFileName(out: string, index: number, total: number): string {
  if (total <= 1) return out;
  const ext = extname(out);
  const base = ext === '' ? out : out.slice(0, -ext.length);
  return `${base}.${String(index)}${ext}`;
}

/** The prompt service, or the reason it is unavailable, as one actionable error. */
export function requirePromptService(runtime: CliRuntime): NonNullable<CliRuntime['promptService']> {
  if (runtime.promptService !== null) return runtime.promptService;
  const cause = runtime.promptServiceError;
  if (cause instanceof CliError) throw cause;
  throw new CliError(cause?.message ?? 'The AI prompt builder is unavailable.', { cause });
}

export const generatePromptCommand: Command = {
  name: 'generate-prompt',
  summary: 'Build an LLM enrichment prompt for a connection (BYO round-trip)',
  usage:
    'adminium generate-prompt --connection <id> [--sections <list>] [--locales <list>]\n' +
    '                        [--sampling] [--out <file>]',
  describe:
    'Creates a BYO run from the connection\'s latest snapshot and writes the\n' +
    'prompt. Paste it into any chat model, save the reply, and feed it back with\n' +
    '`adminium apply-llm-response --run <runId> --file <reply.json>`.\n' +
    '\n' +
    'Nothing leaves this machine: BYO runs record no provider and no model, and\n' +
    'the prompt carries schema metadata + aggregates only — never your rows,\n' +
    'unless you opt in with --sampling.',
  flags: {
    connection: {
      type: 'string',
      short: 'c',
      placeholder: '<id>',
      describe: 'Connection id to build the prompt for (required)',
    },
    sections: {
      type: 'string',
      multiple: true,
      placeholder: '<list>',
      describe: 'Decision groups to request, e.g. labels,enums,relations',
      defaultDescription: 'all sections',
    },
    locales: {
      type: 'string',
      multiple: true,
      placeholder: '<list>',
      describe: 'Output locales, e.g. en_US,de_DE (en_US is always included)',
      defaultDescription: 'en_US',
    },
    sampling: {
      type: 'boolean',
      describe: 'Opt in to including sampled example values in the prompt',
      defaultDescription: 'off — sample-free',
    },
    out: {
      type: 'string',
      short: 'o',
      placeholder: '<file>',
      describe: 'Write the prompt here (chunked runs get <name>.<n>.<ext>)',
      defaultDescription: 'print to stdout',
    },
    'data-dir': { type: 'string', placeholder: '<path>', describe: 'Data directory' },
    'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN' },
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, generatePromptCommand.flags, generatePromptCommand.name);
    const connectionId = stringFlag(values.connection);
    if (connectionId === undefined) {
      throw new CliError('--connection <id> is required.', {
        hint: 'See `adminium generate-prompt --help`.',
      });
    }

    const sections = splitList(values.sections) as RequestedSection[];
    const locales = splitList(values.locales) as LocaleCode[];
    const sampling: Sampling = boolFlag(values.sampling)
      ? { maxValuesPerColumn: SAMPLING_MAX_VALUES }
      : null;
    const dataDir = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);

    const env = loadCliEnv(deps.env, {
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(metaUrl === undefined ? {} : { metaUrl }),
    });
    const runtime = await deps.openRuntime(env);

    try {
      const promptService = requirePromptService(runtime);
      const created = await promptService.createRunForConnection({
        connectionId,
        path: 'byo',
        ...(locales.length === 0 ? {} : { locales }),
        ...(sections.length === 0 ? {} : { sections }),
        sampling,
      });

      const chunks = created.artifact.chunks;
      const out = stringFlag(values.out);

      if (out === undefined) {
        for (const chunk of chunks) {
          if (chunks.length > 1) io.out(`\n=== chunk ${String(chunk.index)}/${String(chunk.total)} ===\n`);
          io.out(chunk.byo);
        }
      } else {
        const target = resolve(deps.cwd, out);
        for (const chunk of chunks) {
          const file = chunkFileName(target, chunk.index, chunk.total);
          await writeFile(file, chunk.byo, 'utf8');
          io.out(`Wrote ${file}`);
        }
      }

      // The two facts §10.4 requires on stdout.
      io.out('');
      io.out(`runId:          ${created.run.id}`);
      io.out(`token estimate: ~${String(created.artifact.tokenEstimate)}`);
      if (chunks.length > 1) io.out(`chunks:         ${String(chunks.length)}`);
      io.out('');
      io.out('Next: paste the prompt into your model, save the reply, then run');
      io.out(`  adminium apply-llm-response --run ${created.run.id} --file ./response.json`);
      return EXIT_OK;
    } finally {
      await runtime.close();
    }
  },
};
