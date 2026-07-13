import type { Meta, StoryObj } from '@storybook/react-vite';

import { Textarea } from './Textarea.js';

const meta = {
  title: 'Tier2/Textarea',
  component: Textarea,
  args: { placeholder: 'Describe the incident…', error: false, disabled: false, autoResize: false },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[320px] flex-col gap-3">
      <Textarea placeholder="Leave a note for the next reviewer" />
      <Textarea defaultValue={'Rotate the webhook secret.\nThen re-run the failed deliveries.'} />
      <Textarea mono defaultValue={'{\n  "retries": 3\n}'} />
      <Textarea autoResize defaultValue="Grows with content." className="max-h-40" />
      <Textarea error defaultValue="Too short" />
      <Textarea disabled defaultValue="Locked" />
    </div>
  ),
};
