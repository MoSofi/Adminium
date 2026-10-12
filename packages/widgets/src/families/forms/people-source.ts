// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where a box that takes mentions asks who may be named. The host gives it
 * once (the dashboard: the people who sign in here, found by name); with
 * none, such a box is a plain text box.
 */
import { createContext, useContext } from 'react';

import type { MentionPerson } from './mentions.js';

export type PeopleSource = (query: string) => Promise<readonly MentionPerson[]>;

const PeopleSourceContext = createContext<PeopleSource | null>(null);

export const PeopleSourceProvider = PeopleSourceContext.Provider;

export function usePeopleSource(): PeopleSource | null {
  return useContext(PeopleSourceContext);
}
