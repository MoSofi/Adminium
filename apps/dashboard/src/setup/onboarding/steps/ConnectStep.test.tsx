// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 2 — connect (45-onboarding.md §2, R1, DEP-7, DEP-17).
 *
 * The two properties worth pinning are both about what does NOT happen: no
 * request is made from this step (there is no session to make one with), and a
 * pending bridge ticket is never redeemed here — it is announced, and handed to
 * the Studio wizard where the value is read before it is used.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import { connectDsnError, ConnectStep } from './ConnectStep.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('the shape check', () => {
  it('accepts an empty field — the step may be skipped', () => {
    expect(connectDsnError('')).toBeNull();
    expect(connectDsnError('   ')).toBeNull();
  });

  it('accepts the three engines this build can actually connect to', () => {
    expect(connectDsnError('postgres://user@host:5432/db')).toBeNull();
    expect(connectDsnError('mysql://user@host:3306/db')).toBeNull();
    expect(connectDsnError('mariadb://user@host:3306/db')).toBeNull();
    expect(connectDsnError('sqlite:/var/lib/app.db')).toBeNull();
  });

  it('rejects an engine with no adapter, however valid the URL', () => {
    // The comp draws a MongoDB card; v1 ships no adapter for it (45 DEP-6).
    expect(connectDsnError('mongodb://user@host:27017/db')).toContain('Unrecognized scheme');
    expect(connectDsnError('mssql://user@host/db')).toContain('Unrecognized scheme');
  });

  it('asks for the missing half of a well-schemed string', () => {
    expect(connectDsnError('postgres://')).toContain('Add the host and database');
  });
});

describe('the step', () => {
  it('offers three engines and a connection string field', () => {
    render(<ConnectStep engine="postgres" dsn="" onChange={() => undefined} bridgePending={false} />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radiogroup', { name: 'Database engine' })).toBeDefined();
    expect(screen.getByLabelText('Connection string')).toBeDefined();
  });

  it('says nothing has been sent, because nothing has', () => {
    render(<ConnectStep engine="postgres" dsn="" onChange={() => undefined} bridgePending={false} />);
    expect(screen.getByText(/Nothing leaves this browser until your account exists/)).toBeDefined();
  });

  it('shows the shape error instead of the helper once one applies', () => {
    render(
      <ConnectStep engine="postgres" dsn="postgres://" onChange={() => undefined} bridgePending={false} />,
    );
    expect(screen.getByText(/Add the host and database/)).toBeDefined();
    expect(screen.queryByText(/Nothing leaves this browser/)).toBeNull();
  });

  it('rewrites the scheme when the engine card changes, so the two cannot disagree', async () => {
    const onChange = vi.fn();
    render(
      <ConnectStep
        engine="postgres"
        dsn="postgres://user@host:5432/db"
        onChange={onChange}
        bridgePending={false}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /MySQL/ }));
    expect(onChange).toHaveBeenCalledWith({
      engine: 'mysql',
      dsn: 'mysql://user@host:5432/db',
    });
  });

  // `fireEvent.change`, not `userEvent.type`: the field is controlled by the
  // parent and this render never re-renders, so typing would report the LAST
  // keystroke alone. One change event is also what a paste is, which is how a
  // connection string actually arrives.
  it('lets the pasted string move the card — the DSN is the answer, the card is a shortcut', () => {
    // The e2e first-run walk pasted `sqlite:/…` while the card said PostgreSQL,
    // and the connection was created as postgres: `database "…" does not exist`.
    const onChange = vi.fn();
    render(<ConnectStep engine="postgres" dsn="" onChange={onChange} bridgePending={false} />);
    fireEvent.change(screen.getByLabelText('Connection string'), {
      target: { value: 'sqlite:/tmp/app.db' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ dsn: 'sqlite:/tmp/app.db', engine: 'sqlite' });
  });

  it('leaves the card alone for a string that parses as no engine yet', () => {
    const onChange = vi.fn();
    render(<ConnectStep engine="postgres" dsn="" onChange={onChange} bridgePending={false} />);
    fireEvent.change(screen.getByLabelText('Connection string'), { target: { value: 'host/db' } });
    expect(onChange).toHaveBeenLastCalledWith({ dsn: 'host/db' });
  });

  it('clears the field when no rewrite is meaningful — a SQLite path is not a URL', async () => {
    const onChange = vi.fn();
    render(
      <ConnectStep
        engine="postgres"
        dsn="postgres://user@host:5432/db"
        onChange={onChange}
        bridgePending={false}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /SQLite/ }));
    expect(onChange).toHaveBeenCalledWith({ engine: 'sqlite', dsn: '' });
  });
});

describe('a hand-off from adminium.dev', () => {
  it('announces the waiting string and asks for nothing', () => {
    render(<ConnectStep engine="postgres" dsn="" onChange={() => undefined} bridgePending />);
    expect(screen.getByText(/A connection string is waiting/)).toBeDefined();
    // No field, no engine cards: it cannot be redeemed without a session, and
    // it must be read in the wizard that uses it.
    expect(screen.queryByLabelText('Connection string')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
