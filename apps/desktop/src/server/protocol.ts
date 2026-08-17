// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The parent ↔ utilityProcess wire contract (11-electron.md §2.2 steps 5–9).
 *
 * Shared by BOTH ends of the fork — `src/server/index.ts` (the child, which
 * posts over `process.parentPort`) and `src/main/server-manager.ts` (the parent,
 * which listens on the `UtilityProcess` `message` event). It lives here, in one
 * module, so the two ends cannot drift: a handshake whose shape is declared
 * twice is a handshake that eventually disagrees with itself, and the failure
 * mode — a boot that hangs for 30 s and then shows a crash screen — is the most
 * expensive one this app has.
 *
 * PURE. No Electron, no `@adminium/server`, no `node:` builtins beyond nothing at
 * all: zod and types. Both bundles (main and server) import it, and the unit
 * suites import it without either runtime present.
 *
 * Messages crossing a process boundary are EXTERNAL INPUT — structured-clone
 * gives us `unknown`, not a typed union — so every inbound message is parsed
 * with zod rather than cast. `parseServerMessage` deliberately returns a result
 * object instead of throwing: a malformed message from a wedged child must
 * become an actionable timeout/error, never an exception inside an event
 * handler where nobody is waiting to catch it.
 */

import { z } from 'zod';

/**
 * Where a boot died. The crash page (§2.2 step 9) shows this verbatim next to
 * the log excerpt, because "which of the six boot steps failed" is the entire
 * difference between "your data dir is not writable" and "file a bug".
 */
export const SERVER_BOOT_STAGES = [
  'env',
  'meta-store',
  'migrate',
  'compose',
  'listen',
] as const;

export type ServerBootStage = (typeof SERVER_BOOT_STAGES)[number];

/**
 * §2.2 step 7, verbatim: `{ type: "ready", port, migrations: { applied } }`.
 *
 * `port` is the RESOLVED port. The child is asked to listen on 0 (§2.1 "listens
 * 127.0.0.1:0 (random free port)"), so the parent cannot know it up front — this
 * message is the only place the number exists, which is why the handshake is a
 * handshake and not a fire-and-forget spawn.
 */
export const serverReadyMessageSchema = z.object({
  type: z.literal('ready'),
  port: z.number().int().min(1).max(65535),
  host: z.string().min(1),
  migrations: z.object({
    applied: z.number().int().min(0),
    /**
     * The newest migration this SERVER BUILD ships — `0009_views_kind` — and the
     * only channel by which the main process can ever learn it (11-T12, §9).
     *
     * §9 makes the main process refuse "a backup whose `metaMigrationVersion` is
     * newer than the app", and §9's flow puts that check BEFORE the restore
     * stops the server and moves data aside. So main has to answer "how new am
     * I?" itself. It cannot look the answer up: `ALL_MIGRATIONS` lives in
     * `@adminium/meta`, which the shell may not import (§1 principle 2,
     * `.dependency-cruiser.cjs` `desktop-shell-only`), and importing
     * `@adminium/server` for the constant would drag the whole Fastify graph
     * into the main process to read one string. The child already knows, and it
     * is already sending a message. So it says.
     *
     * The BUILD's latest, not the STORE's high-water mark, and the difference is
     * the question being asked: a backup is restorable iff this app's migration
     * runner can carry its schema forward, which is a fact about the code, not
     * about whatever the store happens to be at. (After any boot they are equal
     * — `firstRun` fast-forwards — so this only diverges when something is
     * already wrong, which is exactly when the honest answer matters.)
     */
    version: z.string().min(1),
  }),
});

/** A boot that failed before `ready`. Turns a 30 s timeout into a real reason. */
export const serverErrorMessageSchema = z.object({
  type: z.literal('error'),
  stage: z.enum(SERVER_BOOT_STAGES),
  message: z.string(),
  /** Present when the failure carried one; rendered under the message. */
  detail: z.string().optional(),
});

/** Child → parent. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  serverReadyMessageSchema,
  serverErrorMessageSchema,
]);

export type ServerReadyMessage = z.infer<typeof serverReadyMessageSchema>;
export type ServerErrorMessage = z.infer<typeof serverErrorMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * Parent → child. `shutdown` is the graceful path: the child closes Fastify
 * (which runs the `onClose` hooks — pool disposal, and §9's
 * `wal_checkpoint(TRUNCATE)` when the meta store wires it) and exits 0. The
 * parent only reaches for `kill()` when this is ignored.
 */
export const parentMessageSchema = z.object({ type: z.literal('shutdown') });

export type ParentMessage = z.infer<typeof parentMessageSchema>;

export type ParseResult<T> =
  | { readonly ok: true; readonly message: T }
  | { readonly ok: false; readonly error: string };

/** Parse a child → parent message. Never throws (see the module header). */
export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  const result = serverMessageSchema.safeParse(raw);
  if (result.success) return { ok: true, message: result.data };
  return { ok: false, error: formatIssues(result.error) };
}

/** Parse a parent → child message. Never throws. */
export function parseParentMessage(raw: unknown): ParseResult<ParentMessage> {
  const result = parentMessageSchema.safeParse(raw);
  if (result.success) return { ok: true, message: result.data };
  return { ok: false, error: formatIssues(result.error) };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
