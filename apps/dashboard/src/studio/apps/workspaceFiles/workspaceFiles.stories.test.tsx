// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every workspace-file story renders without throwing: a story that crashes
 * reads as a timeout in the visual run, far from its cause.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import * as stories from './workspaceFiles.stories.js';

const entries: [string, () => ReactNode][] = Object.entries(stories as Record<string, { render?: () => ReactNode }>).flatMap(([name, story]) =>
  name === 'default' || story.render === undefined ? [] : [[name, story.render] as [string, () => ReactNode]],
);

beforeEach(async () => {
  await installTestI18n();
});

describe('the workspace file stories', () => {
  it('has the states parts 8 and 9 draw', () => {
    expect(entries.length).toBeGreaterThanOrEqual(10);
  });

  it.each(entries)('%s renders', (_name, draw) => {
    const { baseElement } = render(<>{draw()}</>);
    expect(baseElement.textContent?.length).toBeGreaterThan(0);
  });
});
