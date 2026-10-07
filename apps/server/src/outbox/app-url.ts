// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE AN ADD-ON'S MAIL LINKS INTO AN APP.
 *
 * An add-on has no guest side of its own: a mail about a gift card links to
 * the page of an app where the card is spent. Its outbox names such links
 * (`pages.app: { <name>: <route key> }`), and each is `{{app_url.<name>}}` in
 * its templates. The address is the first app's — in key order — that:
 *
 *  - is installed in the same database and names the add-on;
 *  - has the add-on attached and switched on for it;
 *  - declares that route on its customer side; and
 *  - has an address guests reach it by.
 *
 * None: the variable is empty — a button with no address is left out, and a
 * text block is steered by `onlyWith` / `onlyWithout`. Never a link into an
 * app that does not serve the page.
 */
import { namedAddOns, type Manifest } from '@adminium/manifest';
import { manifestsRepo, type MetaDb } from '@adminium/meta';

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading what is installed never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading what is installed never reads a credential');
  },
};

/** `app_url.<name>` for every link an add-on's outbox declares: an address, or empty. */
export async function appUrlsFor(
  deps: { meta: MetaDb; guestBase: (appKey: string) => Promise<string | null> },
  input: { connectionId: string; addOnKey: string; links: Readonly<Record<string, string>> | undefined },
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const names = Object.entries(input.links ?? {});
  if (names.length === 0) return out;
  for (const [name] of names) out[`app_url.${name}`] = '';

  const manifests = manifestsRepo(deps.meta, NO_SECRETS);
  const addOn = await manifests.findByKey(input.addOnKey);
  if (addOn === null || addOn.row.kind !== 'add-on' || addOn.row.status !== 'installed') return out;
  // The apps it is attached to and switched on for.
  const on = new Set(addOn.attachments.filter((attachment) => attachment.disabledAt === null).map((attachment) => attachment.attachedTo));
  const apps = (await manifests.list('app'))
    .filter((app) => app.row.connectionId === input.connectionId && app.row.status === 'installed' && on.has(app.row.manifestKey))
    .sort((a, b) => (a.row.manifestKey < b.row.manifestKey ? -1 : a.row.manifestKey > b.row.manifestKey ? 1 : 0));
  for (const app of apps) {
    const manifest = app.document as Manifest | null;
    if (manifest === null || manifest.kind !== 'app' || !namedAddOns(manifest.addOns).some((need) => need.key === input.addOnKey)) continue;
    const customer = (manifest.frontends ?? []).find((frontend) => frontend.side === 'customer');
    const routes = (customer?.routes ?? {}) as Record<string, unknown>;
    let base: string | null | undefined;
    for (const [name, routeKey] of names) {
      if (out[`app_url.${name}`] !== '') continue;
      const route = routes[routeKey];
      if (typeof route !== 'string' || !route.startsWith('/')) continue;
      base ??= await deps.guestBase(app.row.manifestKey);
      if (base === null) break;
      out[`app_url.${name}`] = `${base}${route}`;
    }
  }
  return out;
}
