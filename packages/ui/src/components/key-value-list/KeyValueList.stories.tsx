// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from '../badge/Badge.js';
import { KeyValueList, KeyValueRow } from './KeyValueList.js';

const meta = {
  title: 'Tier3/KeyValueList',
  component: KeyValueList,
} satisfies Meta<typeof KeyValueList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="w-[380px]">
      <KeyValueList
        items={[
          { label: 'Plan', value: 'Pro — annual' },
          { label: 'Database', value: 'postgres://prod-eu-1', mono: true },
          { label: 'Tables', value: '24', mono: true },
          { label: 'Region', value: 'eu-west-1', mono: true },
          { label: 'Next invoice', value: '$49.00 · Aug 1', mono: true },
        ]}
      />
    </div>
  ),
};

export const Composed: Story = {
  render: () => (
    <div className="w-[380px]">
      <KeyValueList>
        <KeyValueRow label="Status">
          <Badge tone="pos" dot>
            Active
          </Badge>
        </KeyValueRow>
        <KeyValueRow label="Workspace id" mono>
          ws_9f3k2m
        </KeyValueRow>
      </KeyValueList>
    </div>
  ),
};
