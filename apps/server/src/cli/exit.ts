/**
 * CLI exit codes. The `apply-llm-response` triple is a published contract
 * (06-llm-assist.md §10.4: "Exit codes: `0` applied, `2` validation failed,
 * `3` nothing accepted") — scripts and CI pipelines branch on it, so these
 * numbers are as much an API as any route's status code. They live in one
 * module so a command cannot invent a fourth meaning for `2`.
 */
export const EXIT_OK = 0;

/** Anything that went wrong that is not one of the §10.4 outcomes: usage
 *  errors, unreachable databases, missing files, bad configuration. */
export const EXIT_ERROR = 1;

/** §10.4: the LLM response failed validation (fatal or per-path). */
export const EXIT_VALIDATION_FAILED = 2;

/** §10.4: the response validated but nothing was accepted, so nothing applied. */
export const EXIT_NOTHING_ACCEPTED = 3;

export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_ERROR
  | typeof EXIT_VALIDATION_FAILED
  | typeof EXIT_NOTHING_ACCEPTED;

/**
 * An error carrying the exit code the CLI should die with. The dispatcher
 * prints `message` (plus `hint`, when present) and returns `code` — commands
 * throw this instead of calling `process.exit`, so every path is testable.
 */
export class CliError extends Error {
  override readonly name = 'CliError';
  readonly code: ExitCode;
  readonly hint: string | null;

  constructor(message: string, opts: { code?: ExitCode; hint?: string; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.code = opts.code ?? EXIT_ERROR;
    this.hint = opts.hint ?? null;
  }
}

/** A usage/parse problem — the dispatcher appends the command's help. */
export class CliUsageError extends CliError {
  readonly command: string | null;
  constructor(message: string, command: string | null = null) {
    super(message, { code: EXIT_ERROR });
    this.command = command;
  }
}
