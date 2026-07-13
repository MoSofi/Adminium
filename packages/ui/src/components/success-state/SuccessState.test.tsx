import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SuccessState } from './SuccessState.js';

afterEach(cleanup);

describe('SuccessState', () => {
  it('renders heading, body and the Done button', () => {
    render(
      <SuccessState title="Invitation sent" body="We emailed kim@acme.io." doneLabel="Done" />,
    );
    expect(screen.getByRole('heading', { name: 'Invitation sent' })).toBeDefined();
    expect(screen.getByText('We emailed kim@acme.io.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDefined();
  });

  it('autofocuses Done by default and fires onDone', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<SuccessState title="Sent" doneLabel="Done" onDone={onDone} />);
    const done = screen.getByRole('button', { name: 'Done' });
    expect(document.activeElement).toBe(done);
    await user.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('supports extra actions', () => {
    render(
      <SuccessState
        title="Sent"
        doneLabel="Done"
        actions={<button type="button">Invite another</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Invite another' })).toBeDefined();
  });
});
