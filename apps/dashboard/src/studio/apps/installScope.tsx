// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH COPY OF AN APP A SCREEN IS ABOUT.
 *
 * The same app may be installed once per database: Invoices & Receipts on
 * fernhill and on kiln are two installs, with their own settings, roles,
 * parts, sample rows and danger zone. An install's page sets its install id
 * here once, and every card under it reads and writes that install alone
 * (the requests carry `X-Adminium-Install`, and the query keys carry the id,
 * so one copy's answer is never shown for the other).
 *
 * Null is "the key's only install": a server that names none, a test, or a
 * card used outside an install's page.
 */
import { createContext, useContext, type ReactNode } from 'react';

const InstallContext = createContext<string | null>(null);

export function InstallScope({ installId, children }: { installId: string | null; children: ReactNode }) {
  return <InstallContext.Provider value={installId}>{children}</InstallContext.Provider>;
}

/** The install the surrounding page is about, or null. */
export function useInstallId(): string | null {
  return useContext(InstallContext);
}

export { addressOf, splitAddress } from '../../apps/installAddress.js';
