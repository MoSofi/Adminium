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

/** Defaults for everything the panel needs; each case overrides what it is about. */
function renderStep(props: Partial<React.ComponentProps<typeof ConnectStep>> = {}) {
  render(
    <ConnectStep
      engine="postgres"
      dsn=""
      onChange={() => undefined}
      existing={null}
      probing={false}
      park={false}
      onPark={() => undefined}
      onAdopt={() => undefined}
      adopting={null}
      bridgePending={false}
      {...props}
    />,
  );
}

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
    renderStep();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radiogroup', { name: 'Database engine' })).toBeDefined();
    expect(screen.getByLabelText('Connection string')).toBeDefined();
  });

  it('says nothing has been sent, because nothing has', () => {
    renderStep();
    expect(screen.getByText(/Nothing leaves this browser until your account exists/)).toBeDefined();
  });

  it('shows the shape error instead of the helper once one applies', () => {
    renderStep({ dsn: 'postgres://' });
    expect(screen.getByText(/Add the host and database/)).toBeDefined();
    expect(screen.queryByText(/Nothing leaves this browser/)).toBeNull();
  });

  it('rewrites the scheme when the engine card changes, so the two cannot disagree', async () => {
    const onChange = vi.fn();
    renderStep({ dsn: 'postgres://user@host:5432/db', onChange });
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
    renderStep({ onChange });
    fireEvent.change(screen.getByLabelText('Connection string'), {
      target: { value: 'sqlite:/tmp/app.db' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ dsn: 'sqlite:/tmp/app.db', engine: 'sqlite' });
  });

  it('leaves the card alone for a string that parses as no engine yet', () => {
    const onChange = vi.fn();
    renderStep({ onChange });
    fireEvent.change(screen.getByLabelText('Connection string'), { target: { value: 'host/db' } });
    expect(onChange).toHaveBeenLastCalledWith({ dsn: 'host/db' });
  });

  it('clears the field when no rewrite is meaningful — a SQLite path is not a URL', async () => {
    const onChange = vi.fn();
    renderStep({ dsn: 'postgres://user@host:5432/db', onChange });
    await userEvent.click(screen.getByRole('radio', { name: /SQLite/ }));
    expect(onChange).toHaveBeenCalledWith({ engine: 'sqlite', dsn: '' });
  });
});

describe('a hand-off from adminium.dev', () => {
  it('announces the waiting string and asks for nothing', () => {
    renderStep({ bridgePending: true });
    expect(screen.getByText(/A connection string is waiting/)).toBeDefined();
    // No field, no engine cards: it cannot be redeemed without a session, and
    // it must be read in the wizard that uses it.
    expect(screen.queryByLabelText('Connection string')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('a database that already runs an Adminium (45-T11)', () => {
  const existing = { occupied: ['adminium_users', 'adminium_sessions'], secretMatches: true };

  it('names what is in there and offers both ways out', () => {
    renderStep({ dsn: 'postgres://user@host:5432/db', existing });
    expect(screen.getByText(/already runs an Adminium/)).toBeDefined();
    expect(screen.getByText(/2 Adminium tables/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Use it and sign in/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Keep them and start fresh/ })).toBeDefined();
  });

  it('warns when this instance could not read what that store encrypted', () => {
    renderStep({ dsn: 'postgres://x', existing: { ...existing, secretMatches: false } });
    expect(screen.getByText(/different ADMINIUM_SECRET/)).toBeDefined();
  });

  it('says nothing at all when the tables are empty husks', () => {
    renderStep({ dsn: 'postgres://x', existing: { occupied: [], secretMatches: null } });
    expect(screen.queryByText(/already runs an Adminium/)).toBeNull();
  });

  it('replaces the choice with what will happen, once parking is chosen', () => {
    renderStep({ dsn: 'postgres://x', existing, park: true });
    expect(screen.getByText(/renamed out of the way/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Use it and sign in/ })).toBeNull();
  });

  it('reports both decisions to the container', async () => {
    const onPark = vi.fn();
    const onAdopt = vi.fn();
    renderStep({ dsn: 'postgres://x', existing, onPark, onAdopt });
    await userEvent.click(screen.getByRole('button', { name: /Keep them and start fresh/ }));
    expect(onPark).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /Use it and sign in/ }));
    expect(onAdopt).toHaveBeenCalledTimes(1);
  });

  it('narrates the adoption while it runs', () => {
    renderStep({ dsn: 'postgres://x', existing, adopting: 'restarting' });
    expect(screen.getByText(/Restarting onto it/)).toBeDefined();
  });
});

describe('while the check is running', () => {
  it('says so where the helper text was', () => {
    renderStep({ dsn: 'postgres://user@host:5432/db', probing: true });
    expect(screen.getByText('Checking that database…')).toBeDefined();
    expect(screen.queryByText(/Nothing leaves this browser/)).toBeNull();
  });

  it('gives a shape error the field, not the spinner', () => {
    renderStep({ dsn: 'postgres://', probing: true });
    expect(screen.getByText(/Add the host and database/)).toBeDefined();
    expect(screen.queryByText('Checking that database…')).toBeNull();
  });
});
