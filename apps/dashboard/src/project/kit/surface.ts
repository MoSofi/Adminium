// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether kit pieces render inside a project card widget, whose widget frame
 * is already a card (`widgets.tsx`). `Stat` draws no card of its own there,
 * so a card that shows one number has one border, not two.
 */
import { createContext } from 'react';

export const InProjectCardContext = createContext(false);
