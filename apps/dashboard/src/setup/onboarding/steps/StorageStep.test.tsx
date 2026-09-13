// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 4 — where Adminium keeps its own data (45-onboarding.md §2, R2).
 *
 * The gate worth pinning is the one the server also enforces: Adminium's own
 * tables may not go into a database its role cannot write to or run DDL in.
 * The rule is shared with the Studio (`metaPlacementRule.ts`) precisely so the
 * two wizards cannot disagree — these cases prove this side reads it.
 */
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import type { LandedConnection } from '../submitHeldAnswers.js';
import { sameDbBlockedReason, separateDsnError, StorageStep } from './StorageStep.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

const WRITABLE: LandedConnection = {
  connectionId: 'con_1',
  engine: 'postgres',
  tableCount: 14,
  serverVersion: 'PostgreSQL 16.2',
  latencyMs: 11,
  readOnly: false,
  privileges: { canWrite: true, canDDL: true } as never,
};

const EMBEDDED = {
  source: 'embedded' as const,
  engine: 'sqlite' as const,
  embedded: true,
  canRelocate: true,
  reason: null,
};

function renderStep(props: Partial<React.ComponentProps<typeof StorageStep>> = {}) {
  render(
    <StorageStep
      value="local"
      onChange={() => undefined}
      separateDsn=""
      onSeparateDsnChange={() => undefined}
      separateTested={false}
      onSeparateTested={() => undefined}
      placement={EMBEDDED}
      connection={WRITABLE}
      existing={null}
      park={false}
      relocating={null}
      {...props}
    />,
  );
}

describe('the three answers', () => {
  it('offers a file, the connected database, and one of its own', () => {
    renderStep();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /In a file on this machine/ })).toBeDefined();
  });

  it('opens on the file — the lowest-friction path stays one Continue', () => {
    renderStep();
    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent ?? '').toContain('In a file on this machine');
  });
});

describe('when the connected database cannot host it', () => {
  it('says so when nothing was connected at all', () => {
    expect(sameDbBlockedReason(null)).toContain('have not connected a database yet');
  });

  it('reads the shared rule for read-only and DDL-less roles', () => {
    expect(sameDbBlockedReason({ ...WRITABLE, readOnly: true })).toContain('read-only');
    expect(
      sameDbBlockedReason({ ...WRITABLE, privileges: { canWrite: true, canDDL: false } as never }),
    ).toContain('CREATE TABLE');
  });

  it('refuses a SQLite source — a file is not a server to add tables to', () => {
    expect(sameDbBlockedReason({ ...WRITABLE, engine: 'sqlite' })).toContain('not a server');
  });

  it('disables the card rather than letting the server 409 it', () => {
    renderStep({ connection: null });
    const card = screen.getByRole('radio', { name: /In the database you just connected/ });
    expect(card.getAttribute('data-disabled') ?? card.getAttribute('disabled')).not.toBeNull();
  });
});

describe('a database of its own', () => {
  it('checks the shape before anything is probed', () => {
    expect(separateDsnError('')).toBeNull();
    expect(separateDsnError('postgres://user@host:5432/adminium')).toBeNull();
    expect(separateDsnError('sqlite:/tmp/x.db')).toBeNull();
    expect(separateDsnError('mongodb://host/db')).toContain('Unrecognized scheme');
    expect(separateDsnError('postgres://')).toContain('Add the host and database');
  });

  it('reveals the field only for that answer', () => {
    renderStep();
    expect(screen.queryByLabelText(/Connection string for Adminium/)).toBeNull();
    renderStep({ value: 'separate' });
    expect(screen.getByLabelText(/Connection string for Adminium/)).toBeDefined();
  });
});

describe('an instance whose store is already pinned', () => {
  it('offers nothing to choose, and says why', () => {
    renderStep({
      placement: {
        source: 'env',
        engine: 'postgres',
        embedded: false,
        canRelocate: false,
        reason: 'ADMINIUM_META_URL',
      },
    });
    expect(screen.getByText(/already has a home/)).toBeDefined();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('while it moves', () => {
  it('narrates the copy and the restart', () => {
    renderStep({ value: 'same-db', relocating: 'copying' });
    expect(screen.getByText(/Copying Adminium’s data across/)).toBeDefined();
    renderStep({ value: 'same-db', relocating: 'restarting' });
    expect(screen.getByText(/Restarting onto the new database/)).toBeDefined();
  });
});

describe('when that database already runs an Adminium (45-T11)', () => {
  const existing = { occupied: ['adminium_users', 'adminium_sessions'], secretMatches: true };

  it('blocks the card, and says where the decision is made', () => {
    // The failure this replaces came two screens later, from the relocation.
    expect(sameDbBlockedReason(WRITABLE, existing, false)).toContain('already holds an Adminium');
    renderStep({ existing });
    const card = screen.getByRole('radio', { name: /In the database you just connected/ });
    expect(card.getAttribute('data-disabled') ?? card.getAttribute('disabled')).not.toBeNull();
  });

  it('opens the card once the operator chose to keep those tables', () => {
    expect(sameDbBlockedReason(WRITABLE, existing, true)).toBeNull();
    renderStep({ existing, park: true });
    expect(screen.getByText(/renamed out of the way first/)).toBeDefined();
  });

  it('says nothing when the probe found only empty husks', () => {
    expect(sameDbBlockedReason(WRITABLE, { occupied: [], secretMatches: null }, false)).toBeNull();
  });
});
