// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's door, as an app's own screen uses it: a plain element, a call to
 * `mount`, and the handle it answers.
 *
 * Worth proving: a part that is not built yet is refused by name; the mention
 * box stores a picked person exactly as the dashboard's box does; a change of
 * props leaves the box, its focus and its caret where they were; the words
 * are the person's language and no part asks for a word outside its set; a
 * person who may not read the people list still has a box to type in.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KIT_CONTRACT, KitPartUnavailableError, type KitMounted, type MentionsProps } from './contract.js';
import { contract, mount, parts } from './index.js';
import { sessionPeople } from './people.js';
import { clearOutsideWords, kitI18n, kitLocaleOf, loadKitWords, outsideWords } from './words.js';

const DANA = { id: 'usr_dana0001', name: 'Dana Reyes' };
const SAM = { id: 'usr_sam00002', name: 'Sam Lee' };

let host: HTMLElement;
let mounted: KitMounted<MentionsProps> | null = null;

beforeEach(() => {
  clearOutsideWords();
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  host.remove();
  vi.unstubAllGlobals();
  // The gate: nothing drawn in this file asked for a word its part does not carry.
  expect(outsideWords()).toEqual([]);
});

async function box(props: Partial<MentionsProps> = {}): Promise<{ onChange: ReturnType<typeof vi.fn<(stored: string) => void>>; people: ReturnType<typeof vi.fn<(query: string) => Promise<{ id: string; name: string }[]>>> }> {
  const onChange = vi.fn<(stored: string) => void>();
  const people = vi.fn(async (query: string) => [DANA, SAM].filter((person) => person.name.toLowerCase().includes(query.toLowerCase())));
  await act(async () => {
    mounted = await mount('mentions', host, { value: '', onChange, people, locale: 'en-US', dir: 'ltr', label: 'Comment', ...props });
  });
  return { onChange, people };
}

