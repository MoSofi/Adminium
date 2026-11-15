// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install check's refund card: each role the app gives its refund right
 * starts ticked, and unticking one says so; an update that newly gives the
 * right says it among what the roles are given more.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { RoleGrantsAddedCard } from './PrivacyGrantsCard.js';
import { RefundGrantsCard } from './RefundGrantsCard.js';

const GRANTS = [
  { role: 'counter-manager', roleName: 'Manager' },
  { role: 'counter-deputy', roleName: 'Deputy' },
];

function Harness({ seen }: { seen: (unticked: string[]) => void }) {
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <RefundGrantsCard
      grants={GRANTS}
      unticked={unticked}
      onTick={(role, given) =>
        setUnticked((now) => {
          const next = new Set(now);
          if (given) next.delete(role);
          else next.add(role);
          seen([...next]);
          return next;
        })
      }
    />
  );
}

describe('the refund card', () => {
  beforeAll(async () => {
    await installTestI18n();
  });

  it('starts every role ticked, and says which one was unticked', async () => {
    let last: string[] = [];
    render(<Harness seen={(unticked) => (last = unticked)} />);
    expect(screen.getByTestId('refund-grants').textContent).toContain('Who may refund online payments');
    const deputy = screen.getByTestId('refund-grant-counter-deputy');
    expect(deputy.getAttribute('aria-checked') ?? deputy.getAttribute('data-state')).toMatch(/true|checked/);
    await userEvent.setup().click(deputy);
    expect(last).toEqual(['counter-deputy']);
  });

  it('shows nothing when no role refunds', () => {
    const { container } = render(<RefundGrantsCard grants={[]} unticked={new Set()} onTick={() => undefined} />);
    expect(container.textContent).toBe('');
  });

  it('names a role an update newly lets refund', () => {
    render(<RoleGrantsAddedCard privacy={[]} addOn={[]} refund={[{ role: 'counter-manager', roleName: 'Manager' }]} />);
    expect(screen.getByTestId('role-grants-added').textContent).toContain('Manager can give back money customers paid online');
  });
});
