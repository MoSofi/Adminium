// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHOSE PAGE THIS IS. The host sets the add-on's key around a page of its
 * code (and around a slot fill of an add-on built on the data kit); the
 * kit's hooks read it to know whose tables a short name means. A module of
 * its own, so the host imports it without the kit.
 */
import { createContext, useContext } from 'react';

export const AddOnKeyContext = createContext<string | null>(null);

/** The add-on whose page is being drawn; a hook called anywhere else has no tables to name. */
export function useAddOnKey(): string {
  const key = useContext(AddOnKeyContext);
  if (key === null) throw new Error('The data kit\'s hooks are for an add-on\'s own page: this is not one.');
  return key;
}