describe('the door', () => {
  it('says its contract and the parts it has', () => {
    expect(contract).toBe(KIT_CONTRACT);
    expect(parts).toEqual(['mentions', 'board', 'map', 'import', 'signature', 'photos']);
  });

  it('refuses a part it never heard of, by name; one that is named and not built yet has an error of its own', async () => {
    const unknown = await mount('toString' as never, host, {} as never).catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(KitPartUnavailableError);
    expect((unknown as KitPartUnavailableError).code).toBe('KIT_PART_UNKNOWN');
    expect((unknown as Error).message).toContain('mentions, board, map, import, signature, photos');
    expect(host.childElementCount).toBe(0);
    // Every part of contract 1 is built now; the error an older or a later kit answers with is still what apps check for.
    const notYet = new KitPartUnavailableError('import', 'KIT_PART_NOT_YET');
    expect(notYet.message).toContain('"import" is not available');
  });

  it('refuses a place that is not an element', async () => {
    await expect(mount('mentions', null as never, { value: '', onChange: () => undefined, locale: 'en-US', dir: 'ltr' })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('the mention box, mounted', () => {
  it('is in the page when the mount answers, under the wrapper the styles hang from', async () => {
    await box({ placeholder: 'Say something', rows: 5 });
    const wrapper = host.querySelector('.adm-kit');
    expect(wrapper?.getAttribute('data-kit-part')).toBe('mentions');
    expect(wrapper?.getAttribute('dir')).toBe('ltr');
    expect(wrapper?.getAttribute('lang')).toBe('en-US');
    expect(wrapper?.hasAttribute('data-kit-theme')).toBe(false);
    const area = screen.getByLabelText<HTMLTextAreaElement>('Comment');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.getAttribute('rows')).toBe('5');
    expect(area.placeholder).toBe('Say something');
  });

  it('stores a picked person as the dashboard’s box does, by keyboard', async () => {
    const { onChange, people } = await box();
    const user = userEvent.setup();
    const area = screen.getByLabelText<HTMLTextAreaElement>('Comment');
    await user.type(area, 'Thanks @da');
    const list = await screen.findByRole('listbox', { name: 'People to mention' });
    expect(people).toHaveBeenLastCalledWith('da');
    expect(list.textContent).toBe('Dana Reyes');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('Thanks @[Dana Reyes](usr_dana0001) ');
    // The box shows the name; the app never handed the value back, and the box kept it.
    expect(area.value).toBe('Thanks @Dana Reyes ');
    expect(document.activeElement).toBe(area);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(area, 'and more');
    expect(onChange).toHaveBeenLastCalledWith('Thanks @[Dana Reyes](usr_dana0001) and more');
  });

  it('takes a person by a click, and Escape puts the list away', async () => {
    const { onChange } = await box();
    const user = userEvent.setup();
    const area = screen.getByLabelText<HTMLTextAreaElement>('Comment');
    await user.type(area, '@s');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(area, 'a');
    await user.pointer({ keys: '[MouseLeft>]', target: await screen.findByRole('option', { name: 'Sam Lee' }) });
    expect(onChange).toHaveBeenLastCalledWith('@[Sam Lee](usr_sam00002) ');
  });

  it('shows a stored text as a person reads it and keeps who each name is', async () => {
    const { onChange } = await box({ value: 'Ask @[Sam Lee](usr_sam00002) first' });
    const user = userEvent.setup();
    const area = screen.getByLabelText<HTMLTextAreaElement>('Comment');
    expect(area.value).toBe('Ask @Sam Lee first');
    await user.type(area, '!');
    expect(onChange).toHaveBeenLastCalledWith('Ask @[Sam Lee](usr_sam00002) first!');
  });

  it('a change of props keeps the box, its focus and its caret; a new value replaces the text', async () => {
    await box();
    const user = userEvent.setup();
    const area = screen.getByLabelText<HTMLTextAreaElement>('Comment');
    await user.type(area, 'hello world');
    area.setSelectionRange(5, 5);
    act(() => mounted!.update({ invalid: true, placeholder: 'Now', label: 'Note' }));
    const after = screen.getByLabelText<HTMLTextAreaElement>('Note');
    expect(after).toBe(area);
    expect(after.value).toBe('hello world');
    expect(after.getAttribute('aria-invalid')).toBe('true');
    expect(after.placeholder).toBe('Now');
    expect(document.activeElement).toBe(after);
    expect(after.selectionStart).toBe(5);
    // The value the app already heard, handed back: nothing moves.
    act(() => mounted!.update({ value: 'hello world' }));
    expect(after.selectionStart).toBe(5);
    // A form cleared after a save.
    act(() => mounted!.update({ value: '' }));
    expect(after.value).toBe('');
    act(() => mounted!.update({ disabled: true, theme: 'dark' }));
    expect(after.disabled).toBe(true);
    expect(host.querySelector('.adm-kit')?.getAttribute('data-kit-theme')).toBe('dark');
  });

  it('speaks the person’s language and follows a change of it', async () => {
    await box({ locale: 'ar-EG', dir: 'rtl', label: 'تعليق' });
    const user = userEvent.setup();
    const wrapper = host.querySelector('.adm-kit');
    expect(wrapper?.getAttribute('dir')).toBe('rtl');
    expect(wrapper?.getAttribute('lang')).toBe('ar-EG');
    await user.type(screen.getByLabelText('تعليق'), '@da');
    expect(await screen.findByRole('listbox', { name: 'أشخاص يمكن ذكرهم' })).toBeTruthy();
    act(() => mounted!.update({ locale: 'de-DE', dir: 'ltr' }));
    await waitFor(() => expect(host.querySelector('.adm-kit')?.getAttribute('lang')).toBe('de-DE'));
    expect(screen.getByRole('listbox').getAttribute('aria-label')).toBe('Personen zum Erwähnen');
    expect(host.querySelector('.adm-kit')?.getAttribute('dir')).toBe('ltr');
  });

  it('with no list of its own asks the people who sign in here, with the session', async () => {
    const fetched = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ people: [DANA, { id: 7 }, null] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetched);
    const onChange = vi.fn<(stored: string) => void>();
    await act(async () => {
      mounted = await mount('mentions', host, { value: '', onChange, locale: 'en-US', dir: 'ltr', ariaLabel: 'Comment' });
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Comment'), '@d a');
    expect((await screen.findByRole('listbox')).textContent).toBe('Dana Reyes');
    const [url, init] = fetched.mock.calls.at(-1)!;
    expect(url).toBe('/api/v1/people?limit=8&q=d%20a');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.method).toBeUndefined();
  });

  it('someone who may not read the people list still has a box to type in', async () => {
    const fetched = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'APP_SCREENS_ONLY' } }), { status: 403 }));
    vi.stubGlobal('fetch', fetched);
    const onChange = vi.fn<(stored: string) => void>();
    await act(async () => {
      mounted = await mount('mentions', host, { value: '', onChange, locale: 'en-US', dir: 'ltr', ariaLabel: 'Comment' });
    });
    const user = userEvent.setup();
    const area = screen.getByLabelText<HTMLTextAreaElement>('Comment');
    await user.type(area, 'ping @da');
    await waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
    await user.type(area, 'na now');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith('ping @dana now');
    // Refused once, not asked again.
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('is gone after unmount, and a late update does nothing', async () => {
    await box();
    const handle = mounted!;
    act(() => handle.unmount());
    expect(host.childElementCount).toBe(0);
    expect(() => handle.update({ value: 'late' })).not.toThrow();
    expect(() => handle.unmount()).not.toThrow();
    expect(host.childElementCount).toBe(0);
  });
});

describe('the people who sign in here', () => {
  it('answers nobody for a failed read, and reads again next time', async () => {
    const fetcher = vi.fn(async () => new Response('down', { status: 502 }));
    const people = sessionPeople(fetcher as unknown as typeof fetch);
    expect(await people('a')).toEqual([]);
    expect(await people('b')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('answers nobody for a reply of another shape', async () => {
    const people = sessionPeople((async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch);
    expect(await people('a')).toEqual([]);
  });
});

describe('the words', () => {
  it('reads a language the kit has from what a config or a browser says, and en-US for any other', () => {
    expect(kitLocaleOf('ar-EG')).toBe('ar-EG');
    expect(kitLocaleOf('ar_EG')).toBe('ar-EG');
    expect(kitLocaleOf('ar')).toBe('ar-EG');
    expect(kitLocaleOf('zh-tw')).toBe('zh-TW');
    expect(kitLocaleOf('pt-BR')).toBe('en-US');
  });

  it('remembers a key a part asks for outside its set, and answers the English beside it', async () => {
    const { tag, words } = await loadKitWords('fr-FR');
    const i18n = kitI18n('mentions', tag, words);
    expect(i18n.t('ui:mentions.people', { defaultValue: 'People to mention' })).toBe('Personnes à mentionner');
    expect(i18n.t('ui:widgets.kanban.empty', { defaultValue: 'No cards for {who}', who: 'Dana' })).toBe('No cards for Dana');
    expect(outsideWords()).toEqual(['mentions ui:widgets.kanban.empty']);
    clearOutsideWords();
    // A words file that did not load is the network's doing: the English, and nothing remembered.
    expect(kitI18n('mentions', 'fr-FR', null).t('ui:mentions.people', { defaultValue: 'People to mention' })).toBe('People to mention');
    expect(outsideWords()).toEqual([]);
  });
});
