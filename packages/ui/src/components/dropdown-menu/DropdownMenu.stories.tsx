import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, Download, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/index.js';
import { Kbd } from '../kbd/index.js';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu.js';

const meta = {
  title: 'Tier3/DropdownMenu',
  component: DropdownMenuContent,
} satisfies Meta<typeof DropdownMenuContent>;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo() {
  const [showArchived, setShowArchived] = useState(true);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">Row actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Record</DropdownMenuLabel>
        <DropdownMenuItem icon={<Pencil />} trailing={<Kbd>E</Kbd>}>
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Copy />}>Duplicate</DropdownMenuItem>
        <DropdownMenuItem icon={<Download />} disabled>
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>View</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={showArchived} onCheckedChange={setShowArchived}>
          Show archived
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive icon={<Trash2 />}>
          Delete record
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const Playground: Story = {
  render: () => <Demo />,
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="h-[360px]">
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">Open menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Record</DropdownMenuLabel>
          <DropdownMenuItem icon={<Pencil />} trailing={<Kbd>E</Kbd>}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Copy />}>Duplicate</DropdownMenuItem>
          <DropdownMenuItem icon={<Download />} disabled>
            Export CSV
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked>Show archived</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={false}>Show deleted</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive icon={<Trash2 />}>
            Delete record
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};
