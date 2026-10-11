// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Phone side's panel: what stands where the phone would be in each state
 * of the phone app (not added, not approved, no packages, working, failed, a
 * folder that cannot be built, built), and "Open on a phone": the dialog in
 * each state of the door a real phone comes through.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@adminium/ui';

import { installTestI18n } from '../../i18n/testing.js';
import type { PhoneDoorState, PhoneStanding, PhoneStatus } from '../api.js';
import { PhonePanel } from './PhonePanel.js';
import type { PreviewModel } from './usePreview.js';

const ONE = [{ address: '192.168.1.20', name: 'en0' }];
const TWO = [...ONE, { address: '10.0.0.7', name: 'en5' }];
const URL = 'exp://192.168.1.20:9680';
/** A code as the server draws it, with a mark no page should ever hold as its own markup. */
const QR = '<svg xmlns="http://www.w3.org/2000/svg" id="qr-mark"><script>window.qrRan = true</script><rect width="1" height="1"/></svg>';

function status(phone: PhoneStanding, door: PhoneDoorState = { state: 'off' }, addresses: PhoneStatus['addresses'] = ONE): PhoneStatus {
  return { phone, door, addresses };
}
const BUILT: PhoneStanding = { state: 'built', build: 'b1' };
function openDoor(over: Partial<Extract<PhoneDoorState, { state: 'open' }>> = {}): PhoneDoorState {
  return { state: 'open', app: 'shop', url: URL, qr: QR, address: '192.168.1.20', sdk: '54', connected: false, phoneSdk: null, lastSeen: null, ...over };
}

