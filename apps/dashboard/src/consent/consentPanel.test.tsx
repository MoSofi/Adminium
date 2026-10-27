// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's "E-mail consent" panel, state by state, against a
 * pretend server, as the people who use it: a marketer who may change the
 * record but is shown its address masked (not an Admin), and a reader who
 * may change nothing.
 *
 *  - agreed, not asked, unsubscribed, on the do-not-email list (the banner),
 *    no address, an erased person (calm, nothing offered);
 *  - "Replied" carries a real description, says it in full before it acts,
 *    and makes one call; the panel reads the server again and its history
 *    line shows, with a toast;
 *  - "Record consent" sends exactly the purpose, how and note chosen, one
 *    call; the dialog names the person, and never an address the reader is
 *    shown masked;
 *  - "They said no" asks first, makes one call, and is not offered once the
 *    address is on the list;
 *  - in Arabic, "Replied" is a form that fits anyone, and nothing is spaced.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageI18n } from '@adminium/i18n/page';
import { I18nProvider } from '@adminium/i18n/react';
import { EN_US_RESOURCES } from '@adminium/i18n/resources';
import arCommon from '@adminium/i18n/resources/ar-eg/common';

import { ConsentPanel, type ConsentFrames } from './ConsentPanel.js';
import { DIALOG_FRAMES } from './consentDialogs.js';
import type { ConsentClient, ConsentEventView, ConsentPanelView } from './consentTypes.js';

const RECORD = { connectionId: 'conn_1', table: 'main.crm_contacts', recordId: '7' };
const AT = Date.UTC(2026, 5, 12, 13, 0, 0);
const ADDRESS = 'marta.kovac@cobaltlegal.example';

const event = (patch: Partial<ConsentEventView>): ConsentEventView => ({
  id: `ev_${Math.random().toString(36).slice(2)}`,
  purpose: 'newsletter',
  state: 'yes',
  source: 'staff',
  detail: null,
  how: null,
  note: null,
  staff: null,
  wordingVersion: null,
  ip: null,
  at: AT,
  confirmedAt: null,
  ...patch,
});

const formYes = event({ source: 'form', detail: 'Book a showroom visit', wordingVersion: 'v3 en-US', confirmedAt: AT + 120_000 });

function viewOf(patch: Partial<ConsentPanelView> = {}): ConsentPanelView {
  return {
    declared: true,
    erased: false,
    columns: { address: 'email', name: 'name' },
    addressKnown: true,
    purposes: [
      { purpose: 'newsletter', state: 'yes', event: formYes },
      { purpose: 'surveys', state: 'not-asked', event: null },
    ],
    stopped: null,
    lastReplied: null,
    history: [formYes],
    mayChange: true,
    ...patch,
  };
}

/** A pretend server: each call recorded, the panel's view changed as the real one would. */
function fakeClient(start: ConsentPanelView) {
  let view = start;
  const calls: { what: string; body?: unknown }[] = [];
  const client: ConsentClient = {
    panel: vi.fn(async () => view),
    recordConsent: vi.fn(async (_record, input) => {
      calls.push({ what: 'record', body: input });
      const made = event({ purpose: input.purpose, how: input.how, note: input.note, staff: { id: 'usr_mia', label: 'Mia Marketer' }, at: AT + 86_400_000 });
      view = { ...view, history: [made, ...view.history], purposes: view.purposes.map((one) => (one.purpose === input.purpose ? { ...one, state: 'yes', event: made } : one)) };
      return made;
    }),
    replied: vi.fn(async () => {
      calls.push({ what: 'replied' });
      const made = event({ purpose: null, state: 'replied', staff: { id: 'usr_mia', label: 'Mia Marketer' }, at: AT + 2 * 86_400_000 });
      view = { ...view, history: [made, ...view.history], lastReplied: made.at };
      return made;
    }),
    saidNo: vi.fn(async () => {
      calls.push({ what: 'said-no' });
      view = { ...view, stopped: { since: AT + 3 * 86_400_000, reason: 'hand', origin: null } };
      return { added: true };
    }),
  };
  return { client, calls, now: () => view };
}

