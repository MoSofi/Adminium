// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dark / RTL / density / accent axes are exercised via the Storybook globals
 * toolbar and the VRT profile matrix (03-component-library.md §8/§10) — they
 * are intentionally NOT separate stories. Arrow-key order mirrors in RTL via
 * the Radix DirectionProvider from ThemeProvider.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs.js';

const meta: Meta<typeof Tabs> = {
  title: 'Tier3/Tabs',
  component: Tabs,
  argTypes: {
    variant: { control: 'select', options: ['underline', 'pill'] },
  },
};
export default meta;

type Story = StoryObj<typeof Tabs>;

export const Playground: Story = {
  args: { variant: 'underline', defaultValue: 'overview' },
  render: (args) => (
    <Tabs {...args} className="w-[480px]">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="records" count={128}>
          Records
        </TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="archive" disabled>
          Archive
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="text-body text-fg-muted">
        Overview panel
      </TabsContent>
      <TabsContent value="records" className="text-body text-fg-muted">
        Records panel
      </TabsContent>
      <TabsContent value="settings" className="text-body text-fg-muted">
        Settings panel
      </TabsContent>
      <TabsContent value="archive" className="text-body text-fg-muted">
        Archive panel
      </TabsContent>
    </Tabs>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex w-[560px] flex-col gap-8">
      {(['underline', 'pill'] as const).map((variant) => (
        <Tabs key={variant} variant={variant} defaultValue="records">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="records" count={128}>
              Records
            </TabsTrigger>
            <TabsTrigger value="pending" count={4}>
              Pending
            </TabsTrigger>
            <TabsTrigger value="archive" disabled>
              Archive
            </TabsTrigger>
          </TabsList>
          <TabsContent value="records" className="text-body text-fg-muted">
            Active panel ({variant})
          </TabsContent>
        </Tabs>
      ))}
    </div>
  ),
};