function model(over: Partial<PreviewModel> = {}): PreviewModel {
  return {
    noPreview: false,
    app: { key: 'shop', version: '0.1.0', sides: [] } as unknown as PreviewModel['app'],
    appPending: false,
    sides: ['dashboard', 'mobile'],
    side: 'mobile',
    setSide: vi.fn(),
    width: 'desktop',
    setWidth: vi.fn(),
    round: 0,
    reload: vi.fn(),
    sees: true,
    setSees: vi.fn(),
    prefix: '/apps/shop/mobile',
    to: '/apps/shop/mobile/',
    path: '/',
    spoken: false,
    go: vi.fn(),
    visited: [],
    frame: { current: null },
    dashboardSrc: '/',
    onStaffNavigate: vi.fn(),
    ticket: null,
    ticketError: null,
    running: false,
    phone: null,
    addPhone: vi.fn(),
    openPhoneDoor: vi.fn(),
    stopPhoneDoor: vi.fn(),
    phoneError: null,
    openTab: vi.fn(),
    canOpenTab: true,
    ...over,
  };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function panel(over: Partial<PreviewModel>) {
  const preview = model(over);
  const onFix = vi.fn<(message: string) => void>();
  const shown = render(
    <ThemeProvider>
      <PhonePanel preview={preview} frame={<div data-testid="frame" />} over={<div data-testid="over" />} onFix={onFix} compact={false} />
    </ThemeProvider>,
  );
  return { preview, onFix, container: shown.container };
}

/** The panel with a built phone app, and its dialog opened. */
async function dialogFor(door: PhoneDoorState, over: Partial<PreviewModel> = {}, addresses: PhoneStatus['addresses'] = ONE) {
  const made = panel({ phone: status(BUILT, door, addresses), ...over });
  await userEvent.click(screen.getByRole('button', { name: 'Open on a phone' }));
  const dialog = await screen.findByRole('dialog', { name: 'Open on a phone' });
  return { ...made, dialog };
}

describe('the phone panel, with no phone app to show', () => {
  it('draws nothing where the server builds no phone app', () => {
    const { container } = panel({ phone: null });
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks whether to add a phone app, says what that takes, and adds it on a yes', async () => {
    const { preview } = panel({ phone: status({ state: 'none' }) });
    expect(screen.getByText('Add a phone app?')).toBeTruthy();
    expect(screen.getByText('It installs Expo’s packages (about 350 MB, about a minute) and builds with Expo on this computer. This needs the network.')).toBeTruthy();
    // A question is not an alert, and there is no phone to open yet.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('frame')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open on a phone' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add the phone app' }));
    expect(preview.addPhone).toHaveBeenCalledTimes(1);
  });

  it('asks before building a phone app that came with the app, and builds it on a yes', async () => {
    const { preview } = panel({ phone: status({ state: 'unapproved', words: 'engine words nobody reads here', packages: ['expo', 'react-native'] }) });
    expect(screen.getByText('This app has a phone app. Build it on this computer?')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('engine words nobody reads here')).toBeNull();
    // What the yes installs is read before it is given.
    expect(screen.getByText('It asks for these packages:')).toBeTruthy();
    expect(screen.getByText(/expo\s+react-native/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Build it here' }));
    expect(preview.addPhone).toHaveBeenCalledTimes(1);
  });

  it('says the packages are not installed, and gets them when asked', async () => {
    const { preview } = panel({ phone: status({ state: 'no-packages', words: 'node_modules is missing' }) });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The phone app’s packages are not installed.');
    expect(alert.textContent).toContain('It installs Expo’s packages');
    await userEvent.click(within(alert).getByRole('button', { name: 'Get its packages' }));
    expect(preview.addPhone).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['adding', 'Adding the phone app…'],
    ['installing', 'Installing Expo’s packages (about 350 MB)…'],
    ['building', 'Building the phone app…'],
  ] as const)('says what is being done while it is %s, live, with nothing to press', (step, words) => {
    panel({ phone: status({ state: 'working', step }) });
    const line = screen.getByText(words);
    expect(line.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a build that failed in the engine’s words, tries again, and asks the Designer for the fix with those words', async () => {
    const words = 'Unable to resolve module ./Missing from mobile/App.tsx';
    const { preview, onFix } = panel({ phone: status({ state: 'failed', words }) });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The phone app did not build.');
    const code = alert.querySelector('code');
    expect(code?.textContent).toBe(words);
    expect(code?.getAttribute('dir')).toBe('ltr');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(preview.addPhone).toHaveBeenCalledTimes(1);
    await userEvent.click(within(alert).getByRole('button', { name: 'Ask the Designer to fix it' }));
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(onFix.mock.calls[0]?.[0]).toBe(`The phone app did not build: ${words} Please fix it.`);
  });

  it('shows a folder that cannot be built with its words and no "Try again": only the Designer can fix it', async () => {
    const words = 'mobile/app.json has no "expo" entry.';
    const { preview, onFix } = panel({ phone: status({ state: 'shape', words }) });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The phone app’s folder cannot be built as it is.');
    expect(alert.querySelector('code')?.textContent).toBe(words);
    expect(within(alert).getAllByRole('button').map((button) => button.textContent)).toEqual(['Ask the Designer to fix it']);
    await userEvent.click(within(alert).getByRole('button', { name: 'Ask the Designer to fix it' }));
    expect(onFix.mock.calls[0]?.[0]).toContain(words);
    expect(preview.addPhone).not.toHaveBeenCalled();
  });

  it('waits for the Designer: while a turn runs the yes is off, and a line says why', async () => {
    const { preview } = panel({ phone: status({ state: 'none' }), running: true });
    const add = screen.getByRole('button', { name: 'Add the phone app' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText('The Designer is working. This waits until it is done.')).toBeTruthy();
    await userEvent.click(add);
    expect(preview.addPhone).not.toHaveBeenCalled();
  });

  it('says no such thing when no turn runs', () => {
    panel({ phone: status({ state: 'none' }) });
    expect((screen.getByRole('button', { name: 'Add the phone app' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('The Designer is working. This waits until it is done.')).toBeNull();
  });

  it('turns "Try again" and the ask for a fix off while a turn runs', () => {
    panel({ phone: status({ state: 'failed', words: 'boom' }), running: true });
    expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Ask the Designer to fix it' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says what the server refused the last yes with, as an alert', () => {
    panel({ phone: status({ state: 'none' }), phoneError: 'A turn is running. Try again when it is done.' });
    expect(screen.getByRole('alert').textContent).toBe('A turn is running. Try again when it is done.');
  });
});

describe('the phone panel, with a built phone app', () => {
  it('draws the frame it is given in a phone, what the preview draws over it, the way to a real phone, and what this picture is not', () => {
    panel({ phone: status(BUILT) });
    const frame = screen.getByTestId('frame');
    expect(frame.parentElement).toBe(screen.getByTestId('over').parentElement);
    expect(screen.getByRole('button', { name: 'Open on a phone' })).toBeTruthy();
    expect(screen.getByText('Drawn by the browser: close to the phone, not the phone. The Designer does not look at this side.')).toBeTruthy();
    expect(screen.queryByText('Add a phone app?')).toBeNull();
    // The dialog is not there until asked for.
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('"Open on a phone"', () => {
  it('says what the code is for before showing it, and shows it for this computer’s one address', async () => {
    const { preview, dialog } = await dialogFor({ state: 'off' });
    expect(dialog.textContent).toContain('This shows a code. A phone with Expo Go, on the same network as this computer, scans it and runs the real app with this computer’s data. Nothing is sent anywhere else.');
    // One address is nothing to choose from.
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).queryByRole('status')).toBeNull();
    expect(within(dialog).queryByRole('img', { name: 'A code to scan with the phone' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show the code' }));
    expect(preview.openPhoneDoor).toHaveBeenCalledTimes(1);
    expect(preview.openPhoneDoor).toHaveBeenCalledWith('192.168.1.20');
  });

  it('lets a computer on several networks pick its address, the first one until another is picked', async () => {
    const { preview, dialog } = await dialogFor({ state: 'off' }, {}, TWO);
    const pick = within(dialog).getByLabelText('This computer’s address on the phone’s network') as HTMLSelectElement;
    expect(pick.tagName).toBe('SELECT');
    expect(Array.from(pick.options).map((option) => [option.value, option.textContent])).toEqual([
      ['192.168.1.20', '192.168.1.20 (en0)'],
      ['10.0.0.7', '10.0.0.7 (en5)'],
    ]);
    expect(pick.value).toBe('192.168.1.20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show the code' }));
    expect(preview.openPhoneDoor).toHaveBeenLastCalledWith('192.168.1.20');
    await userEvent.selectOptions(pick, '10.0.0.7');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show the code' }));
    expect(preview.openPhoneDoor).toHaveBeenLastCalledWith('10.0.0.7');
  });

  it('says a computer on no network cannot be reached, and shows no code for it', async () => {
    const { preview, dialog } = await dialogFor({ state: 'off' }, {}, []);
    expect(within(dialog).getByRole('alert').textContent).toBe('This computer is on no network a phone could reach. Connect it to Wi-Fi first.');
    const show = within(dialog).getByRole('button', { name: 'Show the code' }) as HTMLButtonElement;
    expect(show.disabled).toBe(true);
    await userEvent.click(show);
    expect(preview.openPhoneDoor).not.toHaveBeenCalled();
  });

  it('says the bundler is starting, live, and can be stopped then', async () => {
    const { preview, dialog } = await dialogFor({ state: 'starting', app: 'shop' });
    expect(within(dialog).getByText('Starting Expo’s bundler…').getAttribute('aria-live')).toBe('polite');
    expect(within(dialog).queryByRole('button', { name: 'Show the code' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
    expect(preview.stopPhoneDoor).toHaveBeenCalledTimes(1);
  });

  it('shows the code as a picture, never as markup of the page, with the steps, the address and what the door lets in', async () => {
    const { preview, dialog } = await dialogFor(openDoor());
    const code = within(dialog).getByRole('img', { name: 'A code to scan with the phone' }) as HTMLImageElement;
    expect(code.tagName).toBe('IMG');
    expect(code.getAttribute('src')).toBe(`data:image/svg+xml;utf8,${encodeURIComponent(QR)}`);
    // What the server drew is in no element of this page.
    expect(document.querySelector('#qr-mark')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect((window as unknown as { qrRan?: boolean }).qrRan).toBeUndefined();

    expect(within(dialog).getAllByRole('listitem').map((step) => step.textContent)).toEqual([
      'Install Expo Go on the phone (the one for SDK 54).',
      'Put the phone on the same network as this computer.',
      'Scan the code with the phone’s camera, or in Expo Go.',
    ]);
    const address = Array.from(dialog.querySelectorAll('code')).map((entry) => entry.textContent);
    expect(address).toEqual([URL]);
    expect(dialog.querySelector('code')?.getAttribute('dir')).toBe('ltr');
    expect(within(dialog).getByText('No phone has connected yet.').getAttribute('aria-live')).toBe('polite');
    expect(within(dialog).queryByText('A phone is connected.')).toBeNull();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(dialog.textContent).toContain('While this is open, the phone that scans the code can open this app’s phone preview and reach what the app makes public, and nothing else on this computer.');
    expect(dialog.textContent).toContain('Only the first phone to scan it is let in.');
    expect(dialog.textContent).toContain('It closes when you stop it, and after half an hour with no phone using it.');
    // The lead is for before the code.
    expect(dialog.textContent).not.toContain('This shows a code.');
    expect(within(dialog).queryByRole('button', { name: 'Show the code' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
    expect(preview.stopPhoneDoor).toHaveBeenCalledTimes(1);
  });

  it('names no SDK in the first step when the app’s is not known', async () => {
    const { dialog } = await dialogFor(openDoor({ sdk: null }));
    expect(within(dialog).getAllByRole('listitem')[0]?.textContent).toBe('Install Expo Go on the phone.');
  });

  it('copies the address, and says so', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    const { dialog } = await dialogFor(openDoor());
    // After the click that opened the dialog: the test's own keyboard and mouse put a clipboard of theirs on the page.
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    expect(within(dialog).queryByText('Copied')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy the address' }));
    expect(writeText).toHaveBeenCalledWith(URL);
    const said = await within(dialog).findByText('Copied');
    expect(said.getAttribute('aria-live')).toBe('polite');
  });

  it('says nothing was copied when the browser refuses the clipboard', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.reject(new Error('denied')));
    const { dialog } = await dialogFor(openDoor());
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy the address' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(within(dialog).queryByText('Copied')).toBeNull();
  });

  it('says when a phone is connected', async () => {
    const { dialog } = await dialogFor(openDoor({ connected: true }));
    expect(within(dialog).getByText('A phone is connected.')).toBeTruthy();
    expect(within(dialog).queryByText('No phone has connected yet.')).toBeNull();
  });

  it('says when the phone’s Expo Go is for another SDK, and which one to install', async () => {
    const { dialog } = await dialogFor(openDoor({ phoneSdk: '53' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('That phone’s Expo Go is for SDK 53, and this app is written for SDK 54. Install the Expo Go for SDK 54.');
  });

  it('says why the door could not open, in the server’s words, and offers the code again', async () => {
    const { preview, dialog } = await dialogFor({ state: 'closed', app: 'shop', why: 'failed', words: 'Expo could not start:\nport 9680 is in use' });
    expect(within(dialog).getByRole('alert').textContent).toBe('Expo could not start:\nport 9680 is in use');
    expect(dialog.textContent).toContain('This shows a code.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show the code' }));
    expect(preview.openPhoneDoor).toHaveBeenCalledWith('192.168.1.20');
  });

  it.each([
    ['idle', 'It closed after half an hour with no phone using it.'],
    ['network', 'This computer’s network changed, so the code led nowhere. Show a new one.'],
  ] as const)('says in the page’s own sentence that the door closed (%s), never in the server’s words', async (why, sentence) => {
    const { dialog } = await dialogFor({ state: 'closed', app: 'shop', why, words: 'the server’s own words' });
    expect(within(dialog).getByRole('status').textContent).toBe(sentence);
    expect(dialog.textContent).not.toContain('the server’s own words');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect((within(dialog).getByRole('button', { name: 'Show the code' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says nothing of a door the person stopped', async () => {
    const { dialog } = await dialogFor({ state: 'closed', app: 'shop', why: 'stopped', words: 'the server’s own words' });
    expect(within(dialog).queryByRole('status')).toBeNull();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(dialog.textContent).not.toContain('the server’s own words');
    expect(within(dialog).getByRole('button', { name: 'Show the code' })).toBeTruthy();
  });

  it('says what the server refused to open the door with, in the dialog', async () => {
    const { dialog } = await dialogFor({ state: 'off' }, { phoneError: 'That is not an address of this computer.' });
    expect(within(dialog).getByRole('alert').textContent).toBe('That is not an address of this computer.');
  });

  it('closes by its own button, and the panel stays', async () => {
    const { dialog } = await dialogFor({ state: 'off' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('frame')).toBeTruthy();
  });
});
