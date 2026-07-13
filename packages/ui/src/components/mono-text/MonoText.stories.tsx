import type { Meta, StoryObj } from '@storybook/react-vite';

import { MonoText } from './MonoText.js';

const meta = {
  title: 'Tier1/MonoText',
  component: MonoText,
  args: { children: '$12,480.00' },
} satisfies Meta<typeof MonoText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-2 text-fg">
      <MonoText className="text-[26px] font-bold tracking-[-0.02em]">$48,290</MonoText>
      <MonoText>2026-07-12T09:00:00Z</MonoText>
      <MonoText className="text-fg-muted">req_9f2c81d7</MonoText>
      <p className="text-body">
        Rows scanned: <MonoText>1,204,391</MonoText> in <MonoText>312ms</MonoText>
      </p>
      <MonoText asChild>
        <code>postgres://readonly@db.internal:5432/app</code>
      </MonoText>
    </div>
  ),
};
