import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, FolderKanban } from 'lucide-react';
import { useState } from 'react';

import { ToggleMatrix } from './ToggleMatrix.js';

const meta = {
  title: 'Tier4/ToggleMatrix',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const columns = [
  { id: 'email', label: 'Email' },
  { id: 'push', label: 'Push' },
  { id: 'slack', label: 'Slack' },
  { id: 'digest', label: 'Digest', locked: true },
] as const;

const groups = [
  {
    id: 'projects',
    label: 'Projects',
    icon: <FolderKanban />,
    rows: [
      { id: 'proj_assigned', label: 'Assigned to me' },
      { id: 'proj_status', label: 'Status changes' },
      { id: 'proj_comments', label: 'New comments' },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: <Bell />,
    rows: [
      { id: 'alert_failures', label: 'Job failures' },
      { id: 'alert_security', label: 'Security events' },
    ],
  },
] as const;

const initial = new Set([
  'proj_assigned email',
  'proj_assigned push',
  'proj_status email',
  'alert_failures email',
  'alert_security email',
  'alert_security push',
  'alert_security slack',
]);

function Demo({ disabled = false }: { disabled?: boolean }) {
  const [on, setOn] = useState<ReadonlySet<string>>(initial);
  return (
    <div className="max-w-[640px]">
      <ToggleMatrix
        label="Notification channels"
        rowHeader="Event"
        columns={columns}
        groups={groups}
        disabled={disabled}
        getCellState={(rowId, columnId) => (on.has(`${rowId} ${columnId}`) ? 'on' : 'off')}
        isDirty={(rowId, columnId) =>
          on.has(`${rowId} ${columnId}`) !== initial.has(`${rowId} ${columnId}`)
        }
        onToggle={(rowId, columnId, next) => {
          setOn((current) => {
            const nextSet = new Set(current);
            if (next) nextSet.add(`${rowId} ${columnId}`);
            else nextSet.delete(`${rowId} ${columnId}`);
            return nextSet;
          });
        }}
      />
    </div>
  );
}

export const Playground: Story = { render: () => <Demo /> };

export const Disabled: Story = { tags: ['vrt'], render: () => <Demo disabled /> };

export const States: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="max-w-[640px]">
      <ToggleMatrix
        label="Notification channels"
        rowHeader="Event"
        columns={columns}
        groups={groups}
        getCellState={(rowId, columnId) => (initial.has(`${rowId} ${columnId}`) ? 'on' : 'off')}
        isDirty={(rowId, columnId) => rowId === 'proj_status' && columnId === 'push'}
      />
    </div>
  ),
};
