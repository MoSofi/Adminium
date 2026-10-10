// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project that is shared on the network instead of being built:
 * the addresses another device uses, and the port a project keeps
 * so that a phone's bookmark survives the next time it is shared.
 *
 * ELECTRON-FREE. The switch itself (stop, start on the network, the window) is
 * main's (`index.ts`); what is here is what can be wrong quietly.
 */
import { enumerateLanUrls } from './lan.js';

type Interfaces = Parameters<typeof enumerateLanUrls>[1];

export interface ShareAddress {
  /** `http://office-mac.local:4712` */
  readonly url: string;
  /** The network interface it is on (`en0`, `Wi-Fi`), or `null` for the computer's own name. */
  readonly via: string | null;
  /** The one to give out first: the computer's name, which stays the same when the network gives it another number. */
  readonly best: boolean;
}

/**
 * A computer's name as other devices on the network ask for it: its first
 * label, lower case, with `.local`. `null` for a name that cannot be one
 * (empty, `localhost`, characters a host name may not have).
 */
export function localName(hostname: string): string | null {
  const first = (hostname.split('.')[0] ?? '').trim().toLowerCase();
  if (first === '' || first === 'localhost' || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(first)) return null;
  return `${first}.local`;
}

/** The addresses a shared project answers on, the computer's name first, then one per network it is on. */
export function shareAddresses(port: number, hostname: string, interfaces?: Interfaces): ShareAddress[] {
  const raw = interfaces === undefined ? enumerateLanUrls(port) : enumerateLanUrls(port, interfaces);
  // With no network at all there is nobody to give the name to.
  if (raw.length === 0) return [];
  const name = localName(hostname);
  return [
    // Written as the interface addresses are (`entry.address`): one shape of address in this app, which the offline
    // gate knows by that name.
    ...(name === null ? [] : [{ address: name }]).map((entry) => ({ url: `http://${entry.address}:${String(port)}`, via: null, best: true })),
    ...raw.map((entry, index) => ({ url: entry.url, via: entry.interfaceName, best: name === null && index === 0 })),
  ];
}

export interface SharePort {
  readonly port: number;
  /** The project had another port before and it is taken now: the address other devices know has changed. */
  readonly changedFrom: number | null;
}

/**
 * The port a project is shared on: the one it had, while that is free; else a
 * free one (and the caller says the address changed). The first time, a free
 * one, which is then kept.
 */
export async function sharePortFor(kept: number | null, isFree: (port: number) => Promise<boolean>, pickFree: () => Promise<number>): Promise<SharePort> {
  if (kept !== null && (await isFree(kept))) return { port: kept, changedFrom: null };
  return { port: await pickFree(), changedFrom: kept };
}
