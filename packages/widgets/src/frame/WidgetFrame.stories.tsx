import { DropdownMenuItem } from '@adminium/ui';
import { GripVertical } from 'lucide-react';

import { WidgetFrame } from './WidgetFrame.js';
import type { WidgetSkeleton } from '../registry/types.js';

/**
 * WidgetFrame state stories (04 §4 contract; acceptance criterion #4 —
 * forcing each state shows correct silhouettes, empty copy, and a working
 * Retry). Typed loosely (no @storybook/react-vite devDep here yet — the
 * 04-T17 QA harness wires widgets stories into the workspace Storybook).
 */
const meta = {
  title: 'Widgets/WidgetFrame',
  component: WidgetFrame,
};
export default meta;

const demoBody = (
  <div className="flex flex-col gap-1 px-4 pb-4">
    <span className="text-[26px] font-bold text-fg">$48,210</span>
    <span className="text-body-sm text-fg-muted">+12.4% vs prior 30 days</span>
  </div>
);

const demoMenu = (
  <>
    <DropdownMenuItem>Refresh</DropdownMenuItem>
    <DropdownMenuItem>Export CSV</DropdownMenuItem>
  </>
);

export const Loaded = {
  render: () => (
    <WidgetFrame state="loaded" title="Revenue" info="Sum of orders.total, last 30 days." menu={demoMenu}>
      {demoBody}
    </WidgetFrame>
  ),
};

export const LoadedRefetching = {
  render: () => (
    <WidgetFrame state="loaded" title="Revenue" refetching>
      {demoBody}
    </WidgetFrame>
  ),
};

export const SkeletonVariants = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      {(['card', 'chart', 'table', 'list', 'block'] as WidgetSkeleton[]).map((variant) => (
        <WidgetFrame key={variant} state="skeleton" title={variant} skeleton={variant} />
      ))}
    </div>
  ),
};

export const Empty = {
  render: () => <WidgetFrame state="empty" title="Signups" />,
};

export const EmptyOverride = {
  render: () => (
    <WidgetFrame
      state="empty"
      title="Inbox"
      empty={{ title: 'All caught up', body: 'No conversations waiting on you.' }}
    />
  ),
};

export const ErrorState = {
  render: () => (
    <WidgetFrame
      state="error"
      title="Revenue"
      errorMessage="The query timed out. Try a shorter range."
      onRetry={() => alert('retry')}
    />
  ),
};

export const EditMode = {
  render: () => (
    <WidgetFrame
      state="loaded"
      title="Revenue"
      menu={demoMenu}
      dragGrip={() => (
        <span className="cursor-grab text-fg-subtle" aria-hidden="true">
          <GripVertical size={14} />
        </span>
      )}
    >
      {demoBody}
    </WidgetFrame>
  ),
};
