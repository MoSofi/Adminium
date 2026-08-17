// SPDX-License-Identifier: AGPL-3.0-only
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Hexagon, ShieldCheck } from 'lucide-react';

import { Avatar } from '../avatar/index.js';
import { Card } from '../card/index.js';
import { AuthLayout, AuthTestimonial } from './AuthLayout.js';

const meta = {
  title: 'Tier5/AuthLayout',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Brand logo block per Login.dc.html. */
function BrandLogo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-[34px] items-center justify-center rounded-md bg-white/15">
        <Hexagon className="size-[19px]" />
      </span>
      <span className="text-[18px] font-extrabold tracking-[-0.02em]">Adminium</span>
    </span>
  );
}

const brandProps = {
  logo: <BrandLogo />,
  headline: <span className="block max-w-[15ch]">Turn any database into a dashboard.</span>,
  description:
    'Connect Postgres, auto-generate admin panels, and ship internal tools in minutes.',
  testimonial: (
    <AuthTestimonial
      quote={'"We replaced three internal tools with Adminium in a weekend."'}
      name="Dana K"
      role="Head of Eng, Northwind"
      avatar={<Avatar name="Dana K" size="lg" />}
    />
  ),
  trustBadges: (
    <>
      <span>SOC 2 Type II</span>
      <span aria-hidden="true">·</span>
      <span>GDPR</span>
      <span aria-hidden="true">·</span>
      <span>99.99% uptime</span>
    </>
  ),
  footer: (
    <>
      <ShieldCheck aria-hidden="true" />
      Protected by enterprise-grade encryption
    </>
  ),
} as const;

function PlaceholderForm() {
  return (
    <Card className="flex h-[320px] items-center justify-center text-body-sm text-fg-subtle">
      380px form column
    </Card>
  );
}

export const Split: Story = {
  tags: ['vrt'],
  render: () => (
    <AuthLayout {...brandProps}>
      <PlaceholderForm />
    </AuthLayout>
  ),
};

export const SingleColumn: Story = {
  tags: ['vrt'],
  render: () => (
    <AuthLayout variant="single" footer={brandProps.footer}>
      <PlaceholderForm />
    </AuthLayout>
  ),
};
