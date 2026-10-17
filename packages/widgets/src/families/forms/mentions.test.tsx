// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MentionTextarea } from './MentionTextarea.js';
import { mentionQueryAt, mentionText, shownOf, storedOf, withMention } from './mentions.js';
import { PeopleSourceProvider } from './people-source.js';

const SAM = { id: 'usr_01SAMSAMSAM', name: 'Sam Lee' };
const SAMIRA = { id: 'usr_01SAMIRA000', name: 'Sam' };

describe('a mention, stored and typed', () => {
  it('reads a stored text as it was typed', () => {
    expect(mentionText('Ask @[Sam Lee](usr_01SAMSAMSAM) by the 12th')).toBe('Ask @Sam Lee by the 12th');
    expect(mentionText('mail me @ home [x](usr_1)')).toBe('mail me @ home [x](usr_1)');
  });

  it('goes to the box and back without losing who is meant', () => {
    const stored = 'Ask @[Sam Lee](usr_01SAMSAMSAM), then @[Sam](usr_01SAMIRA000).';
    const { text, people } = shownOf(stored);
    expect(text).toBe('Ask @Sam Lee, then @Sam.');
    expect(storedOf(text, people)).toBe(stored);
    // Typing after a name does not break it; a name typed by hand that is nobody stays as text.
    expect(storedOf('@Sam Lee and @Samuel', people)).toBe('@[Sam Lee](usr_01SAMSAMSAM) and @Samuel');
  });

  it('keeps a namesake in its stored form rather than swap one person for another', () => {
    const stored = '@[Sam](usr_01SAMIRA000) and @[Sam](usr_01OTHERSAM00)';
    const { text, people } = shownOf(stored);
    expect(text).toBe('@Sam and @[Sam](usr_01OTHERSAM00)');
    expect(storedOf(text, people)).toBe(stored);
  });

  it('knows what is being asked for at the caret', () => {
    expect(mentionQueryAt('Ask @sa', 7)).toEqual({ from: 4, query: 'sa' });
    expect(mentionQueryAt('Ask @sam le', 11)).toEqual({ from: 4, query: 'sam le' });
    expect(mentionQueryAt('me@home', 7)).toBeNull();
    expect(mentionQueryAt('Ask @sam\nnext', 13)).toBeNull();
    expect(mentionQueryAt('no at sign', 5)).toBeNull();
    expect(withMention('Ask @sa now', { from: 4, query: 'sa' }, SAM)).toEqual({ text: 'Ask @Sam Lee now', caret: 13 });
  });
});

function Box({ onStored, initial = '' }: { onStored: (stored: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <MentionTextarea
      aria-label="Comment"
      value={value}
      onChange={(stored) => {
        setValue(stored);
        onStored(stored);
      }}
    />
  );
}

describe('the box that takes mentions', () => {
  it('offers people after an @, takes one by the keyboard and stores who they are', async () => {
    const people = vi.fn(async (query: string) => [SAM, SAMIRA].filter((person) => person.name.toLowerCase().includes(query.toLowerCase())));
    const stored = vi.fn();
    render(
      <PeopleSourceProvider value={people}>
        <Box onStored={stored} />
      </PeopleSourceProvider>,
    );
    const box = screen.getByLabelText('Comment') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Ask @sa', selectionStart: 7 } });
    const list = await screen.findByRole('listbox', { name: 'People to mention' });
    expect(people).toHaveBeenCalledWith('sa');
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(2);
    // Down to the second, back up to the first, and Enter takes it.
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(box.value).toBe('Ask @Sam Lee '));
    expect(stored).toHaveBeenLastCalledWith('Ask @[Sam Lee](usr_01SAMSAMSAM) ');
    expect(screen.queryByRole('listbox')).toBeNull();
    // Typing on keeps the person.
    fireEvent.change(box, { target: { value: 'Ask @Sam Lee by the 12th', selectionStart: 24 } });
    expect(stored).toHaveBeenLastCalledWith('Ask @[Sam Lee](usr_01SAMSAMSAM) by the 12th');
  });

  it('shows a stored text as typed, puts the list away on Escape, and is a plain box with nobody to ask', async () => {
    const stored = vi.fn();
    const { unmount } = render(
      <PeopleSourceProvider value={async () => [SAM]}>
        <Box onStored={stored} initial="Thanks @[Sam Lee](usr_01SAMSAMSAM)" />
      </PeopleSourceProvider>,
    );
    const box = screen.getByLabelText('Comment') as HTMLTextAreaElement;
    expect(box.value).toBe('Thanks @Sam Lee');
    fireEvent.change(box, { target: { value: 'Thanks @Sam Lee and @sa', selectionStart: 23 } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(stored).toHaveBeenLastCalledWith('Thanks @[Sam Lee](usr_01SAMSAMSAM) and @sa');
    unmount();

    render(<Box onStored={stored} />);
    const plain = screen.getByLabelText('Comment');
    expect(plain.getAttribute('role')).toBeNull();
    fireEvent.change(plain, { target: { value: '@sa', selectionStart: 3 } });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
