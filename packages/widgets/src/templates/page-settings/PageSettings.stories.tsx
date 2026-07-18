/**
 * `page-settings` template stories (M7 reports/notifications track): the
 * Notification-Settings comp states — the live matrix with an unavailable
 * email channel (explained, never hidden), the autosave choreography
 * (saving → saved with a pending dirty cell), a failed save, and
 * loading/error/empty shells.
 */
import { useState } from 'react';

import {
  PageSettings,
  settingsCellId,
  type SettingsChannelDef,
  type SettingsEventDef,
  type SettingsSaveState,
} from './PageSettings.js';

const meta = {
  title: 'Templates/PageSettings',
};
export default meta;

const CHANNELS: SettingsChannelDef[] = [
  { id: 'inApp', label: 'In-app', available: true },
  {
    id: 'email',
    label: 'Email',
    available: false,
    reason:
      'No email transport (SMTP) is configured in this build — preferences are saved and take effect when email delivery arrives in a later release.',
  },
  {
    id: 'push',
    label: 'Push',
    available: false,
    reason: 'Push delivery arrives in a later release — preferences are saved until then.',
  },
];

const EVENTS: SettingsEventDef[] = [
  {
    key: 'report.ready',
    label: 'Scheduled report ready',
    channels: { inApp: true, email: true, push: false },
  },
  {
    key: 'report.failed',
    label: 'Scheduled report failed',
    channels: { inApp: true, email: true, push: false },
  },
  {
    key: 'desktop.backup.completed',
    label: 'Backup completed',
    channels: { inApp: true, email: false, push: false },
  },
];

/** The comp state: matrix live, email column explained below. */
export const Matrix = {
  render: () => (
    <div className="h-[480px]">
      <PageSettings channels={CHANNELS} events={EVENTS} onToggle={() => undefined} />
    </div>
  ),
};

/** Interactive autosave cycle: toggle → saving + dirty dot → saved. */
export const AutosaveCycle = {
  render: () => {
    function Demo() {
      const [events, setEvents] = useState(EVENTS);
      const [saveState, setSaveState] = useState<SettingsSaveState>({ state: 'idle' });
      const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
      return (
        <PageSettings
          channels={CHANNELS}
          events={events}
          saveState={saveState}
          pendingCells={pending}
          onToggle={(key, channel, next) => {
            setEvents((prev) =>
              prev.map((event) =>
                event.key === key
                  ? { ...event, channels: { ...event.channels, [channel]: next } }
                  : event,
              ),
            );
            setPending(new Set([settingsCellId(key, channel)]));
            setSaveState({ state: 'saving' });
            setTimeout(() => {
              setPending(new Set());
              setSaveState({ state: 'saved' });
            }, 900);
          }}
        />
      );
    }
    return (
      <div className="h-[480px]">
        <Demo />
      </div>
    );
  },
};

/** A PUT failed: indicator explains, the cell snapped back (controlled). */
export const SaveFailed = {
  render: () => (
    <div className="h-[480px]">
      <PageSettings
        channels={CHANNELS}
        events={EVENTS}
        saveState={{ state: 'error', message: 'Could not save — check your connection.' }}
        onToggle={() => undefined}
      />
    </div>
  ),
};

/** Loading / error / empty shells. */
export const Loading = {
  render: () => (
    <div className="h-[320px]">
      <PageSettings channels={[]} events={[]} status="loading" />
    </div>
  ),
};

export const LoadError = {
  render: () => (
    <div className="h-[320px]">
      <PageSettings
        channels={[]}
        events={[]}
        status="error"
        errorMessage="The server said no."
        onRetry={() => undefined}
      />
    </div>
  ),
};

export const Empty = {
  render: () => (
    <div className="h-[320px]">
      <PageSettings channels={CHANNELS} events={[]} />
    </div>
  ),
};
