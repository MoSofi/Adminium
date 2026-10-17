// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/automations` and `/workflow-logs` search contracts, in a leaf module:
 * the router reads them eagerly (a `validateSearch` runs before the page
 * loads) and both pages are lazy — importing a page for its contract would
 * pull the flow builder into the entry chunk (the invoice surface's
 * `search.ts`).
 *
 * Both selections live in the URL for the same reason: a rule and a run are
 * things one operator sends another a link to.
 */

export interface AutomationsSearch {
  /** Which rule the flow builder is showing. */
  rule?: string | undefined;
  /** Only the rules one installed app brought (its key): an entry of the app's section opens the screen so. */
  app?: string | undefined;
}

/** An installed app's key, as an address may carry it; anything else is no filter. */
export function appKeyOf(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(value) ? value : undefined;
}

export interface WorkflowLogsSearch {
  /** Which run's trace the detail is showing. */
  run?: string | undefined;
  /** The comp's three filters; anything else falls back to All. */
  status?: 'success' | 'failed' | 'running' | undefined;
}

/** Unknown values fall away rather than fail the route. */
export function validateAutomationsSearch(search: Record<string, unknown>): AutomationsSearch {
  const app = appKeyOf(search['app']);
  return { ...(typeof search['rule'] === 'string' ? { rule: search['rule'] } : {}), ...(app === undefined ? {} : { app }) };
}

export function validateWorkflowLogsSearch(search: Record<string, unknown>): WorkflowLogsSearch {
  const status = search['status'];
  return {
    ...(typeof search['run'] === 'string' ? { run: search['run'] } : {}),
    ...(status === 'success' || status === 'failed' || status === 'running' ? { status } : {}),
  };
}
