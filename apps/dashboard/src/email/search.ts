// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/email-templates` search contract, in a leaf module: the router reads
 * it eagerly (a `validateSearch` runs before the page loads), and the page is
 * lazy — importing the page for it would pull the whole manager into the
 * entry chunk (39-email-templates-and-campaigns.md D16).
 */
export interface EmailTemplatesSearch {
  /** Which tray opens — the campaign-sent notice links here with `campaign`. */
  kind?: 'template' | 'campaign' | undefined;
  /** Archived mode (D4). */
  archived?: boolean | undefined;
  /** A document id to open straight in the editor. */
  open?: string | undefined;
}

/** Unknown values fall away rather than fail the route. */
export function validateEmailTemplatesSearch(search: Record<string, unknown>): EmailTemplatesSearch {
  return {
    ...(search['kind'] === 'campaign' || search['kind'] === 'template' ? { kind: search['kind'] } : {}),
    ...(search['archived'] === true || search['archived'] === 'true' ? { archived: true } : {}),
    ...(typeof search['open'] === 'string' && search['open'] !== '' ? { open: search['open'] } : {}),
  };
}
