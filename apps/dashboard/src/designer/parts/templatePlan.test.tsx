// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The template plan card: the summary in the chat, the sheet it opens, the answer it sends, and how
 * it stands once it is sent, built, or answered with changes.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { TemplatePlanAnswer } from '../api.js';
import { BAKERY_PLAN, type PlanCardFixture } from './templatePlan.fixture.js';
import { linkFits, readPlanAnswer, TemplatePlanCard } from './templatePlan.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => cleanup());

/** A small plan: one of each, and an unknown package that starts unticked. */
const SMALL: PlanCardFixture = {
  id: 'plan-2',
  type: 'template-plan',
  site: { attachment: 'att_00000000000000000002', name: 'corner-cafe', pages: 1, files: 1 },
  tables: [{ table: 'dishes', label: 'Dishes', columns: [{ column: 'name', label: 'name' }], shownOn: ['Home'], fromTemplate: 1, filler: 0, madeUp: 0, publicRead: [] }],
  forms: [{ form: 'contact', label: 'Contact', table: 'messages', tableLabel: 'Messages', writable: ['message'], perHour: 1 }],
  report: [{ id: 'chat', label: 'Chat widget', where: 'On every page', status: 'not-available', build: 'a contact form in place of the chat', buildServerCode: false, leave: 'the chat bubble comes off the page' }],
  links: [{ id: 'press', label: 'Press' }],
  roles: [],
  added: [
    { id: 'font:@fontsource/lora', kind: 'font', family: 'Lora', name: '@fontsource/lora', version: '5.2.0', use: 'heading' },
    { id: 'package:pad-string', kind: 'package', name: 'pad-string', version: '1.3.0', role: 'other' },
  ],
};

const START: TemplatePlanAnswer = {
  tables: ['products', 'categories', 'orders', 'order_lines', 'subscribers'],
  decisions: { 'card-payments': 'replace', search: 'replace', 'chat-widget': 'replace' },
  links: { instagram: '', facebook: '', 'learn-home': '', 'learn-about': '', careers: '', press: '' },
  takeOutEmpty: true,
  added: ['package:react', 'package:react-dom', 'package:tailwindcss', 'font:@fontsource/lora', 'font:@fontsource/inter'],
};

function draw(over: Partial<Parameters<typeof TemplatePlanCard>[0]> = {}) {
  const onSend = vi.fn<(value: TemplatePlanAnswer) => void>();
  const view = render(<TemplatePlanCard card={BAKERY_PLAN} answered={false} busy={false} onSend={onSend} {...over} />);
  return { onSend, view };
}

async function openSheet(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: 'Review the plan…' }));
  return { user, sheet: screen.getByRole('dialog', { name: 'The plan for harbor-bakery' }) };
}

const section = (sheet: HTMLElement, title: RegExp) => within(sheet).getByRole('button', { name: title });

