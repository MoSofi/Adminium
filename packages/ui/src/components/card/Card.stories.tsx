/**
 * Dark / RTL / density / accent axes are exercised via the Storybook globals
 * toolbar and the VRT profile matrix (03-component-library.md §8/§10) — they
 * are intentionally NOT separate stories.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card, CardBody, CardFooter, CardHeader } from './Card.js';

const meta: Meta<typeof Card> = {
  title: 'Tier3/Card',
  component: Card,
  argTypes: {
    hoverable: { control: 'boolean' },
    selected: { control: 'boolean' },
    padded: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Playground: Story = {
  args: { hoverable: false, selected: false, padded: true, children: 'Monthly revenue summary' },
};

export const WithSlots: Story = {
  render: () => (
    <Card padded={false} className="w-[360px]">
      <CardHeader>
        <div>
          <div className="text-section text-fg">Data source</div>
          <div className="text-body-sm text-fg-muted">PostgreSQL · read-only</div>
        </div>
      </CardHeader>
      <CardBody className="text-body text-fg-muted">
        Connected to db.acme.io:5432 with 14 tables mapped.
      </CardBody>
      <CardFooter>
        <span className="text-caption text-fg-subtle">Synced 5 min ago</span>
      </CardFooter>
    </Card>
  ),
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="grid w-[720px] grid-cols-2 gap-4">
      <Card>Default card</Card>
      <Card hoverable>Hoverable card (nb-lift)</Card>
      <Card selected>Selected card</Card>
      <Card padded={false}>
        <CardHeader>
          <span className="text-section text-fg">Header</span>
        </CardHeader>
        <CardBody className="text-body text-fg-muted">Body on surface</CardBody>
        <CardFooter>
          <span className="text-caption text-fg-subtle">Footer on surface-2</span>
        </CardFooter>
      </Card>
    </div>
  ),
};
