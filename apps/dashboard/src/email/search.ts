// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/email-templates` search contract, in a leaf module: the router reads
 * it eagerly (a `validateSearch` runs before the page loads), and the page is
 * lazy — importing the page for it would pull the whole manager into the
 * entry chunk.
 */
export interface EmailTemplatesSearch {
  /** Which tray opens — the campaign-sent notice links here with `campaign`. */
  kind?: 'template' | 'campaign' | undefined;
  /** Archived mode (D4). */
  archived?: boolean | undefined;
  /** A document id to open straight in the editor. */
  open?: string | undefined;
  /** Only the documents one installed app brought (its key): an entry of the app's section opens the screen so. */
  app?: string | undefined;
  /**
   * With `kind=campaign`: "New campaign" opens at once, and the campaign it
   * makes starts with a text block holding this address (a form's "Send by
   * e-mail"). An `https://` address only, at most 2048 characters.
   */
  link?: string | undefined;
}

/** The longest address a campaign is started with. */
export const CAMPAIGN_LINK_MAX = 2048;

/** An `https://` address a campaign may start with, as typed; null for anything else. */
export function campaignLinkOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > CAMPAIGN_LINK_MAX || !value.startsWith('https://')) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Unknown values fall away rather than fail the route. */
export function validateEmailTemplatesSearch(search: Record<string, unknown>): EmailTemplatesSearch {
  return {
    ...(search['kind'] === 'campaign' || search['kind'] === 'template' ? { kind: search['kind'] } : {}),
    ...(search['archived'] === true || search['archived'] === 'true' ? { archived: true } : {}),
    ...(typeof search['open'] === 'string' && search['open'] !== '' ? { open: search['open'] } : {}),
    ...(typeof search['app'] === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(search['app']) ? { app: search['app'] } : {}),
    ...(campaignLinkOf(search['link']) === null ? {} : { link: search['link'] as string }),
  };
}
