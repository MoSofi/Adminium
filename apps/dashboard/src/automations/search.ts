// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/automations` and `/workflow-logs` search contracts, in a leaf module:
 * the router reads them eagerly (a `validateSearch` runs before the page
 * loads) and both pages are lazy — importing a page for its contract would
 * pull the flow builder into the entry chunk (42 §3.6; the invoice surface's
 * `search.ts`).
 *
 * Both selections live in the URL for the same reason: a rule and a run are
 * things one operator sends another a link to.
 */

export interface AutomationsSearch {
  /** Which rule the flow builder is showing. */
  rule?: string | undefined;
}

export interface WorkflowLogsSearch {
  /** Which run's trace the detail is showing. */
  run?: string | undefined;
  /** The comp's three filters; anything else falls back to All. */
  status?: 'success' | 'failed' | 'running' | undefined;
}

/** Unknown values fall away rather than fail the route. */
export function validateAutomationsSearch(search: Record<string, unknown>): AutomationsSearch {
  return { ...(typeof search['rule'] === 'string' ? { rule: search['rule'] } : {}) };
}

export function validateWorkflowLogsSearch(search: Record<string, unknown>): WorkflowLogsSearch {
  const status = search['status'];
  return {
    ...(typeof search['run'] === 'string' ? { run: search['run'] } : {}),
    ...(status === 'success' || status === 'failed' || status === 'running' ? { status } : {}),
  };
}
