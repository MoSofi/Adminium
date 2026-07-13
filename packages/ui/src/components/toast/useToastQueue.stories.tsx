import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../button/Button.js';
import { ToastStack } from './Toast.js';
import { useToastQueue } from './useToastQueue.js';

const meta = {
  title: 'Tier3/ToastQueue',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function QueueDemo() {
  const queue = useToastQueue();
  let restored = 0;
  return (
    <div className="flex min-h-[360px] flex-wrap content-start gap-2 p-8">
      <Button variant="secondary" onClick={() => queue.push({ variant: 'success', title: 'Record saved' })}>
        Success (2.6s)
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          queue.push({ variant: 'info', title: 'Sync scheduled', description: 'Next run in 5 minutes.' })
        }
      >
        Info (3.4s)
      </Button>
      <Button variant="secondary" onClick={() => queue.push({ variant: 'warning', title: 'Storage at 82%' })}>
        Warning (4.2s)
      </Button>
      <Button variant="secondary" onClick={() => queue.push({ variant: 'error', title: 'Export failed' })}>
        Error (5.2s)
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          queue.push({
            title: '12 records deleted',
            variant: 'success',
            action: { label: 'Undo', onAction: () => void restored++ },
          })
        }
      >
        Undo action (5.2s)
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          void queue.promise(new Promise((resolve) => setTimeout(resolve, 2000)), {
            loading: 'Exporting 1,204 rows…',
            success: 'Export ready',
            error: 'Export failed',
          })
        }
      >
        Promise toast
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          for (let i = 1; i <= 7; i++) queue.push({ variant: 'info', title: `Toast ${i} of 7` });
        }}
      >
        Push 7 (max 4 + FIFO queue)
      </Button>
      <Button variant="ghost" onClick={() => queue.dismiss()}>
        Dismiss all
      </Button>
      <ToastStack {...queue.stackProps} dismissLabel="Dismiss notification" label="Notifications" />
    </div>
  );
}

export const Playground: Story = { render: () => <QueueDemo /> };
