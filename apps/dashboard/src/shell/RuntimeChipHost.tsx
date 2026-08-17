// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The topbar's runtime chip (11-electron.md §8.1) — the two feeds §8.1
 * sanctions, joined to `runtimeChipState()`'s precedence, rendered as
 * `@adminium/ui`'s `RuntimeChip`.
 *
 * §8.1, verbatim: "The chip is a `@adminium/ui` component fed by
 * `GET /api/v1/system/info` + a lightweight connection-health poll — no preload
 * involvement." Both halves matter. The preload prohibition is §4's rule about
 * where authority lives (the server gates features; the bridge only offers
 * native affordances), and it is also what lets this component render in a
 * browser tab, in the suite, and in the packaged app from the same code.
 *
 * NON-SUSPENDING, ON PURPOSE: `useQuery`, not `useSuspenseQuery`. The topbar is
 * chrome around whatever the user came here to do, and a chip is the least
 * important thing in it. Suspending would let a slow `/connections` hold up the
 * whole shell to decide whether to draw a badge; instead the chip is simply
 * absent until it has something true to say.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { RuntimeChip } from '@adminium/ui';

import { useCapabilities } from '../app/capabilities.js';
import { LAN_SHARE_PANEL_HASH } from '../desktop/lanShare.js';
import { t } from '../i18n/t.js';
import { connectionHealthQuery } from '../studio/api.js';
import { runtimeChipState, unreachableRemotes } from './runtimeChipState.js';

function chipLabel(state: NonNullable<ReturnType<typeof runtimeChipState>>): string {
  switch (state) {
    case 'local':
      return t('desktop.chip.local', 'Local');
    case 'lan-share':
      return t('desktop.chip.lanShare', 'Local · Sharing on LAN');
    case 'remote-db':
      return t('desktop.chip.remoteDb', 'Local + remote DB');
    case 'remote-db-offline':
      return t('desktop.chip.remoteDbOffline', 'Remote DB offline');
  }
}

export function RuntimeChipHost() {
  // `resolved` is not consulted: the unresolved runtime is `self-host`, which
  // draws no chip — the same thing a failed probe should do. Nothing here
  // asserts a fact on a default.
  const { flags } = useCapabilities();
  const runtime = flags.runtime;
  const navigate = useNavigate();

  // The health poll is desktop-only work: on self-host the chip is `null`
  // whatever it returns, so `enabled` keeps a browser tab from polling
  // `/connections` every 30 s to compute a badge it will never draw.
  const health = useQuery({ ...connectionHealthQuery(), enabled: runtime === 'desktop' });

  // `?? null`, NOT `?? []`. An empty list means "nothing but local data" and
  // draws `Local`; an absent one means we were not told — pending, or refused,
  // because `GET /api/v1/connections` needs the Admin-only
  // `system:connections:manage` and this topbar renders for every signed-in
  // user. `runtimeChipState` turns the unknown into no chip rather than a
  // confident `Local` over somebody's unreachable Postgres.
  const connections = health.data ?? null;

  const state = runtimeChipState({
    runtime,
    connections,
    // 11-T11. The signal is `GET /api/v1/system/info`'s `lanShare` — the
    // server's own bind address under the desktop runtime — which is the honest
    // one and the only one §8.1 allows: "no preload involvement". The bridge
    // could answer faster from `config.json`, and would be answering a different
    // question (what the user ASKED for, not what the socket DID).
    lanShare: flags.lanShare,
  });
  if (state === null) return null;

  const down = unreachableRemotes(connections);
  const description =
    state === 'remote-db-offline' && down.length > 0
      ? t('desktop.chip.remoteDbOfflineDetail', "Can't reach {names}. Pages for those connections show a reconnect state.", {
          names: down.map((connection) => connection.name).join(', '),
        })
      : undefined;

  // §8.1: `lan-share` is the one state with an action behind it — "click → LAN
  // panel (§8.3)". The other three describe the world and cannot change it, so
  // they stay non-interactive; `RuntimeChip` renders a `<span>` when no handler
  // is passed, which is the honest control for a thing that does nothing.
  const onClick =
    state === 'lan-share'
      ? () => {
          void navigate({ to: '/settings/desktop', hash: LAN_SHARE_PANEL_HASH });
        }
      : undefined;

  return (
    <RuntimeChip state={state} label={chipLabel(state)} description={description} onClick={onClick} />
  );
}
