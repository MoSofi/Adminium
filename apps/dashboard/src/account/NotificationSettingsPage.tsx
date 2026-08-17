/**
 * `/account/notifications` — the ACCOUNT-group Notification Settings surface
 * (research/ia-mapping.md §2A; comp: Notification Settings.dc.html).
 *
 * 09 §2.2 wants the Engine to seed a `page-settings` utility page for this so
 * nav/permissions ride `adminium_pages` like every other page. The Engine does
 * not seed utility pages yet (the same gap that makes `/imports`/`/exports`
 * direct routes — see data-io/routes.tsx), so this static route mounts the
 * SAME binding the seeded page will use, on a synthetic envelope. The binding
 * reads only `config` (reserved chrome, ignored today) and `title`; all real
 * state lives in `/me/notification-prefs`. When Engine seeding lands, this
 * route can retire in favour of the seeded `/p/notification-settings`.
 */
import type { PageEnvelope } from '@adminium/engine/config';

import { PageSettingsBinding } from '../pages/PageSettingsBinding.js';
import type { PageTemplateAdapters } from '../pages/templates.js';
import { PageSurface } from '../shell/PageSurface.js';

const envelope: PageEnvelope = {
  v: 1,
  kind: 'page',
  id: 'page_notification-settings',
  template: 'page-settings',
  title: { key: 'nav.notificationSettings', fallback: 'Notification settings' },
  source: { connectionId: null, table: null },
  nav: { group: 'account', icon: 'bell', order: 0, slug: 'notification-settings' },
  access: { minRole: 'viewer', permissions: [] },
  config: {},
};

/** Source-less page: no CRUD, no widget-data batch, nothing to navigate to. */
const adapters: PageTemplateAdapters = {
  crud: null,
  dashboard: null,
  onEvent: () => undefined,
  openRecord: () => undefined,
  notifyUndoable: () => undefined,
};

export function NotificationSettingsPage() {
  // Mounts the `page-settings` template directly rather than through
  // PageRenderer, so it has to supply the surface PageRenderer would have —
  // the same one `surfaceDefaults` gives that template. Without it this route
  // was the one settings screen with no gutter at all.
  return (
    <PageSurface>
      <PageSettingsBinding page={envelope} adapters={adapters} />
    </PageSurface>
  );
}
