// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Telling a paused source apart from a broken one, in the templates.
 *
 * Every data template renders the same panel when its load rejects: a danger
 * EmptyState titled "…failed to load" with a Retry button. That is the right
 * shape for a query that broke and the wrong one for a connection an operator
 * PAUSED on purpose (meta wave 0019) — nothing failed, nothing is lost, and
 * Retry is a control that cannot work until a person resumes it, which is the
 * dead-CTA bug the system-state map spent an audit removing.
 *
 * ─── Why the code is read structurally ─────────────────────────────────────
 *
 * `@adminium/widgets` has no dependency on the dashboard, so it cannot import
 * `ApiError` — and it should not: the templates take their data through the
 * `CrudApi`-shaped ports, whose rejections are already read duck-typed
 * (`reason instanceof Error ? reason.message : …`). Reading one more property
 * off the same object is consistent with how errors already cross this
 * boundary, and a host that throws something else simply gets the ordinary
 * failure panel — the degradation is to today's behaviour, not to a crash.
 */

/** The canonical server code for "an operator paused this connection". */
export const CONNECTION_PAUSED_CODE = 'CONNECTION_DISABLED';

/** Does this rejection mean the source is paused rather than broken? */
export function isConnectionPaused(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as { code?: unknown }).code === CONNECTION_PAUSED_CODE
  );
}

/** What a template should put in its error EmptyState. */
export interface DataErrorPanel {
  tone: 'danger' | 'accent';
  /** Localized headline. */
  title: string;
  /** The server's explanation, when there is one. */
  body: string | undefined;
  /**
   * Whether to offer Retry. False for a pause: the answer cannot change until
   * a human resumes the connection, and a button that reliably does nothing
   * teaches people to stop trusting the ones that work.
   */
  retryable: boolean;
}

/**
 * Classify a template's load failure.
 *
 * `failedTitle` is the template's own "…failed to load" copy — each one names
 * its subject ("This directory", "This queue"), which is worth keeping. The
 * paused title does not vary by template, because the fact does not: the whole
 * connection is off, not this one screen.
 */
export function describeDataError(
  reason: unknown,
  failedTitle: string,
  pausedTitle: string,
): DataErrorPanel {
  const body = reason instanceof Error ? reason.message : undefined;
  if (isConnectionPaused(reason)) {
    // `accent`, not `danger`: this is a state somebody chose, and painting it
    // red reports an incident that is not happening.
    return { tone: 'accent', title: pausedTitle, body, retryable: false };
  }
  return { tone: 'danger', title: failedTitle, body, retryable: true };
}
