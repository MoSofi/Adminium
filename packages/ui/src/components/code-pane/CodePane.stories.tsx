// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Braces } from 'lucide-react';
import { useState } from 'react';

import { CodePane, CodePaneButton } from './CodePane.js';

const DOC = JSON.stringify(
  {
    path: '/orders',
    source: 'public.orders',
    methods: ['GET', 'PATCH'],
    select: ['id', 'status', 'total'],
    filters: [],
    pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 120, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
  },
  null,
  2,
);

function Pane({ dirty, error }: { dirty: boolean; error?: string }) {
  const [value, setValue] = useState(DOC);
  return (
    <div className="flex h-[520px] w-[430px]">
      <CodePane
        className="flex-1"
        icon={<Braces />}
        title="Route definition"
        dirty={dirty}
        stateLabel={dirty ? 'edited — not applied' : 'synced with form'}
        value={value}
        onValueChange={setValue}
        textareaLabel="Route definition JSON"
        action={<CodePaneButton variant="format">Format</CodePaneButton>}
        error={error}
        footer={
          <>
            <CodePaneButton variant="apply" disabled={!dirty}>
              Apply to form
            </CodePaneButton>
            <CodePaneButton variant="revert">Revert</CodePaneButton>
          </>
        }
      />
    </div>
  );
}

const meta = { title: 'Tier2/CodePane', component: CodePane } satisfies Meta<typeof CodePane>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Synced: Story = { args: undefined as never, render: () => <Pane dirty={false} /> };
export const Dirty: Story = { args: undefined as never, render: () => <Pane dirty /> };
export const Error: Story = {
  args: undefined as never,
  render: () => <Pane dirty error="Unexpected token } in JSON at position 42" />,
};
