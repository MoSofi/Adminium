// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium apply-llm-response` — 06-llm-assist.md §10.4, verbatim:
 *
 *   adminium apply-llm-response --run <runId> --file ./response.json
 *       [--chunk 2] [--yes-above 0.8] [--dry-run]
 *          → validates, prints the diff table, applies (or previews with --dry-run)
 *
 *   "`--dry-run` prints the same per-path validation errors and diff rows the UI
 *    shows. Exit codes: `0` applied, `2` validation failed, `3` nothing accepted."
 *
 * Every step is a call into the existing services — `runService.receiveResponse`
 * (the same BYO intake `POST /llm/runs/:id/response` uses),
 * `applyService.buildPlanForRun` (the same diff `GET /llm/runs/:id/diff` returns),
 * `applyService.applyRun` (the same transactional executor, provenance and undo
 * included). No HTTP, no second implementation of any of it.
 *
 * The one CLI-specific decision is which rows to accept: the review screen has a
 * confidence slider and checkboxes, and `--yes-above` is its headless equivalent
 * — the "Accept all ≥ 0.8" bulk control, default and all.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { SuggestionDiff } from '@adminium/llm';

import { selectAcceptedByConfidence } from '../../llm/apply-service.js';
import { numberFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import {
  CliError,
  EXIT_NOTHING_ACCEPTED,
  EXIT_OK,
  EXIT_VALIDATION_FAILED,
  type ExitCode,
} from '../exit.js';
import type { CliIo } from '../io.js';
import { renderTable } from '../io.js';
import { loadCliEnv } from '../runtime.js';

/**
 * The review screen's default bulk-accept threshold ("Accept all ≥ 0.8",
 * §10.3). Same number, same meaning, so a headless apply and a reviewed apply
 * of the same run land on the same set.
 */
export const DEFAULT_YES_ABOVE = 0.8;

/** `{ a: 1 }` → `a: 1`, clipped — the diff table's value columns. */
function preview(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** The §10.3 review rows, as the table §10.4 says to print. */
function printDiffTable(
  io: CliIo,
  diff: readonly SuggestionDiff[],
  accepted: ReadonlySet<string>,
): void {
  io.out(
    renderTable(
      ['', 'category', 'target', 'status', 'heuristic', 'llm', 'conf'],
      diff.map((row) => [
        accepted.has(row.id) ? '✓' : ' ',
        row.category,
        row.table ?? '—',
        row.status,
        preview(row.heuristicValue),
        preview(row.llmValue),
        row.confidence.toFixed(2),
      ]),
      [1, 14, 28, 18, 24, 24, 4],
    ),
  );
}

export const applyLlmResponseCommand: Command = {
  name: 'apply-llm-response',
  summary: 'Validate an LLM response and apply the accepted suggestions',
  usage:
    'adminium apply-llm-response --run <runId> --file <response.json>\n' +
    '                           [--chunk <n>] [--yes-above <0..1>] [--dry-run]',
  describe:
    'Feeds a saved model reply back into its run: validates it, prints the diff\n' +
    'against the heuristic baseline, and applies the rows at or above the\n' +
    'confidence threshold in one transaction.\n' +
    '\n' +
    'Your own edits are never overwritten (user > llm > heuristic), and applying\n' +
    'the same run twice writes no duplicates.\n' +
    '\n' +
    'Exit codes: 0 applied · 2 validation failed · 3 nothing accepted.',
  flags: {
    run: { type: 'string', short: 'r', placeholder: '<runId>', describe: 'Run id from generate-prompt (required)' },
    file: { type: 'string', short: 'f', placeholder: '<path>', describe: 'The saved model response (required)' },
    chunk: {
      type: 'string',
      placeholder: '<n>',
      describe: 'Which chunk this file answers, for chunked runs',
      defaultDescription: 'unchunked',
    },
    'yes-above': {
      type: 'string',
      placeholder: '<0..1>',
      describe: 'Accept suggestions at or above this confidence',
      defaultDescription: String(DEFAULT_YES_ABOVE),
    },
    'dry-run': { type: 'boolean', describe: 'Validate and print the diff; write nothing' },
    'data-dir': { type: 'string', placeholder: '<path>', describe: 'Data directory' },
    'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN' },
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, applyLlmResponseCommand.flags, applyLlmResponseCommand.name);
    const runId = stringFlag(values.run);
    const file = stringFlag(values.file);
    if (runId === undefined || file === undefined) {
      throw new CliError('--run <runId> and --file <path> are both required.', {
        hint: 'See `adminium apply-llm-response --help`.',
      });
    }
    const chunkIndex = numberFlag(values.chunk, 'chunk', applyLlmResponseCommand.name);
    const yesAbove = numberFlag(values['yes-above'], 'yes-above', applyLlmResponseCommand.name) ?? DEFAULT_YES_ABOVE;
    if (yesAbove < 0 || yesAbove > 1) {
      throw new CliError(`--yes-above must be between 0 and 1 (got ${String(yesAbove)}).`);
    }
    const dryRun = values['dry-run'] === true;
    const dataDir = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);

    const env = loadCliEnv(deps.env, {
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(metaUrl === undefined ? {} : { metaUrl }),
    });

    const text = await readFile(resolve(deps.cwd, file), 'utf8').catch((cause: unknown) => {
      throw new CliError(`Could not read ${file}.`, { cause });
    });

    const runtime = await deps.openRuntime(env);
    try {
      const { runService, applyService } = runtime;
      const existing = await runService.getRun(runId);
      if (existing === null) throw new CliError(`Run ${runId} not found.`);

      // ── 1. Intake + validation ────────────────────────────────────────────
      // A run still awaiting a response takes the BYO path; one already carrying
      // a validated response (direct path, or an earlier apply attempt) skips
      // straight to the diff — re-pasting is not an error, just redundant.
      let run = existing;
      if (existing.status === 'awaiting_response') {
        const promptService = runtime.promptService;
        const allowed = runtime.allowed;
        if (promptService === null || allowed === null) {
          const cause = runtime.promptServiceError;
          if (cause instanceof CliError) throw cause;
          throw new CliError(cause?.message ?? 'The AI validator is unavailable.', { cause });
        }
        const { model } = await promptService.loadLatestModel(existing.connectionId);

        // `dryRun` reaches the SERVICE, not just the print below: intake is a
        // write (it commits the response and flips the run to `validated`,
        // after which no different response can ever be pasted). Deciding
        // afterwards was deciding too late — see `ReceiveResponseInput.dryRun`.
        const received = await runService.receiveResponse(runId, {
          text,
          ...(chunkIndex === undefined ? {} : { chunkIndex }),
          snapshot: model,
          allowedTemplates: allowed.templates,
          allowedWidgets: allowed.widgets,
          dryRun,
        });

        if (received.validation.response === undefined) {
          io.err('Validation failed — nothing was applied.');
          io.err('');
          io.err(
            renderTable(
              ['path', 'code', 'message'],
              received.validation.errors.map((error) => [
                error.path ?? '—',
                error.code,
                error.message,
              ]),
              [40, 24, 70],
            ),
          );
          return EXIT_VALIDATION_FAILED;
        }

        for (const warning of received.validation.warnings) {
          io.err(`warning: ${warning.path ?? '—'} — ${warning.message}`);
        }
        run = received.run;

        if (run.status !== 'validated') {
          // A chunked run still missing pieces: nothing to accept yet, which is
          // exactly what exit 3 means. Under --dry-run the chunk was validated
          // but NOT recorded, so say "would be" rather than "accepted".
          const progress = `${String(run.chunksReceived)}/${String(run.chunksTotal)}`;
          io.out(
            dryRun
              ? `--dry-run: chunk ${progress} validates — nothing was written.`
              : `Chunk ${progress} accepted — paste the remaining chunk(s) before applying.`,
          );
          return EXIT_NOTHING_ACCEPTED;
        }
      } else if (run.responseJson === null || run.responseJson === undefined) {
        throw new CliError(
          `Run ${runId} is ${run.status} and carries no validated response to apply.`,
        );
      }

      // ── 2. Diff ───────────────────────────────────────────────────────────
      const { diff } = await applyService.buildPlanForRun(run, []);
      const accepted = selectAcceptedByConfidence(diff, yesAbove);
      const acceptedSet = new Set(accepted);
      printDiffTable(io, diff, acceptedSet);
      io.out('');

      // ── 3. Apply (or not) ─────────────────────────────────────────────────
      if (accepted.length === 0) {
        io.out(`Nothing accepted at confidence ≥ ${String(yesAbove)} — nothing applied.`);
        io.out('Lower the bar with --yes-above, or review the run in Studio.');
        return EXIT_NOTHING_ACCEPTED;
      }

      if (dryRun) {
        io.out(
          `--dry-run: would apply ${String(accepted.length)} of ${String(diff.length)} suggestion(s) ` +
            `at confidence ≥ ${String(yesAbove)}. Nothing was written.`,
        );
        return EXIT_OK;
      }

      const result = await applyService.applyRun(runId, accepted);
      io.out(
        `Applied ${String(result.review.accepted.length)} suggestion(s): ` +
          `${String(result.counts.overrides)} override(s), ${String(result.counts.pages)} page(s).`,
      );
      if (result.partial) {
        io.out(`${String(result.review.rejected.length)} suggestion(s) below the bar were not applied.`);
      }
      return EXIT_OK;
    } finally {
      await runtime.close();
    }
  },
};

/** Re-exported for the test — the §10.4 contract is worth asserting by name. */
export const EXIT_CODES: Readonly<Record<'applied' | 'validationFailed' | 'nothingAccepted', ExitCode>> = {
  applied: EXIT_OK,
  validationFailed: EXIT_VALIDATION_FAILED,
  nothingAccepted: EXIT_NOTHING_ACCEPTED,
};
