// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Avatar } from '../avatar/index.js';
import { AvatarStack } from './AvatarStack.js';

afterEach(cleanup);

const NAMES = ['Ava Reyes', 'Omar Farouk', 'Lina Chen', 'Noah Patel', 'Maya Haddad'];

function renderStack(max?: number) {
  return render(
    <AvatarStack label="Assignees" {...(max === undefined ? {} : { max })}>
      {NAMES.map((name) => (
        <Avatar key={name} name={name} />
      ))}
    </AvatarStack>,
  );
}

describe('AvatarStack', () => {
  it('renders all avatars in a labelled group when under max', () => {
    renderStack();
    const group = screen.getByRole('group', { name: 'Assignees' });
    expect(screen.getAllByRole('img')).toHaveLength(5);
    expect(screen.queryByTestId('avatar-stack-overflow')).toBeNull();
    expect(group.className).toContain('[&>*:not(:first-child)]:-ms-2');
    expect(group.className).toContain('[&>*]:ring-surface');
  });

  it('collapses avatars past max into a +N overflow chip', () => {
    renderStack(3);
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByTestId('avatar-stack-overflow').textContent).toBe('+2');
  });

  it('supports a custom overflow label (i18n hook)', () => {
    render(
      <AvatarStack max={2} overflowLabel={(n) => `${n}‏+`}>
        {NAMES.map((name) => (
          <Avatar key={name} name={name} />
        ))}
      </AvatarStack>,
    );
    expect(screen.getByTestId('avatar-stack-overflow').textContent).toBe('3‏+');
  });

  it('sizes the overflow chip from the size prop', () => {
    render(
      <AvatarStack max={1} size="sm">
        {NAMES.map((name) => (
          <Avatar key={name} name={name} size="sm" />
        ))}
      </AvatarStack>,
    );
    expect(screen.getByTestId('avatar-stack-overflow').classList.contains('size-6')).toBe(true);
  });
});
