import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs.js';

afterEach(cleanup);

function renderTabs(variant: 'underline' | 'pill' = 'underline') {
  return render(
    <Tabs variant={variant} defaultValue="one">
      <TabsList>
        <TabsTrigger value="one" count={12}>
          One
        </TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
        <TabsTrigger value="three" disabled>
          Three
        </TabsTrigger>
      </TabsList>
      <TabsContent value="one">Panel one</TabsContent>
      <TabsContent value="two">Panel two</TabsContent>
      <TabsContent value="three">Panel three</TabsContent>
    </Tabs>,
  );
}

describe('Tabs', () => {
  it('renders a tablist and shows the default tab panel', () => {
    renderTabs();
    expect(screen.getByRole('tablist')).toBeDefined();
    expect(screen.getByRole('tab', { name: /One/, selected: true })).toBeDefined();
    expect(screen.getByText('Panel one')).toBeDefined();
    expect(screen.queryByText('Panel two')).toBeNull();
  });

  it('switches panels on click', async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.click(screen.getByRole('tab', { name: 'Two' }));
    expect(screen.getByRole('tab', { name: 'Two', selected: true })).toBeDefined();
    expect(screen.getByText('Panel two')).toBeDefined();
    expect(screen.queryByText('Panel one')).toBeNull();
  });

  it('moves and activates with arrow keys (automatic activation)', async () => {
    const user = userEvent.setup();
    renderTabs();
    const first = screen.getByRole('tab', { name: /One/ });
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two', selected: true })).toBeDefined();
    expect(screen.getByText('Panel two')).toBeDefined();
  });

  it('skips disabled tabs from activation', async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.click(screen.getByRole('tab', { name: 'Three' }));
    // still on the default tab
    expect(screen.getByRole('tab', { name: /One/, selected: true })).toBeDefined();
  });

  it('renders the count pill inline', () => {
    renderTabs();
    expect(screen.getByTestId('tab-count').textContent).toBe('12');
  });

  it('applies the pill tray classes for variant="pill"', () => {
    renderTabs('pill');
    expect(screen.getByRole('tablist').classList.contains('bg-surface-2')).toBe(true);
  });
});
