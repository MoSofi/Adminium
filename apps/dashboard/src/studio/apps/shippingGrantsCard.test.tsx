// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install check's shipping card: each right of each role starts ticked,
 * and unticking one leaves the same role's other rights, and another role's
 * same right, alone.
 */
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { ShippingGrantsCard } from './ShippingGrantsCard.js';

type Right = 'book' | 'cancel' | 'customs';

const GRANTS: { role: string; roleName: string; action: Right }[] = [
  { role: 'shop-packer', roleName: 'Packer', action: 'book' },
  { role: 'shop-packer', roleName: 'Packer', action: 'cancel' },
  { role: 'shop-owner', roleName: 'Owner', action: 'cancel' },
  { role: 'shop-owner', roleName: 'Owner', action: 'customs' },
];

function Harness({ seen }: { seen: (unticked: { role: string; action: Right }[]) => void }) {
  const [unticked, setUnticked] = useState<readonly { role: string; action: Right }[]>([]);
  return (
    <ShippingGrantsCard
      grants={GRANTS}
      unticked={unticked}
      onTick={(role, action, given) => {
        const others = unticked.filter((one) => one.role !== role || one.action !== action);
        const next = given ? others : [...others, { role, action }];
        setUnticked(next);
        seen(next);
      }}
    />
  );
}

const isTicked = (id: string) => {
  const box = screen.getByTestId(id);
  return /true|checked/.test(box.getAttribute('aria-checked') ?? box.getAttribute('data-state') ?? '');
};

describe('the shipping card', () => {
  beforeAll(async () => {
    await installTestI18n();
  });

  it('starts every right ticked, and unticks one right of one role', async () => {
    let last: { role: string; action: Right }[] = [];
    render(<Harness seen={(unticked) => (last = unticked)} />);
    expect(screen.getByTestId('shipping-grants').textContent).toContain('Who may handle shipping labels');
    for (const grant of GRANTS) expect(isTicked(`shipping-grant-${grant.role}-${grant.action}`)).toBe(true);

    await userEvent.setup().click(screen.getByTestId('shipping-grant-shop-packer-cancel'));
    expect(last).toEqual([{ role: 'shop-packer', action: 'cancel' }]);
    expect(isTicked('shipping-grant-shop-packer-cancel')).toBe(false);
    expect(isTicked('shipping-grant-shop-packer-book')).toBe(true);
    expect(isTicked('shipping-grant-shop-owner-cancel')).toBe(true);
  });

  it('gives it back when ticked again', async () => {
    let last: { role: string; action: Right }[] = [];
    render(<Harness seen={(unticked) => (last = unticked)} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('shipping-grant-shop-owner-customs'));
    await user.click(screen.getByTestId('shipping-grant-shop-owner-customs'));
    expect(last).toEqual([]);
  });

  it('offers only the rights the check lists for each role, under its name', () => {
    render(<Harness seen={() => undefined} />);
    const packer = screen.getByRole('group', { name: 'Packer' });
    expect(within(packer).getByText('Buy labels, within the limits you set')).toBeTruthy();
    expect(within(packer).getByText('Ask for a label’s refund')).toBeTruthy();
    expect(within(packer).queryByText('Declare customs')).toBeNull();
    const owner = screen.getByRole('group', { name: 'Owner' });
    expect(within(owner).queryByText('Buy labels, within the limits you set')).toBeNull();
    expect(within(owner).getByText('Declare customs')).toBeTruthy();
  });

  it('shows nothing when the app declares no shipping rights', () => {
    const { container } = render(<ShippingGrantsCard grants={[]} unticked={[]} onTick={() => undefined} />);
    expect(container.textContent).toBe('');
  });
});
