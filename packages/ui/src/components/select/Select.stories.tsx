import type { Meta, StoryObj } from '@storybook/react-vite';

import { Select } from './Select.js';

const meta = {
  title: 'Tier2/Select',
  component: Select,
  args: {
    error: false,
    disabled: false,
    mono: false,
    // real usage wires the name via FormField/htmlFor; standalone needs one
    'aria-label': 'Role',
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const roles = (
  <>
    <option value="owner">Owner</option>
    <option value="admin">Admin</option>
    <option value="editor">Editor</option>
    <option value="viewer">Viewer</option>
  </>
);

export const Playground: Story = {
  render: (args) => <Select {...args}>{roles}</Select>,
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[260px] flex-col gap-3">
      <Select defaultValue="admin" aria-label="Role">{roles}</Select>
      <Select mono defaultValue="utf8mb4" aria-label="Charset">
        <option value="utf8mb4">utf8mb4</option>
        <option value="latin1">latin1</option>
      </Select>
      <Select error defaultValue="viewer" aria-label="Role">{roles}</Select>
      <Select disabled defaultValue="owner" aria-label="Role">{roles}</Select>
      <Select defaultValue="editor" aria-label="Role">
        <optgroup label="Workspace">{roles}</optgroup>
      </Select>
    </div>
  ),
};
