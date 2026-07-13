import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Breadcrumbs } from './Breadcrumbs.js';

afterEach(cleanup);

describe('Breadcrumbs', () => {
  it('renders nav > ol with aria-current on the last segment', () => {
    render(
      <Breadcrumbs
        label="Breadcrumb"
        items={[
          { label: 'Workspace', href: '/' },
          { label: 'Invoices', href: '/invoices' },
          { label: 'inv_8842', mono: true },
        ]}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeDefined();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    const current = screen.getByText('inv_8842');
    expect(current.closest('[aria-current="page"]')).not.toBeNull();
  });

  it('fires onClick handlers (router integration)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Breadcrumbs
        label="Breadcrumb"
        items={[{ label: 'Workspace', onClick }, { label: 'Users' }]}
      />,
    );
    await user.click(screen.getByText('Workspace'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('mono segments render in the mono wrapper', () => {
    render(<Breadcrumbs label="Breadcrumb" items={[{ label: 'usr_01', mono: true }]} />);
    expect(screen.getByText('usr_01').classList.contains('font-mono')).toBe(true);
  });
});
