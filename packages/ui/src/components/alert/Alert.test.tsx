import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Alert } from './Alert.js';

afterEach(cleanup);

describe('Alert', () => {
  it('renders title, body and CTA', () => {
    render(
      <Alert
        tone="warn"
        title="Storage almost full"
        body="You have used 92% of available disk space."
        action={<a href="/settings/storage">Free up space</a>}
      />,
    );
    expect(screen.getByText('Storage almost full')).toBeDefined();
    expect(screen.getByText('You have used 92% of available disk space.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Free up space' })).toBeDefined();
  });

  it('stamps the tone and defaults to info', () => {
    const { container, rerender } = render(<Alert title="Heads up" />);
    expect((container.firstElementChild as HTMLElement).dataset['tone']).toBe('info');
    rerender(<Alert tone="danger" title="Failed" />);
    expect((container.firstElementChild as HTMLElement).dataset['tone']).toBe('danger');
  });

  it('supports live-region roles for dynamic alerts', () => {
    render(<Alert tone="danger" role="alert" title="Sync failed" />);
    expect(screen.getByRole('alert')).toBeDefined();
  });
});
