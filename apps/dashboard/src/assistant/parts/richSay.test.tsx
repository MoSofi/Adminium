// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { RichSay, isAppPath, plainSay, routerKnows, sayPieces } from './RichSay.js';

afterEach(cleanup);

describe('what the assistant said, read for the little Markdown a model writes', () => {
  it('finds bold, code and links, and leaves everything else as it was typed', () => {
    expect(sayPieces('Invite a colleague in the [Team](/settings/team) section. The `main.order_items` table has **the most** rows.')).toEqual([
      { kind: 'text', text: 'Invite a colleague in the ' },
      { kind: 'link', text: 'Team', to: '/settings/team' },
      { kind: 'text', text: ' section. The ' },
      { kind: 'code', text: 'main.order_items' },
      { kind: 'text', text: ' table has ' },
      { kind: 'bold', text: 'the most' },
      { kind: 'text', text: ' rows.' },
    ]);
    // Not Markdown this reads: it stays the characters it is.
    expect(sayPieces('# A heading\n- 2 * 3 * 4 and a lone ` tick')).toEqual([{ kind: 'text', text: '# A heading\n- 2 * 3 * 4 and a lone ` tick' }]);
  });

  it('is read aloud without its marks', () => {
    expect(plainSay('Open [Team](/settings/team), then **Invite** `ana@example.test`.')).toBe('Open Team, then Invite ana@example.test.');
  });

  it('takes only a path of this app as a link`s target', () => {
    for (const ok of ['/settings/team', '/p/customers?tab=open', '/email-templates/tpl_1#top', '/']) expect(isAppPath(ok), ok).toBe(true);
    for (const bad of [
      'https://evil.example/x',
      '//evil.example/x',
      'javascript:alert(1)',
      'settings/team',
      '/\\evil.example',
      '/%2F%2Fevil.example',
      '/%5Cevil.example',
      '/a b',
      '/x\u0000y',
      '/go?to=http://evil.example',
      '/%E0%A4%A',
      '',
    ]) {
      expect(isAppPath(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('asks this app`s own router whether there is a screen there', () => {
    const router = createAppRouter(createQueryClient(), { history: createMemoryHistory({ initialEntries: ['/'] }) });
    expect(routerKnows(router, '/settings/team')).toBe(true);
    expect(routerKnows(router, '/email-templates')).toBe(true);
    expect(routerKnows(router, '/no/such/screen/anywhere')).toBe(false);
    expect(routerKnows(router, '/api/v1/users')).toBe(false);
    // Something that is not a router at all says nothing, which is "no".
    expect(routerKnows({}, '/settings/team')).toBe(false);
  });
});

/** A two-screen app: enough of a router to follow a link inside it. */
function renderIn(say: string) {
  const root = createRootRoute();
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <RichSay say={say} /> });
  const team = createRoute({ getParentRoute: () => root, path: '/settings/team', component: () => <h1>The team screen</h1> });
  const router = createRouter({ routeTree: root.addChildren([home, team]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

describe('drawing it', () => {
  it('draws a link to a screen of this app, and the router follows it', async () => {
    const router = renderIn('Invite a colleague in the [Team](/settings/team) section, in `Settings`, **today**.');
    const link = await screen.findByRole('link', { name: 'Team' });
    expect(link.getAttribute('href')).toBe('/settings/team');
    expect(screen.getByText('Settings').tagName).toBe('CODE');
    expect(screen.getByText('today').tagName).toBe('STRONG');
    expect(screen.queryByText(/\[Team\]/)).toBeNull();

    await userEvent.setup().click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/team'));
    expect(await screen.findByText('The team screen')).toBeTruthy();
  });

  it('draws an outside address, and a path nothing answers, as the label alone', async () => {
    renderIn('See [the docs](https://evil.example/steal), [this](//evil.example), [that](javascript:alert(1)) and [nowhere](/no/such/screen).');
    await screen.findByText(/the docs/);
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(document.body.textContent).toContain('See the docs, this, that');
    expect(document.body.textContent).toContain('nowhere');
    expect(document.body.innerHTML).not.toContain('evil.example');
  });

  it('never reads what was said as markup', async () => {
    renderIn('<img src=x onerror=alert(1)> and **<b>bold</b>**');
    await screen.findByText(/<img src=x onerror=alert\(1\)>/);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });
});
