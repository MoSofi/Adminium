// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → Maps (`/settings/maps`): two switches, and plain sentences saying
 * which server sees what.
 *
 * - **Show maps.** A map makes each staff BROWSER fetch map pictures from the
 *   map server. That server's address is the operator's (`ADMINIUM_MAP_SERVER`),
 *   shown here and never typed here: it is written into the page's security
 *   policy, and a box a settings admin could type into would be a way to let
 *   every staff browser talk to any server.
 * - **Routes along roads.** This SERVER asks the routing server, with a
 *   route's stops in order, and only while the switch is on.
 *
 * AFTER A CHANGE. Switching maps OFF is followed at once: the session is read
 * again and every open map gives its place to its list. Switching them ON
 * cannot be: the security policy this page was loaded under names no map
 * server, so a map drawn now would be refused by the browser. The page says
 * so and offers the reload; the session is left as it was until then, so no
 * map tries and fails in between. That holds for EVERY save made while the
 * reload is owed, the routes switch included: reading the session again then
 * would hand open maps the map server's address under a policy that still
 * refuses it, and each would say "the map could not be reached". Whether a
 * reload is owed is also read off the session itself (it names no map server
 * while the setting says maps are on), so it is still known after this page
 * was left and opened again.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPinned, Route } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert, Button, Card, IconTile, Switch } from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { MAPS_SETTINGS_QUERY_KEY, mapsSettingsQuery, mapsShown, putMapsSettings, type MapsSettings } from './mapsApi.js';

/** `https://tiles.example.com` → `tiles.example.com`: the part a person recognises. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function SwitchRow({
  icon,
  heading,
  body,
  checked,
  disabled,
  why,
  onChange,
  part,
}: {
  icon: ReactNode;
  heading: string;
  body: ReactNode;
  checked: boolean;
  disabled: boolean;
  /** Why the switch cannot be moved, when it cannot. */
  why?: string | undefined;
  onChange: (checked: boolean) => void;
  part: string;
}): ReactNode {
  return (
    <div data-part={part} className="flex flex-wrap items-start gap-3 px-[var(--card-pad)] py-[calc(var(--card-pad)*0.8)]">
      <IconTile tone="accent" size="md" icon={icon} />
      <div className="min-w-0 flex-1 basis-56">
        <h3 className="text-section text-fg">{heading}</h3>
        <div className="mt-1 flex flex-col gap-1.5 text-body-sm text-fg-muted">{body}</div>
        {why === undefined ? null : (
          <p data-part={`${part}-why`} className="mt-2 text-caption font-medium text-fg">
            {why}
          </p>
        )}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={heading} />
    </div>
  );
}

