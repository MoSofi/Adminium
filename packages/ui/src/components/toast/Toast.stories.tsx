/**
 * Dark / RTL / density / accent axes are exercised via the Storybook globals
 * toolbar and the VRT profile matrix (03-component-library.md §8/§10) — they
 * are intentionally NOT separate stories. The slide-in mirrors in RTL
 * (`nb-toastin` → `nb-toastin-rtl`) and the stack anchors to the logical
 * inline-end.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Toast, ToastStack } from './Toast.js';

const meta: Meta<typeof Toast> = {
  title: 'Tier3/Toast',
  component: Toast,
  argTypes: {
    variant: { control: 'select', options: ['success', 'error', 'warning', 'info', 'loading'] },
    duration: { control: 'number' },
  },
};
export default meta;

type Story = StoryObj<typeof Toast>;

export const Playground: Story = {
  args: {
    variant: 'success',
    title: 'Record saved',
    description: 'Invoice #1042 was updated.',
    dismissLabel: 'Dismiss notification',
    onDismiss: () => {},
  },
};

export const Matrix: Story = {
  tags: ['vrt'],
  render: () => (
    <div className="flex flex-col gap-3">
      <Toast
        variant="success"
        title="Record saved"
        description="Invoice #1042 was updated."
        dismissLabel="Dismiss notification"
        onDismiss={() => {}}
      />
      <Toast
        variant="error"
        title="Export failed"
        description="The CSV export could not be generated."
        dismissLabel="Dismiss notification"
        onDismiss={() => {}}
      />
      <Toast
        variant="warning"
        title="Connection degraded"
        dismissLabel="Dismiss notification"
        onDismiss={() => {}}
      />
      <Toast
        variant="info"
        title="Sync scheduled"
        description="Next run in 20 minutes."
        dismissLabel="Dismiss notification"
        onDismiss={() => {}}
      />
      <Toast variant="loading" title="Exporting 1,204 rows…" dismissLabel="Dismiss notification" />
      <Toast
        variant="success"
        title="12 records deleted"
        action={{ label: 'Undo', onAction: () => {} }}
        dismissLabel="Dismiss notification"
      />
    </div>
  ),
};

export const Stack: Story = {
  render: () => (
    <div className="relative h-[320px]">
      <ToastStack
        className="absolute"
        label="Notifications"
        dismissLabel="Dismiss notification"
        onDismissToast={() => {}}
        toasts={[
          { id: '3', variant: 'success', title: 'Record saved' },
          { id: '2', variant: 'info', title: 'Sync scheduled', description: 'Next run in 20 min.' },
          {
            id: '1',
            variant: 'error',
            title: 'Export failed',
            action: { label: 'Retry', onAction: () => {} },
          },
        ]}
      />
    </div>
  ),
};
