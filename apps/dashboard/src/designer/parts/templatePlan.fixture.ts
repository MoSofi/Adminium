// SPDX-License-Identifier: AGPL-3.0-only
/** A template plan as the server sends it, for the card's tests and stories: the bakery of the comp. */
import type { DesignerCard } from '../api.js';

export type PlanCardFixture = Extract<DesignerCard, { type: 'template-plan' }>;

const columns = (...names: string[]): { column: string; label: string }[] => names.map((label) => ({ column: label.replaceAll(' ', '_'), label }));

export const BAKERY_PLAN: PlanCardFixture = {
  id: 'plan-1',
  type: 'template-plan',
  site: { attachment: 'att_00000000000000000001', name: 'harbor-bakery', pages: 9, files: 64 },
  tables: [
    { table: 'products', label: 'Products', columns: columns('name', 'price', 'picture', 'description', 'category', 'in stock', 'weight'), shownOn: ['Home', 'Menu', 'Product'], fromTemplate: 12, filler: 0, madeUp: 4, publicRead: ['name', 'price'] },
    { table: 'categories', label: 'Categories', columns: columns('name', 'order'), shownOn: ['Menu'], fromTemplate: 4, filler: 0, madeUp: 0, publicRead: ['name'] },
    { table: 'orders', label: 'Orders', columns: columns('number', 'customer', 'email', 'status', 'total', 'placed at', 'notes'), shownOn: ['Order', 'Thank you'], fromTemplate: 0, filler: 0, madeUp: 3, publicRead: [] },
    { table: 'order_lines', label: 'Order lines', columns: columns('order', 'product', 'quantity', 'price'), shownOn: ['Order'], fromTemplate: 0, filler: 0, madeUp: 6, publicRead: [] },
    { table: 'subscribers', label: 'Subscribers', columns: columns('email', 'joined'), shownOn: ['the footer of every page'], fromTemplate: 0, filler: 0, madeUp: 0, publicRead: [] },
  ],
  forms: [
    { form: 'contact', label: 'Contact', table: 'messages', tableLabel: 'Messages', writable: ['name', 'email', 'message'], perHour: 5 },
    { form: 'newsletter', label: 'Newsletter', table: 'subscribers', tableLabel: 'Subscribers', writable: ['email'], perHour: null },
  ],
  report: [
    ...['Navigation bar', 'Mobile menu', 'Picture carousel on Home', 'Opening hours', 'Menu list', 'Product pages', 'Cart', 'Order form', 'Thank-you page', 'Contact form', 'Newsletter sign-up', 'Questions that open and close', 'Journal posts', 'Footer'].map((label, index) => ({
      id: `works-${String(index)}`,
      label,
      where: 'On every page',
      status: 'works' as const,
      buildServerCode: false,
    })),
    {
      id: 'card-payments',
      label: 'Card payments',
      where: 'On the Order page',
      status: 'not-available',
      build: 'a payment link emailed for each order (needs your payment account).',
      buildServerCode: true,
      replace: 'pay on delivery, marked paid by staff',
      leave: 'the card form comes off the page',
    },
    { id: 'search', label: 'Search', where: 'On the Menu page', status: 'not-available', build: 'a search the page runs over the rows it has', buildServerCode: false, replace: 'the list filters the rows it shows', leave: 'the search box comes off the page' },
    { id: 'chat-widget', label: 'Chat widget', where: 'On every page', status: 'not-available', build: 'a contact form in place of the chat', buildServerCode: false, replace: 'a link to your chat service', leave: 'the chat bubble comes off the page' },
  ],
  links: [
    { id: 'instagram', label: 'Instagram' },
    { id: 'facebook', label: 'Facebook' },
    { id: 'learn-home', label: '“Learn more” on Home' },
    { id: 'learn-about', label: '“Learn more” on About' },
    { id: 'careers', label: 'Careers' },
    { id: 'press', label: 'Press' },
  ],
  roles: [{ role: 'staff', tables: ['orders', 'order_lines'] }],
  added: [
    { id: 'package:react', kind: 'package', name: 'react', version: '19.2.0', role: 'screens' },
    { id: 'package:react-dom', kind: 'package', name: 'react-dom', version: '19.2.0', role: 'screens' },
    { id: 'package:tailwindcss', kind: 'package', name: 'tailwindcss', version: '4.1.0', role: 'tailwind' },
    { id: 'font:@fontsource/lora', kind: 'font', family: 'Lora', name: '@fontsource/lora', version: '5.2.0', use: 'heading' },
    { id: 'font:@fontsource/inter', kind: 'font', family: 'Inter', name: '@fontsource/inter', version: '5.2.0', use: 'body' },
  ],
};