describe('the plan card in the chat', () => {
  it('sums the plan up with each count said in its own number', () => {
    draw();
    const card = screen.getByRole('group', { name: 'Your template, as an app' });
    expect(card.textContent).toContain('From harbor-bakery: 5 tables, 2 forms, 3 things to decide, 6 links to fill.');
    cleanup();
    draw({ card: SMALL });
    expect(screen.getByRole('group', { name: 'Your template, as an app' }).textContent).toContain('From corner-cafe: 1 table, 1 form, 1 thing to decide, 1 link to fill.');
  });

  it('draws the template’s words as text, never as markup', async () => {
    const card: PlanCardFixture = { ...SMALL, site: { ...SMALL.site, name: '<b>cafe</b>' }, tables: [{ ...SMALL.tables[0]!, label: '<img src=x onerror=alert(1)>' }] };
    const { view } = draw({ card });
    expect(view.container.querySelector('b')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Review the plan…' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('<img src=x onerror=alert(1)>: name');
    expect(sheet.textContent).toContain('The plan for <b>cafe</b>');
    expect(document.querySelector('img')).toBeNull();
    expect(within(sheet).getByRole('checkbox', { name: 'Make <img src=x onerror=alert(1)> a table' })).toBeTruthy();
  });
});

describe('the sheet', () => {
  it('opens on Close, hides the page behind it, and Escape gives the focus back to the button', async () => {
    const { view } = draw();
    const { user, sheet } = await openSheet();
    expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: 'Close' }));
    // The chat behind is out of reach while the sheet is open.
    expect(view.container.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(sheet.className).toContain('w-[560px]');
    expect(sheet.className).toContain('max-md:w-full');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review the plan…' }));
    // Close does the same.
    await user.click(screen.getByRole('button', { name: 'Review the plan…' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review the plan…' }));
  });

  it('opens on its first section; each header opens and closes its own', async () => {
    draw();
    const { user, sheet } = await openSheet();
    const tables = section(sheet, /What becomes a table/);
    const shows = section(sheet, /What the template shows/);
    expect(tables.getAttribute('aria-expanded')).toBe('true');
    expect(shows.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(shows.getAttribute('aria-controls') ?? '')?.hidden).toBe(true);
    await user.click(shows);
    expect(shows.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(shows.getAttribute('aria-controls') ?? '')?.hidden).toBe(false);
    await user.click(tables);
    expect(tables.getAttribute('aria-expanded')).toBe('false');
    // Each header says its count and how it stands.
    expect(tables.textContent).toContain('All ticked');
    expect(tables.textContent).toContain('5 tables');
    expect(section(sheet, /What the forms do/).textContent).toContain('Each writes to a table');
    expect(shows.textContent).toContain('14 work as they are · 6 of 6 links empty');
    expect(shows.textContent).toContain('3 to decide');
    expect(section(sheet, /Added to the project/).textContent).toContain('All ticked');
    expect(section(sheet, /Anything to change\?/).textContent).toContain('Optional');
  });

  it('says what each table is, and an unticked one stays fixed text on the page', async () => {
    draw();
    const { user, sheet } = await openSheet();
    expect(sheet.textContent).toContain('An unticked table stays fixed text on the page.');
    // The name algorithm spaces the bold label from its colon; the text itself has no space there.
    const products = within(sheet).getByRole('button', { name: /^Products ?: name, price, picture and 4 more$/ });
    expect(products.textContent).toBe('Products: name, price, picture and 4 more');
    expect(sheet.textContent).toContain('Shown on Home, Menu, Product');
    expect(sheet.textContent).toContain('12 sample rows from the template, 4 made up');
    expect(sheet.textContent).toContain('4 sample rows from the template');
    expect(sheet.textContent).toContain('3 sample rows, made up');
    expect(sheet.textContent).toContain('No sample rows');
    expect(products.getAttribute('aria-expanded')).toBe('false');
    await user.click(products);
    expect(products.getAttribute('aria-expanded')).toBe('true');
    expect(within(products.parentElement as HTMLElement).getByText('in stock')).toBeTruthy();

    expect(within(sheet).queryByText('Stays fixed text on the page.')).toBeNull();
    const box = within(sheet).getByRole('checkbox', { name: 'Make Categories a table' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    await user.click(box);
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(within(box.closest('li') as HTMLElement).getByText('Stays fixed text on the page.')).toBeTruthy();
    expect(section(sheet, /What becomes a table/).textContent).toContain('4 ticked, 1 stays fixed text');
    await user.click(within(sheet).getByRole('checkbox', { name: 'Make Orders a table' }));
    expect(section(sheet, /What becomes a table/).textContent).toContain('3 ticked, 2 stay fixed text');
  });

  it('says what each form writes, and how often a stranger may send it', async () => {
    draw({ start: { sheet: true, sections: ['forms'] } });
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('Contact: writes to Messages. Anyone can send it, up to 5 times an hour.');
    expect(sheet.textContent).toContain('Newsletter: writes to Subscribers. Anyone can send it.');
  });

  it('starts each thing not available on Replace where there is one, else Leave out, never Build', async () => {
    draw({ card: { ...BAKERY_PLAN, report: [...BAKERY_PLAN.report, { ...SMALL.report[0]!, id: 'map', label: 'Map' }] }, start: { sheet: true, sections: ['shows'] } });
    const sheet = screen.getByRole('dialog');
    const group = (name: string) => within(sheet).getByRole('radiogroup', { name });
    const checked = (name: string) => within(group(name)).getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true').map((radio) => radio.textContent);
    expect(checked('Card payments')).toEqual(['Replace: pay on delivery, marked paid by staff']);
    expect(checked('Search')).toEqual(['Replace: the list filters the rows it shows']);
    expect(checked('Chat widget')).toEqual(['Replace: a link to your chat service']);
    // No Replace offered: Leave out, and no Replace card at all.
    expect(checked('Map')).toEqual(['Leave out: the chat bubble comes off the page']);
    expect(within(group('Map')).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Build: a contact form in place of the chat', 'Leave out: the chat bubble comes off the page']);
    // Only a Build that needs server code says it is asked piece by piece.
    expect(within(group('Card payments')).getByRole('radio', { name: /^Build/ }).textContent).toContain('You approve each piece of server code as it is written.');
    expect(within(group('Search')).getByRole('radio', { name: /^Build/ }).textContent).not.toContain('server code');
    expect(within(sheet).getAllByText('Not available')).toHaveLength(4);
    expect(sheet.textContent).toContain('On the Order page');
  });

  it('moves between the choices with the arrow keys, the choice following the focus', async () => {
    draw({ start: { sheet: true, sections: ['shows'] } });
    const user = userEvent.setup();
    const group = within(screen.getByRole('dialog')).getByRole('radiogroup', { name: 'Card payments' });
    const [build, replace, leave] = within(group).getAllByRole('radio');
    // One stop in the tab order: reaching the group lands on the chosen card.
    expect(within(group).getAllByRole('radio').every((radio) => radio.getAttribute('tabindex') === '-1')).toBe(true);
    act(() => group.focus());
    expect(document.activeElement).toBe(replace);
    // Held, as a person's key is: a press that is let go at once never selects.
    await user.keyboard('{ArrowDown>}');
    expect(document.activeElement).toBe(leave);
    expect(leave?.getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{/ArrowDown}{ArrowUp>}');
    await user.keyboard('{/ArrowUp}{ArrowUp>}');
    await user.keyboard('{/ArrowUp}');
    expect(document.activeElement).toBe(build);
    expect(build?.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the list of what works as it is folded until asked', async () => {
    draw({ start: { sheet: true, sections: ['shows'] } });
    const user = userEvent.setup();
    const sheet = screen.getByRole('dialog');
    const works = within(sheet).getByRole('button', { name: '14 things work as they are' });
    expect(works.getAttribute('aria-expanded')).toBe('false');
    expect(within(sheet).queryByText('Navigation bar')).toBeNull();
    await user.click(works);
    expect(works.getAttribute('aria-expanded')).toBe('true');
    expect(within(sheet).getByText('Navigation bar')).toBeTruthy();
    expect(within(sheet).getByText('Footer')).toBeTruthy();
  });

  it('takes out the empty links unless told not to, and a bad address stops Build with its reason', async () => {
    const { onSend } = draw();
    const { user, sheet } = await openSheet();
    await user.click(section(sheet, /What the template shows/));
    const takeOut = within(sheet).getByRole('switch', { name: 'Take out the links I leave empty' });
    expect(takeOut.getAttribute('aria-checked')).toBe('true');
    await user.click(takeOut);
    expect(takeOut.getAttribute('aria-checked')).toBe('false');

    const instagram = within(sheet).getByRole('textbox', { name: 'Instagram' });
    expect(instagram.getAttribute('dir')).toBe('ltr');
    expect(instagram.getAttribute('placeholder')).toBe('https://');
    await user.type(instagram, 'instagram.com/harbor');
    // Not said while it is being typed.
    expect(within(sheet).queryByText(/Use an address that starts with/)).toBeNull();
    await user.click(section(sheet, /What the template shows/));
    await user.click(within(sheet).getByRole('button', { name: 'Build this' }));
    expect(onSend).not.toHaveBeenCalled();
    // The section opens again, the box says why and takes the focus.
    expect(section(sheet, /What the template shows/).getAttribute('aria-expanded')).toBe('true');
    expect(instagram.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(instagram.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Use an address that starts with https://, mailto: or tel:, or a page of the app like /about.');
    expect(document.activeElement).toBe(instagram);

    await user.clear(instagram);
    await user.type(instagram, 'https://instagram.com/harbor');
    expect(instagram.getAttribute('aria-invalid')).toBeNull();
    await user.type(within(sheet).getByRole('textbox', { name: 'Careers' }), 'mailto:jobs@harbor.example');
    await user.type(within(sheet).getByRole('textbox', { name: '“Learn more” on About' }), '/about');
    expect(section(sheet, /What the template shows/).textContent).toContain('3 of 6 links empty');
    await user.click(within(sheet).getByRole('button', { name: 'Build this' }));
    expect(onSend).toHaveBeenCalledWith({ ...START, links: { ...START.links, instagram: 'https://instagram.com/harbor', careers: 'mailto:jobs@harbor.example', 'learn-about': '/about' }, takeOutEmpty: false });
  });

  it('“Build this” sends the plan as it stands and closes the sheet', async () => {
    const { onSend } = draw();
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole('checkbox', { name: 'Make Subscribers a table' }));
    await user.click(section(sheet, /What the template shows/));
    await user.click(within(within(sheet).getByRole('radiogroup', { name: 'Search' })).getByRole('radio', { name: /^Leave out/ }));
    await user.click(section(sheet, /Added to the project/));
    await user.click(within(sheet).getByRole('checkbox', { name: /^Tailwind CSS/ }));
    expect(section(sheet, /Added to the project/).textContent).toContain('4 of 5 ticked');
    await user.click(within(sheet).getByRole('button', { name: 'Build this' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]?.[0]).toEqual({
      tables: ['products', 'categories', 'orders', 'order_lines'],
      decisions: { 'card-payments': 'replace', search: 'leave', 'chat-widget': 'replace' },
      links: START.links,
      takeOutEmpty: true,
      added: ['package:react', 'package:react-dom', 'font:@fontsource/lora', 'font:@fontsource/inter'],
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ticks only what Adminium knows to start with, as the needs card does', async () => {
    const { onSend } = draw({ card: SMALL, start: { sheet: true, sections: ['added'] } });
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('checkbox', { name: /^Lora — a typeface, for headings/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(sheet).getByRole('checkbox', { name: /^pad-string/ }).getAttribute('aria-checked')).toBe('false');
    expect(sheet.textContent).toContain('Asked for by the Designer');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Build this' }));
    expect(onSend.mock.calls[0]?.[0]).toEqual({ tables: ['dishes'], decisions: { chat: 'leave' }, links: { press: '' }, takeOutEmpty: true, added: ['font:@fontsource/lora'] });
  });

  it('“Send my changes” sends the words with the plan, and nothing is built from it', async () => {
    const { onSend } = draw();
    const { user, sheet } = await openSheet();
    await user.click(section(sheet, /Anything to change\?/));
    const box = within(sheet).getByRole('textbox', { name: 'Anything to change?' });
    expect(box.getAttribute('placeholder')).toBe('Write what you want different.');
    await user.type(box, '  Keep Categories as fixed text on the Menu page.  ');
    expect(section(sheet, /Anything to change\?/).textContent).toContain('Your changes are written');
    expect(within(sheet).queryByRole('button', { name: 'Build this' })).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Send my changes' }));
    expect(onSend).toHaveBeenCalledWith({ ...START, changes: 'Keep Categories as fixed text on the Menu page.' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Words alone build nothing: the card does not say it is building.
    expect(screen.queryByText('Building from the plan…')).toBeNull();
  });

  it('keeps what was chosen when the sheet is closed and opened again', async () => {
    draw();
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole('checkbox', { name: 'Make Products a table' }));
    await user.keyboard('{Escape}');
    const again = (await openSheet(user)).sheet;
    expect(within(again).getByRole('checkbox', { name: 'Make Products a table' }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('what the plan approves, said before it is approved', () => {
  /** Products shows five columns to visitors, one of them its id and one a ref with no label. */
  const SHOWN: PlanCardFixture = {
    ...BAKERY_PLAN,
    tables: BAKERY_PLAN.tables.map((table) =>
      table.table === 'products'
        ? { ...table, publicRead: ['id', 'name', 'price', 'picture', 'in_stock', 'sku'] }
        : table.table === 'subscribers'
          ? { ...table, columns: [{ column: 'email_address', label: 'email' }, { column: 'joined', label: 'joined' }] }
          : table,
    ),
    forms: BAKERY_PLAN.forms.map((form) => (form.form === 'newsletter' ? { ...form, writable: ['email_address'] } : form)),
    roles: [
      { role: 'staff', tables: ['orders', 'order_lines'] },
      { role: 'front-desk', tables: ['messages', 'categories'] },
    ],
  };

  it('says what visitors see of each ticked table, by its column names, short while folded', async () => {
    draw({ card: SHOWN });
    const { user, sheet } = await openSheet();
    const row = (name: string) => within(sheet).getByRole('checkbox', { name: `Make ${name} a table` }).closest('li') as HTMLElement;
    // Labels, not refs; a ref with no label as it is; never the id.
    expect(row('Products').textContent).toContain('Visitors see: name, price, picture and 2 more');
    await user.click(within(sheet).getByRole('button', { name: /^Products ?:/ }));
    expect(row('Products').textContent).toContain('Visitors see: name, price, picture, in stock, sku');
    expect(row('Products').textContent).not.toMatch(/Visitors see: id|, id/);
    expect(row('Categories').textContent).toContain('Visitors see: name');
    // What visitors read nothing of says nothing.
    expect(row('Orders').textContent).not.toContain('Visitors see');
    // An unticked table is not read by anyone: its line goes.
    await user.click(within(sheet).getByRole('checkbox', { name: 'Make Categories a table' }));
    expect(row('Categories').textContent).not.toContain('Visitors see');
  });

  it('says what visitors fill in on each form: names where the table is the plan’s, refs where it is not', async () => {
    draw({ card: SHOWN, start: { sheet: true, sections: ['forms'] } });
    const sheet = screen.getByRole('dialog');
    const forms = within(sheet).getAllByRole('listitem').map((item) => item.textContent);
    expect(forms.find((text) => text?.startsWith('Contact'))).toContain('Visitors fill in: name, email, message');
    expect(forms.find((text) => text?.startsWith('Newsletter'))).toContain('Visitors fill in: email');
    expect(forms.find((text) => text?.startsWith('Newsletter'))).not.toContain('email_address');
  });

  it('says what each line of an order sends, with the order’s own fields', async () => {
    draw({ card: { ...SHOWN, forms: [{ form: 'form-9', label: 'Checkout', table: 'shop_orders', tableLabel: 'Orders', writable: ['email'], lines: 'shop_lines', linesWritable: ['product', 'quantity'], perHour: null }] }, start: { sheet: true, sections: ['forms'] } });
    const sheet = screen.getByRole('dialog');
    const forms = within(sheet).getAllByRole('listitem').map((item) => item.textContent);
    expect(forms.find((text) => text?.startsWith('Checkout'))).toContain("Visitors fill in: email, product, quantity");
  });

  it('says who edits which tables in the dashboard, only of the tables the plan builds', async () => {
    draw({ card: SHOWN });
    const { user, sheet } = await openSheet();
    expect(sheet.textContent).toContain('Who edits them in the dashboard: staff (Orders, Order lines)');
    // A form’s table is the plan’s too, by the form’s own name for it.
    expect(sheet.textContent).toContain('Who edits them in the dashboard: front-desk (Messages, Categories)');
    await user.click(within(sheet).getByRole('checkbox', { name: 'Make Categories a table' }));
    expect(sheet.textContent).toContain('Who edits them in the dashboard: front-desk (Messages)');
    await user.click(within(sheet).getByRole('checkbox', { name: 'Make Orders a table' }));
    await user.click(within(sheet).getByRole('checkbox', { name: 'Make Order lines a table' }));
    expect(sheet.textContent).not.toContain('staff (');
  });

  it('sends the same answer: the lines only say what the plan holds', async () => {
    const { onSend } = draw({ card: SHOWN });
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole('button', { name: 'Build this' }));
    expect(onSend).toHaveBeenCalledWith(START);
  });

  it('draws the template’s words in them as text', async () => {
    const card: PlanCardFixture = {
      ...SMALL,
      tables: [{ ...SMALL.tables[0]!, columns: [{ column: 'name', label: '<img src=x onerror=alert(1)>' }], publicRead: ['name'] }],
      forms: [{ ...SMALL.forms[0]!, table: 'dishes', tableLabel: '<b>Dishes</b>', writable: ['name'] }],
      roles: [{ role: 'staff', tables: ['dishes'] }],
    };
    draw({ card: { ...card, tables: [{ ...card.tables[0]!, label: '<u>Dishes</u>' }] }, start: { sheet: true, sections: ['tables', 'forms'] } });
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('Visitors see: <img src=x onerror=alert(1)>');
    expect(sheet.textContent).toContain('Visitors fill in: <img src=x onerror=alert(1)>');
    expect(sheet.textContent).toContain('Who edits them in the dashboard: staff (<u>Dishes</u>)');
    expect(sheet.querySelector('img, u, b')).toBeNull();
  });
});

describe('once it is sent', () => {
  it('says it is building while the answer is on its way, and is the button again when it was not taken', async () => {
    const { onSend, view } = draw();
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole('button', { name: 'Build this' }));
    expect(onSend).toHaveBeenCalled();
    view.rerender(<TemplatePlanCard card={BAKERY_PLAN} answered={false} busy onSend={onSend} />);
    expect(screen.getByRole('status').textContent).toBe('Building from the plan…');
    expect(screen.queryByRole('button', { name: 'Review the plan…' })).toBeNull();
    view.rerender(<TemplatePlanCard card={BAKERY_PLAN} answered={false} busy={false} onSend={onSend} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Review the plan…' })).toBeTruthy();
  });

  it('builds while the turn runs, then keeps one line of what was built, replaced and left out', () => {
    const answer = { type: 'template-plan', ...START, tables: ['products', 'categories', 'orders', 'order_lines'], decisions: { 'card-payments': 'build', search: 'replace', 'chat-widget': 'leave' } };
    const { view } = draw({ answered: true, answer });
    expect(screen.getByRole('status').textContent).toBe('Building from the plan…');
    expect(screen.queryByRole('button')).toBeNull();
    view.rerender(<TemplatePlanCard card={BAKERY_PLAN} answered closed answer={answer} busy={false} onSend={() => undefined} />);
    const card = screen.getByRole('group', { name: 'Your template, as an app, answered' });
    expect(card.textContent).toContain('Answered');
    expect(card.textContent).toContain('Built: 4 tables, 2 forms. Also built: Card payments. Replaced: Search. Left out: Chat widget.');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('says “Left out: nothing.” and leaves out a line with nothing in it', () => {
    draw({ card: SMALL, answered: true, closed: true, answer: { tables: ['dishes'], decisions: { chat: 'build' } } });
    expect(screen.getByRole('group', { name: 'Your template, as an app, answered' }).textContent).toContain('Built: 1 table, 1 form. Also built: Chat widget. Left out: nothing.');
    expect(screen.queryByText(/Replaced:/)).toBeNull();
  });

  it('says changes were sent, in the person’s words, while the turn runs and after', () => {
    const answer = { ...START, changes: 'Keep <b>Categories</b>.' };
    const { view } = draw({ answered: true, answer });
    const card = screen.getByRole('group', { name: 'Your template, as an app, answered' });
    expect(card.textContent).toContain('You asked for changes to the plan: Keep <b>Categories</b>.');
    expect(screen.queryByRole('status')).toBeNull();
    view.rerender(<TemplatePlanCard card={BAKERY_PLAN} answered closed answer={answer} busy={false} onSend={() => undefined} />);
    expect(screen.getByRole('group', { name: 'Your template, as an app, answered' }).textContent).toContain('You asked for changes to the plan:');
  });

  it('says no answer was given when its turn ended without one', () => {
    draw({ closed: true });
    const card = screen.getByRole('group', { name: 'Your template, as an app, answered' });
    expect(card.textContent).toContain('No answer was given.');
    expect(within(card).queryByRole('button')).toBeNull();
  });
});

describe('the answer as history keeps it', () => {
  it('is read without trusting its shape', () => {
    expect(readPlanAnswer(null)).toBeNull();
    expect(readPlanAnswer('built')).toBeNull();
    expect(readPlanAnswer({ tables: ['a', 3], decisions: { x: 'build', y: 'burn' }, links: { l: 'https://a.example', m: 4 }, takeOutEmpty: 'no', added: 'all', changes: '  ' })).toEqual({
      tables: ['a'],
      decisions: { x: 'build' },
      links: { l: 'https://a.example' },
      takeOutEmpty: true,
      added: [],
    });
  });

  it('checks a link’s address as the server does', () => {
    for (const good of ['', '  ', 'https://harbor.example/menu', 'mailto:hello@harbor.example', 'tel:+44 20 7946 0000', '/about', '/']) expect(linkFits(good)).toBe(true);
    for (const bad of ['http://harbor.example', 'harbor.example', 'javascript:alert(1)', 'tel:call-us', '/about us', 'https://a b', '//evil.example/x']) expect(linkFits(bad)).toBe(false);
  });
});
