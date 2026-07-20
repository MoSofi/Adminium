import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Banner } from './Banner.js';

afterEach(cleanup);

describe('Banner', () => {
  it('renders the message and stamps the tone', () => {
    const { container } = render(<Banner tone="warn">Payment method expires soon.</Banner>);
    expect(screen.getByText('Payment method expires soon.')).toBeDefined();
    expect((container.firstElementChild as HTMLElement).dataset['tone']).toBe('warn');
  });

  it('dismisses via the labeled close button', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Banner onDismiss={onDismiss} dismissLabel="Dismiss banner">
        Maintenance starts in 3 days.
      </Banner>,
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss banner' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('hides the close button without onDismiss and renders the action slot', () => {
    render(<Banner action={<a href="/settings/storage">Free up space</a>}>Disk almost full.</Banner>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'Free up space' })).toBeDefined();
  });
});
