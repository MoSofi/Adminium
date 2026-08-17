// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tag } from './Tag.js';

const TONES = ['neutral', 'accent', 'pos', 'warn', 'danger', 'info'] as const;

const meta = {
  title: 'Tier1/Tag',
  component: Tag,
  args: { children: 'varchar', tone: 'neutral', mono: false },
  argTypes: {
    tone: { control: 'select', options: TONES },
    mono: { control: 'boolean' },
  },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {TONES.map((tone) => (
          <Tag key={tone} tone={tone}>
            {tone}
          </Tag>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag mono>varchar</Tag>
        <Tag mono>int8</Tag>
        <Tag mono tone="accent">
          PK
        </Tag>
        <Tag mono tone="info">
          FK
        </Tag>
        <Tag mono tone="warn">
          PII
        </Tag>
        <Tag mono tone="pos">
          GET
        </Tag>
        <Tag mono tone="danger">
          DELETE
        </Tag>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag onRemove={() => {}} removeLabel="Remove ops@example.com">
          ops@example.com
        </Tag>
        <Tag tone="accent" onRemove={() => {}} removeLabel="Remove filter">
          status = paid
        </Tag>
      </div>
    </div>
  ),
};
