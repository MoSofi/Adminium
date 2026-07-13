import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { KeyValueList, KeyValueRow } from './KeyValueList.js';

afterEach(cleanup);

describe('KeyValueList', () => {
  it('renders data-driven rows', () => {
    const { container } = render(
      <KeyValueList
        items={[
          { label: 'Plan', value: 'Pro' },
          { label: 'Region', value: 'eu-west-1', mono: true },
          { label: 'Amount', value: '$49.00', mono: true },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-part="key-value-row"]')).toHaveLength(3);
    expect(screen.getByText('Plan')).toBeDefined();
    expect(screen.getByText('Pro')).toBeDefined();
  });

  it('mono option wraps the value in the mono wrapper', () => {
    render(<KeyValueList items={[{ label: 'Host', value: 'db.acme.io', mono: true }]} />);
    expect(screen.getByText('db.acme.io').classList.contains('font-mono')).toBe(true);
  });

  it('supports composed KeyValueRow children', () => {
    render(
      <KeyValueList>
        <KeyValueRow label="Status">Active</KeyValueRow>
      </KeyValueList>,
    );
    expect(screen.getByText('Status')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
  });
});