export function MapsSettingsPage(): ReactNode {
  const queryClient = useQueryClient();
  const query = useQuery(mapsSettingsQuery());
  const [saving, setSaving] = useState(false);
  // Maps were switched on in this sitting: the page has to be loaded again before one can be drawn.
  const [needsReload, setNeedsReload] = useState(false);
  const [failed, setFailed] = useState(false);
  const session = useQuery({ ...bootstrapQuery(), enabled: false }).data;
  /** The session this page was loaded with names no map server, and maps are on now: it is out of date until a reload. */
  const sessionBehind = (settings: MapsSettings, held: typeof session): boolean =>
    mapsShown(settings) && settings.mapServer !== null && held?.maps !== undefined && held.maps.server === null;

  const save = async (change: { enabled?: boolean; routing?: boolean }, before: MapsSettings): Promise<void> => {
    setSaving(true);
    setFailed(false);
    try {
      const after = await putMapsSettings(change);
      queryClient.setQueryData(MAPS_SETTINGS_QUERY_KEY, after);
      const was = mapsShown(before);
      const now = mapsShown(after);
      if (now && !was) {
        setNeedsReload(true);
      } else if (!now) {
        setNeedsReload(false);
        // Off: every open page follows at once.
        await queryClient.invalidateQueries({ queryKey: bootstrapQuery().queryKey });
      } else if (!needsReload && !sessionBehind(after, queryClient.getQueryData(bootstrapQuery().queryKey))) {
        // Only the routes changed, and no reload is owed: every open page follows at once.
        await queryClient.invalidateQueries({ queryKey: bootstrapQuery().queryKey });
      }
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const title = <PageActions title={t('studio:settingsMaps.title', 'Maps')} subtitle={t('studio:settingsMaps.subtitle', 'Whether maps are shown, and which servers are asked.')} />;

  if (query.data === undefined) {
    return (
      <PageSurface width="page" className="flex flex-col gap-4">
        {title}
        {query.isError ? <Alert tone="danger" title={t('studio:settingsMaps.loadFailed', 'These settings could not be read. Reload the page.')} /> : null}
      </PageSurface>
    );
  }

  const settings = query.data;
  const desktop = settings.runtime === 'desktop';
  const mapsWhy = desktop
    ? t('studio:settingsMaps.maps.whyDesktop', 'The desktop app works without the internet and shows no outside map. A list is shown where a map would be.')
    : settings.mapServerOff
      ? t('studio:settingsMaps.maps.whyEnvOff', 'Whoever runs this server switched maps off for it (ADMINIUM_MAP_SERVER=off), so this switch does nothing.')
      : undefined;
  const routesWhy = settings.routingServerOff
    ? t(
        'studio:settingsMaps.routes.whyEnvOff',
        'Whoever runs this server switched the routing server off (ADMINIUM_ROUTING_SERVER=off, or all outside calls with ADMINIUM_NETWORK_FEATURES=off), so this switch does nothing.',
      )
    : undefined;

  return (
    <PageSurface width="page" className="flex flex-col gap-4">
      {title}

      {needsReload || sessionBehind(settings, session) ? (
        <Alert
          tone="info"
          role="status"
          data-part="maps-reload"
          title={t('studio:settingsMaps.reload.title', 'Maps are on. Reload to see them.')}
          body={t('studio:settingsMaps.reload.body', 'A page that was open while maps were off may not ask the map server. Reload it, here and in other open tabs.')}
          action={
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              {t('studio:settingsMaps.reload.cta', 'Reload this page')}
            </Button>
          }
        />
      ) : null}

      {failed ? <Alert tone="danger" role="alert" title={t('studio:settingsMaps.saveFailed', 'This could not be saved. Try again.')} /> : null}

      <Card padded={false} className="divide-y divide-border">
        <SwitchRow
          part="maps-switch"
          icon={<MapPinned />}
          heading={t('studio:settingsMaps.maps.heading', 'Show maps')}
          checked={mapsShown(settings)}
          disabled={saving || desktop || settings.mapServerOff}
          why={mapsWhy}
          onChange={(enabled) => void save({ enabled }, settings)}
          body={
            <>
              <p>
                {t(
                  'studio:settingsMaps.maps.sees',
                  'A map is drawn from pictures of the part of the world on screen. Each staff member’s browser fetches them from the map server, which learns that person’s internet address and the area they looked at. It is never sent a record, a name or where your pins are.',
                )}
              </p>
              <p data-part="maps-server">
                {settings.mapServer === null
                  ? t('studio:settingsMaps.maps.serverNone', 'Map server: none.')
                  : t('studio:settingsMaps.maps.server', 'Map server: {host}. Set by whoever runs this server, with ADMINIUM_MAP_SERVER. It cannot be changed here.', {
                      host: hostOf(settings.mapServer),
                    })}
              </p>
              <p>{t('studio:settingsMaps.maps.off', 'With maps off, a list of the same places is shown where a map would be, and no outside server is asked.')}</p>
            </>
          }
        />
        <SwitchRow
          part="routes-switch"
          icon={<Route />}
          heading={t('studio:settingsMaps.routes.heading', 'Routes along roads')}
          checked={settings.routing && !settings.routingServerOff}
          disabled={saving || settings.routingServerOff}
          why={routesWhy}
          onChange={(routing) => void save({ routing }, settings)}
          body={
            <>
              <p>
                {t(
                  'studio:settingsMaps.routes.sees',
                  'While this is on, this server asks the routing server for the way between a route’s stops, and sends it the stops’ positions in order. It learns this server’s address, never a staff member’s, a name or a record.',
                )}
              </p>
              <p data-part="routes-server">
                {settings.routingServer === null
                  ? t('studio:settingsMaps.routes.serverNone', 'Routing server: none.')
                  : t('studio:settingsMaps.routes.server', 'Routing server: {host}. Set by whoever runs this server, with ADMINIUM_ROUTING_SERVER.', { host: hostOf(settings.routingServer) })}
              </p>
              <p>{t('studio:settingsMaps.routes.off', 'With this off, distances are straight lines worked out on this server and marked “about”. Nothing is asked outside.')}</p>
            </>
          }
        />
      </Card>
    </PageSurface>
  );
}
