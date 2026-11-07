// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every Save as app story renders without a server, and the choices mode
 * reads as Save workspace's "More choices" opens it: four steps, and Check
 * ending in "Use these choices" rather than Save. A story that throws would
 * only show up as a VRT timeout.
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import * as stories from './saveApp.stories.js';

const entries: [string, () => ReactNode][] = Object.entries(stories as Record<string, { render?: () => ReactNode }>).flatMap(([name, story]) =>
  name === 'default' || story.render === undefined ? [] : [[name, story.render] as [string, () => ReactNode]],
);

afterEach(cleanup);

describe('the Save as app stories', () => {
  it('has the choices mode at What to include, About the app and Check', () => {
    expect(entries.map(([name]) => name)).toEqual(expect.arrayContaining(['ChoicesWhatToInclude', 'ChoicesAboutTheApp', 'ChoicesCheckUseThese']));
  });

  it.each(entries)('%s renders', (_name, draw) => {
    const { baseElement } = render(<>{draw()}</>);
    expect(baseElement.textContent?.length).toBeGreaterThan(0);
  });

  it('opens the choices in the modal named for the database, with four steps and no Back out of What to include', () => {
    render(<>{stories.ChoicesWhatToInclude.render()}</>);
    expect(screen.getByRole('dialog', { name: 'More choices for fernhill' })).toBeTruthy();
    // The key is drawn in mono inside the sentence.
    expect(screen.getByRole('dialog').textContent).toContain('Step 2 of 4 · fernhill-ops');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('ends Check with Use these choices, not Save', () => {
    render(<>{stories.ChoicesCheckUseThese.render()}</>);
    expect(screen.getByRole('button', { name: 'Use these choices' })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('lists only the saver’s own and shared views when the page holds another person’s view, and asks nothing about it', () => {
    const { container } = render(<>{stories.CheckAnotherPersonsView.render()}</>);
    const text = container.textContent ?? '';
    expect(text).toContain('Today’s roasts');
    expect(text).not.toContain('Low stock beans');
    // Nothing blocks; the saver's own view is the one thing that needs a choice, and it holds its default answer.
    const pills = container.querySelector('[data-part="check-pills"]')?.textContent ?? '';
    expect(pills).toContain('Blocks saving0');
    expect(pills).toContain('Needs a choice1');
  });

  it('asks about a personal view the plan names that the views block does not show, and counts it', () => {
    const { container } = render(<>{stories.CheckAskedAboutAnUnlistedView.render()}</>);
    expect(container.textContent).toContain('My open orders');
    expect(container.querySelector('[data-part="check-pills"]')?.textContent).toContain('Needs a choice2');
    expect(screen.getAllByRole('button', { name: 'Leave it out' }).length).toBeGreaterThan(0);
  });
});
