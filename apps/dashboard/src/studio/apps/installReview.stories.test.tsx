// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every install-review story renders without throwing: a story that crashes
 * reads as a timeout in the visual run, far from its cause.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import * as stories from './installReview.stories.js';

const entries: [string, () => ReactNode][] = Object.entries(stories as Record<string, { render?: () => ReactNode }>).flatMap(([name, story]) =>
  name === 'default' || story.render === undefined ? [] : [[name, story.render] as [string, () => ReactNode]],
);

describe('the install review stories', () => {
  it('has the states the review draws', () => {
    expect(entries.length).toBeGreaterThanOrEqual(14);
  });

  it.each(entries)('%s renders', (_name, draw) => {
    const { container } = render(<>{draw()}</>);
    expect(container.textContent?.length).toBeGreaterThan(0);
  });
});