/** The panel as the record page holds it: read again after a change. */
function Harness({ client, start, address, notify, frames }: { client: ConsentClient; start: ConsentPanelView; address: string | null; notify?: (message: string) => void; frames?: ConsentFrames }): ReactNode {
  const [view, setView] = useState(start);
  return (
    <ConsentPanel
      record={RECORD}
      view={view}
      client={client}
      name="Marta Kovac"
      address={address}
      locale="en-GB"
      onChanged={async () => setView(await client.panel(RECORD))}
      {...(notify === undefined ? {} : { notify: (message: string) => notify(message) })}
      {...(frames === undefined ? {} : { frames })}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe('the e-mail consent panel', () => {
  it('shows a person who agreed: their purposes, and the history newest first', () => {
    const { client } = fakeClient(viewOf());
    render(<Harness client={client} start={viewOf()} address={null} />);
    expect(screen.getByRole('heading', { name: 'E-mail consent' })).not.toBeNull();
    expect(screen.getByTestId('consent-badge-newsletter').textContent).toBe('May be e-mailed');
    expect(screen.getByTestId('consent-badge-surveys').textContent).toBe('Not asked');
    expect(screen.getByTestId('consent-purpose-newsletter').textContent).toContain('Agreed on the form ‘Book a showroom visit’ (wording v3)');
    const lines = within(screen.getByTestId('consent-history')).getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(lines[0]).toContain('Confirmed by e-mail');
    expect(lines[1]).toContain('Agreed on the form ‘Book a showroom visit’ (wording v3)');
    expect(screen.queryByTestId('consent-banner')).toBeNull();
  });

  it('shows the do-not-email banner and an unsubscribed purpose', () => {
    const unsubscribed = event({ state: 'no', source: 'unsubscribe', detail: 'link', at: AT + 5 * 86_400_000 });
    const view = viewOf({ stopped: { since: AT + 5 * 86_400_000, reason: 'link', origin: 'Spring newsletter' }, purposes: [{ purpose: 'newsletter', state: 'no', event: unsubscribed }, { purpose: 'surveys', state: 'not-asked', event: null }], history: [unsubscribed, formYes] });
    render(<Harness client={fakeClient(view).client} start={view} address={null} />);
    const banner = screen.getByTestId('consent-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(banner.textContent).toContain('On the do-not-email list since 17 Jun 2026 (unsubscribed).');
    expect(screen.getByTestId('consent-badge-newsletter').textContent).toBe('Unsubscribed');
    expect(screen.getByTestId('consent-history').textContent).toContain('Unsubscribed from the Newsletter by the e-mail link');
    // Already on the list: "They said no" has nothing left to do.
    expect(screen.queryByTestId('consent-said-no')).toBeNull();
  });

  it('offers a reader nothing to press', () => {
    const view = viewOf({ mayChange: false });
    render(<Harness client={fakeClient(view).client} start={view} address={null} />);
    expect(screen.getByTestId('consent-panel')).not.toBeNull();
    expect(screen.queryByTestId('consent-replied')).toBeNull();
    expect(screen.queryByTestId('consent-record')).toBeNull();
    expect(screen.queryByTestId('consent-said-no')).toBeNull();
  });

  it('shows an erased person calmly, with nothing to press and nothing known', () => {
    const view = viewOf({ erased: true, addressKnown: false, mayChange: false, history: [], purposes: [{ purpose: 'newsletter', state: 'not-asked', event: null }, { purpose: 'surveys', state: 'not-asked', event: null }] });
    render(<Harness client={fakeClient(view).client} start={view} address={null} />);
    expect(screen.getByTestId('consent-erased').textContent).toContain('This person was erased.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('consent-history')).toBeNull();
    expect(screen.queryByTestId('consent-record')).toBeNull();
  });

  it('says a record with no address has none, and offers no "They said no"', () => {
    const view = viewOf({ addressKnown: false, history: [], purposes: [{ purpose: 'newsletter', state: 'not-asked', event: null }, { purpose: 'surveys', state: 'not-asked', event: null }] });
    render(<Harness client={fakeClient(view).client} start={view} address={null} />);
    expect(screen.getByTestId('consent-no-address').textContent).toBe('This record has no e-mail address yet.');
    expect(screen.getByTestId('consent-history-empty')).not.toBeNull();
    expect(screen.queryByTestId('consent-said-no')).toBeNull();
    expect(screen.getByTestId('consent-record')).not.toBeNull();
  });

  it('"Replied" is described, says what it does before it acts, and writes once', async () => {
    const user = userEvent.setup();
    const { client, calls } = fakeClient(viewOf());
    const notify = vi.fn();
    render(<Harness client={client} start={viewOf()} address={null} notify={notify} />);
    const replied = screen.getByTestId('consent-replied');
    const hint = document.getElementById(replied.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('They replied to a marketing e-mail. This stops their e-mail sequences.');
    await user.click(replied);
    const confirm = await screen.findByTestId('consent-replied-confirm');
    expect(confirm.textContent).toContain('This stops their e-mail sequences.');
    // Focus starts on Cancel: nothing is written by a stray Enter.
    expect(document.activeElement?.textContent).toBe('Cancel');
    await user.click(screen.getByTestId('consent-replied-confirm-yes'));
    await waitFor(() => expect(screen.getByTestId('consent-history').textContent).toContain('Replied — e-mail sequences stopped'));
    expect(calls).toEqual([{ what: 'replied' }]);
    expect(client.panel).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Marked as replied. Their e-mail sequences stop.');
    expect(screen.getByTestId('consent-history').textContent).toContain('by Mia Marketer');
  });

  it('"Record consent" sends exactly what was chosen, once, and names the person without a masked address', async () => {
    const user = userEvent.setup();
    const { client, calls } = fakeClient(viewOf());
    render(<Harness client={client} start={viewOf()} address={null} />);
    await user.click(screen.getByTestId('consent-record'));
    const dialog = await screen.findByTestId('consent-dialog');
    // Shown masked to this reader: the dialog names the person and nothing else.
    expect(within(dialog).getByTestId('consent-dialog-who').textContent).toBe('Marta Kovac');
    expect(document.body.textContent).not.toContain('cobaltlegal');
    await user.click(within(dialog).getByRole('radio', { name: 'Surveys' }));
    await user.click(within(dialog).getByRole('radio', { name: 'By phone' }));
    await user.type(within(dialog).getByTestId('consent-dialog-note'), '  Rang the office ');
    await user.click(within(dialog).getByTestId('consent-dialog-save'));
    await waitFor(() => expect(screen.queryByTestId('consent-dialog')).toBeNull());
    expect(calls).toEqual([{ what: 'record', body: { purpose: 'surveys', how: 'phone', note: 'Rang the office' } }]);
    expect(screen.getByTestId('consent-badge-surveys').textContent).toBe('May be e-mailed');
    expect(screen.getByTestId('consent-history').textContent).toContain('Agreed by phone, recorded by Mia Marketer');
    // Which purpose it was for, and the note in quotation marks, follow the time.
    expect(screen.getByTestId('consent-history').textContent).toContain('Surveys · “Rang the office”');
    // Without a toast to tell it to, the panel says it in a polite line of its own.
    expect(screen.getByRole('status').textContent).toBe('Consent recorded: Surveys.');
  });

  it('names the address in the dialog for a reader shown it in clear', async () => {
    const user = userEvent.setup();
    const { client } = fakeClient(viewOf());
    render(<Harness client={client} start={viewOf()} address={ADDRESS} />);
    await user.click(screen.getByTestId('consent-record'));
    expect((await screen.findByTestId('consent-dialog-who')).textContent).toBe(`Marta Kovac · ${ADDRESS}`);
  });

  it('on the record page, asks in the house\'s dialogs: a confirm over the page, and the Record consent dialog', async () => {
    const user = userEvent.setup();
    const { client, calls } = fakeClient(viewOf());
    render(<Harness client={client} start={viewOf()} address={null} frames={DIALOG_FRAMES} />);
    await user.click(screen.getByTestId('consent-replied'));
    const confirm = await screen.findByRole('alertdialog', { name: 'Mark as replied?' });
    expect(screen.getByTestId('consent-panel').contains(confirm)).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await user.click(screen.getByTestId('consent-record'));
    const dialog = await screen.findByRole('dialog', { name: 'Record consent' });
    expect(within(dialog).getByTestId('consent-dialog-who').textContent).toBe('Marta Kovac');
    await user.click(within(dialog).getByRole('radio', { name: 'On paper' }));
    // The chosen answer is the one drawn as chosen.
    expect(within(dialog).getByRole('radio', { name: 'On paper' }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByRole('radio', { name: 'In person' }).getAttribute('aria-checked')).toBe('false');
    await user.click(within(dialog).getByTestId('consent-dialog-save'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toEqual([{ what: 'record', body: { purpose: 'newsletter', how: 'paper', note: null } }]);
  });

  it('"They said no" asks first, writes once, and then shows the banner', async () => {
    const user = userEvent.setup();
    const { client, calls } = fakeClient(viewOf());
    render(<Harness client={client} start={viewOf()} address={null} />);
    await user.click(screen.getByTestId('consent-said-no'));
    expect((await screen.findByTestId('consent-said-no-confirm')).textContent).toContain('Only a Super Admin can take them off the list.');
    await user.click(screen.getByTestId('consent-said-no-confirm-yes'));
    await waitFor(() => expect(screen.getByTestId('consent-banner').textContent).toContain('(added by hand)'));
    expect(calls).toEqual([{ what: 'said-no' }]);
    expect(screen.queryByTestId('consent-said-no')).toBeNull();
  });

  it('says a refused change in words, and writes nothing more', async () => {
    const user = userEvent.setup();
    const { client } = fakeClient(viewOf());
    client.replied = vi.fn(async () => {
      throw Object.assign(new Error('erased'), { details: { reason: 'ERASED' } });
    });
    render(<Harness client={client} start={viewOf()} address={null} />);
    await user.click(screen.getByTestId('consent-replied'));
    await user.click(await screen.findByTestId('consent-replied-confirm-yes'));
    expect((await screen.findByRole('status')).textContent).toBe('This person was erased: nothing more is recorded about them.');
    expect(client.panel).not.toHaveBeenCalled();
  });

  it('in Arabic, says "Replied" in a form that fits anyone, with no letter spacing', async () => {
    const english = EN_US_RESOURCES.common;
    const i18n = await createPageI18n({ locale: 'ar_EG', namespace: 'common', english, loadBundle: async (tag, ns) => (tag === 'ar-EG' && ns === 'common' ? arCommon : null) });
    const view = viewOf();
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <div dir="rtl" lang="ar">
            <Harness client={fakeClient(view).client} start={view} address={null} />
          </div>
        </I18nProvider>,
      );
    });
    const replied = screen.getByTestId('consent-replied');
    expect(replied.textContent).toBe('تمّ الردّ');
    // Not the comp's feminine form, on the button or in its description.
    const hint = document.getElementById(replied.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
    expect(hint).toBe('وصل ردّ على بريد تسويقي. يوقف هذا سلاسل البريد المرسلة إلى هذا الشخص.');
    expect(`${replied.textContent} ${hint}`).not.toMatch(/ردّت|ردت/);
    expect(screen.getByRole('heading', { name: 'موافقة البريد الإلكتروني' }).className).toContain('rtl:tracking-normal');
  });
});
